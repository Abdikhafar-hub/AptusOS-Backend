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
  approvalRequest: {
    include: {
      requestedBy: { select: { id: true, fullName: true, email: true } },
      currentApprover: { select: { id: true, fullName: true, email: true } },
      steps: true
    }
  }
};

async function createApprovalWorkflow(tx, auth, requisition, req) {
  const steps = await approvalPolicyService.buildRequisitionSteps({
    requesterRoleName: auth.roleName,
    estimatedAmount: requisition.estimatedAmount
  });
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
    const [comments, timeline, documentRecords] = await Promise.all([
      prisma.comment.findMany({
        where: { entityType: 'REQUISITION', entityId: id, deletedAt: null },
        include: { author: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      timelineService.getTimeline('REQUISITION', id),
      documentIds.length
        ? prisma.document.findMany({
          where: { id: { in: documentIds }, deletedAt: null },
          include: {
            uploadedBy: { select: { id: true, fullName: true, email: true } },
            approvedBy: { select: { id: true, fullName: true, email: true } }
          }
        })
        : Promise.resolve([])
    ]);
    return { ...requisition, comments, timeline, documentRecords };
  },

  async createRequisition(auth, data, req) {
    const payload = {
      requestedById: auth.userId,
      departmentId: data.departmentId || req.user.departmentId,
      title: data.title,
      description: data.description,
      estimatedAmount: data.estimatedAmount,
      priority: data.priority || 'MEDIUM',
      documents: normalizeDocumentIds(data.documents),
      status: data.status || 'DRAFT'
    };
    const requisition = await prisma.$transaction(async (tx) => {
      const created = await tx.requisition.create({ data: payload });
      if (created.status === 'SUBMITTED') {
        await createApprovalWorkflow(tx, auth, created, req);
      }
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'Requisition', entityId: created.id, newValues: created, req }, tx);
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
          await createApprovalWorkflow(tx, auth, submitted, req);
        }
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
    const nextDocumentIds = [...new Set([...currentDocumentIds, ...normalizeDocumentIds(documentIds)])];
    await prisma.requisition.update({
      where: { id },
      data: { documents: nextDocumentIds }
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
