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

const requisitionSortableFields = new Set(['createdAt', 'updatedAt', 'estimatedAmount', 'priority', 'status', 'title']);
const vendorDocumentSortableFields = new Set(['createdAt', 'updatedAt', 'vendorName', 'documentType', 'expiryDate']);
const budgetOverridePermissionKeys = new Set([
  'operations:budget-override',
  'finance:budget-override',
  'budget:override'
]);
const attachmentTypeToLabel = {
  SUPPLIER_QUOTATION: 'Supplier quotation',
  SPECIFICATION_DOCUMENT: 'Specification document',
  APPROVAL_MEMO: 'Approval memo',
  PREVIOUS_INVOICE_RECEIPT: 'Previous invoice/receipt',
  EMERGENCY_JUSTIFICATION: 'Emergency justification',
  OTHER: 'Other attachment'
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const roundCurrency = (value) => Number(toNumber(value).toFixed(2));

const normalizeCurrency = (value) => {
  const normalized = String(value || 'KES').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'KES';
};

const normalizeDocumentIds = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return [...new Set(value.filter(Boolean))];
  if (typeof value === 'string') return [value];
  if (typeof value === 'object') {
    return [...new Set(Object.values(value).flatMap((entry) => normalizeDocumentIds(entry)))];
  }
  return [];
};

const requisitionInclude = {
  requestedBy: { select: { id: true, fullName: true, email: true, departmentId: true } },
  department: true,
  lineItems: { orderBy: { createdAt: 'asc' } },
  attachments: { where: { removedAt: null }, orderBy: { uploadedAt: 'desc' } },
  approvalSteps: {
    orderBy: { stepOrder: 'asc' },
    include: {
      approverRole: { select: { id: true, name: true, displayName: true } },
      approverUser: { select: { id: true, fullName: true, email: true } }
    }
  },
  auditLogs: {
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      actor: { select: { id: true, fullName: true, email: true } }
    }
  },
  approvalRequest: {
    include: {
      requestedBy: { select: { id: true, fullName: true, email: true } },
      currentApprover: { select: { id: true, fullName: true, email: true } },
      steps: true
    }
  }
};

function hasBudgetOverridePermission(auth) {
  if (accessControlService.isGeneralManager(auth) || accessControlService.isFinance(auth)) return true;
  return (auth.permissions || []).some((permission) => budgetOverridePermissionKeys.has(permission));
}

async function resolveBudgetAvailabilityContext({ departmentId, costCenter, amount, currency }) {
  if (!departmentId) {
    return {
      hasBudget: false,
      exceeded: false,
      budgetAmount: null,
      spentAmount: null,
      availableAmount: null,
      currency: normalizeCurrency(currency),
      budgetId: null,
      allowOverspending: false,
      overspendingLimitType: null,
      overspendingLimitValue: null
    };
  }

  const normalizedCurrency = normalizeCurrency(currency);
  const budget = await prisma.budget.findFirst({
    where: {
      departmentId,
      deletedAt: null,
      approvalStatus: 'APPROVED',
      currency: normalizedCurrency,
      ...(costCenter ? { costCenter } : {})
    },
    orderBy: [
      { year: 'desc' },
      { month: 'desc' },
      { updatedAt: 'desc' }
    ]
  });

  if (!budget) {
    return {
      hasBudget: false,
      exceeded: false,
      budgetAmount: null,
      spentAmount: null,
      availableAmount: null,
      currency: normalizedCurrency,
      budgetId: null,
      allowOverspending: false,
      overspendingLimitType: null,
      overspendingLimitValue: null
    };
  }

  const budgetAmount = toNumber(budget.amount);
  const spentAmount = toNumber(budget.spent);
  const availableAmount = roundCurrency(budgetAmount - spentAmount);
  const requestedAmount = toNumber(amount);
  const exceeded = requestedAmount > availableAmount;

  return {
    hasBudget: true,
    exceeded,
    budgetAmount,
    spentAmount,
    availableAmount,
    currency: budget.currency || normalizedCurrency,
    budgetId: budget.id,
    allowOverspending: Boolean(budget.allowOverspending),
    overspendingLimitType: budget.overspendingLimitType || null,
    overspendingLimitValue: budget.overspendingLimitValue ? toNumber(budget.overspendingLimitValue) : null
  };
}

