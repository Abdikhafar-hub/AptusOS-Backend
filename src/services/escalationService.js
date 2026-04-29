const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const governanceService = require('./governanceService');
const notificationService = require('./notificationService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { ROLES } = require('../constants/roles');

function buildSeverityByHours(overdueHours) {
  if (overdueHours >= 168) return 'CRITICAL';
  if (overdueHours >= 72) return 'HIGH';
  if (overdueHours >= 24) return 'MEDIUM';
  return 'LOW';
}

async function findGeneralManagerIds(tx = prisma) {
  const users = await tx.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      role: { name: ROLES.GENERAL_MANAGER }
    },
    select: { id: true }
  });
  return users.map((item) => item.id);
}

async function hasEscalationDelegation(userId, tx = prisma) {
  const now = new Date();
  const delegation = await tx.delegation.findFirst({
    where: {
      delegateUserId: userId,
      status: { in: ['ACTIVE', 'SCHEDULED'] },
      startAt: { lte: now },
      endAt: { gte: now },
      modules: { hasSome: ['FULL_ACCESS', 'ALL', 'ESCALATIONS'] },
      delegator: {
        role: { name: ROLES.GENERAL_MANAGER },
        deletedAt: null,
        isActive: true
      }
    }
  });

  return Boolean(delegation);
}

async function ensureEscalation({
  type,
  relatedEntityType,
  relatedEntityId,
  departmentId,
  reason,
  severity,
  createdById,
  tx = prisma
}) {
  const existing = await tx.escalationLog.findFirst({
    where: {
      type,
      relatedEntityType,
      relatedEntityId,
      resolvedAt: null
    }
  });

  if (existing) return existing;

  const created = await tx.escalationLog.create({
    data: {
      type,
      relatedEntityType,
      relatedEntityId,
      departmentId: departmentId || null,
      reason,
      severity,
      createdById
    }
  });

  await auditService.log({
    actorId: createdById,
    action: AUDIT_ACTIONS.ESCALATION_CREATED,
    entityType: 'EscalationLog',
    entityId: created.id,
    newValues: created
  }, tx);

  const gmIds = await findGeneralManagerIds(tx);
  await notificationService.createMany(gmIds, {
    type: 'ESCALATION_CREATED',
    title: `Escalation raised: ${severity}`,
    body: reason,
    entityType: 'EscalationLog',
    entityId: created.id
  }, tx);

  return created;
}

