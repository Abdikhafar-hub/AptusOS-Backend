const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const uploadService = require('../uploads/uploadService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const accessControlService = require('./accessControlService');
const approvalService = require('./approvalService');
const notificationService = require('./notificationService');
const approvalPolicyService = require('./approvalPolicyService');

const nullIfBlank = (value) => {
  if (typeof value === 'string' && !value.trim()) return null;
  return value;
};

const documentService = {
  buildWhere(auth, query = {}) {
    const where = { deletedAt: null, AND: [] };
    ['category', 'ownerType', 'ownerId', 'departmentId', 'status', 'visibility', 'documentType'].forEach((field) => {
      if (query[field]) where[field] = query[field];
    });
    if (query.expiringBefore || query.expiryFrom || query.expiryTo) {
      where.expiryDate = {};
      if (query.expiringBefore) where.expiryDate.lte = new Date(query.expiringBefore);
      if (query.expiryFrom) where.expiryDate.gte = new Date(query.expiryFrom);
      if (query.expiryTo) where.expiryDate.lte = new Date(query.expiryTo);
    }
    if (query.search) {
      where.AND.push({ OR: ['title', 'description', 'fileName'].map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' } })) });
    }
    if (accessControlService.isGeneralManager(auth)) {
      if (!where.AND.length) delete where.AND;
      return where;
    }
    where.AND.push({ OR: [
      { visibility: 'COMPANY_INTERNAL' },
      { uploadedById: auth.userId },
      { ownerType: 'USER', ownerId: auth.userId },
      ...(auth.departmentIds?.length ? [{ departmentId: { in: auth.departmentIds }, visibility: { in: ['DEPARTMENT_ONLY', 'COMPANY_INTERNAL'] } }] : []),
      ...(accessControlService.isHr(auth) ? [{ ownerType: { in: ['HR', 'USER'] } }] : []),
      ...(accessControlService.isFinance(auth) ? [{ ownerType: 'FINANCE' }] : []),
      ...(accessControlService.isSalesCompliance(auth) ? [{ ownerType: { in: ['COMPLIANCE', 'CUSTOMER'] } }] : []),
      ...(accessControlService.isOperations(auth) ? [{ ownerType: 'OPERATIONS' }] : [])
    ] });
    delete where.OR;
    if (!where.AND.length) delete where.AND;
    return where;
  },

  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = this.buildWhere(auth, query);
    const [items, total] = await prisma.$transaction([
      prisma.document.findMany({ where, include: { uploadedBy: { select: { id: true, fullName: true } }, approvedBy: { select: { id: true, fullName: true } } }, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.document.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async get(id, auth) {
    const item = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: {
        documentVersions: true,
        comments: {
          where: { deletedAt: null },
          include: { author: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: 'desc' }
        },
        uploadedBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
        department: { select: { id: true, name: true, slug: true, headId: true } }
      }
    });
    if (!item) throw new AppError('Document not found', 404);
    accessControlService.assertDocumentAccess(auth, item);
    const approvalRequest = await prisma.approvalRequest.findFirst({
      where: { entityType: 'DOCUMENT', entityId: id, deletedAt: null },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        currentApprover: { select: { id: true, fullName: true, email: true } },
        steps: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return { ...item, approvalRequest };
  },

  async upload(file, data, actorId, req) {
    if (!file) throw new AppError('A file upload is required', 400);
    const uploaded = await uploadService.uploadSingleFile(file, data.folder || 'documents');
    const documentData = {
      title: data.title,
      description: data.description,
      category: data.category,
      documentType: nullIfBlank(data.documentType),
      ownerType: data.ownerType,
      ownerId: nullIfBlank(data.ownerId),
      departmentId: nullIfBlank(data.departmentId),
      visibility: data.visibility || 'PRIVATE',
      status: data.status || 'DRAFT',
      expiryDate: data.expiryDate,
      reminderDate: data.reminderDate,
      ...uploaded,
      uploadedById: actorId,
      fileSize: uploaded.fileSize
    };
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: documentData
      });
      await auditService.log({ actorId, action: AUDIT_ACTIONS.DOCUMENT_UPLOADED, entityType: 'Document', entityId: created.id, newValues: created, req }, tx);
      return created;
    });
    if (document.status === 'PENDING_APPROVAL') {
      await this.requestApproval(document.id, actorId, { reason: data.approvalReason, currentApproverId: data.currentApproverId, steps: data.approvalSteps }, req);
    }
    return document;
  },

  async version(id, file, actorId, req) {
    const existing = await this.get(id, req.auth);
    if (!file) throw new AppError('A file upload is required', 400);
    const uploaded = await uploadService.uploadSingleFile(file, 'documents');
    const version = existing.version + 1;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({ data: { documentId: id, version, uploadedById: actorId, ...uploaded } });
      return tx.document.update({ where: { id }, data: { ...uploaded, version, status: 'DRAFT' } });
    });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DOCUMENT_UPLOADED, entityType: 'Document', entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async requestApproval(id, actorId, data, req) {
    const document = await this.get(id, req.auth || { userId: actorId, roleName: 'GENERAL_MANAGER', departmentIds: [] });
    if (document.status === 'APPROVED') throw new AppError('Document is already approved', 400);
    const existingApproval = await approvalService.getOpenByEntity('DOCUMENT', id);
    if (existingApproval) throw new AppError('Document already has a pending approval request', 400);
    const steps = data.steps?.length
      ? data.steps
      : data.currentApproverId
        ? [{ approverUserId: data.currentApproverId, stepOrder: 1 }]
        : await approvalPolicyService.buildDocumentSteps({
          ownerType: document.ownerType,
          requesterRoleName: req.auth?.roleName,
          departmentHeadId: document.department?.headId,
          actorId
        });
    if (!steps.length) throw new AppError('Document approval workflow could not resolve a valid approver', 400);
    const approval = await approvalService.create({
      requestType: 'DOCUMENT',
      entityType: 'DOCUMENT',
      entityId: id,
      requestedById: actorId,
      currentApproverId: data.currentApproverId,
      reason: data.reason,
      steps
    }, actorId, req);
    await prisma.document.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
    return approval;
  },

  async approve(id, actorId, req) {
    const existing = await this.get(id, req.auth);
    const approvalRequest = await approvalService.getOpenByEntity('DOCUMENT', id);
    if (approvalRequest) {
      await approvalService.act(approvalRequest.id, 'APPROVED', actorId, req.body?.comment, req);
      return this.get(id, req.auth);
    }
    if (existing.status === 'PENDING_APPROVAL') {
      throw new AppError('Document is awaiting workflow approval and must be processed through the approval queue', 400);
    }
    if (existing.status !== 'REJECTED' && existing.status !== 'DRAFT') throw new AppError('Document is not eligible for direct approval', 400);
    const document = await prisma.document.update({ where: { id }, data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date(), rejectionReason: null } });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DOCUMENT_APPROVED, entityType: 'Document', entityId: id, newValues: document, req });
    if (document.uploadedById !== actorId) {
      await notificationService.create({ userId: document.uploadedById, type: 'DOCUMENT_UPLOADED', title: 'Document approved', body: document.title, entityType: 'Document', entityId: id });
    }
    return document;
  },

  async reject(id, rejectionReason, actorId, req) {
    const existing = await this.get(id, req.auth);
    const approvalRequest = await approvalService.getOpenByEntity('DOCUMENT', id);
    if (approvalRequest) {
      await approvalService.act(approvalRequest.id, 'REJECTED', actorId, rejectionReason, req);
      return this.get(id, req.auth);
    }
    if (existing.status === 'PENDING_APPROVAL') {
      throw new AppError('Document is awaiting workflow approval and must be processed through the approval queue', 400);
    }
    if (!rejectionReason) throw new AppError('A rejection reason is required', 400);
    const document = await prisma.document.update({ where: { id }, data: { status: 'REJECTED', rejectionReason } });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DOCUMENT_REJECTED, entityType: 'Document', entityId: id, newValues: document, req });
    return document;
  },

  async archive(id, actorId, req) {
    const existing = await this.get(id, req.auth);
    const document = await prisma.document.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DOCUMENT_REJECTED, entityType: 'Document', entityId: id, oldValues: existing, newValues: document, req });
    return document;
  },

  async expiringDocuments(auth, query = {}) {
    return this.list(auth, { ...query, expiringBefore: query.expiringBefore || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
  },

  async dashboardMetrics(auth) {
    const where = this.buildWhere(auth, {});
    const now = new Date();
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [byStatus, expiringSoon, awaitingApproval] = await prisma.$transaction([
      prisma.document.groupBy({ by: ['status'], where, _count: true }),
      prisma.document.count({ where: { ...where, expiryDate: { gte: now, lte: soon } } }),
      prisma.document.count({ where: { ...where, status: 'PENDING_APPROVAL' } })
    ]);
    return { byStatus, expiringSoon, awaitingApproval };
  }
};

module.exports = documentService;
