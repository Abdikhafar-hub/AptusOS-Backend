const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const approvalService = require('./approvalService');
const approvalPolicyService = require('./approvalPolicyService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const includeConfig = {
  customer: {
    select: {
      id: true,
      businessName: true,
      accountStatus: true,
      customerHealthStatus: true,
      accountTier: true
    }
  },
  requestedBy: { select: { id: true, fullName: true, email: true } }
};

async function resolveDiscountThreshold() {
  const setting = await prisma.setting.findFirst({
    where: {
      section: 'sales_compliance',
      key: 'discount_approval_threshold_percent',
      deletedAt: null
    }
  }).catch(() => null);

  const value = Number(setting?.value?.value ?? setting?.value ?? 10);
  if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  return 10;
}

function calcDiscountPercent(standardPrice, requestedPrice) {
  if (!standardPrice || Number(standardPrice) <= 0) return 0;
  const discount = ((Number(standardPrice) - Number(requestedPrice)) / Number(standardPrice)) * 100;
  return Math.max(0, Math.min(100, Number(discount.toFixed(2))));
}

const discountRequestService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.requestedById) where.requestedById = query.requestedById;
    if (query.status) where.status = query.status;
    if (query.approvalRequired !== undefined) where.approvalRequired = String(query.approvalRequired) === 'true';
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { reason: { contains: query.search, mode: 'insensitive' } },
        { customer: { businessName: { contains: query.search, mode: 'insensitive' } } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.discountRequest.findMany({ where, include: includeConfig, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.discountRequest.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async create(auth, data, req) {
    const discountPercent = data.discountPercent ?? calcDiscountPercent(data.standardPrice, data.requestedPrice);

    const created = await prisma.discountRequest.create({
      data: {
        customerId: data.customerId,
        requestedById: data.requestedById || auth.userId,
        reason: data.reason,
        standardPrice: data.standardPrice,
        requestedPrice: data.requestedPrice,
        discountPercent,
        estimatedValue: data.estimatedValue,
        currency: data.currency || 'KES',
        approvalRequired: data.approvalRequired ?? true,
        status: data.status || 'DRAFT'
      },
      include: includeConfig
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'DiscountRequest',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Discount request created for ${created.customer?.businessName || 'customer'}`
      },
      req
    });

    return created;
  },

  async get(auth, id) {
    const request = await prisma.discountRequest.findFirst({
      where: { id, deletedAt: null },
      include: includeConfig
    });

    if (!request) throw new AppError('Discount request not found', 404);

    const approvalRequest = request.approvalRequestId
      ? await prisma.approvalRequest.findFirst({
        where: { id: request.approvalRequestId, deletedAt: null },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          currentApprover: { select: { id: true, fullName: true, email: true } },
          steps: true
        }
      })
      : null;

    return {
      ...request,
      approvalRequest
    };
  },

  async update(auth, id, data, req) {
    const existing = await prisma.discountRequest.findFirst({ where: { id, deletedAt: null }, include: includeConfig });
    if (!existing) throw new AppError('Discount request not found', 404);

    const standardPrice = data.standardPrice ?? existing.standardPrice;
    const requestedPrice = data.requestedPrice ?? existing.requestedPrice;
    const discountPercent = data.discountPercent ?? calcDiscountPercent(standardPrice, requestedPrice);

    const updated = await prisma.discountRequest.update({
      where: { id },
      data: {
        customerId: data.customerId,
        reason: data.reason,
        standardPrice: data.standardPrice,
        requestedPrice: data.requestedPrice,
        discountPercent,
        estimatedValue: data.estimatedValue,
        currency: data.currency,
        approvalRequired: data.approvalRequired,
        status: data.status
      },
      include: includeConfig
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'DiscountRequest',
      entityId: id,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Discount request updated for ${updated.customer?.businessName || 'customer'}`
      },
      req
    });

    return updated;
  },

  async submit(auth, id, note, req) {
    const existing = await prisma.discountRequest.findFirst({ where: { id, deletedAt: null }, include: includeConfig });
    if (!existing) throw new AppError('Discount request not found', 404);

    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      throw new AppError('Only draft or rejected discount requests can be submitted', 400);
    }

    const thresholdPercent = await resolveDiscountThreshold();
    const requiresApproval = Boolean(existing.approvalRequired) && Number(existing.discountPercent) > thresholdPercent;

    const submitted = await prisma.$transaction(async (tx) => {
      let approvalRequest = null;

      if (requiresApproval) {
        const openRequest = await tx.approvalRequest.findFirst({
          where: {
            entityType: 'DISCOUNT_REQUEST',
            entityId: id,
            status: { in: ['PENDING', 'NEEDS_MORE_INFO'] },
            deletedAt: null
          }
        });
        if (openRequest) throw new AppError('This discount request already has a pending approval workflow', 400);

        const steps = await approvalPolicyService.buildDiscountRequestSteps({ requesterRoleName: auth.roleName });
        if (!steps.length) throw new AppError('Unable to resolve approvers for discount request', 400);

        approvalRequest = await approvalService.create({
          requestType: 'DISCOUNT_REQUEST',
          entityType: 'DISCOUNT_REQUEST',
          entityId: id,
          requestedById: auth.userId,
          reason: note || `Discount request approval required for ${existing.customer?.businessName || 'customer'}`,
          steps,
          tx
        }, auth.userId, req);
      }

      return tx.discountRequest.update({
        where: { id },
        data: {
          status: requiresApproval ? 'UNDER_REVIEW' : 'SUBMITTED',
          approvalRequired: requiresApproval,
          approvalRequestId: approvalRequest?.id || existing.approvalRequestId
        },
        include: includeConfig
      });
    });

    if (requiresApproval) {
      const pendingApprover = await prisma.approvalRequest.findFirst({
        where: { id: submitted.approvalRequestId },
        select: { currentApproverId: true }
      });

      if (pendingApprover?.currentApproverId) {
        await notificationService.create({
          userId: pendingApprover.currentApproverId,
          type: 'APPROVAL_REQUEST',
          title: 'Discount approval required',
          body: submitted.customer?.businessName || submitted.reason,
          entityType: 'DiscountRequest',
          entityId: submitted.id
        });
      }
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'DiscountRequest',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: submitted.status,
        approvalRequestId: submitted.approvalRequestId,
        summary: `Discount request submitted: ${submitted.customer?.businessName || submitted.id}`
      },
      req
    });

    return submitted;
  }
};

module.exports = discountRequestService;
