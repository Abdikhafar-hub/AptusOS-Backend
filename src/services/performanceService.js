const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const stateMachineService = require('./stateMachineService');
const domainGuardService = require('./domainGuardService');
const timelineService = require('./timelineService');
const workflowSupportService = require('./workflowSupportService');
const uploadService = require('../uploads/uploadService');

const uniqueIds = (values = []) => [...new Set((values || []).filter(Boolean))];
const parseMentions = (value) => (Array.isArray(value) ? uniqueIds(value.map((item) => String(item).trim()).filter(Boolean)) : []);

const normalizeSupportingDocs = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return [value];
  return [];
};

const hasAtLeastOneGoal = (value) => {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value.goals)) {
    return value.goals.some((goal) => goal && typeof goal === 'object' && String(goal.title || '').trim().length > 0);
  }
  if (typeof value.summary === 'string' && value.summary.trim().length > 0) return true;
  return false;
};

const performanceService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.reviewerId) where.reviewerId = query.reviewerId;
    if (query.cycleName) where.cycleName = { contains: query.cycleName, mode: 'insensitive' };
    if (query.dateFrom || query.dateTo) {
      where.periodStart = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {})
      };
    }
    if (query.departmentId) {
      where.employee = { departmentId: query.departmentId };
    }
    if (query.search) {
      where.OR = [
        { cycleName: { contains: query.search, mode: 'insensitive' } },
        { employee: { is: { fullName: { contains: query.search, mode: 'insensitive' } } } },
        { reviewer: { is: { fullName: { contains: query.search, mode: 'insensitive' } } } }
      ];
    }
    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      else where.employeeId = auth.userId;
    }
    const [items, total] = await prisma.$transaction([
      prisma.performanceReview.findMany({ where, include: { employee: { select: { id: true, fullName: true, departmentId: true } }, reviewer: { select: { id: true, fullName: true } } }, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.performanceReview.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async create(auth, data, req) {
    const periodStart = new Date(data.periodStart);
    const periodEnd = new Date(data.periodEnd);
    if (periodEnd <= periodStart) throw new AppError('Period end must be after period start', 400);
    if (!data.reviewerId) throw new AppError('Reviewer is required', 400);
    if (!hasAtLeastOneGoal(data.goals)) throw new AppError('At least one goal is required', 400);

    const allowedInitialStatuses = new Set(['NOT_STARTED', 'SELF_REVIEW_PENDING', 'MANAGER_REVIEW_PENDING', 'COMPLETED']);
    const initialStatus = data.initialStatus && allowedInitialStatuses.has(data.initialStatus)
      ? data.initialStatus
      : 'SELF_REVIEW_PENDING';

    const review = await prisma.performanceReview.create({
      data: {
        employeeId: data.employeeId,
        reviewerId: data.reviewerId,
        cycleName: data.cycleName,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        goals: data.goals,
        supportingDocs: data.supportingDocs,
        recommendation: data.recommendation,
        status: initialStatus
      }
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'PerformanceReview', entityId: review.id, newValues: review, req });
    await notificationService.create({
      userId: data.employeeId,
      type: 'PERFORMANCE_REVIEW_REQUESTED',
      title: data.cycleName,
      body: initialStatus === 'NOT_STARTED' ? 'A new performance review has been drafted.' : 'A new performance review has been created.',
      entityType: 'PerformanceReview',
      entityId: review.id
    });
    return review;
  },

  async get(id, auth) {
    const review = await prisma.performanceReview.findFirst({
      where: { id, deletedAt: null },
      include: { employee: { select: { id: true, fullName: true, departmentId: true } }, reviewer: { select: { id: true, fullName: true } } }
    });
    if (!review) throw new AppError('Performance review not found', 404);
    const allowed = accessControlService.isGeneralManager(auth)
      || accessControlService.isHr(auth)
      || review.employeeId === auth.userId
      || review.reviewerId === auth.userId
      || (accessControlService.isDepartmentHead(auth) && review.employee?.departmentId && auth.departmentIds.includes(review.employee.departmentId));
    if (!allowed) throw new AppError('You do not have access to this performance review', 403);
    const supportingDocumentIds = normalizeSupportingDocs(review.supportingDocs).flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (item && typeof item === 'object') return [item.documentId, item.id].filter(Boolean);
      return [];
    });
    const [timeline, comments, supportingDocuments] = await Promise.all([
      timelineService.getTimeline('PERFORMANCE_REVIEW', id),
      prisma.comment.findMany({
        where: { entityType: 'PERFORMANCE_REVIEW', entityId: id, deletedAt: null },
        include: { author: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      supportingDocumentIds.length
        ? prisma.document.findMany({
          where: { id: { in: supportingDocumentIds }, deletedAt: null },
          orderBy: { createdAt: 'desc' }
        })
        : Promise.resolve([])
    ]);
    return { ...review, timeline, comments, supportingDocumentRecords: supportingDocuments };
  },

  async submitSelfReview(auth, id, data, req) {
    const review = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(review, 'Performance review', ['COMPLETED']);
    if (review.employeeId !== auth.userId) throw new AppError('Only the assigned employee can submit this self review', 403);
    stateMachineService.assertTransition('PERFORMANCE_REVIEW', review.status, 'MANAGER_REVIEW_PENDING');
    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        selfReview: data.selfReview,
        goals: data.goals || review.goals,
        status: 'MANAGER_REVIEW_PENDING'
      }
    });
    if (review.reviewerId) {
      await notificationService.create({ userId: review.reviewerId, type: 'PERFORMANCE_REVIEW_REQUESTED', title: review.cycleName, body: 'Manager review is now required.', entityType: 'PerformanceReview', entityId: id });
    }
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'PerformanceReview', entityId: id, oldValues: { status: review.status }, newValues: { status: 'MANAGER_REVIEW_PENDING' }, req });
    return updated;
  },

  async submitManagerReview(auth, id, data, req) {
    const review = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(review, 'Performance review', ['COMPLETED']);
    if (review.reviewerId !== auth.userId && !accessControlService.isDepartmentHead(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only the assigned reviewer can submit this manager review', 403);
    }
    stateMachineService.assertTransition('PERFORMANCE_REVIEW', review.status, 'HR_REVIEW_PENDING');
    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        managerReview: data.managerReview,
        score: data.score,
        recommendation: data.recommendation,
        status: 'HR_REVIEW_PENDING'
      }
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'PerformanceReview', entityId: id, oldValues: { status: review.status }, newValues: { status: 'HR_REVIEW_PENDING' }, req });
    return updated;
  },

  async submitHrReview(auth, id, data, req) {
    const review = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(review, 'Performance review', ['COMPLETED']);
    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) throw new AppError('Only HR or General Manager can complete this performance review', 403);
    stateMachineService.assertTransition('PERFORMANCE_REVIEW', review.status, 'COMPLETED');
    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        rating: data.rating,
        recommendation: data.recommendation || review.recommendation,
        score: data.score || review.score,
        status: 'COMPLETED',
        lockedAt: new Date()
      }
    });
    await notificationService.create({ userId: review.employeeId, type: 'PERFORMANCE_REVIEW_REQUESTED', title: review.cycleName, body: 'Your performance review has been completed.', entityType: 'PerformanceReview', entityId: id });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'PerformanceReview', entityId: id, oldValues: { status: review.status }, newValues: { status: 'COMPLETED' }, req });
    return updated;
  },

  async addComment(auth, id, data, req) {
    await this.get(id, auth);
    const comment = await workflowSupportService.createComment({
      authorId: auth.userId,
      entityType: 'PERFORMANCE_REVIEW',
      entityId: id,
      body: data.body,
      mentions: parseMentions(data.mentions),
      attachments: data.attachments
    }, req);

    return {
      reviewId: id,
      comment
    };
  },

  async uploadSupportingDocument(auth, id, file, data, req) {
    if (!file) throw new AppError('A file upload is required', 400);

    const review = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(review, 'Performance review', ['COMPLETED']);

    const canUpload = accessControlService.isGeneralManager(auth)
      || accessControlService.isHr(auth)
      || review.employeeId === auth.userId
      || review.reviewerId === auth.userId;
    if (!canUpload) throw new AppError('You do not have permission to upload supporting documents to this review', 403);

    const uploaded = await uploadService.uploadSingleFile(file, 'performance/supporting-documents');
    const existingDocs = normalizeSupportingDocs(review.supportingDocs);

    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          title: data.title || `${review.employee.fullName} - ${review.cycleName} supporting document`,
          description: data.description || `Supporting document for ${review.cycleName}`,
          category: 'PERFORMANCE_DOCUMENT',
          documentType: 'PERFORMANCE_SUPPORTING_DOCUMENT',
          ownerType: 'USER',
          ownerId: review.employeeId,
          departmentId: review.employee?.departmentId,
          visibility: data.visibility || 'PRIVATE',
          status: 'DRAFT',
          uploadedById: auth.userId,
          ...uploaded
        }
      });

      const supportingDocs = [
        ...existingDocs,
        {
          documentId: document.id,
          title: document.title,
          uploadedById: auth.userId,
          uploadedAt: new Date().toISOString()
        }
      ];

      const updatedReview = await tx.performanceReview.update({
        where: { id },
        data: { supportingDocs }
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
        entityType: 'Document',
        entityId: document.id,
        newValues: document,
        req
      }, tx);
      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'PerformanceReview',
        entityId: id,
        oldValues: { supportingDocs: review.supportingDocs },
        newValues: { supportingDocs },
        req
      }, tx);

      return { review: updatedReview, document, supportingDocs };
    });

    const recipients = uniqueIds([review.employeeId, review.reviewerId]).filter((userId) => userId && userId !== auth.userId);
    if (recipients.length) {
      await notificationService.createMany(recipients, {
        type: 'PERFORMANCE_REVIEW_REQUESTED',
        title: review.cycleName,
        body: 'A supporting document was added to the performance review.',
        entityType: 'PerformanceReview',
        entityId: id
      });
    }

    return result;
  }
};

module.exports = performanceService;
