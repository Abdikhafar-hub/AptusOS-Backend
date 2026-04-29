const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { ROLES, normalizeRoleName } = require('../constants/roles');

const LEGACY_REPORT_MAP = {
  staff: 'user',
  departments: 'department',
  leave: 'leaveRequest',
  attendance: 'attendanceRecord',
  trainings: 'training',
  performance: 'performanceReview',
  separations: 'separation',
  'hr-actions': 'hRAction',
  payroll: 'payslip',
  finance: 'financeRequest',
  'finance-requests': 'financeRequest',
  expense: 'financeRequest',
  payment: 'financeRequest',
  'petty-cash': 'financeRequest',
  'travel-requests': 'financeRequest',
  'procurement-payment': 'financeRequest',
  'budget-usage': 'budget',
  'payment-proofs': 'financeRequest',
  accounts: 'document',
  'tax-kra-documents': 'document',
  documents: 'document',
  requisitions: 'requisition',
  'vendor-documents': 'vendorDocument',
  'procurement-documents': 'document',
  'logistics-tasks': 'task',
  'operations-tasks': 'task',
  compliance: 'complianceItem',
  customers: 'customerOnboarding',
  'customer-coverage': 'customerOnboarding',
  'territory-performance': 'salesTerritory',
  'visit-performance': 'clientVisitNote',
  'customer-compliance': 'customerOnboarding',
  'issue-sla': 'customerIssue',
  'sales-opportunity-pipeline': 'salesOpportunity',
  'product-feedback': 'productFeedback',
  'discount-request': 'discountRequest',
  'key-account': 'customerOnboarding',
  alert: 'customerAlert',
  tasks: 'task',
  approvals: 'approvalRequest',
  audit: 'auditLog'
};

const REPORT_TYPES = Object.freeze({
  LEAVE: 'leave',
  ATTENDANCE: 'attendance',
  TRAINING: 'training',
  PERFORMANCE: 'performance',
  HR_ACTIONS: 'hr-actions',
  SEPARATIONS: 'separations',
  APPROVALS: 'approvals',
  CUSTOMER_ONBOARDING: 'customer-onboarding',
  SALES: 'sales'
});

const ROLE_ALLOWED_REPORT_TYPES = Object.freeze({
  [ROLES.GENERAL_MANAGER]: Object.values(REPORT_TYPES),
  [ROLES.HR_MANAGER]: [
    REPORT_TYPES.LEAVE,
    REPORT_TYPES.ATTENDANCE,
    REPORT_TYPES.TRAINING,
    REPORT_TYPES.PERFORMANCE,
    REPORT_TYPES.HR_ACTIONS,
    REPORT_TYPES.SEPARATIONS,
    REPORT_TYPES.APPROVALS
  ],
  [ROLES.DEPARTMENT_HEAD]: [
    REPORT_TYPES.LEAVE,
    REPORT_TYPES.ATTENDANCE,
    REPORT_TYPES.TRAINING,
    REPORT_TYPES.PERFORMANCE,
    REPORT_TYPES.HR_ACTIONS,
    REPORT_TYPES.SEPARATIONS,
    REPORT_TYPES.APPROVALS
  ],
  [ROLES.FINANCE_ACCOUNTS_MANAGER]: [REPORT_TYPES.APPROVALS],
  [ROLES.SALES_COMPLIANCE_OFFICER]: [REPORT_TYPES.CUSTOMER_ONBOARDING, REPORT_TYPES.SALES],
  [ROLES.OPERATIONS_PROCUREMENT_OFFICER]: [REPORT_TYPES.APPROVALS, REPORT_TYPES.SALES],
  [ROLES.EMPLOYEE]: []
});

const TYPE_ALIASES = Object.freeze({
  trainings: REPORT_TYPES.TRAINING,
  'sales-reports': REPORT_TYPES.SALES,
  'sales-activity': REPORT_TYPES.SALES
});

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toISOString();
}

