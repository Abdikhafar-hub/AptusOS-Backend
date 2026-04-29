const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const governanceService = require('./governanceService');
const escalationService = require('./escalationService');
const financeService = require('./financeService');
const reportService = require('./reportService');
const auditLogService = require('./auditLogService');
const communicationService = require('./communicationService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

function assertGeneralManager(auth) {
  if (!accessControlService.isGeneralManager(auth)) {
    throw new AppError('General Manager access required', 403);
  }
}

function applyDateRange(where, query = {}, field = 'createdAt') {
  if (!query.dateFrom && !query.dateTo) return;
  where[field] = {};
  if (query.dateFrom) where[field].gte = new Date(query.dateFrom);
  if (query.dateTo) where[field].lte = new Date(query.dateTo);
}

async function buildEscalationTrendReport(query = {}) {
  const where = {};
  applyDateRange(where, query);
  const rows = await prisma.escalationLog.findMany({
    where,
    select: {
      id: true,
      type: true,
      severity: true,
      relatedEntityType: true,
      relatedEntityId: true,
      createdAt: true,
      resolvedAt: true,
      resolutionNotes: true
    },
    orderBy: { createdAt: 'desc' },
    take: 5000
  });

  return {
    reportType: 'escalation-trend-report',
    columns: ['id', 'type', 'severity', 'relatedEntityType', 'relatedEntityId', 'createdAt', 'resolvedAt', 'resolutionNotes'],
    rows,
    csvReady: true,
    generatedAt: new Date().toISOString(),
    filters: query
  };
}

const HIGH_RISK_LEVELS = new Set(['HIGH', 'CRITICAL']);
const EXPIRY_ALERT_CONTRACT_STATUSES = ['ACTIVE', 'RENEWAL_DUE', 'RENEWED'];
const DELEGATION_SCOPE_OPTIONS = new Set([
  'TASKS',
  'APPROVALS',
  'FINANCE_APPROVALS',
  'HR_ACTIONS',
  'PROCUREMENT_APPROVALS',
  'REPORTS_ACCESS',
  'CONTRACTS',
  'FULL_ACCESS'
]);
const DELEGATION_SCOPE_PERMISSION_MAP = Object.freeze({
  TASKS: 'tasks:update',
  APPROVALS: 'approvals:act',
  FINANCE_APPROVALS: 'finance:manage',
  HR_ACTIONS: 'hr:manage',
  PROCUREMENT_APPROVALS: 'operations:manage',
  REPORTS_ACCESS: 'reports:read',
  CONTRACTS: 'contracts:manage',
  FULL_ACCESS: 'delegations:full-access'
});
const DELEGATION_ACTIVE_STATUSES = new Set(['ACTIVE', 'SCHEDULED', 'PENDING_APPROVAL']);

function nullIfBlank(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return value;
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return JSON.parse(JSON.stringify(metadata));
}

function parseDateOrNull(value, fieldName) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 422);
  }
  return parsed;
}

function resolvePrimaryDocumentId(payload, metadata, fallback = null) {
  if (payload.documentId !== undefined) return nullIfBlank(payload.documentId);
  const signedCopyId = metadata?.documents?.signedCopy?.id;
  const contractDocumentId = metadata?.documents?.contractDocument?.id;
  return nullIfBlank(signedCopyId || contractDocumentId || fallback);
}

function validateEnterpriseContractRules({ status, amount, startDate, endDate, metadata }) {
  if (amount !== null && amount !== undefined && Number.isNaN(Number(amount))) {
    throw new AppError('Contract value must be a valid number', 422);
  }

  if (amount !== null && amount !== undefined && Number(amount) < 0) {
    throw new AppError('Contract value must be greater than or equal to 0', 422);
  }

  if (startDate && endDate && startDate >= endDate) {
    throw new AppError('Start date must be before end date', 422);
  }

  const documents = metadata?.documents || {};
  const hasUploadedDocuments = Boolean(
    documents.contractDocument
      || documents.signedCopy
      || (Array.isArray(documents.supportingDocuments) && documents.supportingDocuments.length)
  );
  const hasSignedCopy = Boolean(documents.signedCopy && (documents.signedCopy.id || documents.signedCopy.name));

  if (status === 'ACTIVE' && hasUploadedDocuments && !hasSignedCopy) {
    throw new AppError('Active status requires a signed copy when documents are attached', 422);
  }

  const riskLevel = metadata?.riskCompliance?.riskLevel;
  const legalReviewRequired = metadata?.riskCompliance?.legalReviewRequired;
  if (HIGH_RISK_LEVELS.has(riskLevel) && legalReviewRequired !== true) {
    throw new AppError('High-risk contracts require legal review', 422);
  }

  const renewalType = metadata?.datesAndRenewal?.renewalType;
  const renewalNoticeDays = Number(metadata?.datesAndRenewal?.renewalNoticeDays || 0);
  if (renewalType === 'AUTO_RENEWAL' && renewalNoticeDays <= 0) {
    throw new AppError('Auto-renewal requires renewal notice days', 422);
  }
}

function toStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeDelegationModules(modules = []) {
  const normalized = toStringArray(modules).map((value) => {
    const upper = value.toUpperCase();
    return upper === 'ALL' ? 'FULL_ACCESS' : upper;
  });
  const deduped = [...new Set(normalized)];
  const invalid = deduped.filter((item) => !DELEGATION_SCOPE_OPTIONS.has(item));
  if (invalid.length) throw new AppError(`Unsupported delegation scopes: ${invalid.join(', ')}`, 422);
  if (!deduped.length) throw new AppError('At least one delegation permission scope is required', 422);
  return deduped;
}

function parseDateOrThrow(value, fieldName) {
  if (!value) throw new AppError(`${fieldName} is required`, 422);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError(`${fieldName} must be a valid date-time`, 422);
  return parsed;
}

function hasPermission(auth, permission) {
  return Array.isArray(auth?.permissions) && auth.permissions.includes(permission);
}

function computeDelegationStatus({ startAt, endAt, approvalRequired, approvedAt, requestedStatus, immediateActivation }) {
  const now = new Date();
  if (requestedStatus === 'REVOKED') return 'REVOKED';
  if (endAt <= now) return 'EXPIRED';
  if (requestedStatus === 'DRAFT') return 'DRAFT';
  if (approvalRequired && !approvedAt) return 'PENDING_APPROVAL';
  if (immediateActivation) return 'ACTIVE';
  if (startAt > now) return 'SCHEDULED';
  return 'ACTIVE';
}

async function refreshDelegationStatuses(tx = prisma) {
  const now = new Date();
  await tx.delegation.updateMany({
    where: {
      status: { in: ['ACTIVE', 'SCHEDULED', 'PENDING_APPROVAL'] },
      autoExpire: true,
      endAt: { lt: now }
    },
    data: {
      status: 'EXPIRED',
      resolvedAt: now
    }
  });
}

function buildDelegationRiskProfile(delegation) {
  const now = new Date();
  const endTime = delegation.endAt ? new Date(delegation.endAt).getTime() : null;
  const hoursToExpiry = endTime ? (endTime - now.getTime()) / (1000 * 60 * 60) : null;
  const expiringSoon = hoursToExpiry !== null && hoursToExpiry > 0 && hoursToExpiry <= 24;
  const highRisk = Boolean(
    delegation.modules?.includes('FULL_ACCESS')
      || delegation.allowFinancialApprovals
      || delegation.allowContractApprovals
      || Number(delegation.maxApprovalAmount || 0) > 0
  );
  return { expiringSoon, highRisk };
}

