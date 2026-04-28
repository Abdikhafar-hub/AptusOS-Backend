const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const territoryInclude = {
  assignedOfficer: { select: { id: true, fullName: true, email: true } }
};

const normalizeAssignedOfficerId = (value) => {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const assertValidAssignedOfficer = async (assignedOfficerId) => {
  if (!assignedOfficerId) return null;

  const officer = await prisma.user.findFirst({
    where: {
      id: assignedOfficerId,
      deletedAt: null,
      isActive: true
    },
    select: { id: true }
  });

  if (!officer) {
    throw new AppError('Assigned officer was not found. Select an active staff member or leave this field blank.', 422);
  }

  return assignedOfficerId;
};

const territoryService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.assignedOfficerId) where.assignedOfficerId = query.assignedOfficerId;
    if (query.county) where.county = { contains: query.county, mode: 'insensitive' };
    if (query.region) where.region = { contains: query.region, mode: 'insensitive' };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { county: { contains: query.search, mode: 'insensitive' } },
        { region: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.salesTerritory.findMany({ where, include: territoryInclude, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.salesTerritory.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async create(auth, data, req) {
    const assignedOfficerId = await assertValidAssignedOfficer(normalizeAssignedOfficerId(data.assignedOfficerId));

    const created = await prisma.salesTerritory.create({
      data: {
        name: data.name,
        region: data.region,
        county: data.county,
        towns: data.towns || [],
        assignedOfficerId,
        description: data.description,
        status: data.status || 'ACTIVE'
      },
      include: territoryInclude
    });

    if (created.assignedOfficerId && created.assignedOfficerId !== auth.userId) {
      await notificationService.create({
        userId: created.assignedOfficerId,
        type: 'SYSTEM',
        title: 'Territory assignment',
        body: `You were assigned territory ${created.name}`,
        entityType: 'SalesTerritory',
        entityId: created.id
      });
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesTerritory',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Territory created: ${created.name}`
      },
      req
    });

    return created;
  },

  async get(auth, id) {
    const territory = await prisma.salesTerritory.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...territoryInclude,
        customers: {
          where: { deletedAt: null },
          select: {
            id: true,
            businessName: true,
            accountStatus: true,
            customerHealthStatus: true,
            complianceRiskLevel: true,
            nextFollowUpDate: true,
            assignedOfficer: { select: { id: true, fullName: true } }
          },
          orderBy: { updatedAt: 'desc' },
          take: 100
        }
      }
    });

    if (!territory) throw new AppError('Territory not found', 404);

    const [routes, visits, reports] = await prisma.$transaction([
      prisma.visitRoute.findMany({
        where: { territoryId: id, deletedAt: null },
        include: { assignedOfficer: { select: { id: true, fullName: true } } },
        orderBy: { routeDate: 'desc' },
        take: 50
      }),
      prisma.clientVisitNote.findMany({
        where: { territoryId: id, deletedAt: null },
        include: {
          customer: { select: { id: true, businessName: true } },
          createdBy: { select: { id: true, fullName: true } }
        },
        orderBy: { visitDate: 'desc' },
        take: 50
      }),
      prisma.salesReport.findMany({
        where: { territoryId: id, deletedAt: null },
        include: { createdBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ]);

    return {
      ...territory,
      routes,
      visits,
      salesReports: reports
    };
  },

  async update(auth, id, data, req) {
    const existing = await prisma.salesTerritory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Territory not found', 404);

    const updateData = {
      name: data.name,
      region: data.region,
      county: data.county,
      towns: data.towns,
      description: data.description,
      status: data.status
    };

    if (Object.prototype.hasOwnProperty.call(data, 'assignedOfficerId')) {
      updateData.assignedOfficerId = await assertValidAssignedOfficer(normalizeAssignedOfficerId(data.assignedOfficerId));
    }

    const updated = await prisma.salesTerritory.update({
      where: { id },
      data: updateData,
      include: territoryInclude
    });

    if (updated.assignedOfficerId && updated.assignedOfficerId !== existing.assignedOfficerId) {
      await notificationService.create({
        userId: updated.assignedOfficerId,
        type: 'SYSTEM',
        title: 'Territory reassignment',
        body: `You were assigned territory ${updated.name}`,
        entityType: 'SalesTerritory',
        entityId: id
      });
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesTerritory',
      entityId: id,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Territory updated: ${updated.name}`
      },
      req
    });

    return updated;
  },

  async archive(auth, id, req) {
    const existing = await prisma.salesTerritory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Territory not found', 404);

    const updated = await prisma.salesTerritory.update({
      where: { id },
      data: {
        status: 'INACTIVE',
        deletedAt: new Date()
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesTerritory',
      entityId: id,
      oldValues: { status: existing.status, deletedAt: existing.deletedAt },
      newValues: { status: updated.status, deletedAt: updated.deletedAt, summary: `Territory archived: ${existing.name}` },
      req
    });

    return updated;
  }
};

module.exports = territoryService;