function normalizeReportType(type) {
  return TYPE_ALIASES[type] || type;
}

function buildReportResponse(reportType, columns, rows, filters) {
  return {
    reportType,
    columns,
    rows,
    csvReady: true,
    generatedAt: new Date().toISOString(),
    filters
  };
}

function parseDateInput(value, boundary) {
  if (!value) return null;
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  const normalizedValue = dateOnlyPattern.test(value)
    ? `${value}${boundary === 'end' ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`
    : value;
  const parsed = new Date(normalizedValue);
  if (Number.isNaN(parsed.getTime())) throw new AppError(`Invalid date value: ${value}`, 422);
  return parsed;
}

function parseDateRange(query) {
  const from = parseDateInput(query.dateFrom, 'start');
  const to = parseDateInput(query.dateTo, 'end');
  if (from && to && from > to) {
    throw new AppError('dateFrom cannot be after dateTo', 422);
  }
  return { from, to };
}

function applyDateRange(where, field, range) {
  if (!range.from && !range.to) return;
  where[field] = {};
  if (range.from) where[field].gte = range.from;
  if (range.to) where[field].lte = range.to;
}

function applyDateOverlap(where, startField, endField, range) {
  if (!range.from && !range.to) return;
  const clauses = [];
  if (range.from) clauses.push({ [endField]: { gte: range.from } });
  if (range.to) clauses.push({ [startField]: { lte: range.to } });
  if (!clauses.length) return;
  where.AND = [...(where.AND || []), ...clauses];
}

function resolveEmployeeId(query) {
  return query.employeeId || query.userId || undefined;
}

function resolveDepartmentFilter(auth, requestedDepartmentId) {
  if (!auth) return requestedDepartmentId || undefined;
  const roleName = normalizeRoleName(auth.roleName);
  if (roleName !== ROLES.DEPARTMENT_HEAD) return requestedDepartmentId || undefined;

  const departmentIds = (auth.departmentIds || []).filter(Boolean);
  if (requestedDepartmentId) {
    if (!departmentIds.includes(requestedDepartmentId)) {
      throw new AppError('You do not have access to this department', 403);
    }
    return requestedDepartmentId;
  }

  if (!departmentIds.length) return { in: ['__NO_DEPARTMENT_ACCESS__'] };
  return { in: departmentIds };
}

function assertRoleAccess(auth, reportType) {
  const roleName = normalizeRoleName(auth?.roleName);
  const allowed = ROLE_ALLOWED_REPORT_TYPES[roleName] || [];
  if (!allowed.includes(reportType)) {
    throw new AppError('You are not allowed to run this report type', 403);
  }
}

function getTypeFilterValue(query) {
  return query.typeFilter || query.typeValue || query.filterType || undefined;
}

function inferAchievementStats(goals) {
  if (!goals) return { targetCount: 0, achievementCount: 0 };
  if (!Array.isArray(goals)) return { targetCount: 0, achievementCount: 0 };

  const targetCount = goals.length;
  const achievementCount = goals.filter((goal) => {
    if (!goal || typeof goal !== 'object') return false;
    if (goal.achieved === true || goal.completed === true) return true;
    const status = String(goal.status || '').toUpperCase();
    return ['DONE', 'COMPLETED', 'ACHIEVED'].includes(status);
  }).length;

  return { targetCount, achievementCount };
}

function withDateRange(where, query) {
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
    if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
  }
}

function withUserScope(where, model, query) {
  if (!query.userId) return;
  if (model === 'user') where.id = query.userId;
  else if (['leaveRequest', 'attendanceRecord', 'payslip'].includes(model)) where.employeeId = query.userId;
  else if (['financeRequest', 'requisition'].includes(model)) where.requestedById = query.userId;
  else if (model === 'approvalRequest') where.requestedById = query.userId;
  else if (model === 'auditLog') where.actorId = query.userId;
  else if (model === 'document') where.uploadedById = query.userId;
}