const generalManagerService = {
  async dashboard(auth, query = {}) {
    assertGeneralManager(auth);

    await escalationService.refreshAutomaticEscalations(auth.userId);

    const settingsMap = await governanceService.getResolvedMap();
    const approvalSlaHours = Number(settingsMap.approvalSlaHours || 24);
    const taskAckHours = Number(settingsMap.taskAcknowledgementSlaHours || 12);
    const issueResolutionHours = Number(settingsMap.issueResolutionSlaHours || 48);
    const now = new Date();

    const approvalCutoff = new Date(now.getTime() - approvalSlaHours * 60 * 60 * 1000);
    const taskCutoff = new Date(now.getTime() - taskAckHours * 60 * 60 * 1000);
    const issueCutoff = new Date(now.getTime() - issueResolutionHours * 60 * 60 * 1000);
    const financeSummary = await financeService.getEnterpriseFinanceSummary(auth, query);
    const unreadMessagesPromise = communicationService.unreadCount(auth.userId);

    const [
      totalStaff,
      activeStaff,
      inactiveStaff,
      activeDepartments,
      archivedDepartments,
      tasksByStatusRaw,
      approvalsByTypeRaw,
      pendingEscalations,
      criticalEscalations,
      overdueTasks,
      complianceOverdue,
      complianceExpiring,
      highRiskCustomers,
      approvalSlaViolations,
      taskSlaViolations,
      issueSlaViolations,
      unreadNotifications,
      recentAudits,
      auditActions,
      contractsExpiringSoon,
      keyAccountsCount,
      escalationSeverityBreakdown,
      departments
    ] = await prisma.$transaction([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, isActive: true, employmentStatus: 'ACTIVE' } }),
      prisma.user.count({ where: { OR: [{ deletedAt: { not: null } }, { isActive: false }, { employmentStatus: { not: 'ACTIVE' } }] } }),
      prisma.department.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.department.count({ where: { OR: [{ deletedAt: { not: null } }, { status: 'ARCHIVED' }] } }),
      prisma.task.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
      prisma.approvalRequest.groupBy({ by: ['requestType'], where: { deletedAt: null }, _count: true }),
      prisma.escalationLog.count({ where: { resolvedAt: null } }),
      prisma.escalationLog.findMany({
        where: { resolvedAt: null, severity: 'CRITICAL' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          createdBy: { select: { id: true, fullName: true } }
        }
      }),
      prisma.task.count({
        where: {
          deletedAt: null,
          status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
          dueDate: { lte: now }
        }
      }),
      prisma.complianceItem.count({
        where: {
          deletedAt: null,
          status: { in: ['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'PENDING', 'SUBMITTED'] },
          OR: [{ dueDate: { lte: now } }, { expiryDate: { lte: now } }]
        }
      }),
      prisma.complianceItem.count({
        where: {
          deletedAt: null,
          OR: [{ dueDate: { lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) } }, { expiryDate: { lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) } }]
        }
      }),
      prisma.customerOnboarding.count({
        where: {
          deletedAt: null,
          OR: [
            { customerHealthStatus: 'AT_RISK' },
            { customerHealthStatus: 'BLOCKED' },
            { blacklistStatus: { in: ['WATCHLISTED', 'BLOCKED'] } }
          ]
        }
      }),
      prisma.approvalRequest.count({ where: { deletedAt: null, status: 'PENDING', createdAt: { lte: approvalCutoff } } }),
      prisma.task.count({
        where: {
          deletedAt: null,
          status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
          dueDate: { lte: taskCutoff }
        }
      }),
      prisma.customerIssue.count({ where: { deletedAt: null, status: { in: ['OPEN', 'ESCALATED', 'IN_PROGRESS'] }, slaDueAt: { lte: issueCutoff } } }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
      prisma.auditLog.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { actor: { select: { id: true, fullName: true, role: { select: { displayName: true } } } } }
      }),
      prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } }, _count: true }),
      prisma.contract.count({
        where: {
          deletedAt: null,
          status: { in: EXPIRY_ALERT_CONTRACT_STATUSES },
          endDate: { lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) }
        }
      }),
      prisma.customerOnboarding.count({ where: { deletedAt: null, isKeyAccount: true } }),
      prisma.escalationLog.groupBy({ by: ['severity'], where: { resolvedAt: null }, _count: true }),
      prisma.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true } })
    ]);
    const unreadMessages = await unreadMessagesPromise;

    const departmentIds = departments.map((item) => item.id);

    const [departmentTaskCounts, departmentApprovalCounts, departmentComplianceCounts, departmentOverdueCounts] = await Promise.all([
      prisma.task.groupBy({ by: ['departmentId'], where: { deletedAt: null, departmentId: { in: departmentIds } }, _count: true }),
      prisma.approvalRequest.findMany({
        where: { deletedAt: null, status: 'PENDING' },
        select: { requestedBy: { select: { departmentId: true } } }
      }),
      prisma.complianceItem.groupBy({ by: ['departmentId'], where: { deletedAt: null, departmentId: { in: departmentIds }, status: { in: ['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'PENDING', 'SUBMITTED'] } }, _count: true }),
      prisma.task.groupBy({
        by: ['departmentId'],
        where: {
          deletedAt: null,
          departmentId: { in: departmentIds },
          status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
          dueDate: { lte: now }
        },
        _count: true
      })
    ]);

    const taskMap = new Map(departmentTaskCounts.map((item) => [item.departmentId || 'unassigned', item._count]));
    const complianceMap = new Map(departmentComplianceCounts.map((item) => [item.departmentId || 'unassigned', item._count]));
    const overdueMap = new Map(departmentOverdueCounts.map((item) => [item.departmentId || 'unassigned', item._count]));
    const pendingApprovalsByDepartment = new Map();

    for (const item of departmentApprovalCounts) {
      const depId = item.requestedBy?.departmentId || 'unassigned';
      pendingApprovalsByDepartment.set(depId, (pendingApprovalsByDepartment.get(depId) || 0) + 1);
    }

    const departmentActivity = departments.map((department) => ({
      departmentId: department.id,
      departmentName: department.name,
      tasksCount: taskMap.get(department.id) || 0,
      pendingApprovals: pendingApprovalsByDepartment.get(department.id) || 0,
      complianceIssues: complianceMap.get(department.id) || 0,
      overdueItems: overdueMap.get(department.id) || 0
    })).sort((a, b) => b.overdueItems - a.overdueItems);

    const tasksByStatus = tasksByStatusRaw.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {});

    const approvalsByType = approvalsByTypeRaw.map((item) => ({
      requestType: item.requestType,
      count: item._count
    }));

    const escalationBySeverity = escalationSeverityBreakdown.map((item) => ({
      severity: item.severity,
      count: item._count
    }));

    const auditSummary = {
      last7Days: recentAudits.length,
      topActions: auditActions
        .map((item) => ({ action: item.action, count: item._count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    };

    return {
      staffCounts: {
        total: totalStaff,
        active: activeStaff,
        inactive: inactiveStaff
      },
      departmentCounts: {
        total: departments.length,
        active: activeDepartments,
        archived: archivedDepartments
      },
      tasksByStatus,
      approvalsByType,
      pendingEscalations: {
        total: pendingEscalations,
        critical: criticalEscalations,
        bySeverity: escalationBySeverity
      },
      overdueTasksSummary: {
        total: overdueTasks,
        byDepartment: departmentActivity
          .filter((item) => item.overdueItems > 0)
          .map((item) => ({ departmentName: item.departmentName, overdueCount: item.overdueItems }))
      },
      financeSummary,
      complianceSummary: {
        openComplianceItems: complianceOverdue,
        upcomingComplianceDeadlines: complianceExpiring,
        highRiskCustomers
      },
      SLAviolations: {
        approval: approvalSlaViolations,
        taskAcknowledgement: taskSlaViolations,
        issueResolution: issueSlaViolations,
        total: approvalSlaViolations + taskSlaViolations + issueSlaViolations,
        targetHours: {
          approval: approvalSlaHours,
          taskAcknowledgement: taskAckHours,
          issueResolution: issueResolutionHours
        }
      },
      auditSummary,
      alertsSummary: {
        unreadNotifications,
        unreadMessages,
        contractsExpiringSoon,
        openEscalations: pendingEscalations,
        keyAccounts: keyAccountsCount
      },
      departmentActivity,
      recentAuditLogs: recentAudits
    };
  },

  async listEscalations(auth, query = {}) {
    assertGeneralManager(auth);
    return escalationService.list(auth, query);
  },

  async resolveEscalation(auth, escalationId, payload = {}, req) {
    return escalationService.resolve(auth, escalationId, payload, req);
  },

  async runEnterpriseReport(auth, payload = {}, req) {
    assertGeneralManager(auth);

    const reportType = String(payload.reportType || '').trim();
    const filters = payload.filters || {};

    if (!reportType) throw new AppError('reportType is required', 422);

    let result = await reportService.runEnterprise(reportType, filters, auth);
    if (!result && reportType === 'escalationTrendReport') result = await buildEscalationTrendReport(filters);
    if (!result) throw new AppError('Unsupported enterprise report type', 422);

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.GM_REPORT_RUN,
      entityType: 'GeneralManagerReport',
      entityId: reportType,
      newValues: { reportType, filters },
      req
    });

    return result;
  },

  async getSettings(auth) {
    assertGeneralManager(auth);
    return governanceService.getSettings();
  },

  async updateSettings(auth, payload, req) {
    assertGeneralManager(auth);
    return governanceService.updateSettings(auth, payload.settings || payload, req);
  },

  async getFinanceSummary(auth, query = {}) {
    assertGeneralManager(auth);
    return financeService.getEnterpriseFinanceSummary(auth, query);
  },

  async listPayables(auth, query = {}) {
    assertGeneralManager(auth);
    return financeService.listEnterprisePayables(auth, query);
  },

  async listReceivables(auth, query = {}) {
    assertGeneralManager(auth);
    return financeService.listEnterpriseReceivables(auth, query);
  },

  async listAuditLogs(auth, query = {}) {
    assertGeneralManager(auth);
    return auditLogService.list({
      ...query,
      entityType: query.entityType || query.type
    });
  },

  async listKeyAccounts(auth, query = {}) {
    assertGeneralManager(auth);
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null, isKeyAccount: true };

    if (query.search) {
      where.OR = [
        { businessName: { contains: String(query.search), mode: 'insensitive' } },
        { contactPersonName: { contains: String(query.search), mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.customerOnboarding.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.customerOnboarding.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async listContracts(auth, query = {}) {
    assertGeneralManager(auth);
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.dateFrom || query.dateTo) applyDateRange(where, query, 'endDate');

    if (query.search) {
      where.OR = [
        { name: { contains: String(query.search), mode: 'insensitive' } },
        { counterpartyName: { contains: String(query.search), mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.contract.findMany({
        where,
        skip,
        take: limit,
        include: {
          owner: { select: { id: true, fullName: true, email: true } },
          department: { select: { id: true, name: true, slug: true } }
        },
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.contract.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async createContract(auth, payload = {}, req) {
    assertGeneralManager(auth);

    if (!payload.name || !payload.type || !payload.counterpartyName) {
      throw new AppError('name, type, and counterpartyName are required', 422);
    }

    const metadata = normalizeMetadata(payload.metadata);
    const resolvedStatus = payload.status || metadata?.contractBasics?.status || 'DRAFT';
    const resolvedStartDate = parseDateOrNull(payload.startDate || metadata?.datesAndRenewal?.startDate, 'startDate');
    const resolvedEndDate = parseDateOrNull(payload.endDate || metadata?.datesAndRenewal?.endDate, 'endDate');
    const resolvedAmount = payload.amount !== undefined
      ? Number(payload.amount)
      : (metadata?.financialTerms?.contractValue !== undefined ? Number(metadata.financialTerms.contractValue) : null);

    validateEnterpriseContractRules({
      status: resolvedStatus,
      amount: resolvedAmount,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      metadata
    });

    const contract = await prisma.contract.create({
      data: {
        name: String(payload.name),
        type: payload.type,
        status: resolvedStatus,
        category: nullIfBlank(payload.category || metadata?.contractBasics?.category),
        counterpartyName: String(payload.counterpartyName),
        amount: resolvedAmount,
        currency: payload.currency || metadata?.financialTerms?.currency || 'KES',
        startDate: resolvedStartDate,
        endDate: resolvedEndDate,
        renewalReminderDays: Number(payload.renewalReminderDays || metadata?.datesAndRenewal?.renewalNoticeDays || 30),
        ownerId: nullIfBlank(payload.ownerId || metadata?.contractBasics?.ownerId || metadata?.contractBasics?.internalResponsiblePersonId),
        departmentId: nullIfBlank(payload.departmentId || metadata?.contractBasics?.departmentId),
        documentId: resolvePrimaryDocumentId(payload, metadata, null),
        metadata,
        notes: payload.notes || null
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.CONTRACT_CREATED,
      entityType: 'Contract',
      entityId: contract.id,
      newValues: contract,
      req
    });

    return contract;
  },

  async updateContract(auth, contractId, payload = {}, req) {
    assertGeneralManager(auth);
    const existing = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!existing || existing.deletedAt) throw new AppError('Contract not found', 404);

    const mergedMetadata = payload.metadata === undefined ? existing.metadata : normalizeMetadata(payload.metadata);
    const resolvedStatus = payload.status !== undefined
      ? payload.status
      : (mergedMetadata?.contractBasics?.status || existing.status);
    const resolvedStartDate = payload.startDate !== undefined
      ? parseDateOrNull(payload.startDate, 'startDate')
      : (payload.metadata !== undefined && mergedMetadata?.datesAndRenewal?.startDate !== undefined
        ? parseDateOrNull(mergedMetadata.datesAndRenewal.startDate, 'startDate')
        : existing.startDate);
    const resolvedEndDate = payload.endDate !== undefined
      ? parseDateOrNull(payload.endDate, 'endDate')
      : (payload.metadata !== undefined && mergedMetadata?.datesAndRenewal?.endDate !== undefined
        ? parseDateOrNull(mergedMetadata.datesAndRenewal.endDate, 'endDate')
        : existing.endDate);
    const resolvedAmount = payload.amount !== undefined
      ? Number(payload.amount)
      : (payload.metadata !== undefined && mergedMetadata?.financialTerms?.contractValue !== undefined
        ? Number(mergedMetadata.financialTerms.contractValue)
        : (existing.amount === null ? null : Number(existing.amount)));

    validateEnterpriseContractRules({
      status: resolvedStatus,
      amount: resolvedAmount,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      metadata: mergedMetadata
    });

    const contract = await prisma.contract.update({
      where: { id: contractId },
      data: {
        name: payload.name !== undefined ? String(payload.name) : undefined,
        type: payload.type,
        status: resolvedStatus,
        category: payload.category !== undefined
          ? nullIfBlank(payload.category)
          : (mergedMetadata?.contractBasics?.category !== undefined ? nullIfBlank(mergedMetadata.contractBasics.category) : undefined),
        counterpartyName: payload.counterpartyName !== undefined ? String(payload.counterpartyName) : undefined,
        amount: payload.amount !== undefined
          ? resolvedAmount
          : (mergedMetadata?.financialTerms?.contractValue !== undefined ? Number(mergedMetadata.financialTerms.contractValue) : undefined),
        currency: payload.currency !== undefined
          ? payload.currency
          : (payload.metadata !== undefined && mergedMetadata?.financialTerms?.currency !== undefined
            ? mergedMetadata.financialTerms.currency
            : undefined),
        startDate: payload.startDate !== undefined ? resolvedStartDate : undefined,
        endDate: payload.endDate !== undefined ? resolvedEndDate : undefined,
        renewalReminderDays: payload.renewalReminderDays !== undefined
          ? Number(payload.renewalReminderDays)
          : (mergedMetadata?.datesAndRenewal?.renewalNoticeDays !== undefined ? Number(mergedMetadata.datesAndRenewal.renewalNoticeDays) : undefined),
        ownerId: payload.ownerId !== undefined
          ? nullIfBlank(payload.ownerId)
          : (mergedMetadata?.contractBasics?.ownerId !== undefined
            ? nullIfBlank(mergedMetadata.contractBasics.ownerId)
            : (mergedMetadata?.contractBasics?.internalResponsiblePersonId !== undefined
              ? nullIfBlank(mergedMetadata.contractBasics.internalResponsiblePersonId)
              : undefined)),
        departmentId: payload.departmentId !== undefined
          ? nullIfBlank(payload.departmentId)
          : (mergedMetadata?.contractBasics?.departmentId !== undefined ? nullIfBlank(mergedMetadata.contractBasics.departmentId) : undefined),
        documentId: resolvePrimaryDocumentId(payload, mergedMetadata, existing.documentId),
        metadata: payload.metadata !== undefined ? mergedMetadata : undefined,
        notes: payload.notes !== undefined ? payload.notes : undefined
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.CONTRACT_UPDATED,
      entityType: 'Contract',
      entityId: contract.id,
      oldValues: existing,
      newValues: contract,
      req
    });

    return contract;
  },

  async deleteContract(auth, contractId, req) {
    assertGeneralManager(auth);
    const existing = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!existing || existing.deletedAt) throw new AppError('Contract not found', 404);

    const contract = await prisma.contract.update({
      where: { id: contractId },
      data: { deletedAt: new Date() }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.CONTRACT_DELETED,
      entityType: 'Contract',
      entityId: contract.id,
      oldValues: existing,
      newValues: contract,
      req
    });

    return contract;
  },

  async listDelegations(auth, query = {}) {
    assertGeneralManager(auth);
    await refreshDelegationStatuses();

    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = {};

    if (query.status) where.status = query.status;
    if (query.delegateUserId) where.delegateUserId = query.delegateUserId;
    if (query.delegatorId) where.delegatorId = query.delegatorId;
    if (query.restrictedDepartmentId) where.restrictedDepartmentId = query.restrictedDepartmentId;
    if (query.search) {
      where.OR = [
        { notes: { contains: String(query.search), mode: 'insensitive' } },
        { justification: { contains: String(query.search), mode: 'insensitive' } },
        { reason: { contains: String(query.search), mode: 'insensitive' } },
        { delegateUser: { is: { fullName: { contains: String(query.search), mode: 'insensitive' } } } },
        { delegator: { is: { fullName: { contains: String(query.search), mode: 'insensitive' } } } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.delegation.findMany({
        where,
        skip,
        take: limit,
        include: {
          delegator: { select: { id: true, fullName: true, role: { select: { name: true, displayName: true } } } },
          delegateUser: { select: { id: true, fullName: true, email: true } },
          approver: { select: { id: true, fullName: true, email: true } },
          approvedBy: { select: { id: true, fullName: true } },
          restrictedDepartment: { select: { id: true, name: true, slug: true } },
          resolvedBy: { select: { id: true, fullName: true } }
        },
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.delegation.count({ where })
    ]);

    const decorated = items.map((item) => {
      const risk = buildDelegationRiskProfile(item);
      return {
        ...item,
        scope: item.modules,
        riskLevel: risk.highRisk ? 'HIGH' : 'LOW',
        expiringSoon: risk.expiringSoon
      };
    });

    return paginated(decorated, total, page, limit);
  },

  async createDelegation(auth, payload = {}, req) {
    assertGeneralManager(auth);
    await refreshDelegationStatuses();

    if (!payload.delegateUserId) throw new AppError('delegateUserId is required', 422);
    if (!payload.reason) throw new AppError('Delegation reason is required', 422);
    if (!payload.justification || !String(payload.justification).trim()) throw new AppError('Detailed justification is required', 422);

    if (payload.delegateUserId === auth.userId) {
      throw new AppError('You cannot delegate authority to yourself', 422);
    }

    const scopeModules = normalizeDelegationModules(payload.modules);
    if (scopeModules.includes('FULL_ACCESS') && !hasPermission(auth, 'delegations:full-access')) {
      throw new AppError('Full access delegation is restricted to explicit admin permission holders', 403);
    }

    for (const scope of scopeModules) {
      const permissionKey = DELEGATION_SCOPE_PERMISSION_MAP[scope];
      if (permissionKey && !hasPermission(auth, permissionKey)) {
        throw new AppError(`You cannot delegate ${scope} because you do not hold that privilege`, 403);
      }
    }

    const [delegateUser, restrictedDepartment, approver] = await Promise.all([
      prisma.user.findUnique({
        where: { id: payload.delegateUserId },
        include: { role: { include: { permissions: { include: { permission: true } } } } }
      }),
      payload.restrictedDepartmentId ? prisma.department.findUnique({ where: { id: payload.restrictedDepartmentId } }) : Promise.resolve(null),
      payload.approverId ? prisma.user.findUnique({ where: { id: payload.approverId } }) : Promise.resolve(null)
    ]);

    if (!delegateUser || !delegateUser.isActive || delegateUser.deletedAt) {
      throw new AppError('Delegatee must be an active user', 422);
    }

    if (payload.restrictedDepartmentId && !restrictedDepartment) {
      throw new AppError('Restricted department not found', 404);
    }

    const approvalRequired = Boolean(payload.approvalRequired);
    if (approvalRequired && !payload.approverId) {
      throw new AppError('Approver is required when approval is enabled', 422);
    }
    if (payload.approverId && !approver) throw new AppError('Approver not found', 404);

    const immediateActivation = payload.immediateActivation === true;
    const autoExpire = payload.autoExpire !== false;
    const now = new Date();

    let startAt = parseDateOrThrow(payload.startAt, 'startAt');
    const endAt = parseDateOrThrow(payload.endAt, 'endAt');
    if (immediateActivation && startAt < now) startAt = now;
    if (startAt >= endAt) throw new AppError('Delegation endAt must be after startAt', 422);
    if (startAt < now && !immediateActivation) throw new AppError('Cannot create delegation in the past', 422);

    const maxApprovalAmount = payload.maxApprovalAmount !== undefined ? Number(payload.maxApprovalAmount) : null;
    if (maxApprovalAmount !== null && maxApprovalAmount < 0) throw new AppError('Maximum approval limit must be >= 0', 422);

    const overlap = await prisma.delegation.findFirst({
      where: {
        delegatorId: auth.userId,
        delegateUserId: payload.delegateUserId,
        status: { in: [...DELEGATION_ACTIVE_STATUSES, 'DRAFT'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        modules: { hasSome: scopeModules }
      },
      select: { id: true }
    });
    if (overlap) {
      throw new AppError('Conflicting overlapping delegation already exists for this delegatee and scope', 409);
    }

    const metadata = normalizeMetadata(payload.metadata);
    const requestedStatus = payload.status || (approvalRequired ? 'PENDING_APPROVAL' : undefined);
    const approvedAt = !approvalRequired && requestedStatus === 'ACTIVE' ? now : null;
    const status = computeDelegationStatus({
      startAt,
      endAt,
      approvalRequired,
      approvedAt,
      requestedStatus,
      immediateActivation
    });

    const delegation = await prisma.delegation.create({
      data: {
        delegatorId: auth.userId,
        delegateUserId: payload.delegateUserId,
        modules: scopeModules,
        restrictedModules: toStringArray(payload.restrictedModules),
        restrictedDepartmentId: nullIfBlank(payload.restrictedDepartmentId),
        maxApprovalAmount,
        allowFinancialApprovals: Boolean(payload.allowFinancialApprovals),
        allowContractApprovals: Boolean(payload.allowContractApprovals),
        immediateActivation,
        autoExpire,
        reason: String(payload.reason),
        justification: String(payload.justification),
        approvalRequired,
        approverId: nullIfBlank(payload.approverId),
        approvedAt,
        approvedById: approvedAt ? auth.userId : null,
        metadata,
        startAt,
        endAt,
        status,
        notes: payload.notes || null
      },
      include: {
        delegator: { select: { id: true, fullName: true } },
        delegateUser: { select: { id: true, fullName: true, email: true } },
        approver: { select: { id: true, fullName: true, email: true } },
        restrictedDepartment: { select: { id: true, name: true, slug: true } }
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.DELEGATION_CREATED,
      entityType: 'Delegation',
      entityId: delegation.id,
      newValues: delegation,
      req
    });

    return delegation;
  },

  async updateDelegation(auth, delegationId, payload = {}, req) {
    assertGeneralManager(auth);
    await refreshDelegationStatuses();

    const existing = await prisma.delegation.findUnique({ where: { id: delegationId } });
    if (!existing) throw new AppError('Delegation not found', 404);

    const delegateUserId = payload.delegateUserId !== undefined ? payload.delegateUserId : existing.delegateUserId;
    if (delegateUserId === auth.userId) throw new AppError('You cannot delegate authority to yourself', 422);

    const scopeModules = payload.modules !== undefined ? normalizeDelegationModules(payload.modules) : existing.modules;
    if (scopeModules.includes('FULL_ACCESS') && !hasPermission(auth, 'delegations:full-access')) {
      throw new AppError('Full access delegation is restricted to explicit admin permission holders', 403);
    }
    for (const scope of scopeModules) {
      const permissionKey = DELEGATION_SCOPE_PERMISSION_MAP[scope];
      if (permissionKey && !hasPermission(auth, permissionKey)) {
        throw new AppError(`You cannot delegate ${scope} because you do not hold that privilege`, 403);
      }
    }

    const [delegateUser, restrictedDepartment, approver] = await Promise.all([
      prisma.user.findUnique({ where: { id: delegateUserId } }),
      payload.restrictedDepartmentId !== undefined && payload.restrictedDepartmentId
        ? prisma.department.findUnique({ where: { id: payload.restrictedDepartmentId } })
        : Promise.resolve(null),
      payload.approverId ? prisma.user.findUnique({ where: { id: payload.approverId } }) : Promise.resolve(null)
    ]);
    if (!delegateUser || !delegateUser.isActive || delegateUser.deletedAt) {
      throw new AppError('Delegatee must be an active user', 422);
    }
    if (payload.restrictedDepartmentId !== undefined && payload.restrictedDepartmentId && !restrictedDepartment) {
      throw new AppError('Restricted department not found', 404);
    }
    if (payload.approverId && !approver) throw new AppError('Approver not found', 404);

    const immediateActivation = payload.immediateActivation !== undefined ? Boolean(payload.immediateActivation) : existing.immediateActivation;
    const approvalRequired = payload.approvalRequired !== undefined ? Boolean(payload.approvalRequired) : existing.approvalRequired;
    if (approvalRequired && !((payload.approverId !== undefined ? payload.approverId : existing.approverId))) {
      throw new AppError('Approver is required when approval is enabled', 422);
    }

    const now = new Date();
    let startAt = payload.startAt !== undefined ? parseDateOrThrow(payload.startAt, 'startAt') : existing.startAt;
    const endAt = payload.endAt !== undefined ? parseDateOrThrow(payload.endAt, 'endAt') : existing.endAt;
    if (payload.startAt !== undefined && immediateActivation && startAt < now) startAt = now;
    if (startAt >= endAt) throw new AppError('Delegation endAt must be after startAt', 422);
    if (startAt < now && !immediateActivation && existing.status === 'DRAFT') {
      throw new AppError('Cannot set delegation start in the past without immediate activation', 422);
    }

    const maxApprovalAmount = payload.maxApprovalAmount !== undefined ? Number(payload.maxApprovalAmount) : (existing.maxApprovalAmount === null ? null : Number(existing.maxApprovalAmount));
    if (maxApprovalAmount !== null && maxApprovalAmount < 0) throw new AppError('Maximum approval limit must be >= 0', 422);

    const overlap = await prisma.delegation.findFirst({
      where: {
        id: { not: delegationId },
        delegatorId: auth.userId,
        delegateUserId,
        status: { in: [...DELEGATION_ACTIVE_STATUSES, 'DRAFT'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        modules: { hasSome: scopeModules }
      },
      select: { id: true }
    });
    if (overlap) throw new AppError('Conflicting overlapping delegation already exists for this delegatee and scope', 409);

    const approvedAt = payload.approvedAt !== undefined
      ? (payload.approvedAt ? parseDateOrThrow(payload.approvedAt, 'approvedAt') : null)
      : existing.approvedAt;
    const status = computeDelegationStatus({
      startAt,
      endAt,
      approvalRequired,
      approvedAt,
      requestedStatus: payload.status || existing.status,
      immediateActivation
    });
    const metadata = payload.metadata !== undefined ? normalizeMetadata(payload.metadata) : undefined;

    const delegation = await prisma.delegation.update({
      where: { id: delegationId },
      data: {
        delegateUserId: payload.delegateUserId !== undefined ? delegateUserId : undefined,
        modules: payload.modules !== undefined ? scopeModules : undefined,
        restrictedModules: payload.restrictedModules !== undefined ? toStringArray(payload.restrictedModules) : undefined,
        restrictedDepartmentId: payload.restrictedDepartmentId !== undefined ? nullIfBlank(payload.restrictedDepartmentId) : undefined,
        maxApprovalAmount: payload.maxApprovalAmount !== undefined ? maxApprovalAmount : undefined,
        allowFinancialApprovals: payload.allowFinancialApprovals !== undefined ? Boolean(payload.allowFinancialApprovals) : undefined,
        allowContractApprovals: payload.allowContractApprovals !== undefined ? Boolean(payload.allowContractApprovals) : undefined,
        immediateActivation: payload.immediateActivation !== undefined ? immediateActivation : undefined,
        autoExpire: payload.autoExpire !== undefined ? Boolean(payload.autoExpire) : undefined,
        reason: payload.reason !== undefined ? nullIfBlank(payload.reason) : undefined,
        justification: payload.justification !== undefined ? nullIfBlank(payload.justification) : undefined,
        approvalRequired: payload.approvalRequired !== undefined ? approvalRequired : undefined,
        approverId: payload.approverId !== undefined ? nullIfBlank(payload.approverId) : undefined,
        approvedAt: payload.approvedAt !== undefined ? approvedAt : undefined,
        approvedById: payload.approvedAt !== undefined ? (approvedAt ? auth.userId : null) : undefined,
        metadata,
        startAt: payload.startAt !== undefined ? startAt : undefined,
        endAt: payload.endAt !== undefined ? endAt : undefined,
        status,
        revokedReason: payload.revokedReason !== undefined ? nullIfBlank(payload.revokedReason) : undefined,
        notes: payload.notes !== undefined ? payload.notes : undefined,
        resolvedAt: status === 'REVOKED' ? new Date() : undefined,
        resolvedById: status === 'REVOKED' ? auth.userId : undefined
      },
      include: {
        delegator: { select: { id: true, fullName: true } },
        delegateUser: { select: { id: true, fullName: true, email: true } },
        approver: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true } },
        restrictedDepartment: { select: { id: true, name: true, slug: true } },
        resolvedBy: { select: { id: true, fullName: true } }
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: status === 'REVOKED' ? AUDIT_ACTIONS.DELEGATION_REVOKED : AUDIT_ACTIONS.DELEGATION_UPDATED,
      entityType: 'Delegation',
      entityId: delegation.id,
      oldValues: existing,
      newValues: delegation,
      req
    });

    return delegation;
  }
};

module.exports = generalManagerService;
