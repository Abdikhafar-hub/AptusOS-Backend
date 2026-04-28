const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const customerAlertService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.alertType) where.alertType = query.alertType;
    if (query.severity) where.severity = query.severity;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.customerAlert.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              businessName: true,
              accountStatus: true,
              customerHealthStatus: true,
              assignedOfficer: { select: { id: true, fullName: true } }
            }
          }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.customerAlert.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async create(customerId, payload, auth, req, tx = prisma) {
    const customer = await tx.customerOnboarding.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw new AppError('Customer not found', 404);

    const created = await tx.customerAlert.create({
      data: {
        customerId,
        alertType: payload.alertType,
        title: payload.title,
        description: payload.description,
        severity: payload.severity || 'MEDIUM',
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        status: payload.status || 'OPEN'
      }
    });

    if (customer.assignedOfficerId && customer.assignedOfficerId !== auth.userId) {
      await notificationService.create({
        userId: customer.assignedOfficerId,
        type: 'SYSTEM',
        title: `Customer alert: ${created.title}`,
        body: customer.businessName,
        entityType: 'CustomerAlert',
        entityId: created.id
      }, tx);
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerAlert',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Alert created for ${customer.businessName}: ${created.title}`
      },
      req
    }, tx);

    return created;
  },

  async updateStatus(id, status, auth, req) {
    const existing = await prisma.customerAlert.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Customer alert not found', 404);

    const updated = await prisma.customerAlert.update({
      where: { id },
      data: { status }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerAlert',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status, summary: `Alert marked as ${status.toLowerCase()}` },
      req
    });

    return updated;
  }
};

module.exports = customerAlertService;
