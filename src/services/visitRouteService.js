const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const customerAlertService = require('./customerAlertService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const routeInclude = {
  assignedOfficer: { select: { id: true, fullName: true, email: true } },
  territory: { select: { id: true, name: true, region: true, county: true } }
};

const normalizeStringId = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const assertValidOfficer = async (assignedOfficerId) => {
  const normalizedOfficerId = normalizeStringId(assignedOfficerId);
  if (!normalizedOfficerId) throw new AppError('Assigned officer is required', 422);

  const officer = await prisma.user.findFirst({
    where: {
      id: normalizedOfficerId,
      deletedAt: null,
      isActive: true
    },
    select: { id: true }
  });

  if (!officer) {
    throw new AppError('Assigned officer was not found. Select an active staff member.', 422);
  }

  return normalizedOfficerId;
};

const assertValidTerritory = async (territoryId) => {
  const normalizedTerritoryId = normalizeStringId(territoryId);
  if (!normalizedTerritoryId) throw new AppError('Territory is required', 422);

  const territory = await prisma.salesTerritory.findFirst({
    where: {
      id: normalizedTerritoryId,
      deletedAt: null
    },
    select: { id: true }
  });

  if (!territory) {
    throw new AppError('Territory was not found. Select an active territory.', 422);
  }

  return normalizedTerritoryId;
};

async function createMissedVisitTaskAndAlert(tx, route, stop, auth, req) {
  await customerAlertService.create(stop.customerId, {
    alertType: 'OVERDUE_FOLLOWUP',
    title: 'Missed planned visit',
    description: `Planned route stop was missed for ${stop.customer?.businessName || 'customer'} on ${new Date(route.routeDate).toDateString()}.`,
    severity: 'HIGH',
    dueDate: route.routeDate,
    status: 'OPEN'
  }, auth, req, tx);

  const task = await tx.task.create({
    data: {
      title: `Follow up missed visit: ${stop.customer?.businessName || 'Customer'}`,
      description: `Route ${route.title} missed stop #${stop.visitOrder}. Capture visit outcome and next action.`,
      assignedToId: route.assignedOfficerId,
      assignedById: auth.userId,
      dueDate: new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)),
      priority: 'HIGH',
      status: 'TODO',
      customerId: stop.customerId
    }
  });

  await auditService.log({
    actorId: auth.userId,
    action: AUDIT_ACTIONS.TASK_CREATED,
    entityType: 'Task',
    entityId: task.id,
    newValues: {
      ...task,
      summary: `Follow-up task created from missed route stop: ${route.title}`
    },
    req
  }, tx);

  return task;
}