function applyFinanceSubtypeFilter(where, type) {
  if (!type) return;
  where.type = type;
}

async function runLeaveReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const typeFilter = getTypeFilterValue(query);

  const where = { deletedAt: null };
  if (query.status) where.status = query.status;
  if (employeeId) where.employeeId = employeeId;
  if (typeFilter) where.leaveType = typeFilter;
  applyDateOverlap(where, 'startDate', 'endDate', range);

  where.employee = where.employee || {};
  if (departmentFilter) where.employee.departmentId = departmentFilter;

  const records = await prisma.leaveRequest.findMany({
    where,
    include: {
      employee: {
        select: {
          fullName: true,
          department: { select: { name: true } },
          role: { select: { name: true, displayName: true } }
        }
      }
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    take: 5000
  });

  const rows = records.map((record) => ({
    department: record.employee?.department?.name || 'Unassigned',
    role: record.employee?.role?.displayName || record.employee?.role?.name || 'Unknown',
    employee: record.employee?.fullName || 'Unknown',
    leaveType: record.leaveType,
    startDate: formatDate(record.startDate),
    endDate: formatDate(record.endDate),
    duration: toNumber(record.days) || 0,
    status: record.status,
    requestedAt: formatDate(record.createdAt)
  }));

  return buildReportResponse(REPORT_TYPES.LEAVE, ['department', 'role', 'employee', 'leaveType', 'startDate', 'endDate', 'duration', 'status', 'requestedAt'], rows, query);
}

async function runAttendanceReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);

  const where = { deletedAt: null };
  if (query.status) where.status = query.status;
  if (employeeId) where.employeeId = employeeId;
  applyDateRange(where, 'date', range);

  where.employee = where.employee || {};
  if (departmentFilter) where.employee.departmentId = departmentFilter;

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          department: { select: { name: true } },
          role: { select: { name: true, displayName: true } }
        }
      }
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 10000
  });

  const summaryByEmployee = new Map();
  records.forEach((record) => {
    const employeeKey = record.employee?.id || `unknown-${record.employeeId}`;
    const current = summaryByEmployee.get(employeeKey) || {
      department: record.employee?.department?.name || 'Unassigned',
      role: record.employee?.role?.displayName || record.employee?.role?.name || 'Unknown',
      employee: record.employee?.fullName || 'Unknown',
      presentCount: 0,
      absentCount: 0,
      tardyCount: 0,
      halfDayCount: 0,
      remoteCount: 0,
      onLeaveCount: 0,
      totalRecorded: 0
    };

    const status = String(record.status || '').toUpperCase();
    if (status === 'PRESENT') current.presentCount += 1;
    if (status === 'ABSENT') current.absentCount += 1;
    if (status === 'LATE') current.tardyCount += 1;
    if (status === 'HALF_DAY') current.halfDayCount += 1;
    if (status === 'REMOTE') current.remoteCount += 1;
    if (status === 'ON_LEAVE') current.onLeaveCount += 1;
    current.totalRecorded += 1;

    summaryByEmployee.set(employeeKey, current);
  });

  const rows = Array.from(summaryByEmployee.values());
  return buildReportResponse(
    REPORT_TYPES.ATTENDANCE,
    ['department', 'role', 'employee', 'presentCount', 'absentCount', 'tardyCount', 'halfDayCount', 'remoteCount', 'onLeaveCount', 'totalRecorded'],
    rows,
    query
  );
}

