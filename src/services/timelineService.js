const prisma = require('../prisma/client');

const timelineTypeMap = {
  TASK: 'Task',
  APPROVAL: 'ApprovalRequest',
  FINANCE_REQUEST: 'FinanceRequest',
  LEAVE_REQUEST: 'LeaveRequest',
  ONBOARDING: 'OnboardingChecklist',
  ONBOARDING_ITEM: 'OnboardingItem',
  PERFORMANCE_REVIEW: 'PerformanceReview',
  COMPLIANCE_ITEM: 'ComplianceItem',
  REQUISITION: 'Requisition',
  DOCUMENT: 'Document',
  CUSTOMER_ONBOARDING: 'CustomerOnboarding',
  SALES_REPORT: 'SalesReport',
  CLIENT_VISIT: 'ClientVisitNote',
  COMPLAINT: 'ComplaintEscalation',
  RISK: 'RiskRegister',
  INCIDENT: 'IncidentReport',
  CUSTOMER_ISSUE: 'CustomerIssue',
  DISCOUNT_REQUEST: 'DiscountRequest',
  SALES_OPPORTUNITY: 'SalesOpportunity',
  PRODUCT_FEEDBACK: 'ProductFeedback',
  SALES_TERRITORY: 'SalesTerritory',
  VISIT_ROUTE: 'VisitRoute',
  POLICY_ACKNOWLEDGEMENT: 'PolicyAcknowledgement',
  HR_ACTION: 'HRAction',
  SEPARATION: 'Separation',
  TRAINING: 'Training',
  ATTENDANCE: 'AttendanceRecord'
};

const formatAction = (value) => String(value || '').replaceAll('_', ' ').trim();

const buildAuditDescription = (item) => {
  if (item.actor?.fullName && item.entityType) {
    return `${item.actor.fullName} updated ${item.entityType}.`;
  }
  if (item.actor?.fullName) return item.actor.fullName;
  if (item.entityType) return `${item.entityType} activity recorded.`;
  return 'System activity recorded.';
};

const timelineService = {
  async getTimeline(entityType, entityId) {
    const normalized = String(entityType || '').toUpperCase();
    const auditEntityType = timelineTypeMap[normalized] || entityType;
    const [audits, comments] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where: { entityType: auditEntityType, entityId },
        include: { actor: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      prisma.comment.findMany({
        where: { entityType: normalized, entityId, deletedAt: null },
        include: { author: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    ]);

    return [
      ...audits.map((item) => ({
        id: `audit-${item.id}`,
        type: 'AUDIT',
        title: formatAction(item.action) || 'Audit event',
        description: buildAuditDescription(item),
        action: item.action,
        actor: item.actor,
        createdAt: item.createdAt,
        metadata: {
          oldValues: item.oldValues,
          newValues: item.newValues
        }
      })),
      ...comments.map((item) => ({
        id: `comment-${item.id}`,
        type: 'COMMENT',
        title: item.author?.fullName ? `Comment from ${item.author.fullName}` : 'Comment added',
        description: item.body,
        action: 'COMMENT_ADDED',
        actor: item.author,
        createdAt: item.createdAt,
        metadata: {
          body: item.body,
          mentions: item.mentions,
          attachments: item.attachments
        }
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
};

module.exports = timelineService;