const visitRouteService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.assignedOfficerId) where.assignedOfficerId = query.assignedOfficerId;
    if (query.territoryId) where.territoryId = query.territoryId;
    if (query.dateFrom || query.dateTo) {
      where.routeDate = {};
      if (query.dateFrom) where.routeDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.routeDate.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.visitRoute.findMany({ where, include: routeInclude, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.visitRoute.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async create(auth, data, req) {
    const assignedOfficerId = await assertValidOfficer(data.assignedOfficerId);
    const territoryId = await assertValidTerritory(data.territoryId);

    const created = await prisma.visitRoute.create({
      data: {
        title: data.title,
        assignedOfficerId,
        territoryId,
        routeDate: new Date(data.routeDate),
        status: data.status || 'PLANNED',
        notes: data.notes
      },
      include: routeInclude
    });

    if (created.assignedOfficerId && created.assignedOfficerId !== auth.userId) {
      await notificationService.create({
        userId: created.assignedOfficerId,
        type: 'SYSTEM',
        title: 'Visit route assigned',
        body: `${created.title} · ${new Date(created.routeDate).toDateString()}`,
        entityType: 'VisitRoute',
        entityId: created.id
      });
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'VisitRoute',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Route created: ${created.title}`
      },
      req
    });

    return created;
  },

  async get(auth, id) {
    const route = await prisma.visitRoute.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...routeInclude,
        stops: {
          include: {
            customer: {
              select: {
                id: true,
                businessName: true,
                accountStatus: true,
                customerHealthStatus: true
              }
            },
            visit: {
              select: {
                id: true,
                visitDate: true,
                outcome: true,
                nextAction: true,
                status: true,
                visitType: true
              }
            }
          },
          orderBy: { visitOrder: 'asc' }
        }
      }
    });

    if (!route) throw new AppError('Visit route not found', 404);
    return route;
  },

  async update(auth, id, data, req) {
    const existing = await prisma.visitRoute.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Visit route not found', 404);

    const updateData = {
      title: data.title,
      routeDate: data.routeDate ? new Date(data.routeDate) : undefined,
      status: data.status,
      notes: data.notes
    };

    if (Object.prototype.hasOwnProperty.call(data, 'assignedOfficerId')) {
      updateData.assignedOfficerId = await assertValidOfficer(data.assignedOfficerId);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'territoryId')) {
      updateData.territoryId = await assertValidTerritory(data.territoryId);
    }

    const updated = await prisma.visitRoute.update({
      where: { id },
      data: updateData,
      include: routeInclude
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'VisitRoute',
      entityId: id,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Route updated: ${updated.title}`
      },
      req
    });

    return updated;
  },

  async addStop(auth, routeId, data, req) {
    const route = await prisma.visitRoute.findFirst({ where: { id: routeId, deletedAt: null } });
    if (!route) throw new AppError('Visit route not found', 404);

    const created = await prisma.visitRouteStop.create({
      data: {
        routeId,
        customerId: data.customerId,
        plannedTime: data.plannedTime ? new Date(data.plannedTime) : null,
        visitOrder: data.visitOrder,
        status: data.status || 'PLANNED',
        visitId: data.visitId || null,
        notes: data.notes
      },
      include: {
        customer: { select: { id: true, businessName: true } },
        visit: true
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'VisitRouteStop',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Route stop added to ${route.title}`
      },
      req
    });

    return created;
  },

  async updateStop(auth, routeId, stopId, data, req) {
    const existing = await prisma.visitRouteStop.findFirst({
      where: { id: stopId, routeId },
      include: { customer: { select: { id: true, businessName: true } }, route: { select: { id: true, title: true } } }
    });
    if (!existing) throw new AppError('Route stop not found', 404);

    const updated = await prisma.visitRouteStop.update({
      where: { id: stopId },
      data: {
        customerId: data.customerId,
        plannedTime: data.plannedTime ? new Date(data.plannedTime) : undefined,
        visitOrder: data.visitOrder,
        status: data.status,
        visitId: data.visitId,
        notes: data.notes
      },
      include: {
        customer: { select: { id: true, businessName: true } },
        visit: true
      }
    });

    if (updated.status === 'MISSED') {
      const route = await prisma.visitRoute.findUnique({ where: { id: routeId } });
      if (route) {
        await prisma.$transaction(async (tx) => {
          await createMissedVisitTaskAndAlert(tx, route, updated, auth, req);
        });
      }
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'VisitRouteStop',
      entityId: stopId,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Route stop updated for ${existing.route?.title || 'route'}`
      },
      req
    });

    return updated;
  },

  async complete(auth, routeId, notes, req) {
    const route = await prisma.visitRoute.findFirst({
      where: { id: routeId, deletedAt: null },
      include: {
        stops: {
          include: {
            customer: { select: { id: true, businessName: true } }
          }
        }
      }
    });
    if (!route) throw new AppError('Visit route not found', 404);

    const completed = await prisma.$transaction(async (tx) => {
      const updated = await tx.visitRoute.update({
        where: { id: routeId },
        data: {
          status: 'COMPLETED',
          notes: notes ? `${route.notes || ''}\n${notes}`.trim() : route.notes
        }
      });

      const missedStops = route.stops.filter((stop) => stop.status === 'MISSED');
      for (const stop of missedStops) {
        await createMissedVisitTaskAndAlert(tx, route, stop, auth, req);
      }

      return updated;
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'VisitRoute',
      entityId: routeId,
      oldValues: { status: route.status },
      newValues: {
        status: completed.status,
        summary: `Route completed: ${route.title}`
      },
      req
    });

    return completed;
  }
};

module.exports = visitRouteService;