async function runTrainingReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const typeFilter = getTypeFilterValue(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (employeeId) where.employeeId = employeeId;

  where.training = { deletedAt: null };
  if (range.from || range.to) {
    where.training.trainingDate = {};
    if (range.from) where.training.trainingDate.gte = range.from;
    if (range.to) where.training.trainingDate.lte = range.to;
  }
  if (typeFilter) where.training.trainingType = typeFilter;
  if (departmentFilter) where.employee = { departmentId: departmentFilter };

  const records = await prisma.trainingParticipant.findMany({
    where,
    include: {
      training: { select: { title: true, trainingType: true, trainingDate: true, trainerName: true } },
      employee: {
        select: {
          fullName: true,
          department: { select: { name: true } },
          role: { select: { name: true, displayName: true } }
        }
      }
    },
    orderBy: [{ training: { trainingDate: 'desc' } }, { createdAt: 'desc' }],
    take: 10000
  });

  const rows = records.map((record) => ({
    trainingTitle: record.training?.title || 'Training',
    trainingType: record.training?.trainingType || 'OTHER',
    trainingDate: formatDate(record.training?.trainingDate),
    trainer: record.training?.trainerName || 'Unspecified',
    department: record.employee?.department?.name || 'Unassigned',
    role: record.employee?.role?.displayName || record.employee?.role?.name || 'Unknown',
    employee: record.employee?.fullName || 'Unknown',
    participationStatus: record.status,
    attendedAt: formatDateTime(record.attendedAt),
    completedAt: formatDateTime(record.completedAt),
    outcome: record.status === 'COMPLETED' ? 'Completed' : record.status === 'ATTENDED' ? 'Attended' : 'Pending'
  }));

  return buildReportResponse(
    REPORT_TYPES.TRAINING,
    ['trainingTitle', 'trainingType', 'trainingDate', 'trainer', 'department', 'role', 'employee', 'participationStatus', 'attendedAt', 'completedAt', 'outcome'],
    rows,
    query
  );
}

async function runPerformanceReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const typeFilter = getTypeFilterValue(query);

  const where = { deletedAt: null };
  if (query.status) where.status = query.status;
  if (employeeId) where.employeeId = employeeId;
  if (typeFilter) where.cycleName = { contains: typeFilter, mode: 'insensitive' };
  applyDateOverlap(where, 'periodStart', 'periodEnd', range);

  where.employee = where.employee || {};
  if (departmentFilter) where.employee.departmentId = departmentFilter;

  const records = await prisma.performanceReview.findMany({
    where,
    include: {
      employee: {
        select: {
          fullName: true,
          department: { select: { name: true } },
          role: { select: { name: true, displayName: true } }
        }
      },
      reviewer: { select: { fullName: true } }
    },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    take: 5000
  });

  const rows = records.map((record) => {
    const { targetCount, achievementCount } = inferAchievementStats(record.goals);
    return {
      department: record.employee?.department?.name || 'Unassigned',
      role: record.employee?.role?.displayName || record.employee?.role?.name || 'Unknown',
      employee: record.employee?.fullName || 'Unknown',
      reviewer: record.reviewer?.fullName || 'Unassigned',
      cycle: record.cycleName,
      periodStart: formatDate(record.periodStart),
      periodEnd: formatDate(record.periodEnd),
      status: record.status,
      score: toNumber(record.score),
      rating: record.rating || '',
      targetCount,
      achievementCount
    };
  });

  return buildReportResponse(
    REPORT_TYPES.PERFORMANCE,
    ['department', 'role', 'employee', 'reviewer', 'cycle', 'periodStart', 'periodEnd', 'status', 'score', 'rating', 'targetCount', 'achievementCount'],
    rows,
    query
  );
}