async function logRequisitionAudit(tx, { requisitionId, actorId, eventType, description, oldValues, newValues }) {
  await tx.requisitionAuditLog.create({
    data: {
      requisitionId,
      actorId: actorId || null,
      eventType,
      description: description || null,
      oldValues: oldValues || undefined,
      newValues: newValues || undefined
    }
  });
}

async function createApprovalWorkflow(tx, auth, requisition, req, steps) {
  if (!steps.length) throw new AppError('Requisition approval workflow could not resolve a valid approver', 400);

  const approval = await approvalService.create({
    requestType: 'REQUISITION',
    entityType: 'REQUISITION',
    entityId: requisition.id,
    requestedById: auth.userId,
    reason: requisition.description,
    priority: requisition.priority,
    steps,
    tx
  }, auth.userId, req);

  await tx.requisition.update({
    where: { id: requisition.id },
    data: { approvalRequestId: approval.id }
  });

  await tx.requisitionApprovalStep.createMany({
    data: steps.map((step) => ({
      requisitionId: requisition.id,
      stepOrder: step.stepOrder,
      stepType: step.stepType || 'AUTO',
      label: step.label || null,
      approverRoleId: step.approverRoleId || null,
      approverUserId: step.approverUserId || null,
      status: 'PENDING',
      notes: step.notes || null
    }))
  });

  await logRequisitionAudit(tx, {
    requisitionId: requisition.id,
    actorId: auth.userId,
    eventType: 'APPROVAL_ROUTE_GENERATED',
    description: 'Approval route generated for requisition submission',
    newValues: {
      approvalRoute: requisition.approvalRoute,
      steps: steps.map((step) => ({
        stepOrder: step.stepOrder,
        stepType: step.stepType || 'AUTO',
        approverRoleId: step.approverRoleId || null,
        approverUserId: step.approverUserId || null
      }))
    }
  });

  return approval;
}

async function hydrateVendorDocuments(items) {
  const documentIds = [...new Set(items.map((item) => item.documentId).filter(Boolean))];
  const documents = documentIds.length
    ? await prisma.document.findMany({
      where: { id: { in: documentIds }, deletedAt: null },
      include: {
        uploadedBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
        department: true
      }
    })
    : [];

  const documentMap = new Map(documents.map((document) => [document.id, document]));

  return items.map((item) => {
    const linkedDocument = documentMap.get(item.documentId) || null;
    return {
      ...item,
      title: linkedDocument?.title || null,
      description: linkedDocument?.description || null,
      status: linkedDocument?.status || 'DRAFT',
      uploadedBy: linkedDocument?.uploadedBy || null,
      uploadDate: linkedDocument?.createdAt || item.createdAt,
      approvalStatus: linkedDocument?.status === 'PENDING_APPROVAL'
        ? 'PENDING'
        : linkedDocument?.status === 'APPROVED'
          ? 'APPROVED'
          : linkedDocument?.status === 'REJECTED'
            ? 'REJECTED'
            : 'DRAFT',
      linkedDocument
    };
  });
}

