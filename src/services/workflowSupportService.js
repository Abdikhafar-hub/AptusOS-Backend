const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const workflowEntityService = require('./workflowEntityService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const accessControlService = require('./accessControlService');

const workflowSupportService = {
  ensureTransition(currentStatus, nextStatus, transitions, label = 'Status') {
    const allowed = transitions[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(`${label} transition ${currentStatus} -> ${nextStatus} is not allowed`, 400);
    }
  },

  normalizeIds(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
  },

  async assertCommentAccess(auth, entityType, entityId) {
    const type = workflowEntityService.normalizeType(entityType);
    const entity = await workflowEntityService.getEntity(type, entityId);
    if (accessControlService.isGeneralManager(auth)) return entity;
    if (type === 'TASK') {
      if (entity.assignedToId === auth.userId || entity.assignedById === auth.userId || (entity.departmentId && auth.departmentIds.includes(entity.departmentId))) return entity;
    }
    if (type === 'APPROVAL') {
      if ([entity.requestedById, entity.currentApproverId].includes(auth.userId)) return entity;
    }
    if (type === 'DOCUMENT') {
      if (accessControlService.canAccessDocument(auth, entity)) return entity;
    }
    if (type === 'LEAVE_REQUEST' || type === 'HR_ACTION' || type === 'SEPARATION') {
      if (entity.employeeId === auth.userId || accessControlService.isHr(auth)) return entity;
    }
    if (type === 'FINANCE_REQUEST') {
      if (entity.requestedById === auth.userId || accessControlService.isFinance(auth) || (entity.departmentId && auth.departmentIds.includes(entity.departmentId))) return entity;
    }
    if (type === 'PERFORMANCE_REVIEW') {
      if ([entity.employeeId, entity.reviewerId].includes(auth.userId) || accessControlService.isHr(auth)) return entity;
    }
    if (type === 'COMPLIANCE_ITEM') {
      if (entity.ownerId === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'COMPLAINT') {
      if (entity.ownerId === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'RISK') {
      if (entity.ownerId === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'INCIDENT') {
      if (entity.reportedById === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'REQUISITION') {
      if (entity.requestedById === auth.userId || accessControlService.isOperations(auth) || (entity.departmentId && auth.departmentIds.includes(entity.departmentId))) return entity;
    }
    if (type === 'CUSTOMER_ONBOARDING') {
      if (entity.assignedOfficerId === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'CUSTOMER_ISSUE') {
      if ([entity.reportedById, entity.assignedToId].includes(auth.userId) || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'DISCOUNT_REQUEST') {
      if (entity.requestedById === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'SALES_OPPORTUNITY') {
      if (entity.ownerId === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'PRODUCT_FEEDBACK') {
      if (entity.submittedById === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    if (type === 'VISIT_ROUTE') {
      if (entity.assignedOfficerId === auth.userId || accessControlService.isSalesCompliance(auth)) return entity;
    }
    throw new AppError('You do not have access to comment on this workflow item', 403);
  },

  async createComment({ authorId, entityType, entityId, body, attachments, mentions = [] }, req, tx = prisma) {
    await this.assertCommentAccess(req.auth, entityType, entityId);
    const recipients = workflowSupportService.normalizeIds([
      ...(await workflowEntityService.getRecipients(entityType, entityId)),
      ...mentions
    ]).filter((userId) => userId !== authorId);

    const comment = await tx.comment.create({
      data: {
        entityType: workflowEntityService.normalizeType(entityType),
        entityId,
        authorId,
        body,
        attachments: attachments || undefined,
        mentions: mentions.length ? mentions : undefined,
        ...workflowEntityService.buildCommentRelations(entityType, entityId)
      }
    });

    await notificationService.createMany(recipients, {
      type: 'MENTION',
      title: `New comment on ${workflowEntityService.normalizeType(entityType).replaceAll('_', ' ').toLowerCase()}`,
      body,
      entityType: workflowEntityService.normalizeType(entityType),
      entityId
    }, tx);

    await auditService.log({
      actorId: authorId,
      action: AUDIT_ACTIONS.COMMENT_ADDED,
      entityType: workflowEntityService.normalizeType(entityType),
      entityId,
      newValues: { body, mentions, attachments },
      req
    }, tx);

    return comment;
  }
};

module.exports = workflowSupportService;