async function runHrActionsReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const typeFilter = getTypeFilterValue(query);

  const where = { deletedAt: null };
  if (query.status) where.status = query.status;
  if (employeeId) where.employeeId = employeeId;
  if (typeFilter) where.actionType = typeFilter;
  applyDateRange(where, 'effectiveDate', range);

  where.employee = where.employee || {};
  if (departmentFilter) where.employee.departmentId = departmentFilter;

  const records = await prisma.hRAction.findMany({
    where,
    include: {
      employee: {
        select: {
          fullName: true,
          department: { select: { name: true } },
          role: { select: { name: true, displayName: true } }
        }
      }
    },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    take: 5000
  });

  const creatorIds = Array.from(new Set(records.map((item) => item.createdById).filter(Boolean)));
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true } })
    : [];
  const creatorMap = new Map(creators.map((user) => [user.id, user.fullName]));

  const rows = records.map((record) => ({
    department: record.employee?.department?.name || 'Unassigned',
    role: record.employee?.role?.displayName || record.employee?.role?.name || 'Unknown',
    employee: record.employee?.fullName || 'Unknown',
    actionType: record.actionType,
    status: record.status,
    reason: record.reason || '',
    effectiveDate: formatDate(record.effectiveDate),
    initiatedBy: creatorMap.get(record.createdById) || 'Unknown',
    recordedAt: formatDate(record.createdAt)
  }));

  return buildReportResponse(
    REPORT_TYPES.HR_ACTIONS,
    ['department', 'role', 'employee', 'actionType', 'status', 'reason', 'effectiveDate', 'initiatedBy', 'recordedAt'],
    rows,
    query
  );
}

async function runSeparationsReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const typeFilter = getTypeFilterValue(query);

  const where = { deletedAt: null };
  if (query.status) where.status = query.status;
  if (employeeId) where.employeeId = employeeId;
  if (typeFilter) where.type = typeFilter;
  applyDateRange(where, 'exitDate', range);

  where.employee = where.employee || {};
  if (departmentFilter) where.employee.departmentId = departmentFilter;

  const records = await prisma.separation.findMany({
    where,
    include: {
      employee: {
        select: {
          fullName: true,
          department: { select: { name: true } },
          role: { select: { name: true, displayName: true } }
        }
      }
    },
    orderBy: [{ exitDate: 'desc' }, { createdAt: 'desc' }],
    take: 5000
  });

  const rows = records.map((record) => ({
    department: record.employee?.department?.name || 'Unassigned',
    role: record.employee?.role?.displayName || record.employee?.role?.name || 'Unknown',
    employee: record.employee?.fullName || 'Unknown',
    separationType: record.type,
    reason: record.reason || '',
    exitDate: formatDate(record.exitDate),
    status: record.status,
    finalPaymentStatus: record.finalPaymentStatus || '',
    recordedAt: formatDate(record.createdAt)
  }));

  return buildReportResponse(
    REPORT_TYPES.SEPARATIONS,
    ['department', 'role', 'employee', 'separationType', 'reason', 'exitDate', 'status', 'finalPaymentStatus', 'recordedAt'],
    rows,
    query
  );
}

async function runApprovalsReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const typeFilter = getTypeFilterValue(query);

  const where = { deletedAt: null };
  if (query.status) where.status = query.status;
  if (employeeId) where.requestedById = employeeId;
  if (typeFilter) where.requestType = typeFilter;
  applyDateRange(where, 'createdAt', range);

  where.requestedBy = where.requestedBy || {};
  if (departmentFilter) where.requestedBy.departmentId = departmentFilter;

  const records = await prisma.approvalRequest.findMany({
    where,
    include: {
      requestedBy: {
        select: {
          fullName: true,
          department: { select: { name: true } },
          role: { select: { name: true, displayName: true } }
        }
      },
      currentApprover: { select: { fullName: true } }
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 5000
  });

  const rows = records.map((record) => ({
    requestType: record.requestType,
    entityType: record.entityType,
    department: record.requestedBy?.department?.name || 'Unassigned',
    requester: record.requestedBy?.fullName || 'Unknown',
    requesterRole: record.requestedBy?.role?.displayName || record.requestedBy?.role?.name || 'Unknown',
    currentApprover: record.currentApprover?.fullName || 'Unassigned',
    status: record.status,
    priority: record.priority,
    requestedAt: formatDateTime(record.createdAt),
    resolvedAt: formatDateTime(record.approvedAt || record.rejectedAt)
  }));

  return buildReportResponse(
    REPORT_TYPES.APPROVALS,
    ['requestType', 'entityType', 'department', 'requester', 'requesterRole', 'currentApprover', 'status', 'priority', 'requestedAt', 'resolvedAt'],
    rows,
    query
  );
}

