const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const includeConfig = {
  customer: { select: { id: true, businessName: true, customerHealthStatus: true, accountStatus: true } },
  owner: { select: { id: true, fullName: true, email: true } }
};

const salesOpportunityService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.stage) where.stage = query.stage;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { competitorName: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.salesOpportunity.findMany({ where, include: includeConfig, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.salesOpportunity.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async create(auth, data, req) {
    const created = await prisma.salesOpportunity.create({
      data: {
        customerId: data.customerId,
        ownerId: data.ownerId || auth.userId,
        title: data.title,
        description: data.description,
        stage: data.stage || 'PROSPECTING',
        expectedValue: data.expectedValue,
        currency: data.currency || 'KES',
        expectedOrderDate: data.expectedOrderDate ? new Date(data.expectedOrderDate) : null,
        competitorInvolved: Boolean(data.competitorInvolved),
        competitorName: data.competitorName,
        lossReason: data.lossReason,
        probability: data.probability,
        status: data.status || 'OPEN'
      },
      include: includeConfig
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesOpportunity',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Opportunity created: ${created.title}`
      },
      req
    });

    if (created.ownerId && created.ownerId !== auth.userId) {
      await notificationService.create({
        userId: created.ownerId,
        type: 'SYSTEM',
        title: 'Opportunity assigned',
        body: created.title,
        entityType: 'SalesOpportunity',
        entityId: created.id
      });
    }

    return created;
  },

  async get(auth, id) {
    const opportunity = await prisma.salesOpportunity.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...includeConfig,
        tasks: {
          where: { deletedAt: null },
          include: { assignedTo: { select: { id: true, fullName: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 30
        }
      }
    });

    if (!opportunity) throw new AppError('Opportunity not found', 404);
    return opportunity;
  },

  async update(auth, id, data, req) {
    const existing = await prisma.salesOpportunity.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Opportunity not found', 404);

    const updated = await prisma.salesOpportunity.update({
      where: { id },
      data: {
        customerId: data.customerId,
        ownerId: data.ownerId,
        title: data.title,
        description: data.description,
        stage: data.stage,
        expectedValue: data.expectedValue,
        currency: data.currency,
        expectedOrderDate: data.expectedOrderDate ? new Date(data.expectedOrderDate) : undefined,
        competitorInvolved: data.competitorInvolved,
        competitorName: data.competitorName,
        lossReason: data.lossReason,
        probability: data.probability,
        status: data.status
      },
      include: includeConfig
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesOpportunity',
      entityId: id,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Opportunity updated: ${updated.title}`
      },
      req
    });

    return updated;
  },

  async closeWon(auth, id, req) {
    const existing = await prisma.salesOpportunity.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Opportunity not found', 404);

    const updated = await prisma.salesOpportunity.update({
      where: { id },
      data: {
        stage: 'WON',
        status: 'WON',
        lossReason: null
      },
      include: includeConfig
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesOpportunity',
      entityId: id,
      oldValues: { stage: existing.stage, status: existing.status },
      newValues: { stage: 'WON', status: 'WON', summary: `Opportunity marked won: ${existing.title}` },
      req
    });

    return updated;
  },

  async closeLost(auth, id, payload, req) {
    const existing = await prisma.salesOpportunity.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Opportunity not found', 404);
    if (!payload?.lossReason) throw new AppError('Loss reason is required to close an opportunity as lost', 400);

    const updated = await prisma.salesOpportunity.update({
      where: { id },
      data: {
        stage: 'LOST',
        status: 'LOST',
        lossReason: payload.lossReason,
        competitorName: payload.competitorName || existing.competitorName
      },
      include: includeConfig
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesOpportunity',
      entityId: id,
      oldValues: { stage: existing.stage, status: existing.status, lossReason: existing.lossReason },
      newValues: {
        stage: 'LOST',
        status: 'LOST',
        lossReason: payload.lossReason,
        summary: `Opportunity marked lost: ${existing.title}`
      },
      req
    });

    return updated;
  }
};

module.exports = salesOpportunityService;