function normalizeRequisitionAttachments(items = []) {
  const normalized = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item?.documentId || !item?.attachmentType) return;
    const key = `${item.documentId}:${item.attachmentType}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      attachmentType: item.attachmentType,
      documentId: item.documentId,
      fileName: item.fileName,
      mimeType: item.mimeType,
      fileSize: item.fileSize
    });
  });
  return normalized;
}

function computeRequisitionTotals(data) {
  const normalizedLineItems = (Array.isArray(data.lineItems) ? data.lineItems : []).map((item) => {
    const quantity = toNumber(item.quantity);
    const estimatedUnitCost = toNumber(item.estimatedUnitCost);
    const estimatedTotalCost = roundCurrency(quantity * estimatedUnitCost);
    return {
      itemName: item.itemName,
      specification: item.specification || null,
      quantity,
      unitOfMeasure: item.unitOfMeasure,
      estimatedUnitCost,
      estimatedTotalCost,
      preferredBrandModel: item.preferredBrandModel || null,
      requiredByDate: new Date(item.requiredByDate),
      budgetCode: item.budgetCode || null,
      costCenter: item.costCenter || null
    };
  });

  const subtotal = roundCurrency(normalizedLineItems.reduce((sum, item) => sum + item.estimatedTotalCost, 0));
  const taxApplicable = Boolean(data.taxApplicable);
  const taxRate = taxApplicable ? toNumber(data.taxRate) : 0;
  const taxAmount = taxApplicable
    ? roundCurrency(data.taxAmount !== undefined && data.taxAmount !== null
      ? toNumber(data.taxAmount)
      : (subtotal * taxRate) / 100)
    : 0;
  const grandTotal = roundCurrency(subtotal + taxAmount);

  return {
    normalizedLineItems,
    subtotal,
    taxApplicable,
    taxRate,
    taxAmount,
    grandTotal
  };
}

async function resolveApprovalStepsForRequisition({ auth, data, departmentHeadId, amount }) {
  if (data.approvalRoute === 'MANUAL') {
    return (data.manualApproverIds || []).map((approverUserId, index) => ({
      stepOrder: index + 1,
      approverUserId,
      stepType: 'MANUAL',
      label: `Manual approver ${index + 1}`
    }));
  }

  return approvalPolicyService.buildRequisitionSteps({
    requesterRoleName: auth.roleName,
    requesterId: auth.userId,
    departmentHeadId,
    estimatedAmount: amount,
    requestCategory: data.requestCategory,
    requiresProcurementReview: Boolean(data.preferredSupplier || data.requireMultipleQuotes)
  });
}

const operationsService = {
  async listRequisitions(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const resolvedSortBy = requisitionSortableFields.has(sortBy) ? sortBy : 'createdAt';
    const where = { deletedAt: null, AND: [] };
    if (query.search) {
      where.AND.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } }
        ]
      });
    }
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.requestCategory) where.requestCategory = query.requestCategory;
    if (query.requestType) where.requestType = query.requestType;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.requestedById) where.requestedById = query.requestedById;
    if (query.amountMin || query.amountMax) {
      where.estimatedAmount = {};
      if (query.amountMin) where.estimatedAmount.gte = Number(query.amountMin);
      if (query.amountMax) where.estimatedAmount.lte = Number(query.amountMax);
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isOperations(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.departmentId = { in: auth.departmentIds };
      else where.requestedById = auth.userId;
    }
    if (!where.AND.length) delete where.AND;

    const [items, total] = await prisma.$transaction([
      prisma.requisition.findMany({ where, include: requisitionInclude, skip, take: limit, orderBy: { [resolvedSortBy]: sortOrder } }),
      prisma.requisition.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async getRequisitionBudgetAvailability(auth, query = {}) {
    const departmentId = query.departmentId || null;
    if (!departmentId) throw new AppError('Department is required for budget availability checks', 400);
    if (!accessControlService.isGeneralManager(auth)
      && !accessControlService.isFinance(auth)
      && !accessControlService.hasDepartmentAccess(auth, departmentId)) {
      throw new AppError('You do not have permission to inspect this budget', 403);
    }
    const amount = toNumber(query.amount, 0);
    const context = await resolveBudgetAvailabilityContext({
      departmentId,
      costCenter: query.costCenter || null,
      amount,
      currency: query.currency || 'KES'
    });
    return {
      ...context,
      amount,
      canOverrideBudget: hasBudgetOverridePermission(auth)
    };
  },

  async getRequisition(auth, id) {
    const requisition = await prisma.requisition.findFirst({
      where: { id, deletedAt: null },
      include: requisitionInclude
    });
    if (!requisition) throw new AppError('Requisition not found', 404);
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isOperations(auth)) {
      if (accessControlService.isDepartmentHead(auth)) {
        domainGuardService.cannotAccessOtherDepartmentData(auth, requisition.departmentId);
      } else if (requisition.requestedById !== auth.userId) {
        throw new AppError('You do not have access to this requisition', 403);
      }
    }
    const documentIds = normalizeDocumentIds(requisition.documents);
    const attachmentDocumentIds = requisition.attachments
      .map((attachment) => attachment.documentId)
      .filter(Boolean);
    const allDocumentIds = [...new Set([...documentIds, ...attachmentDocumentIds])];
    const [comments, timeline, documentRecords] = await Promise.all([
      prisma.comment.findMany({
        where: { entityType: 'REQUISITION', entityId: id, deletedAt: null },
        include: { author: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      timelineService.getTimeline('REQUISITION', id),
      allDocumentIds.length
        ? prisma.document.findMany({
          where: { id: { in: allDocumentIds }, deletedAt: null },
          include: {
            uploadedBy: { select: { id: true, fullName: true, email: true } },
            approvedBy: { select: { id: true, fullName: true, email: true } }
          }
        })
        : Promise.resolve([])
    ]);
    const documentMap = new Map(documentRecords.map((document) => [document.id, document]));
    const attachments = requisition.attachments.map((attachment) => ({
      ...attachment,
      typeLabel: attachmentTypeToLabel[attachment.attachmentType] || attachment.attachmentType,
      linkedDocument: attachment.documentId ? documentMap.get(attachment.documentId) || null : null
    }));
    return { ...requisition, comments, timeline, documentRecords, attachments };
  },

  async createRequisition(auth, data, req) {
    const departmentId = data.departmentId || req.user.departmentId || null;
    if (!departmentId) throw new AppError('Department is required', 400);

    if (!accessControlService.isGeneralManager(auth)
      && !accessControlService.isFinance(auth)
      && !accessControlService.hasDepartmentAccess(auth, departmentId)) {
      throw new AppError('You do not have permission to create requisitions for this department', 403);
    }

    const requiredByDate = new Date(data.requiredByDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const normalizedRequiredByDate = new Date(requiredByDate);
    normalizedRequiredByDate.setHours(0, 0, 0, 0);
    if (normalizedRequiredByDate < today) throw new AppError('Required by date cannot be in the past', 400);
    if (['HIGH', 'CRITICAL'].includes(String(data.priority || '')) && !String(data.urgencyReason || '').trim()) {
      throw new AppError('Urgency reason is required for high or critical priority', 400);
    }
    if (data.requestCategory === 'EMERGENCY_PROCUREMENT' && !String(data.emergencyJustification || '').trim()) {
      throw new AppError('Emergency procurement justification is required', 400);
    }

    const totals = computeRequisitionTotals(data);
    if (!totals.normalizedLineItems.length) throw new AppError('At least one line item is required', 400);
    if (Math.abs(totals.grandTotal - toNumber(data.grandTotal)) > 0.01) {
      throw new AppError('Grand total must match line item totals and tax', 400);
    }

    const normalizedAttachments = normalizeRequisitionAttachments(data.attachments);
    const hasSupplierQuoteAttachment = normalizedAttachments.some((attachment) => attachment.attachmentType === 'SUPPLIER_QUOTATION');
    if (data.requireMultipleQuotes && !hasSupplierQuoteAttachment && !String(data.supplierQuoteReference || '').trim()) {
      throw new AppError('Quote upload or quote reference is required when multiple quotes are required', 400);
    }
    if (!data.complianceChecks?.businessPurposeConfirmed
      || !data.complianceChecks?.pricesAreEstimatesConfirmed
      || !data.complianceChecks?.nonDuplicateConfirmed) {
      throw new AppError('Required compliance confirmations are missing', 400);
    }
    if (data.requestCategory === 'EMERGENCY_PROCUREMENT' && data.complianceChecks?.emergencyJustificationConfirmed !== true) {
      throw new AppError('Emergency procurement confirmation is required', 400);
    }

    const [department, attachmentDocuments, budgetContext] = await Promise.all([
      prisma.department.findFirst({
        where: { id: departmentId, deletedAt: null },
        select: { id: true, name: true, headId: true }
      }),
      normalizedAttachments.length
        ? prisma.document.findMany({
          where: { id: { in: normalizedAttachments.map((attachment) => attachment.documentId) }, deletedAt: null }
        })
        : Promise.resolve([]),
      resolveBudgetAvailabilityContext({
        departmentId,
        costCenter: data.costCenter || null,
        amount: totals.grandTotal,
        currency: data.currency
      })
    ]);

    if (!department) throw new AppError('Selected department was not found', 404);

    const attachmentDocumentMap = new Map(attachmentDocuments.map((document) => [document.id, document]));
    normalizedAttachments.forEach((attachment) => {
      const linkedDocument = attachmentDocumentMap.get(attachment.documentId);
      if (!linkedDocument) throw new AppError('One or more requisition attachments do not exist', 400);
      accessControlService.assertDocumentAccess(auth, linkedDocument);
    });

    const budgetExceeded = Boolean(budgetContext.hasBudget && budgetContext.exceeded);
    const overrideRequested = Boolean(data.budgetOverrideRequested);
    const canOverrideBudget = hasBudgetOverridePermission(auth);
    if (overrideRequested && !String(data.budgetOverrideReason || '').trim()) {
      throw new AppError('Budget override reason is required when requesting override', 400);
    }
    if (budgetExceeded && !overrideRequested && data.status === 'SUBMITTED') {
      throw new AppError('Budget availability exceeded. Override permission is required to submit this requisition.', 400);
    }
    if (budgetExceeded && overrideRequested && !canOverrideBudget) {
      throw new AppError('You do not have permission to override budget limits', 403);
    }

    const approvalRoute = data.approvalRoute || 'AUTO';
    const approvalSteps = await resolveApprovalStepsForRequisition({
      auth,
      data: { ...data, approvalRoute },
      amount: totals.grandTotal,
      departmentHeadId: department.headId
    });
    if (!approvalSteps.length) throw new AppError('Unable to determine requisition approval route', 400);

    const normalizedDocumentIds = [...new Set([
      ...normalizeDocumentIds(data.documents),
      ...normalizedAttachments.map((attachment) => attachment.documentId)
    ])];

    const requestedBySnapshot = {
      id: req.user.id,
      fullName: req.user.fullName,
      email: req.user.email,
      roleId: req.user.roleId
    };

    const payload = {
      requestedById: auth.userId,
      departmentId,
      title: data.title,
      description: data.description,
      requestCategory: data.requestCategory,
      requestType: data.requestType,
      businessJustification: data.businessJustification,
      requiredByDate,
      urgencyReason: data.urgencyReason || null,
      emergencyJustification: data.emergencyJustification || null,
      estimatedAmount: totals.grandTotal,
      subtotal: totals.subtotal,
      taxApplicable: totals.taxApplicable,
      taxRate: totals.taxApplicable ? totals.taxRate : null,
      taxAmount: totals.taxAmount,
      grandTotal: totals.grandTotal,
      currency: normalizeCurrency(data.currency),
      budgetLine: data.budgetLine || null,
      costCenter: data.costCenter || null,
      fundingSource: data.fundingSource,
      budgetAvailableAmount: budgetContext.availableAmount,
      budgetExceeded,
      budgetOverrideUsed: budgetExceeded && overrideRequested && canOverrideBudget,
      budgetOverrideReason: data.budgetOverrideReason || null,
      expenditureType: data.expenditureType,
      preferredSupplier: data.preferredSupplier || null,
      supplierContact: data.supplierContact || null,
      supplierQuoteReference: data.supplierQuoteReference || null,
      requireMultipleQuotes: Boolean(data.requireMultipleQuotes),
      quotesRequired: data.requireMultipleQuotes ? data.quotesRequired || 2 : null,
      approvalRoute,
      manualApproverIds: approvalRoute === 'MANUAL' ? [...new Set(data.manualApproverIds || [])] : null,
      approvalRoutePreview: approvalSteps.map((step) => ({
        stepOrder: step.stepOrder,
        stepType: step.stepType || 'AUTO',
        approverRoleId: step.approverRoleId || null,
        approverUserId: step.approverUserId || null,
        label: step.label || null
      })),
      requestedBySnapshot,
      complianceChecks: data.complianceChecks || null,
      priority: data.priority || 'MEDIUM',
      documents: normalizedDocumentIds,
      status: data.status || 'DRAFT'
    };

    const requisition = await prisma.$transaction(async (tx) => {
      const created = await tx.requisition.create({ data: payload });
      await tx.requisitionLineItem.createMany({
        data: totals.normalizedLineItems.map((item) => ({
          requisitionId: created.id,
          itemName: item.itemName,
          specification: item.specification,
          quantity: item.quantity,
          unitOfMeasure: item.unitOfMeasure,
          estimatedUnitCost: item.estimatedUnitCost,
          estimatedTotalCost: item.estimatedTotalCost,
          preferredBrandModel: item.preferredBrandModel,
          requiredByDate: item.requiredByDate,
          budgetCode: item.budgetCode,
          costCenter: item.costCenter
        }))
      });
      if (normalizedAttachments.length) {
        await tx.requisitionAttachment.createMany({
          data: normalizedAttachments.map((attachment) => {
            const linkedDocument = attachmentDocumentMap.get(attachment.documentId);
            return {
              requisitionId: created.id,
              attachmentType: attachment.attachmentType,
              documentId: attachment.documentId,
              fileName: attachment.fileName || linkedDocument?.fileName || null,
              mimeType: attachment.mimeType || linkedDocument?.mimeType || null,
              fileSize: attachment.fileSize || linkedDocument?.fileSize || null,
              uploadedById: auth.userId,
              metadata: {
                title: linkedDocument?.title || null,
                category: linkedDocument?.category || null
              }
            };
          })
        });
      }
      if (created.status === 'SUBMITTED') {
        await createApprovalWorkflow(tx, auth, created, req, approvalSteps);
      }

      await logRequisitionAudit(tx, {
        requisitionId: created.id,
        actorId: auth.userId,
        eventType: created.status === 'SUBMITTED' ? 'REQUISITION_SUBMITTED' : 'REQUISITION_DRAFT_CREATED',
        description: created.status === 'SUBMITTED'
          ? 'Requisition submitted for approval'
          : 'Requisition saved as draft',
        newValues: {
          status: created.status,
          requestCategory: created.requestCategory,
          requestType: created.requestType,
          priority: created.priority
        }
      });
      await logRequisitionAudit(tx, {
        requisitionId: created.id,
        actorId: auth.userId,
        eventType: 'LINE_ITEMS_ADDED',
        description: 'Line items added to requisition',
        newValues: totals.normalizedLineItems
      });
      await logRequisitionAudit(tx, {
        requisitionId: created.id,
        actorId: auth.userId,
        eventType: 'AMOUNT_SET',
        description: 'Initial financial totals set for requisition',
        newValues: {
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
          currency: payload.currency
        }
      });
      if (normalizedAttachments.length) {
        await logRequisitionAudit(tx, {
          requisitionId: created.id,
          actorId: auth.userId,
          eventType: 'ATTACHMENTS_ADDED',
          description: 'Supporting attachments added during requisition creation',
          newValues: normalizedAttachments.map((attachment) => ({
            attachmentType: attachment.attachmentType,
            documentId: attachment.documentId
          }))
        });
      }
      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
        entityType: 'Requisition',
        entityId: created.id,
        newValues: created,
        req
      }, tx);
      return created;
    });
    return this.getRequisition(auth, requisition.id);
  },

  async reviewRequisition(auth, id, decision, comment, req) {
    const requisition = await this.getRequisition(auth, id);
    domainGuardService.cannotEditAfterFinalState(requisition, 'Requisition', ['REJECTED', 'CANCELLED']);
    if (!['NEEDS_MORE_INFO', 'APPROVED', 'REJECTED'].includes(decision)) {
      stateMachineService.assertTransition('REQUISITION', requisition.status, decision);
    }
    let updated = requisition;
    if (decision === 'SUBMITTED') {
      updated = await prisma.$transaction(async (tx) => {
        const submitted = await tx.requisition.update({ where: { id }, data: { status: 'SUBMITTED' } });
        if (!submitted.approvalRequestId) {
          const stepsFromPreview = Array.isArray(submitted.approvalRoutePreview)
            ? submitted.approvalRoutePreview
              .map((step, index) => ({
                stepOrder: step.stepOrder || index + 1,
                approverRoleId: step.approverRoleId || null,
                approverUserId: step.approverUserId || null,
                stepType: step.stepType || 'AUTO',
                label: step.label || null
              }))
              .filter((step) => step.approverRoleId || step.approverUserId)
            : [];
          const steps = stepsFromPreview.length
            ? stepsFromPreview
            : await approvalPolicyService.buildRequisitionSteps({
              requesterRoleName: auth.roleName,
              requesterId: auth.userId,
              departmentHeadId: submitted.departmentId
                ? (await tx.department.findUnique({ where: { id: submitted.departmentId }, select: { headId: true } }))?.headId
                : null,
              estimatedAmount: submitted.grandTotal || submitted.estimatedAmount || 0,
              requestCategory: submitted.requestCategory,
              requiresProcurementReview: Boolean(submitted.preferredSupplier || submitted.requireMultipleQuotes)
            });
          await createApprovalWorkflow(tx, auth, submitted, req, steps);
        }
        await logRequisitionAudit(tx, {
          requisitionId: id,
          actorId: auth.userId,
          eventType: 'REQUISITION_SUBMITTED',
          description: 'Draft requisition submitted for approval workflow',
          oldValues: { status: requisition.status },
          newValues: { status: 'SUBMITTED' }
        });
        return tx.requisition.findUnique({ where: { id }, include: requisitionInclude });
      });
    } else if (decision === 'UNDER_REVIEW') {
      updated = await prisma.requisition.update({ where: { id }, data: { status: 'UNDER_REVIEW' }, include: requisitionInclude });
    } else if (decision === 'APPROVED' || decision === 'REJECTED') {
      if (!requisition.approvalRequestId) {
        throw new AppError('This requisition is missing its approval workflow', 400);
      }
      await approvalService.act(requisition.approvalRequestId, decision, auth.userId, comment, req);
      updated = await prisma.requisition.findUnique({ where: { id }, include: requisitionInclude });
    } else if (decision === 'NEEDS_MORE_INFO') {
      if (!requisition.approvalRequestId) {
        throw new AppError('This requisition does not have an approval workflow to request more information on', 400);
      }
      await approvalService.act(requisition.approvalRequestId, decision, auth.userId, comment, req);
      updated = await prisma.requisition.findUnique({ where: { id }, include: requisitionInclude });
    } else if (decision === 'FULFILLED') {
      updated = await prisma.requisition.update({ where: { id }, data: { status: 'FULFILLED', lockedAt: new Date() }, include: requisitionInclude });
    } else {
      updated = await prisma.requisition.update({ where: { id }, data: { status: decision }, include: requisitionInclude });
    }
    if (updated.approvalRequest?.steps?.length) {
      await Promise.all(updated.approvalRequest.steps.map((step) => prisma.requisitionApprovalStep.updateMany({
        where: { requisitionId: id, stepOrder: step.stepOrder },
        data: {
          status: step.status,
          notes: step.comment || undefined
        }
      })));
    }
    await prisma.requisitionAuditLog.create({
      data: {
        requisitionId: id,
        actorId: auth.userId,
        eventType: 'STATUS_UPDATED',
        description: `Requisition status changed to ${updated.status}`,
        oldValues: { status: requisition.status },
        newValues: { status: updated.status, comment: comment || null }
      }
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'Requisition', entityId: id, oldValues: { status: requisition.status }, newValues: { status: updated.status, comment }, req });
    if (updated.requestedById && updated.requestedById !== auth.userId) {
      await notificationService.create({ userId: updated.requestedById, type: 'SYSTEM', title: 'Requisition updated', body: updated.status, entityType: 'Requisition', entityId: id });
    }
    return this.getRequisition(auth, id);
  },

  async attachDocuments(auth, id, documentIds, req) {
    const requisition = await this.getRequisition(auth, id);
    domainGuardService.cannotEditAfterFinalState(requisition, 'Requisition', ['REJECTED', 'CANCELLED']);
    const currentDocumentIds = normalizeDocumentIds(requisition.documents);
    const incomingDocumentIds = normalizeDocumentIds(documentIds);
    const nextDocumentIds = [...new Set([...currentDocumentIds, ...incomingDocumentIds])];
    const existingAttachmentDocumentIds = new Set((requisition.attachments || []).map((attachment) => attachment.documentId).filter(Boolean));
    const newAttachmentDocumentIds = incomingDocumentIds.filter((documentId) => !existingAttachmentDocumentIds.has(documentId));

    const [documents] = await Promise.all([
      newAttachmentDocumentIds.length
        ? prisma.document.findMany({
          where: { id: { in: newAttachmentDocumentIds }, deletedAt: null }
        })
        : Promise.resolve([])
    ]);
    const documentMap = new Map(documents.map((document) => [document.id, document]));
    newAttachmentDocumentIds.forEach((documentId) => {
      if (!documentMap.has(documentId)) throw new AppError('One or more attached documents were not found', 400);
      accessControlService.assertDocumentAccess(auth, documentMap.get(documentId));
    });

    await prisma.$transaction(async (tx) => {
      await tx.requisition.update({
        where: { id },
        data: { documents: nextDocumentIds }
      });
      if (newAttachmentDocumentIds.length) {
        await tx.requisitionAttachment.createMany({
          data: newAttachmentDocumentIds.map((documentId) => {
            const linkedDocument = documentMap.get(documentId);
            return {
              requisitionId: id,
              attachmentType: 'OTHER',
              documentId,
              fileName: linkedDocument?.fileName || null,
              mimeType: linkedDocument?.mimeType || null,
              fileSize: linkedDocument?.fileSize || null,
              uploadedById: auth.userId,
              metadata: {
                title: linkedDocument?.title || null,
                source: 'manual-attach'
              }
            };
          })
        });
      }
      await logRequisitionAudit(tx, {
        requisitionId: id,
        actorId: auth.userId,
        eventType: 'ATTACHMENTS_ADDED',
        description: 'Supporting documents attached to requisition',
        oldValues: { documents: currentDocumentIds },
        newValues: { documents: nextDocumentIds }
      });
    });
    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'Requisition',
      entityId: id,
      oldValues: { documents: currentDocumentIds },
      newValues: { documents: nextDocumentIds },
      req
    });
    return this.getRequisition(auth, id);
  },

  async listVendorDocuments(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const resolvedSortBy = vendorDocumentSortableFields.has(sortBy) ? sortBy : 'createdAt';
    const where = { deletedAt: null, AND: [] };
    if (query.search) {
      where.AND.push({
        OR: [
          { vendorName: { contains: query.search, mode: 'insensitive' } },
          { documentType: { contains: query.search, mode: 'insensitive' } }
        ]
      });
    }
    if (query.vendorName) {
      where.vendorName = { contains: query.vendorName, mode: 'insensitive' };
    }
    if (query.documentType) {
      where.documentType = query.documentType;
    }
    if (query.expiryFrom || query.expiryTo) {
      where.expiryDate = {};
      if (query.expiryFrom) where.expiryDate.gte = new Date(query.expiryFrom);
      if (query.expiryTo) where.expiryDate.lte = new Date(query.expiryTo);
    }
    if (query.status) {
      const matchingDocuments = await prisma.document.findMany({
        where: { status: query.status, deletedAt: null },
        select: { id: true }
      });
      where.documentId = { in: matchingDocuments.map((item) => item.id) };
    }
    if (!where.AND.length) delete where.AND;

    const [items, total] = await prisma.$transaction([
      prisma.vendorDocument.findMany({ where, skip, take: limit, orderBy: { [resolvedSortBy]: sortOrder } }),
      prisma.vendorDocument.count({ where })
    ]);
    const hydratedItems = await hydrateVendorDocuments(items);
    return paginated(hydratedItems, total, page, limit);
  },

  async getVendorDocument(auth, id) {
    const item = await prisma.vendorDocument.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new AppError('Vendor document not found', 404);
    const [hydrated] = await hydrateVendorDocuments([item]);
    return hydrated;
  },

  async createVendorDocument(auth, data, req) {
    const linkedDocument = await prisma.document.findFirst({
      where: { id: data.documentId, deletedAt: null }
    });
    if (!linkedDocument) throw new AppError('Linked document not found', 404);
    accessControlService.assertDocumentAccess(auth, linkedDocument);

    const document = await prisma.vendorDocument.create({
      data: {
        vendorName: data.vendorName,
        documentType: data.documentType,
        documentId: data.documentId,
        expiryDate: data.expiryDate,
        notes: data.notes
      }
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'VendorDocument', entityId: document.id, newValues: document, req });
    return this.getVendorDocument(auth, document.id);
  },

  async archiveVendorDocument(auth, id, req) {
    const existing = await this.getVendorDocument(auth, id);
    const updated = await prisma.vendorDocument.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'VendorDocument',
      entityId: id,
      oldValues: existing,
      newValues: updated,
      req
    });
    return updated;
  }
};

module.exports = operationsService;