async function runCustomerOnboardingReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const typeFilter = getTypeFilterValue(query);

  const where = { deletedAt: null };
  if (query.status) where.status = query.status;
  if (employeeId) where.assignedOfficerId = employeeId;
  if (typeFilter) {
    where.OR = [
      { businessType: typeFilter },
      { customerCategory: typeFilter },
      { complianceRiskLevel: typeFilter }
    ];
  }
  applyDateRange(where, 'createdAt', range);

  if (departmentFilter) {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { assignedOfficer: { departmentId: departmentFilter } },
          { accountOwner: { departmentId: departmentFilter } }
        ]
      }
    ];
  }

  const records = await prisma.customerOnboarding.findMany({
    where,
    include: {
      assignedOfficer: { select: { fullName: true } },
      accountOwner: { select: { fullName: true } },
      territory: { select: { name: true } }
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 5000
  });

  const rows = records.map((record) => ({
    customer: record.businessName,
    businessType: record.businessType,
    status: record.status,
    riskLevel: record.complianceRiskLevel || '',
    assignedOfficer: record.assignedOfficer?.fullName || 'Unassigned',
    accountOwner: record.accountOwner?.fullName || 'Unassigned',
    territory: record.territory?.name || 'Unassigned',
    county: record.county || '',
    createdAt: formatDate(record.createdAt),
    nextFollowUpDate: formatDate(record.nextFollowUpDate)
  }));

  return buildReportResponse(
    REPORT_TYPES.CUSTOMER_ONBOARDING,
    ['customer', 'businessType', 'status', 'riskLevel', 'assignedOfficer', 'accountOwner', 'territory', 'county', 'createdAt', 'nextFollowUpDate'],
    rows,
    query
  );
}