const escalationService = {
  async refreshAutomaticEscalations(actorId) {
    if (!actorId) return { created: 0 };

    const settings = await governanceService.getResolvedMap();
    const approvalSlaHours = Number(settings.approvalSlaHours || 24);
    const taskAckHours = Number(settings.taskAcknowledgementSlaHours || 12);
    const issueResolutionHours = Number(settings.issueResolutionSlaHours || 48);
    const leaveRejectEscalationCount = Number(settings.leaveRejectEscalationCount || 3);
    const discountThresholdPercent = Number(settings.discountApprovalThresholdPercent || 10);
    const licenseExpiryWarningDays = Number(settings.licenseExpiryWarningDays || 30);
    const missingDocumentsEscalationDays = Number(settings.missingDocumentsEscalationDays || 7);

    const now = new Date();
    const approvalCutoff = new Date(now.getTime() - approvalSlaHours * 60 * 60 * 1000);
    const taskCutoff = new Date(now.getTime() - taskAckHours * 60 * 60 * 1000);
    const issueCutoff = new Date(now.getTime() - issueResolutionHours * 60 * 60 * 1000);
    const licenseCutoff = new Date(now.getTime() + licenseExpiryWarningDays * 24 * 60 * 60 * 1000);
    const missingDocsCutoff = new Date(now.getTime() - missingDocumentsEscalationDays * 24 * 60 * 60 * 1000);
    const leaveWindow = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      overdueApprovals,
      overdueTasks,
      slaBreachedIssues,
      repeatedLeaveRejects,
      financeExceptions,
      dueComplianceItems,
      expiringLicenses,
      openHighRisks,
      missingCriticalCustomerDocs
    ] = await Promise.all([
      prisma.approvalRequest.findMany({
        where: {
          status: 'PENDING',
          createdAt: { lte: approvalCutoff },
          deletedAt: null
        },
        include: { requestedBy: { select: { departmentId: true } } },
        take: 200
      }),
      prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
          dueDate: { lte: taskCutoff }
        },
        select: { id: true, dueDate: true, departmentId: true },
        take: 200
      }),
      prisma.customerIssue.findMany({
        where: {
          deletedAt: null,
          status: { in: ['OPEN', 'ESCALATED', 'IN_PROGRESS'] },
          slaDueAt: { lte: issueCutoff }
        },
        select: { id: true, slaDueAt: true },
        take: 200
      }),
      prisma.leaveRequest.groupBy({
        by: ['employeeId'],
        where: {
          deletedAt: null,
          status: 'REJECTED',
          createdAt: { gte: leaveWindow }
        },
        _count: true
      }),
      prisma.discountRequest.findMany({
        where: {
          deletedAt: null,
          status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
          discountPercent: { gte: discountThresholdPercent }
        },
        select: { id: true, discountPercent: true },
        take: 200
      }),
      prisma.complianceItem.findMany({
        where: {
          deletedAt: null,
          status: { in: ['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'PENDING', 'SUBMITTED'] },
          OR: [{ dueDate: { lte: now } }, { expiryDate: { lte: now } }]
        },
        select: { id: true, priority: true, departmentId: true },
        take: 200
      }),
      prisma.customerOnboarding.findMany({
        where: {
          deletedAt: null,
          accountStatus: { in: ['ACTIVE', 'PENDING_APPROVAL'] },
          licenseExpiryDate: { lte: licenseCutoff }
        },
        select: { id: true, licenseExpiryDate: true },
        take: 200
      }),
      prisma.riskRegister.findMany({
        where: {
          deletedAt: null,
          status: { in: ['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW'] },
          severity: { in: ['HIGH', 'CRITICAL'] }
        },
        select: { id: true, severity: true },
        take: 200
      }),
      prisma.customerOnboarding.findMany({
        where: {
          deletedAt: null,
          createdAt: { lte: missingDocsCutoff },
          OR: [
            { registrationNumber: null },
            { licenseNumber: null },
            { taxComplianceCertificateNumber: null }
          ]
        },
        select: { id: true },
        take: 200
      })
    ]);

    const createdItems = [];

    for (const item of overdueApprovals) {
      const ageHours = Math.max(1, Math.round((now - new Date(item.createdAt)) / (60 * 60 * 1000)));
      createdItems.push(await ensureEscalation({
        type: 'OVERDUE_APPROVAL',
        relatedEntityType: 'APPROVAL_REQUEST',
        relatedEntityId: item.id,
        departmentId: item.requestedBy?.departmentId || null,
        reason: `Approval request overdue by ${ageHours} hours`,
        severity: buildSeverityByHours(ageHours),
        createdById: actorId
      }));
    }

    for (const item of overdueTasks) {
      const ageHours = Math.max(1, Math.round((now - new Date(item.dueDate || now)) / (60 * 60 * 1000)));
      createdItems.push(await ensureEscalation({
        type: 'OVERDUE_TASK',
        relatedEntityType: 'TASK',
        relatedEntityId: item.id,
        departmentId: item.departmentId || null,
        reason: `Task overdue by ${ageHours} hours`,
        severity: buildSeverityByHours(ageHours),
        createdById: actorId
      }));
    }

    for (const item of slaBreachedIssues) {
      const ageHours = Math.max(1, Math.round((now - new Date(item.slaDueAt || now)) / (60 * 60 * 1000)));
      createdItems.push(await ensureEscalation({
        type: 'SLA_VIOLATION',
        relatedEntityType: 'ISSUE',
        relatedEntityId: item.id,
        reason: `Issue resolution SLA breached by ${ageHours} hours`,
        severity: buildSeverityByHours(ageHours),
        createdById: actorId
      }));
    }

    for (const item of repeatedLeaveRejects.filter((entry) => {
      const count = typeof entry._count === 'number'
        ? entry._count
        : Object.values(entry._count || {}).find((value) => typeof value === 'number') || 0;
      return count >= leaveRejectEscalationCount;
    })) {
      createdItems.push(await ensureEscalation({
        type: 'REPEATED_LEAVE_REJECT',
        relatedEntityType: 'LEAVE_REQUEST',
        relatedEntityId: item.employeeId,
        reason: `Repeated leave rejections for employee ${item.employeeId} exceeded threshold`,
        severity: 'HIGH',
        createdById: actorId
      }));
    }

    for (const item of financeExceptions) {
      createdItems.push(await ensureEscalation({
        type: 'FINANCE_EXCEPTION',
        relatedEntityType: 'OTHER',
        relatedEntityId: item.id,
        reason: `Discount exception at ${item.discountPercent}% requires executive oversight`,
        severity: Number(item.discountPercent) >= 25 ? 'CRITICAL' : 'HIGH',
        createdById: actorId
      }));
    }

    for (const item of dueComplianceItems) {
      createdItems.push(await ensureEscalation({
        type: 'COMPLIANCE_VIOLATION',
        relatedEntityType: 'COMPLIANCE_ITEM',
        relatedEntityId: item.id,
        departmentId: item.departmentId || null,
        reason: 'Compliance item is overdue or expired',
        severity: item.priority === 'CRITICAL' ? 'CRITICAL' : item.priority === 'HIGH' ? 'HIGH' : 'MEDIUM',
        createdById: actorId
      }));
    }

    for (const item of expiringLicenses) {
      createdItems.push(await ensureEscalation({
        type: 'LICENSE_EXPIRY',
        relatedEntityType: 'CUSTOMER_ONBOARDING',
        relatedEntityId: item.id,
        reason: 'Customer license is expiring soon',
        severity: 'MEDIUM',
        createdById: actorId
      }));
    }

    for (const item of openHighRisks) {
      createdItems.push(await ensureEscalation({
        type: 'RISK_WARNING',
        relatedEntityType: 'OTHER',
        relatedEntityId: item.id,
        reason: `Open risk with ${item.severity} severity requires GM oversight`,
        severity: item.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        createdById: actorId
      }));
    }

    for (const item of missingCriticalCustomerDocs) {
      createdItems.push(await ensureEscalation({
        type: 'DOCUMENT_MISSING',
        relatedEntityType: 'CUSTOMER_ONBOARDING',
        relatedEntityId: item.id,
        reason: 'Critical onboarding documents missing for more than policy threshold',
        severity: 'HIGH',
        createdById: actorId
      }));
    }

    return { created: createdItems.filter(Boolean).length };
  },

  async list(auth, query = {}) {
    if (!accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only General Manager can view escalations', 403);
    }

    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = {};

    if (query.severity) where.severity = query.severity;
    if (query.relatedEntityType) where.relatedEntityType = query.relatedEntityType;
    if (query.departmentId) where.departmentId = query.departmentId;

    if (query.status === 'RESOLVED') {
      where.resolvedAt = { not: null };
    } else if (query.status === 'OPEN' || !query.status) {
      where.resolvedAt = null;
    }

    if (query.search) {
      where.OR = [
        { reason: { contains: String(query.search), mode: 'insensitive' } },
        { relatedEntityId: { contains: String(query.search), mode: 'insensitive' } },
        { resolutionNotes: { contains: String(query.search), mode: 'insensitive' } }
      ];
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [items, total] = await prisma.$transaction([
      prisma.escalationLog.findMany({
        where,
        skip,
        take: limit,
        include: {
          createdBy: { select: { id: true, fullName: true, email: true } },
          resolvedBy: { select: { id: true, fullName: true, email: true } }
        },
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.escalationLog.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async resolve(auth, escalationId, payload = {}, req) {
    const escalation = await prisma.escalationLog.findUnique({ where: { id: escalationId } });
    if (!escalation) throw new AppError('Escalation not found', 404);

    const canResolve = accessControlService.isGeneralManager(auth) || await hasEscalationDelegation(auth.userId);
    if (!canResolve) throw new AppError('Only GM or delegated executive can resolve escalations', 403);
    if (escalation.resolvedAt && !payload.reopen) throw new AppError('Escalation already resolved', 400);

    const action = payload.action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGE' : 'RESOLVE';
    const notes = payload.resolutionNotes ? String(payload.resolutionNotes).trim() : null;

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.escalationLog.update({
        where: { id: escalationId },
        data: action === 'ACKNOWLEDGE'
          ? {
              resolutionNotes: notes || escalation.resolutionNotes || `Acknowledged by ${auth.userId}`
            }
          : {
              resolvedAt: new Date(),
              resolvedById: auth.userId,
              resolutionNotes: notes || escalation.resolutionNotes || 'Resolved'
            }
      });

      if (action === 'RESOLVE') {
        const gmIds = await findGeneralManagerIds(tx);
        await notificationService.createMany(gmIds, {
          type: 'ESCALATION_RESOLVED',
          title: 'Escalation resolved',
          body: `Escalation ${next.id} resolved by leadership`,
          entityType: 'EscalationLog',
          entityId: next.id
        }, tx);
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.ESCALATION_RESOLVED,
        entityType: 'EscalationLog',
        entityId: escalationId,
        oldValues: escalation,
        newValues: next,
        req
      }, tx);

      return next;
    });

    return updated;
  }
};

module.exports = escalationService;
