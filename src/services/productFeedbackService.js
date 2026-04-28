const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { ROLES } = require('../constants/roles');

const includeConfig = {
  customer: { select: { id: true, businessName: true } },
  submittedBy: { select: { id: true, fullName: true, email: true } },
  relatedVisit: { select: { id: true, visitDate: true, visitType: true } }
};

async function notifyCriticalQualityFeedback(feedback) {
  if (feedback.feedbackType !== 'QUALITY_COMPLAINT') return;
  if (!['HIGH', 'CRITICAL'].includes(String(feedback.severity || '').toUpperCase())) return;

  const recipients = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      role: { name: { in: [ROLES.SALES_COMPLIANCE_OFFICER, ROLES.GENERAL_MANAGER] } }
    },
    select: { id: true }
  });

  const userIds = [...new Set(recipients.map((item) => item.id).filter(Boolean))];
  if (!userIds.length) return;

  await notificationService.createMany(userIds, {
    type: 'SYSTEM',
    title: 'Critical product quality feedback',
    body: feedback.productName,
    entityType: 'ProductFeedback',
    entityId: feedback.id
  });
}

const productFeedbackService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.feedbackType) where.feedbackType = query.feedbackType;
    if (query.severity) where.severity = query.severity;
    if (query.submittedById) where.submittedById = query.submittedById;
    if (query.relatedVisitId) where.relatedVisitId = query.relatedVisitId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { productName: { contains: query.search, mode: 'insensitive' } },
        { productCategory: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.productFeedback.findMany({ where, include: includeConfig, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.productFeedback.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async create(auth, data, req) {
    const created = await prisma.productFeedback.create({
      data: {
        customerId: data.customerId || null,
        submittedById: data.submittedById || auth.userId,
        productName: data.productName,
        productCategory: data.productCategory,
        feedbackType: data.feedbackType,
        description: data.description,
        severity: data.severity || 'MEDIUM',
        status: data.status || 'OPEN',
        relatedVisitId: data.relatedVisitId || null
      },
      include: includeConfig
    });

    await notifyCriticalQualityFeedback(created);

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'ProductFeedback',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Product feedback submitted for ${created.productName}`
      },
      req
    });

    return created;
  },

  async get(auth, id) {
    const feedback = await prisma.productFeedback.findFirst({
      where: { id, deletedAt: null },
      include: includeConfig
    });

    if (!feedback) throw new AppError('Product feedback not found', 404);
    return feedback;
  },

  async update(auth, id, data, req) {
    const existing = await prisma.productFeedback.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Product feedback not found', 404);

    const updated = await prisma.productFeedback.update({
      where: { id },
      data: {
        customerId: data.customerId,
        productName: data.productName,
        productCategory: data.productCategory,
        feedbackType: data.feedbackType,
        description: data.description,
        severity: data.severity,
        status: data.status,
        relatedVisitId: data.relatedVisitId
      },
      include: includeConfig
    });

    await notifyCriticalQualityFeedback(updated);

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'ProductFeedback',
      entityId: id,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Product feedback updated for ${updated.productName}`
      },
      req
    });

    return updated;
  },

  async resolve(auth, id, resolutionNotes, req) {
    const existing = await prisma.productFeedback.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Product feedback not found', 404);

    const updated = await prisma.productFeedback.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        description: resolutionNotes
          ? `${existing.description}\n\nResolution Notes:\n${resolutionNotes}`
          : existing.description
      },
      include: includeConfig
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'ProductFeedback',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: 'RESOLVED',
        summary: `Product feedback resolved for ${existing.productName}`
      },
      req
    });

    return updated;
  }
};

module.exports = productFeedbackService;