async function runSalesActivityReport(query, auth) {
  const range = parseDateRange(query);
  const employeeId = resolveEmployeeId(query);
  const departmentFilter = resolveDepartmentFilter(auth, query.departmentId);
  const activityType = String(query.activityType || getTypeFilterValue(query) || '').toUpperCase();

  const includeVisits = !activityType || activityType === 'VISITS' || activityType === 'ALL';
  const includeOpportunities = !activityType || activityType === 'OPPORTUNITIES' || activityType === 'ALL';

  const visitWhere = { deletedAt: null };
  applyDateRange(visitWhere, 'visitDate', range);
  if (employeeId) visitWhere.createdById = employeeId;
  if (departmentFilter) visitWhere.createdBy = { departmentId: departmentFilter };

  const opportunityWhere = { deletedAt: null };
  applyDateRange(opportunityWhere, 'createdAt', range);
  if (employeeId) opportunityWhere.ownerId = employeeId;
  if (query.status) opportunityWhere.status = query.status;
  if (departmentFilter) opportunityWhere.owner = { departmentId: departmentFilter };

  const [visits, opportunities] = await Promise.all([
    includeVisits
      ? prisma.clientVisitNote.findMany({
          where: visitWhere,
          include: {
            createdBy: {
              select: {
                id: true,
                fullName: true,
                department: { select: { name: true } },
                role: { select: { name: true, displayName: true } }
              }
            }
          },
          take: 10000,
          orderBy: [{ visitDate: 'desc' }]
        })
      : Promise.resolve([]),
    includeOpportunities
      ? prisma.salesOpportunity.findMany({
          where: opportunityWhere,
          include: {
            owner: {
              select: {
                id: true,
                fullName: true,
                department: { select: { name: true } },
                role: { select: { name: true, displayName: true } }
              }
            }
          },
          take: 10000,
          orderBy: [{ createdAt: 'desc' }]
        })
      : Promise.resolve([])
  ]);

  const summary = new Map();

  visits.forEach((visit) => {
    const ownerId = visit.createdBy?.id || '__unknown__';
    const current = summary.get(ownerId) || {
      officer: visit.createdBy?.fullName || 'Unknown',
      department: visit.createdBy?.department?.name || 'Unassigned',
      role: visit.createdBy?.role?.displayName || visit.createdBy?.role?.name || 'Unknown',
      visitCount: 0,
      customerCoverage: new Set(),
      opportunitiesCreated: 0,
      opportunitiesOpen: 0,
      opportunitiesWon: 0,
      opportunitiesLost: 0
    };

    current.visitCount += 1;
    if (visit.customerId) current.customerCoverage.add(visit.customerId);
    summary.set(ownerId, current);
  });

  opportunities.forEach((opportunity) => {
    const ownerId = opportunity.owner?.id || '__unknown__';
    const current = summary.get(ownerId) || {
      officer: opportunity.owner?.fullName || 'Unknown',
      department: opportunity.owner?.department?.name || 'Unassigned',
      role: opportunity.owner?.role?.displayName || opportunity.owner?.role?.name || 'Unknown',
      visitCount: 0,
      customerCoverage: new Set(),
      opportunitiesCreated: 0,
      opportunitiesOpen: 0,
      opportunitiesWon: 0,
      opportunitiesLost: 0
    };

    current.opportunitiesCreated += 1;
    if (opportunity.status === 'OPEN') current.opportunitiesOpen += 1;
    if (opportunity.status === 'WON') current.opportunitiesWon += 1;
    if (opportunity.status === 'LOST') current.opportunitiesLost += 1;
    summary.set(ownerId, current);
  });

  const rows = Array.from(summary.values()).map((row) => ({
    officer: row.officer,
    department: row.department,
    role: row.role,
    visits: row.visitCount,
    coverage: row.customerCoverage.size,
    opportunitiesCreated: row.opportunitiesCreated,
    opportunitiesOpen: row.opportunitiesOpen,
    opportunitiesWon: row.opportunitiesWon,
    opportunitiesLost: row.opportunitiesLost
  }));

  return buildReportResponse(
    REPORT_TYPES.SALES,
    ['officer', 'department', 'role', 'visits', 'coverage', 'opportunitiesCreated', 'opportunitiesOpen', 'opportunitiesWon', 'opportunitiesLost'],
    rows,
    query
  );
}

async function runNewReportType(type, query, auth) {
  const reportType = normalizeReportType(type);
  if (!Object.values(REPORT_TYPES).includes(reportType)) {
    throw new AppError('Unsupported report type', 400);
  }

  assertRoleAccess(auth, reportType);

  if (reportType === REPORT_TYPES.LEAVE) return runLeaveReport(query, auth);
  if (reportType === REPORT_TYPES.ATTENDANCE) return runAttendanceReport(query, auth);
  if (reportType === REPORT_TYPES.TRAINING) return runTrainingReport(query, auth);
  if (reportType === REPORT_TYPES.PERFORMANCE) return runPerformanceReport(query, auth);
  if (reportType === REPORT_TYPES.HR_ACTIONS) return runHrActionsReport(query, auth);
  if (reportType === REPORT_TYPES.SEPARATIONS) return runSeparationsReport(query, auth);
  if (reportType === REPORT_TYPES.APPROVALS) return runApprovalsReport(query, auth);
  if (reportType === REPORT_TYPES.CUSTOMER_ONBOARDING) return runCustomerOnboardingReport(query, auth);
  if (reportType === REPORT_TYPES.SALES) return runSalesActivityReport(query, auth);

  throw new AppError('Unsupported report type', 400);
}

