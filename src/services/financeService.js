const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const approvalService = require('./approvalService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const stateMachineService = require('./stateMachineService');
const domainGuardService = require('./domainGuardService');
const timelineService = require('./timelineService');
const approvalPolicyService = require('./approvalPolicyService');

const safeDepartmentSelect = {
  id: true,
  name: true,
  slug: true,
  headId: true
};

const approvalSummaryInclude = {
  requestedBy: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  currentApprover: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  steps: true,
  comments: {
    where: { deletedAt: null },
    include: {
      author: {
        select: {
          id: true,
          fullName: true
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  }
};

const financeRequestListInclude = {
  requestedBy: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  department: {
    select: safeDepartmentSelect
  }
};

const toDate = (value) => (value ? new Date(value) : undefined);

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDateOnly(value) {
  const normalized = normalizeDate(value);
  if (!normalized) return null;
  return new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth(), normalized.getUTCDate()));
}

function normalizePeriod({ year, budgetType, periodStartDate, periodEndDate }) {
  const normalizedYear = Number(year);
  const startCandidate = toDateOnly(periodStartDate) || new Date(Date.UTC(normalizedYear, 0, 1));
  let start = startCandidate;
  let end = toDateOnly(periodEndDate);
  let month = null;

  if (budgetType === 'ANNUAL') {
    start = new Date(Date.UTC(normalizedYear, 0, 1));
    end = new Date(Date.UTC(normalizedYear, 11, 31));
    month = null;
  } else if (budgetType === 'MONTHLY') {
    start = new Date(Date.UTC(normalizedYear, startCandidate.getUTCMonth(), 1));
    end = new Date(Date.UTC(normalizedYear, startCandidate.getUTCMonth() + 1, 0));
    month = start.getUTCMonth() + 1;
  } else if (budgetType === 'QUARTERLY') {
    const quarterStartMonth = Math.floor(startCandidate.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(normalizedYear, quarterStartMonth, 1));
    end = new Date(Date.UTC(normalizedYear, quarterStartMonth + 3, 0));
    month = start.getUTCMonth() + 1;
  } else {
    start = startCandidate;
    end = end || startCandidate;
    month = start.getUTCMonth() + 1;
  }

  return { start, end, month };
}

const financeService = {
  buildWhere(auth, query = {}) {
    const where = { deletedAt: null, AND: [] };

    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.type) where.type = query.type;
    if (query.requestedById) where.requestedById = query.requestedById;

    const createdAt = {};
    if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
    if (query.dateTo) createdAt.lte = new Date(query.dateTo);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;

    const amount = {};
    if (query.amountMin !== undefined && query.amountMin !== '') amount.gte = Number(query.amountMin);
    if (query.amountMax !== undefined && query.amountMax !== '') amount.lte = Number(query.amountMax);
    if (Object.keys(amount).length) where.amount = amount;

    if (query.search) {
      where.AND.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } }
        ]
      });
    }

    if (accessControlService.isGeneralManager(auth) || accessControlService.isFinance(auth)) {
      if (!where.AND.length) delete where.AND;
      return where;
    }

    if (accessControlService.isDepartmentHead(auth)) {
      where.AND.push({
        OR: [
          { departmentId: { in: auth.departmentIds } },
          { requestedById: auth.userId }
        ]
      });
      if (!where.AND.length) delete where.AND;
      return where;
    }

    where.requestedById = auth.userId;
    if (!where.AND.length) delete where.AND;
    return where;
  },

  async listRequests(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = this.buildWhere(auth, query);
    const [items, total] = await prisma.$transaction([
      prisma.financeRequest.findMany({
        where,
        include: financeRequestListInclude,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.financeRequest.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async getRequest(id, auth) {
    const request = await prisma.financeRequest.findFirst({
      where: { id, deletedAt: null },
      include: financeRequestListInclude
    });
    if (!request) throw new AppError('Finance request not found', 404);

    const allowed = accessControlService.isGeneralManager(auth)
      || accessControlService.isFinance(auth)
      || request.requestedById === auth.userId
      || (request.departmentId && auth.departmentIds.includes(request.departmentId));

    if (!allowed) throw new AppError('You do not have access to this finance request', 403);

    const [comments, timeline, receiptDocument, paymentProofDocument, approvalRequest] = await Promise.all([
      prisma.comment.findMany({
        where: { entityType: 'FINANCE_REQUEST', entityId: id, deletedAt: null },
        include: { author: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      timelineService.getTimeline('FINANCE_REQUEST', id),
      request.receiptDocumentId
        ? prisma.document.findFirst({
          where: { id: request.receiptDocumentId, deletedAt: null },
          include: {
            uploadedBy: { select: { id: true, fullName: true } },
            approvedBy: { select: { id: true, fullName: true } }
          }
        })
        : null,
      request.paymentProofDocumentId
        ? prisma.document.findFirst({
          where: { id: request.paymentProofDocumentId, deletedAt: null },
          include: {
            uploadedBy: { select: { id: true, fullName: true } },
            approvedBy: { select: { id: true, fullName: true } }
          }
        })
        : null,
      request.approvalRequestId
        ? prisma.approvalRequest.findUnique({
          where: { id: request.approvalRequestId },
          include: approvalSummaryInclude
        })
        : null
    ]);

    return {
      ...request,
      comments,
      timeline,
      receiptDocument,
      paymentProofDocument,
      approvalRequest
    };
  },

  async createRequest(auth, data, req) {
    const payload = {
      requestedById: auth.userId,
      departmentId: data.departmentId || auth.departmentIds?.[0] || null,
      type: data.type,
      title: data.title,
      description: data.description,
      amount: data.amount,
      currency: data.currency || 'KES',
      status: data.status || 'DRAFT',
      receiptDocumentId: data.receiptDocumentId
    };

    const steps = payload.status === 'SUBMITTED'
      ? await approvalPolicyService.buildFinanceRequestSteps({ requesterRoleName: auth.roleName, amount: payload.amount })
      : [];

    const financeRequest = await prisma.$transaction(async (tx) => {
      const created = await tx.financeRequest.create({ data: payload });

      if (created.status === 'SUBMITTED') {
        if (!steps.length) throw new AppError('Finance approval workflow could not resolve a valid approver', 400);
        const approval = await approvalService.create({
          requestType: created.type,
          entityType: 'FINANCE_REQUEST',
          entityId: created.id,
          requestedById: auth.userId,
          reason: created.description,
          steps,
          tx
        }, auth.userId, req);

        await tx.financeRequest.update({
          where: { id: created.id },
          data: { approvalRequestId: approval.id }
        });
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.FINANCE_REQUEST_CREATED,
        entityType: 'FinanceRequest',
        entityId: created.id,
        newValues: created,
        req
      }, tx);

      return created;
    });

    return financeRequest;
  },

  async updateRequest(id, auth, data, req) {
    const existing = await this.getRequest(id, auth);
    domainGuardService.cannotEditAfterFinalState(existing, 'Finance request', ['PAID', 'LOCKED', 'CANCELLED', 'REJECTED']);

    if (existing.requestedById !== auth.userId && !accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      throw new AppError('You do not have permission to update this finance request', 403);
    }

    if (!['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(existing.status)) {
      throw new AppError('This finance request can no longer be edited', 400);
    }

    const updated = await prisma.financeRequest.update({ where: { id }, data });
    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED,
      entityType: 'FinanceRequest',
      entityId: id,
      oldValues: existing,
      newValues: updated,
      req
    });
    return updated;
  },

  async reviewRequest(id, auth, decision, comment, req) {
    const existing = await this.getRequest(id, auth);
    stateMachineService.assertTransition('FINANCE_REQUEST', existing.status, decision);

    let updated = existing;

    if (decision === 'UNDER_REVIEW') {
      updated = await prisma.financeRequest.update({
        where: { id },
        data: { status: 'UNDER_REVIEW', financeNotes: comment || existing.financeNotes }
      });
    } else if (decision === 'APPROVED' || decision === 'REJECTED') {
      if (!existing.approvalRequestId) {
        throw new AppError('Finance request is missing its approval workflow', 400);
      }
      await approvalService.act(existing.approvalRequestId, decision, auth.userId, comment, req);
      updated = await prisma.financeRequest.findUnique({ where: { id } });
    } else if (decision === 'CANCELLED') {
      updated = await prisma.financeRequest.update({
        where: { id },
        data: { status: 'CANCELLED', financeNotes: comment || existing.financeNotes }
      });
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED,
      entityType: 'FinanceRequest',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: updated.status, comment },
      req
    });

    await notificationService.create({
      userId: updated.requestedById,
      type: 'EXPENSE_STATUS_CHANGED',
      title: updated.title,
      body: updated.status,
      entityType: 'FinanceRequest',
      entityId: id
    });

    return updated;
  },

  async markPaid(id, auth, data, req) {
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      throw new AppError('Only Finance & Accounts Manager or General Manager can mark a finance request as paid', 403);
    }

    const existing = await this.getRequest(id, auth);
    stateMachineService.assertTransition('FINANCE_REQUEST', existing.status, 'PAID');

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.financeRequest.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: data.paidAt || new Date(),
          lockedAt: new Date(),
          paymentProofDocumentId: data.paymentProofDocumentId || existing.paymentProofDocumentId,
          financeNotes: data.financeNotes || existing.financeNotes
        }
      });

      if (result.departmentId) {
        await tx.budget.updateMany({
          where: {
            departmentId: result.departmentId,
            year: new Date(result.paidAt || new Date()).getFullYear(),
            deletedAt: null
          },
          data: { spent: { increment: result.amount } }
        });
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.FINANCE_REQUEST_PAID,
        entityType: 'FinanceRequest',
        entityId: id,
        oldValues: existing,
        newValues: result,
        req
      }, tx);

      return result;
    });

    await notificationService.create({
      userId: updated.requestedById,
      type: 'EXPENSE_STATUS_CHANGED',
      title: updated.title,
      body: 'PAID',
      entityType: 'FinanceRequest',
      entityId: id
    });

    return updated;
  },

  async attachPaymentProof(id, auth, data, req) {
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      throw new AppError('Only Finance & Accounts Manager or General Manager can attach payment proofs', 403);
    }

    const existing = await this.getRequest(id, auth);

    if (['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'CANCELLED'].includes(existing.status)) {
      throw new AppError('Payment proof can only be attached to approved, paid, or locked finance requests', 400);
    }

    const updated = await prisma.financeRequest.update({
      where: { id },
      data: {
        paymentProofDocumentId: data.paymentProofDocumentId,
        financeNotes: data.financeNotes || existing.financeNotes,
        paidAt: data.paidAt || existing.paidAt
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED,
      entityType: 'FinanceRequest',
      entityId: id,
      oldValues: {
        paymentProofDocumentId: existing.paymentProofDocumentId,
        paidAt: existing.paidAt,
        financeNotes: existing.financeNotes
      },
      newValues: {
        paymentProofDocumentId: updated.paymentProofDocumentId,
        paidAt: updated.paidAt,
        financeNotes: updated.financeNotes
      },
      req
    });

    if (updated.requestedById && updated.requestedById !== auth.userId) {
      await notificationService.create({
        userId: updated.requestedById,
        type: 'DOCUMENT_UPLOADED',
        title: `${updated.title} payment proof updated`,
        body: updated.status,
        entityType: 'FinanceRequest',
        entityId: id
      });
    }

    return updated;
  },

  async listBudgets(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.year) where.year = Number(query.year);

    const [items, total] = await prisma.$transaction([
      prisma.budget.findMany({
        where,
        include: { department: { select: safeDepartmentSelect } },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.budget.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async createBudget(auth, data, req) {
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      throw new AppError('Only Finance & Accounts Manager or General Manager can manage budgets', 403);
    }

    const budgetType = data.budgetType || 'ANNUAL';
    const approvalStatus = data.approvalStatus || 'DRAFT';
    const isDraft = approvalStatus === 'DRAFT';
    const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];

    const normalizedLineItems = lineItems
      .map((line) => ({
        category: String(line.category || '').trim(),
        description: line.description ? String(line.description).trim() : null,
        allocatedAmount: Number(line.allocatedAmount || 0)
      }))
      .filter((line) => line.category || line.description || line.allocatedAmount > 0);

    const lineItemTotal = normalizedLineItems.reduce((sum, line) => sum + Number(line.allocatedAmount || 0), 0);
    const amount = Number(data.amount ?? lineItemTotal);

    if (!isDraft) {
      if (!data.name || !String(data.name).trim()) {
        throw new AppError('Budget name is required', 400);
      }
      if (!normalizedLineItems.length) {
        throw new AppError('At least 1 budget line is required', 400);
      }
      if (normalizedLineItems.some((line) => line.allocatedAmount <= 0 || !line.category)) {
        throw new AppError('Each budget line must include category and amount greater than zero', 400);
      }
      if (lineItemTotal <= 0 || amount <= 0) {
        throw new AppError('Budget amount must be greater than zero', 400);
      }
      if (Math.abs(amount - lineItemTotal) > 0.01) {
        throw new AppError('Allocated amount must match sum of line items', 400);
      }
    }

    const { start, end, month } = normalizePeriod({
      year: data.year,
      budgetType,
      periodStartDate: data.periodStartDate,
      periodEndDate: data.periodEndDate
    });

    if (!isDraft && (!start || !end)) {
      throw new AppError('Budget period start and end dates are required', 400);
    }

    if (start && end && start >= end) {
      throw new AppError('Start date must be before end date', 400);
    }

    if (!isDraft && data.allowOverspending && (!data.overspendingLimitType || Number(data.overspendingLimitValue || 0) <= 0)) {
      throw new AppError('Overspending limit type and value are required when overspending is allowed', 400);
    }

    if (!isDraft && data.overspendingLimitType === 'PERCENT' && Number(data.overspendingLimitValue || 0) > 100) {
      throw new AppError('Overspending percent limit cannot exceed 100', 400);
    }

    const periodOverlapWhere = start && end
      ? {
          OR: [
            { periodStartDate: { lte: end }, periodEndDate: { gte: start } },
            { periodStartDate: null, periodEndDate: null, year: Number(data.year), month: month || null }
          ]
        }
      : { year: Number(data.year), month: month || null };

    if (!isDraft && !data.allowDuplicatePeriod) {
      const existing = await prisma.budget.findFirst({
        where: {
          deletedAt: null,
          departmentId: data.departmentId,
          ...periodOverlapWhere
        }
      });
      if (existing) {
        throw new AppError('A budget already exists for this department and period. Enable duplicate period to continue.', 409);
      }
    }

    const isApproved = approvalStatus === 'APPROVED';
    const approvedById = isApproved ? (data.approvedById || data.approverId || auth.userId) : null;
    const approvedAt = isApproved ? new Date() : null;

    const budget = await prisma.budget.create({
      data: {
        departmentId: data.departmentId,
        name: data.name?.trim() || null,
        budgetType,
        budgetCategory: data.budgetCategory || 'OPERATIONAL',
        year: Number(data.year),
        month: Number.isInteger(Number(data.month)) ? Number(data.month) : month,
        periodStartDate: start,
        periodEndDate: end,
        amount,
        currency: data.currency || 'KES',
        lineItems: normalizedLineItems,
        approvalStatus,
        budgetOwnerId: data.budgetOwnerId || null,
        approverId: data.approverId || null,
        approvedById,
        approvedAt,
        createdById: auth.userId,
        allowOverspending: Boolean(data.allowOverspending),
        overspendingLimitType: data.allowOverspending ? data.overspendingLimitType || null : null,
        overspendingLimitValue: data.allowOverspending ? (data.overspendingLimitValue ?? null) : null,
        alertThresholds: Array.isArray(data.alertThresholds) && data.alertThresholds.length
          ? Array.from(new Set(data.alertThresholds.map((value) => Number(value)).filter((value) => Number.isFinite(value)))).sort((a, b) => a - b)
          : [50, 75, 90, 100],
        costCenter: data.costCenter || null,
        projectCode: data.projectCode || null,
        notes: data.notes || null,
        supportingDocumentId: data.supportingDocumentId || null,
        amountChangeHistory: [
          {
            changedAt: new Date().toISOString(),
            changedById: auth.userId,
            previousAmount: null,
            newAmount: amount,
            reason: 'INITIAL_CREATE'
          }
        ]
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: isApproved ? AUDIT_ACTIONS.BUDGET_APPROVED : AUDIT_ACTIONS.BUDGET_CREATED,
      entityType: 'Budget',
      entityId: budget.id,
      newValues: {
        ...budget,
        totalFromLineItems: lineItemTotal
      },
      req
    });

    return budget;
  },

  async monthlySummary(auth, query = {}) {
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      throw new AppError('You do not have access to finance summary data', 403);
    }

    const dateFrom = toDate(query.dateFrom) || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const dateTo = toDate(query.dateTo) || new Date();
    const where = { deletedAt: null, createdAt: { gte: dateFrom, lte: dateTo } };

    const [summary, byStatus, budgets] = await prisma.$transaction([
      prisma.financeRequest.aggregate({ where, _sum: { amount: true }, _count: true }),
      prisma.financeRequest.groupBy({ by: ['status'], where, _count: true, _sum: { amount: true } }),
      prisma.budget.findMany({
        where: { deletedAt: null },
        include: { department: { select: safeDepartmentSelect } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }]
      })
    ]);

    return { summary, byStatus, departmentBudgetUsage: budgets };
  },

  async accountsSummary(auth) {
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      throw new AppError('You do not have access to accounts records', 403);
    }

    const financeDocumentWhere = {
      deletedAt: null,
      ownerType: 'FINANCE'
    };

    const [payables, receivables, archives, taxDocuments, paymentProofLinked, financeReportsSubmitted] = await prisma.$transaction([
      prisma.financeRequest.findMany({
        where: { deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } },
        include: financeRequestListInclude,
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      prisma.financeRequest.findMany({
        where: { deletedAt: null, status: { in: ['PAID'] } },
        include: financeRequestListInclude,
        orderBy: [{ paidAt: 'desc' }, { updatedAt: 'desc' }],
        take: 100
      }),
      prisma.document.findMany({
        where: financeDocumentWhere,
        include: {
          uploadedBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          department: { select: safeDepartmentSelect }
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      prisma.document.count({
        where: {
          ...financeDocumentWhere,
          category: { in: ['KRA_DOCUMENT', 'TAX_DOCUMENT'] }
        }
      }),
      prisma.financeRequest.count({
        where: { deletedAt: null, paymentProofDocumentId: { not: null } }
      }),
      prisma.document.count({
        where: {
          ...financeDocumentWhere,
          category: 'FINANCE_DOCUMENT'
        }
      })
    ]);

    return {
      payables,
      receivables,
      archives,
      totals: {
        archivedDocuments: archives.length,
        pendingPaymentProofs: receivables.filter((item) => !item.paymentProofDocumentId).length,
        taxDocuments,
        recentUploads: archives.slice(0, 5).length,
        reportsSubmitted: financeReportsSubmitted,
        linkedPaymentProofs: paymentProofLinked
      }
    };
  }
};

module.exports = financeService;