async function runLegacyReport(type, query = {}) {
  const model = LEGACY_REPORT_MAP[type];
  if (!model) throw new AppError('Unsupported report type', 400);

  if (type === 'payment-proofs') {
    const where = { deletedAt: null, paymentProofDocumentId: { not: null } };
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.status = query.status;
    withUserScope(where, 'financeRequest', query);
    withDateRange(where, query);
    const rows = await prisma.financeRequest.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        department: { select: { id: true, name: true, slug: true } }
      },
      take: 1000,
      orderBy: [{ paidAt: 'desc' }, { updatedAt: 'desc' }]
    });
    return {
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      csvReady: true,
      generatedAt: new Date().toISOString(),
      filters: query
    };
  }

  if (type === 'budget-usage') {
    const where = { deletedAt: null };
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.year) where.year = Number(query.year);
    const rows = await prisma.budget.findMany({
      where,
      include: { department: { select: { id: true, name: true, slug: true } } },
      take: 1000,
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }]
    });
    return {
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      csvReady: true,
      generatedAt: new Date().toISOString(),
      filters: query
    };
  }

  const where = {};
  if (query.status) where.status = query.status;
  if (query.departmentId) where.departmentId = query.departmentId;

  withUserScope(where, model, query);

  if (type === 'expense') applyFinanceSubtypeFilter(where, 'EXPENSE_REIMBURSEMENT');
  else if (type === 'payment') applyFinanceSubtypeFilter(where, 'PAYMENT_REQUEST');
  else if (type === 'petty-cash') applyFinanceSubtypeFilter(where, 'PETTY_CASH');
  else if (type === 'travel-requests') applyFinanceSubtypeFilter(where, 'TRAVEL_REQUEST');
  else if (type === 'procurement-payment') applyFinanceSubtypeFilter(where, 'PROCUREMENT_PAYMENT');
  else if (query.type && ['financeRequest', 'customerOnboarding', 'complianceItem'].includes(model)) where.type = query.type;

  if (type === 'key-account') where.isKeyAccount = true;
  if (type === 'customer-compliance' && query.riskLevel) where.complianceRiskLevel = query.riskLevel;
  if (type === 'issue-sla' && query.slaBreach === 'true') where.slaDueAt = { lt: new Date() };
  if (type === 'territory-performance' && query.assignedOfficerId) where.assignedOfficerId = query.assignedOfficerId;

  if (type === 'accounts') where.ownerType = 'FINANCE';

  if (type === 'tax-kra-documents') {
    where.ownerType = 'FINANCE';
    where.category = { in: ['KRA_DOCUMENT', 'TAX_DOCUMENT'] };
  }

  if (type === 'procurement-documents') where.ownerType = 'OPERATIONS';

  if (type === 'document-expiry') {
    where.expiryDate = {};
    if (query.dateFrom) where.expiryDate.gte = new Date(query.dateFrom);
    if (query.dateTo) where.expiryDate.lte = new Date(query.dateTo);
    if (!query.dateFrom && !query.dateTo) where.expiryDate.lte = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  if (type !== 'document-expiry') withDateRange(where, query);

  const rows = await prisma[model].findMany({
    where,
    take: 1000,
    orderBy: { createdAt: 'desc' }
  });

  return {
    rows,
    columns: rows[0] ? Object.keys(rows[0]) : [],
    csvReady: true,
    generatedAt: new Date().toISOString(),
    filters: query
  };
}

const reportService = {
  async run(type, query = {}) {
    return runLegacyReport(type, query);
  },

  async runQuery(type, query = {}, auth) {
    return runNewReportType(type, query, auth);
  },

  async runEnterprise(type, query = {}, auth) {
    if (type === 'financeReport') return runLegacyReport('finance', query);
    if (type === 'complianceReport') return runLegacyReport('compliance', query);
    if (type === 'procurementReport') return runLegacyReport('requisitions', query);
    if (type === 'HRreport') return runLegacyReport('staff', query);
    if (type === 'performanceReport') return runNewReportType('performance', query, auth);
    if (type === 'approvalPressureReport') return runNewReportType('approvals', query, auth);
    return null;
  }
};

module.exports = reportService;
