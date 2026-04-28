const prisma = require('../prisma/client');

const FINANCE_REPORT_TYPES = Object.freeze([
  'finance-requests',
  'expenses',
  'payments',
  'budgets',
  'budget-variance',
  'payroll',
  'petty-cash',
  'tax-kra',
  'payment-proofs',
  'accounts-archive',
  'audit-trail'
]);

const FINANCE_DOC_CATEGORIES = ['FINANCE_DOCUMENT', 'KRA_DOCUMENT', 'TAX_DOCUMENT'];

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? 0 : numeric;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function normalizePagination(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 25), 1), 100);
  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
}

function parseDateRange(query = {}) {
  const parse = (value, end = false) => {
    if (!value) return null;
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? `${value}${end ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`
      : String(value);
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  return {
    from: parse(query.dateFrom, false),
    to: parse(query.dateTo, true)
  };
}

function financeReference(id) {
  const suffix = String(id || '').slice(-8).toUpperCase();
  return `FR-${suffix}`;
}

function budgetReference(id) {
  const suffix = String(id || '').slice(-8).toUpperCase();
  return `BG-${suffix}`;
}

function payrollReference(id) {
  const suffix = String(id || '').slice(-8).toUpperCase();
  return `PY-${suffix}`;
}

function docReference(id) {
  const suffix = String(id || '').slice(-8).toUpperCase();
  return `DOC-${suffix}`;
}

function addDateFilter(where, field, range) {
  if (!range.from && !range.to) return;
  where[field] = {};
  if (range.from) where[field].gte = range.from;
  if (range.to) where[field].lte = range.to;
}

function matchText(value, needle) {
  if (!needle) return true;
  if (!value) return false;
  return String(value).toLowerCase().includes(String(needle).toLowerCase());
}

function getAgingDays(date) {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  return Math.max(Math.floor(diff / (1000 * 60 * 60 * 24)), 0);
}

function sortRows(rows, sortBy, sortOrder) {
  if (!sortBy) return rows;
  const direction = String(sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a?.[sortBy];
    const right = b?.[sortBy];

    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;

    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;

    const leftTime = Date.parse(String(left));
    const rightTime = Date.parse(String(right));
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) return (leftTime - rightTime) * direction;

    return String(left).localeCompare(String(right)) * direction;
  });
}

async function buildFinanceApprovalMap(financeRequestIds = []) {
  if (!financeRequestIds.length) return new Map();

  const approvals = await prisma.approvalRequest.findMany({
    where: {
      deletedAt: null,
      entityType: 'FINANCE_REQUEST',
      entityId: { in: financeRequestIds }
    },
    include: {
      currentApprover: { select: { id: true, fullName: true, email: true } },
      requestedBy: { select: { id: true, fullName: true, email: true } },
      steps: true
    }
  });

  const approverIds = Array.from(new Set(
    approvals
      .flatMap((approval) => approval.steps || [])
      .map((step) => step.approverUserId)
      .filter(Boolean)
  ));

  const approvers = approverIds.length
    ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, fullName: true, email: true } })
    : [];

  const approverMap = new Map(approvers.map((user) => [user.id, user]));

  const map = new Map();
  approvals.forEach((approval) => {
    const approvedSteps = (approval.steps || [])
      .filter((step) => step.status === 'APPROVED' && step.actedAt)
      .sort((a, b) => new Date(b.actedAt).getTime() - new Date(a.actedAt).getTime());

    const currentStage = (approval.steps || []).find((step) => step.status === 'PENDING')?.stepOrder
      || Math.max(...(approval.steps || []).map((step) => step.stepOrder), 0)
      || null;

    const approvedStep = approvedSteps[0] || null;
    const approvedBy = approvedStep?.approverUserId ? approverMap.get(approvedStep.approverUserId) : null;

    map.set(approval.entityId, {
      id: approval.id,
      status: approval.status,
      currentStage,
      currentApprover: approval.currentApprover || null,
      approvedBy: approvedBy || null,
      approvedAt: approval.approvedAt || approvedStep?.actedAt || null,
      requestedAt: approval.createdAt,
      steps: approval.steps || []
    });
  });

  return map;
}

function createReportPayload({ reportType, generatedBy, filters, columns, rows, totals, warnings, pagination }) {
  return {
    reportType,
    generatedAt: new Date().toISOString(),
    generatedBy,
    filters,
    columns,
    rows,
    totals,
    warnings,
    pagination
  };
}

async function buildFinanceRequestRows({ reportType, query, generatedBy }) {
  const pagination = normalizePagination(query);
  const range = parseDateRange(query);

  const where = { deletedAt: null };
  addDateFilter(where, 'createdAt', range);
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.status) where.status = query.status;
  if (query.requesterId) where.requestedById = query.requesterId;
  if (query.type) where.type = query.type;
  if (query.amountMin || query.amountMax) {
    where.amount = {};
    if (query.amountMin) where.amount.gte = toNumber(query.amountMin);
    if (query.amountMax) where.amount.lte = toNumber(query.amountMax);
  }

  const fetchWhere = {
    ...where,
    ...(query.referenceNumber
      ? { id: { contains: String(query.referenceNumber).replace(/^FR-/i, ''), mode: 'insensitive' } }
      : {})
  };

  const requests = await prisma.financeRequest.findMany({
    where: fetchWhere,
    include: {
      requestedBy: { select: { id: true, fullName: true, email: true } },
      department: { select: { id: true, name: true, slug: true, headId: true } }
    },
    orderBy: [{ createdAt: 'desc' }]
  });

  const approvalMap = await buildFinanceApprovalMap(requests.map((request) => request.id));

  const filtered = requests.filter((request) => {
    if (query.vendorPayee && !matchText(request.title, query.vendorPayee) && !matchText(request.description, query.vendorPayee)) return false;
    if (query.approverId) {
      const approval = approvalMap.get(request.id);
      const currentApproverId = approval?.currentApprover?.id;
      const approvedById = approval?.approvedBy?.id;
      if (currentApproverId !== query.approverId && approvedById !== query.approverId) return false;
    }
    if (query.approvalState) {
      const approval = approvalMap.get(request.id);
      if (String(approval?.status || '').toUpperCase() !== String(query.approvalState).toUpperCase()) return false;
    }
    return true;
  });

  const rows = filtered.map((request) => {
    const approval = approvalMap.get(request.id);
    const amount = toNumber(request.amount);
    const agingDays = getAgingDays(request.createdAt);
    const warnings = [];

    if (request.status === 'APPROVED' && !request.paidAt) warnings.push('APPROVED_UNPAID');
    if (request.status === 'PAID' && !request.paymentProofDocumentId) warnings.push('PAID_WITHOUT_PROOF');
    if (['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(request.status) && (agingDays || 0) > 14) warnings.push('OVERDUE_REQUEST_AGING');

    return {
      id: request.id,
      requestReference: financeReference(request.id),
      requestDate: formatDate(request.createdAt),
      requester: request.requestedBy?.fullName || null,
      requesterId: request.requestedBy?.id || null,
      department: request.department?.name || 'Unassigned',
      departmentId: request.department?.id || null,
      financeType: request.type,
      category: request.type,
      description: request.description || request.title,
      amountRequested: amount,
      amountApproved: ['APPROVED', 'PAID'].includes(request.status) ? amount : 0,
      status: request.status,
      approvalStage: approval?.currentStage || null,
      approvalState: approval?.status || null,
      currentApprover: approval?.currentApprover?.fullName || null,
      currentApproverId: approval?.currentApprover?.id || null,
      approvedBy: approval?.approvedBy?.fullName || null,
      approvedById: approval?.approvedBy?.id || null,
      approvedDate: formatDate(approval?.approvedAt),
      paymentStatus: request.status === 'PAID' ? 'PAID' : request.status === 'APPROVED' ? 'UNPAID' : 'PENDING',
      paymentDate: formatDate(request.paidAt),
      proofStatus: request.paymentProofDocumentId ? 'UPLOADED' : 'MISSING',
      agingDays,
      warningFlags: warnings,
      createdAt: formatDateTime(request.createdAt),
      updatedAt: formatDateTime(request.updatedAt)
    };
  });

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const approvalTimes = filtered
    .map((request) => {
      const approval = approvalMap.get(request.id);
      if (!approval?.approvedAt) return null;
      const diffHours = (new Date(approval.approvedAt).getTime() - new Date(request.createdAt).getTime()) / (1000 * 60 * 60);
      return diffHours > 0 ? diffHours : null;
    })
    .filter((value) => value !== null);

  const totals = {
    totalRequested: rows.reduce((sum, row) => sum + toNumber(row.amountRequested), 0),
    totalApproved: rows.reduce((sum, row) => sum + toNumber(row.amountApproved), 0),
    pendingApproval: rows.filter((row) => ['SUBMITTED', 'UNDER_REVIEW'].includes(String(row.status))).length,
    rejected: rows.filter((row) => row.status === 'REJECTED').length,
    paid: rows.filter((row) => row.status === 'PAID').length,
    unpaid: rows.filter((row) => row.paymentStatus === 'UNPAID').length,
    averageApprovalTimeHours: approvalTimes.length
      ? Number((approvalTimes.reduce((sum, value) => sum + value, 0) / approvalTimes.length).toFixed(2))
      : 0
  };

  const warningGroups = {
    missingPaymentProof: rows.filter((row) => row.warningFlags.includes('PAID_WITHOUT_PROOF')).length,
    approvedButUnpaid: rows.filter((row) => row.warningFlags.includes('APPROVED_UNPAID')).length,
    overdueAging: rows.filter((row) => row.warningFlags.includes('OVERDUE_REQUEST_AGING')).length
  };

  const warnings = [
    { key: 'missing_payment_proof', label: 'Paid requests without payment proof', count: warningGroups.missingPaymentProof, severity: 'high' },
    { key: 'approved_unpaid', label: 'Approved requests not yet paid', count: warningGroups.approvedButUnpaid, severity: 'medium' },
    { key: 'overdue_aging', label: 'Overdue finance request aging', count: warningGroups.overdueAging, severity: 'medium' }
  ];

  const columns = [
    'requestReference', 'requestDate', 'requester', 'department', 'financeType', 'category', 'description',
    'amountRequested', 'amountApproved', 'status', 'approvalStage', 'currentApprover', 'approvedBy', 'approvedDate',
    'paymentStatus', 'paymentDate', 'proofStatus', 'agingDays', 'warningFlags'
  ];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: pagedRows,
    totals,
    warnings,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pagination.limit), 1)
    }
  });
}

function buildWarningCount(rows, flag) {
  return rows.filter((row) => Array.isArray(row.warningFlags) && row.warningFlags.includes(flag)).length;
}

async function buildExpenseRows({ reportType, query, generatedBy }) {
  const base = await buildFinanceRequestRows({ reportType: 'finance-requests', query: { ...query, type: 'EXPENSE_REIMBURSEMENT' }, generatedBy });
  const rows = base.rows.map((row) => {
    const gross = toNumber(row.amountRequested);
    const taxAmount = toNullableNumber(query.taxRate) ? (gross * toNumber(query.taxRate)) / 100 : 0;
    const net = gross - taxAmount;
    return {
      id: row.id,
      expenseReference: row.requestReference,
      expenseDate: row.requestDate,
      category: row.financeType,
      subcategory: null,
      department: row.department,
      costCenter: row.department,
      vendorPayee: row.requester,
      description: row.description,
      amount: gross,
      taxAmount,
      netAmount: net,
      paymentMethod: query.paymentMethod || null,
      status: row.status,
      createdBy: row.requester,
      approvedBy: row.approvedBy,
      paidDate: row.paymentDate,
      receiptProofStatus: row.proofStatus,
      warningFlags: row.warningFlags
    };
  });

  const totals = {
    grossExpense: rows.reduce((sum, row) => sum + toNumber(row.amount), 0),
    netExpense: rows.reduce((sum, row) => sum + toNumber(row.netAmount), 0),
    taxAmount: rows.reduce((sum, row) => sum + toNumber(row.taxAmount), 0),
    paidCount: rows.filter((row) => row.status === 'PAID').length,
    unpaidCount: rows.filter((row) => row.status !== 'PAID').length,
    byCategory: rows.reduce((acc, row) => {
      const key = String(row.category || 'OTHER');
      acc[key] = (acc[key] || 0) + toNumber(row.amount);
      return acc;
    }, {}),
    byDepartment: rows.reduce((acc, row) => {
      const key = String(row.department || 'Unassigned');
      acc[key] = (acc[key] || 0) + toNumber(row.amount);
      return acc;
    }, {})
  };

  const warnings = [
    { key: 'missing_payment_proof', label: 'Expense payments missing proof', count: buildWarningCount(rows, 'PAID_WITHOUT_PROOF'), severity: 'high' },
    { key: 'approved_unpaid', label: 'Approved expenses not paid', count: buildWarningCount(rows, 'APPROVED_UNPAID'), severity: 'medium' }
  ];

  const columns = [
    'expenseReference', 'expenseDate', 'category', 'subcategory', 'department', 'costCenter', 'vendorPayee', 'description', 'amount',
    'taxAmount', 'netAmount', 'paymentMethod', 'status', 'createdBy', 'approvedBy', 'paidDate', 'receiptProofStatus', 'warningFlags'
  ];

  return {
    ...base,
    reportType,
    columns,
    rows,
    totals,
    warnings
  };
}

async function buildPaymentRows({ reportType, query, generatedBy }) {
  const pagination = normalizePagination(query);
  const range = parseDateRange(query);
  const where = { deletedAt: null, type: 'PAYMENT_REQUEST' };
  addDateFilter(where, 'createdAt', range);
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.status) where.status = query.status;
  if (query.requesterId) where.requestedById = query.requesterId;

  const requests = await prisma.financeRequest.findMany({
    where,
    include: {
      requestedBy: { select: { id: true, fullName: true, email: true } },
      department: { select: { id: true, name: true, slug: true } }
    },
    orderBy: [{ createdAt: 'desc' }]
  });

  const rows = requests
    .filter((request) => (query.referenceNumber ? matchText(financeReference(request.id), query.referenceNumber) : true))
    .map((request) => {
      const warnings = [];
      if (request.status === 'PAID' && !request.paymentProofDocumentId) warnings.push('PAID_WITHOUT_PROOF');
      if (request.status !== 'PAID' && request.paymentProofDocumentId) warnings.push('PAYMENT_AMOUNT_MISMATCH');
      if (request.status === 'APPROVED' && !request.paidAt) warnings.push('APPROVED_UNPAID');

      return {
        id: request.id,
        paymentReference: financeReference(request.id),
        paymentDate: formatDate(request.paidAt || request.createdAt),
        payee: request.requestedBy?.fullName || null,
        payeeType: 'STAFF',
        relatedRequestReference: financeReference(request.id),
        amount: toNumber(request.amount),
        paymentMethod: query.paymentMethod || null,
        accountSource: request.department?.name || null,
        transactionReference: request.paymentProofDocumentId || null,
        status: request.status,
        proofUploaded: Boolean(request.paymentProofDocumentId),
        reconciled: request.status === 'PAID' && Boolean(request.paymentProofDocumentId),
        reconciledBy: null,
        reconciledDate: formatDate(request.paidAt),
        notes: request.financeNotes || null,
        warningFlags: warnings,
        createdAt: formatDateTime(request.createdAt)
      };
    });

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const totals = {
    totalPaid: rows.filter((row) => row.status === 'PAID').reduce((sum, row) => sum + toNumber(row.amount), 0),
    failedPayments: rows.filter((row) => row.status === 'REJECTED').length,
    pendingPayments: rows.filter((row) => ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(String(row.status))).length,
    unreconciledAmount: rows.filter((row) => !row.reconciled).reduce((sum, row) => sum + toNumber(row.amount), 0),
    missingProofCount: rows.filter((row) => !row.proofUploaded).length
  };

  const warnings = [
    { key: 'missing_payment_proof', label: 'Payments without proof', count: buildWarningCount(rows, 'PAID_WITHOUT_PROOF'), severity: 'high' },
    { key: 'approved_unpaid', label: 'Approved payment requests not paid', count: buildWarningCount(rows, 'APPROVED_UNPAID'), severity: 'medium' },
    { key: 'payment_mismatch', label: 'Payment status and proof mismatch', count: buildWarningCount(rows, 'PAYMENT_AMOUNT_MISMATCH'), severity: 'medium' }
  ];

  const columns = [
    'paymentReference', 'paymentDate', 'payee', 'payeeType', 'relatedRequestReference', 'amount', 'paymentMethod',
    'accountSource', 'transactionReference', 'status', 'proofUploaded', 'reconciled', 'reconciledBy', 'reconciledDate', 'notes', 'warningFlags'
  ];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: pagedRows,
    totals,
    warnings,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pagination.limit), 1)
    }
  });
}

async function buildBudgetRows({ reportType, query, generatedBy, varianceMode = false }) {
  const pagination = normalizePagination(query);
  const where = { deletedAt: null };
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.year) where.year = Number(query.year);
  if (query.month) where.month = Number(query.month);

  const budgets = await prisma.budget.findMany({
    where,
    include: {
      department: {
        select: {
          id: true,
          name: true,
          slug: true,
          headId: true
        }
      }
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }]
  });

  const departmentIds = Array.from(new Set(budgets.map((budget) => budget.departmentId).filter(Boolean)));

  const requests = await prisma.financeRequest.findMany({
    where: {
      deletedAt: null,
      departmentId: { in: departmentIds },
      status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID'] }
    },
    select: {
      id: true,
      departmentId: true,
      amount: true,
      status: true,
      createdAt: true,
      paidAt: true
    }
  });

  const ownerIds = Array.from(new Set(budgets.map((budget) => budget.department?.headId).filter(Boolean)));
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, fullName: true } })
    : [];
  const ownerMap = new Map(owners.map((user) => [user.id, user.fullName]));

  const rows = budgets.map((budget) => {
    const allocated = toNumber(budget.amount);
    const spend = toNumber(budget.spent);
    const committed = requests
      .filter((request) => request.departmentId === budget.departmentId && request.status !== 'PAID')
      .reduce((sum, request) => sum + toNumber(request.amount), 0);
    const remaining = allocated - spend;
    const utilization = allocated > 0 ? Number(((spend / allocated) * 100).toFixed(2)) : 0;
    const variance = spend - allocated;

    const warnings = [];
    if (spend > allocated) warnings.push('BUDGET_OVERRUN');
    if (utilization < 30) warnings.push('UNDER_UTILIZED_BUDGET');

    return {
      id: budget.id,
      budgetPeriod: budget.periodStartDate && budget.periodEndDate
        ? `${formatDate(budget.periodStartDate)} - ${formatDate(budget.periodEndDate)}`
        : budget.month ? `${budget.year}-${String(budget.month).padStart(2, '0')}` : String(budget.year),
      department: budget.department?.name || 'Unassigned',
      departmentId: budget.departmentId,
      costCenter: budget.costCenter || budget.department?.slug || null,
      budgetLine: budget.name || `${budget.department?.name || 'Department'} Budget`,
      allocatedAmount: allocated,
      committedAmount: committed,
      actualSpend: spend,
      remainingAmount: remaining,
      utilizationPercent: utilization,
      variance,
      varianceStatus: variance > 0 ? 'OVER_BUDGET' : variance < 0 ? 'UNDER_BUDGET' : 'ON_TARGET',
      owner: ownerMap.get(budget.department?.headId) || null,
      warningFlags: warnings,
      updatedAt: formatDateTime(budget.updatedAt)
    };
  });

  const filteredRows = rows.filter((row) => (query.costCenter ? matchText(row.costCenter, query.costCenter) : true));
  const sortedRows = sortRows(filteredRows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const totals = {
    totalAllocated: filteredRows.reduce((sum, row) => sum + toNumber(row.allocatedAmount), 0),
    totalSpent: filteredRows.reduce((sum, row) => sum + toNumber(row.actualSpend), 0),
    totalRemaining: filteredRows.reduce((sum, row) => sum + toNumber(row.remainingAmount), 0),
    overBudgetDepartments: new Set(filteredRows.filter((row) => row.variance > 0).map((row) => row.departmentId)).size,
    underUtilizedBudgets: filteredRows.filter((row) => row.utilizationPercent < 30).length
  };

  const warnings = [
    { key: 'budget_overrun', label: 'Budget overrun departments', count: buildWarningCount(filteredRows, 'BUDGET_OVERRUN'), severity: 'high' },
    { key: 'under_utilized_budget', label: 'Under-utilized budgets', count: buildWarningCount(filteredRows, 'UNDER_UTILIZED_BUDGET'), severity: 'low' }
  ];

  const columns = [
    'budgetPeriod', 'department', 'costCenter', 'budgetLine', 'allocatedAmount', 'committedAmount',
    'actualSpend', 'remainingAmount', 'utilizationPercent', 'variance', 'varianceStatus', 'owner', 'warningFlags'
  ];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: varianceMode
      ? pagedRows.map((row) => ({ ...row, varianceAbsolute: Math.abs(toNumber(row.variance)) }))
      : pagedRows,
    totals,
    warnings,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: filteredRows.length,
      totalPages: Math.max(Math.ceil(filteredRows.length / pagination.limit), 1)
    }
  });
}

async function buildPayrollRows({ reportType, query, generatedBy }) {
  const pagination = normalizePagination(query);
  const range = parseDateRange(query);

  const where = { deletedAt: null };
  if (query.status) where.approvalStatus = query.status;
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.month) where.month = Number(query.month);
  if (query.year) where.year = Number(query.year);
  addDateFilter(where, 'createdAt', range);

  const payslips = await prisma.payslip.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          departmentId: true,
          department: { select: { id: true, name: true, slug: true } },
          jobTitle: true
        }
      }
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }]
  });

  const approvalMap = await prisma.approvalRequest.findMany({
    where: {
      deletedAt: null,
      entityType: 'PAYSLIP',
      entityId: { in: payslips.map((payslip) => payslip.id) }
    },
    select: {
      entityId: true,
      status: true,
      approvedAt: true,
      requestedById: true
    }
  });

  const approvalByEntity = new Map(approvalMap.map((item) => [item.entityId, item]));

  const rows = payslips
    .filter((payslip) => {
      if (query.departmentId && payslip.employee?.departmentId !== query.departmentId) return false;
      return true;
    })
    .map((payslip) => {
      const approval = approvalByEntity.get(payslip.id);
      const deductions = toNumber(payslip.totalDeductions);
      const gross = toNumber(payslip.grossPay);
      const net = toNumber(payslip.netPay);
      const warnings = [];

      if (!approval || approval.status === 'PENDING') warnings.push('PAYROLL_APPROVAL_MISSING');

      return {
        id: payslip.id,
        payrollReference: payrollReference(payslip.id),
        payrollPeriod: `${payslip.year}-${String(payslip.month).padStart(2, '0')}`,
        employee: payslip.employee?.fullName || 'Unknown',
        employeeId: payslip.employee?.id || null,
        staffId: payslip.employee?.id || null,
        department: payslip.employee?.department?.name || 'Unassigned',
        departmentId: payslip.employee?.departmentId || null,
        jobTitle: payslip.employee?.jobTitle || null,
        grossPay: gross,
        allowances: null,
        deductions,
        taxPaye: null,
        netPay: net,
        paymentStatus: payslip.lockedAt ? 'PAID' : 'PENDING',
        approvalStatus: payslip.approvalStatus,
        paidDate: formatDate(payslip.lockedAt),
        warningFlags: warnings,
        createdAt: formatDateTime(payslip.createdAt)
      };
    });

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const totals = {
    grossPayroll: rows.reduce((sum, row) => sum + toNumber(row.grossPay), 0),
    totalDeductions: rows.reduce((sum, row) => sum + toNumber(row.deductions), 0),
    totalPaye: rows.reduce((sum, row) => sum + toNumber(row.taxPaye), 0),
    netPayroll: rows.reduce((sum, row) => sum + toNumber(row.netPay), 0),
    payrollByDepartment: rows.reduce((acc, row) => {
      const key = String(row.department || 'Unassigned');
      acc[key] = (acc[key] || 0) + toNumber(row.netPay);
      return acc;
    }, {})
  };

  const warnings = [
    { key: 'payroll_approval_missing', label: 'Payroll approvals missing/pending', count: buildWarningCount(rows, 'PAYROLL_APPROVAL_MISSING'), severity: 'high' }
  ];

  const columns = [
    'payrollPeriod', 'employee', 'staffId', 'department', 'jobTitle', 'grossPay', 'allowances', 'deductions',
    'taxPaye', 'netPay', 'paymentStatus', 'approvalStatus', 'paidDate', 'warningFlags'
  ];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: pagedRows,
    totals,
    warnings,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pagination.limit), 1)
    }
  });
}

async function buildPettyCashRows({ reportType, query, generatedBy }) {
  const base = await buildFinanceRequestRows({ reportType: 'finance-requests', query: { ...query, type: 'PETTY_CASH' }, generatedBy });

  let runningBalance = 0;
  const chronological = [...base.rows].sort((a, b) => new Date(String(a.requestDate)).getTime() - new Date(String(b.requestDate)).getTime());

  const rows = chronological.map((row, index) => {
    const amountOut = toNumber(row.amountRequested);
    const amountIn = 0;
    runningBalance += amountIn - amountOut;

    return {
      id: row.id,
      transactionDate: row.requestDate,
      voucherNumber: `PC-${String(index + 1).padStart(4, '0')}`,
      custodian: row.requester,
      description: row.description,
      amountIn,
      amountOut,
      runningBalance,
      category: row.category,
      approvedBy: row.approvedBy,
      receiptStatus: row.proofStatus,
      status: row.status,
      warningFlags: row.warningFlags
    };
  });

  const totals = {
    openingBalance: 0,
    totalCashIn: rows.reduce((sum, row) => sum + toNumber(row.amountIn), 0),
    totalCashOut: rows.reduce((sum, row) => sum + toNumber(row.amountOut), 0),
    closingBalance: rows.length ? rows[rows.length - 1].runningBalance : 0,
    unapprovedCashUsage: rows.filter((row) => !['APPROVED', 'PAID'].includes(String(row.status))).length
  };

  const warnings = [
    { key: 'petty_cash_unapproved', label: 'Unapproved petty cash usage', count: totals.unapprovedCashUsage, severity: 'medium' }
  ];

  const columns = [
    'transactionDate', 'voucherNumber', 'custodian', 'description', 'amountIn', 'amountOut',
    'runningBalance', 'category', 'approvedBy', 'receiptStatus', 'status', 'warningFlags'
  ];

  return {
    ...base,
    reportType,
    columns,
    rows,
    totals,
    warnings
  };
}

async function buildTaxKraRows({ reportType, query, generatedBy }) {
  const pagination = normalizePagination(query);
  const range = parseDateRange(query);

  const where = {
    deletedAt: null,
    ownerType: 'FINANCE',
    category: { in: ['KRA_DOCUMENT', 'TAX_DOCUMENT'] }
  };
  addDateFilter(where, 'createdAt', range);

  const documents = await prisma.document.findMany({
    where,
    include: {
      uploadedBy: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true, slug: true } }
    },
    orderBy: [{ createdAt: 'desc' }]
  });

  const rows = documents
    .filter((document) => (query.departmentId ? document.departmentId === query.departmentId : true))
    .map((document) => {
      const dueDate = document.expiryDate || null;
      const today = new Date();
      const dueDays = dueDate ? Math.ceil((new Date(dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
      const warningFlags = [];
      if (dueDays !== null && dueDays <= 14 && dueDays >= 0) warningFlags.push('TAX_DUE_APPROACHING');
      if (dueDays !== null && dueDays < 0) warningFlags.push('OVERDUE_TAX_FILING');

      return {
        id: document.id,
        period: formatDate(document.createdAt),
        taxType: document.category,
        relatedPayrollPayment: document.ownerId || null,
        taxableAmount: null,
        taxDue: null,
        filingStatus: document.status,
        dueDate: formatDate(dueDate),
        filedDate: formatDate(document.approvedAt),
        penaltyRisk: dueDays === null ? 'UNKNOWN' : dueDays < 0 ? 'HIGH' : dueDays <= 14 ? 'MEDIUM' : 'LOW',
        documentStatus: document.status,
        warningFlags,
        uploadedBy: document.uploadedBy?.fullName || null
      };
    });

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const totals = {
    taxDue: rows.reduce((sum, row) => sum + toNumber(row.taxDue), 0),
    taxFiled: rows.filter((row) => ['APPROVED', 'ARCHIVED'].includes(String(row.filingStatus))).length,
    pendingFilings: rows.filter((row) => ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(String(row.filingStatus))).length,
    overdueFilings: buildWarningCount(rows, 'OVERDUE_TAX_FILING')
  };

  const warnings = [
    { key: 'tax_due_approaching', label: 'Tax due approaching', count: buildWarningCount(rows, 'TAX_DUE_APPROACHING'), severity: 'medium' },
    { key: 'overdue_tax_filings', label: 'Overdue tax filings', count: buildWarningCount(rows, 'OVERDUE_TAX_FILING'), severity: 'high' }
  ];

  const columns = [
    'period', 'taxType', 'relatedPayrollPayment', 'taxableAmount', 'taxDue', 'filingStatus',
    'dueDate', 'filedDate', 'penaltyRisk', 'documentStatus', 'warningFlags'
  ];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: pagedRows,
    totals,
    warnings,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pagination.limit), 1)
    }
  });
}

async function buildPaymentProofRows({ reportType, query, generatedBy }) {
  const pagination = normalizePagination(query);
  const range = parseDateRange(query);
  const where = { deletedAt: null };
  addDateFilter(where, 'createdAt', range);
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.status) where.status = query.status;

  const requests = await prisma.financeRequest.findMany({
    where,
    include: {
      requestedBy: { select: { id: true, fullName: true, email: true } },
      department: { select: { id: true, name: true, slug: true } }
    },
    orderBy: [{ createdAt: 'desc' }]
  });

  const proofDocumentIds = requests.map((request) => request.paymentProofDocumentId).filter(Boolean);
  const proofDocuments = proofDocumentIds.length
    ? await prisma.document.findMany({
      where: { id: { in: proofDocumentIds }, deletedAt: null },
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } }
      }
    })
    : [];
  const proofMap = new Map(proofDocuments.map((document) => [document.id, document]));

  const rows = requests
    .filter((request) => (query.vendorPayee ? matchText(request.requestedBy?.fullName, query.vendorPayee) : true))
    .map((request) => {
      const proof = request.paymentProofDocumentId ? proofMap.get(request.paymentProofDocumentId) : null;
      const warningFlags = [];
      if (!proof) warningFlags.push('MISSING_PAYMENT_PROOF');
      if (request.status === 'PAID' && !proof) warningFlags.push('PAID_WITHOUT_PROOF');
      if (proof && request.status !== 'PAID') warningFlags.push('PAYMENT_AMOUNT_MISMATCH');

      return {
        id: request.id,
        requestReference: financeReference(request.id),
        paymentReference: request.paymentProofDocumentId ? docReference(request.paymentProofDocumentId) : null,
        payee: request.requestedBy?.fullName || null,
        amount: toNumber(request.amount),
        proofType: proof?.category || null,
        uploadedBy: proof?.uploadedBy?.fullName || null,
        uploadedDate: formatDate(proof?.createdAt),
        verificationStatus: proof?.status || 'MISSING',
        verifiedBy: proof?.approvedBy?.fullName || null,
        verifiedDate: formatDate(proof?.approvedAt),
        mismatchFlag: warningFlags.includes('PAYMENT_AMOUNT_MISMATCH'),
        warningFlags
      };
    });

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const totals = {
    totalProofs: rows.filter((row) => row.paymentReference).length,
    verifiedProofs: rows.filter((row) => ['APPROVED', 'ARCHIVED'].includes(String(row.verificationStatus))).length,
    pendingVerification: rows.filter((row) => ['PENDING_APPROVAL', 'DRAFT'].includes(String(row.verificationStatus))).length,
    missingProofs: buildWarningCount(rows, 'MISSING_PAYMENT_PROOF'),
    mismatchedProofs: rows.filter((row) => row.mismatchFlag).length
  };

  const warnings = [
    { key: 'missing_payment_proof', label: 'Missing payment proofs', count: totals.missingProofs, severity: 'high' },
    { key: 'mismatched_proof', label: 'Payment/proof mismatches', count: totals.mismatchedProofs, severity: 'medium' }
  ];

  const columns = [
    'requestReference', 'paymentReference', 'payee', 'amount', 'proofType', 'uploadedBy', 'uploadedDate',
    'verificationStatus', 'verifiedBy', 'verifiedDate', 'mismatchFlag', 'warningFlags'
  ];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: pagedRows,
    totals,
    warnings,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pagination.limit), 1)
    }
  });
}

async function buildAccountsArchiveRows({ reportType, query, generatedBy }) {
  const pagination = normalizePagination(query);
  const range = parseDateRange(query);

  const where = {
    deletedAt: null,
    ownerType: 'FINANCE'
  };
  addDateFilter(where, 'createdAt', range);
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.status) where.status = query.status;

  const documents = await prisma.document.findMany({
    where,
    include: {
      uploadedBy: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true, slug: true } }
    },
    orderBy: [{ createdAt: 'desc' }]
  });

  const rows = documents.map((document) => ({
    id: document.id,
    documentReference: docReference(document.id),
    documentType: document.documentType || document.category,
    relatedEntity: document.ownerType,
    relatedReference: document.ownerId || null,
    vendorEmployee: null,
    amount: null,
    period: formatDate(document.createdAt),
    uploadedBy: document.uploadedBy?.fullName || null,
    uploadedDate: formatDate(document.createdAt),
    retentionStatus: document.status,
    warningFlags: []
  }));

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const totals = {
    documents: rows.length,
    financeDocuments: rows.filter((row) => row.documentType === 'FINANCE_DOCUMENT').length,
    kraTaxDocuments: rows.filter((row) => ['KRA_DOCUMENT', 'TAX_DOCUMENT'].includes(String(row.documentType))).length
  };

  const columns = [
    'documentReference', 'documentType', 'relatedEntity', 'relatedReference', 'vendorEmployee',
    'amount', 'period', 'uploadedBy', 'uploadedDate', 'retentionStatus'
  ];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: pagedRows,
    totals,
    warnings: [],
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pagination.limit), 1)
    }
  });
}

async function buildAuditTrailRows({ reportType, query, generatedBy }) {
  const pagination = normalizePagination(query);
  const range = parseDateRange(query);

  const where = {
    entityType: { in: ['FinanceRequest', 'Budget', 'Payslip', 'Document'] }
  };
  addDateFilter(where, 'createdAt', range);
  if (query.status) where.action = query.status;
  if (query.requesterId) where.actorId = query.requesterId;

  const logs = await prisma.auditLog.findMany({
    where,
    include: { actor: { select: { id: true, fullName: true, email: true, departmentId: true } } },
    orderBy: [{ createdAt: 'desc' }]
  });

  const rows = logs
    .filter((log) => (query.departmentId ? log.actor?.departmentId === query.departmentId : true))
    .map((log) => ({
      id: log.id,
      eventTime: formatDateTime(log.createdAt),
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      actor: log.actor?.fullName || 'System',
      actorId: log.actorId || null,
      oldValues: log.oldValues || null,
      newValues: log.newValues || null,
      ipAddress: log.ipAddress || null,
      userAgent: log.userAgent || null,
      warningFlags: []
    }));

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const pagedRows = sortedRows.slice(pagination.skip, pagination.skip + pagination.limit);

  const totals = {
    events: rows.length,
    financeRequestEvents: rows.filter((row) => row.entityType === 'FinanceRequest').length,
    payrollEvents: rows.filter((row) => row.entityType === 'Payslip').length,
    documentEvents: rows.filter((row) => row.entityType === 'Document').length
  };

  const columns = ['eventTime', 'action', 'entityType', 'entityId', 'actor', 'oldValues', 'newValues', 'ipAddress', 'userAgent'];

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns,
    rows: pagedRows,
    totals,
    warnings: [],
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pagination.limit), 1)
    }
  });
}

async function buildSummary(query = {}) {
  const range = parseDateRange(query);

  const financeWhere = { deletedAt: null };
  addDateFilter(financeWhere, 'createdAt', range);
  if (query.departmentId) financeWhere.departmentId = query.departmentId;

  const [requests, budgets, payslips, documents, approvals] = await prisma.$transaction([
    prisma.financeRequest.findMany({ where: financeWhere, select: { id: true, amount: true, status: true, paymentProofDocumentId: true, departmentId: true } }),
    prisma.budget.findMany({ where: { deletedAt: null, ...(query.departmentId ? { departmentId: query.departmentId } : {}) }, select: { id: true, amount: true, spent: true } }),
    prisma.payslip.findMany({ where: { deletedAt: null, ...(query.employeeId ? { employeeId: query.employeeId } : {}) }, select: { id: true, netPay: true, approvalStatus: true } }),
    prisma.document.findMany({ where: { deletedAt: null, ownerType: 'FINANCE', category: { in: FINANCE_DOC_CATEGORIES } }, select: { id: true, category: true, status: true } }),
    prisma.approvalRequest.findMany({ where: { deletedAt: null, entityType: 'FINANCE_REQUEST' }, select: { entityId: true, status: true } })
  ]);

  const approvedStatuses = new Set(['APPROVED', 'PAID']);
  const pendingStatuses = new Set(['SUBMITTED', 'UNDER_REVIEW']);

  const totalRequested = requests.reduce((sum, request) => sum + toNumber(request.amount), 0);
  const totalApproved = requests.filter((request) => approvedStatuses.has(request.status)).reduce((sum, request) => sum + toNumber(request.amount), 0);
  const totalPaid = requests.filter((request) => request.status === 'PAID').reduce((sum, request) => sum + toNumber(request.amount), 0);
  const totalPending = requests.filter((request) => pendingStatuses.has(request.status)).reduce((sum, request) => sum + toNumber(request.amount), 0);
  const totalRejected = requests.filter((request) => request.status === 'REJECTED').reduce((sum, request) => sum + toNumber(request.amount), 0);
  const outstandingLiabilities = requests.filter((request) => request.status === 'APPROVED').reduce((sum, request) => sum + toNumber(request.amount), 0);

  const totalBudgetAllocated = budgets.reduce((sum, budget) => sum + toNumber(budget.amount), 0);
  const totalBudgetSpent = budgets.reduce((sum, budget) => sum + toNumber(budget.spent), 0);
  const budgetUtilization = totalBudgetAllocated > 0 ? Number(((totalBudgetSpent / totalBudgetAllocated) * 100).toFixed(2)) : 0;
  const payrollCost = payslips.reduce((sum, payslip) => sum + toNumber(payslip.netPay), 0);

  const taxKraPending = documents.filter((document) => ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(String(document.status))).length;
  const missingPaymentProofs = requests.filter((request) => request.status === 'PAID' && !request.paymentProofDocumentId).length;
  const unreconciledPayments = requests.filter((request) => request.status === 'PAID' && !request.paymentProofDocumentId).reduce((sum, request) => sum + toNumber(request.amount), 0);
  const overBudgetDepartments = budgets.filter((budget) => toNumber(budget.spent) > toNumber(budget.amount)).length;
  const pendingApprovals = approvals.filter((approval) => approval.status === 'PENDING').length;

  return {
    reportType: 'summary',
    generatedAt: new Date().toISOString(),
    filters: query,
    metrics: {
      totalRequested,
      totalApproved,
      totalPaid,
      totalPending,
      totalRejected,
      outstandingLiabilities,
      budgetUtilization,
      payrollCost,
      taxKraPending,
      missingPaymentProofs,
      unreconciledPayments,
      overBudgetDepartments,
      pendingApprovals
    }
  };
}

async function listSavedViews(auth) {
  const views = await prisma.setting.findMany({
    where: {
      section: 'finance_report_views',
      scopeType: 'USER',
      scopeKey: auth.userId
    },
    orderBy: { updatedAt: 'desc' }
  });

  return views.map((view) => ({
    id: view.key,
    ...((view.value && typeof view.value === 'object') ? view.value : {}),
    createdAt: view.createdAt,
    updatedAt: view.updatedAt
  }));
}

async function saveView(auth, payload) {
  const id = payload.id || `view_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const value = {
    id,
    name: payload.name,
    reportType: payload.reportType,
    filters: payload.filters || {},
    visibleColumns: Array.isArray(payload.visibleColumns) ? payload.visibleColumns : [],
    createdAt: payload.createdAt || new Date().toISOString()
  };

  const saved = await prisma.setting.upsert({
    where: {
      organizationId_section_key_scopeType_scopeKey: {
        organizationId: 'aptus-default-org',
        section: 'finance_report_views',
        key: id,
        scopeType: 'USER',
        scopeKey: auth.userId
      }
    },
    update: {
      value,
      updatedById: auth.userId
    },
    create: {
      organizationId: 'aptus-default-org',
      section: 'finance_report_views',
      key: id,
      scopeType: 'USER',
      scopeKey: auth.userId,
      value,
      createdById: auth.userId,
      updatedById: auth.userId
    }
  });

  return {
    id,
    ...value,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt
  };
}

async function deleteView(auth, id) {
  await prisma.setting.deleteMany({
    where: {
      organizationId: 'aptus-default-org',
      section: 'finance_report_views',
      key: id,
      scopeType: 'USER',
      scopeKey: auth.userId
    }
  });

  return { id };
}

async function getReportRows({ reportType, query, auth }) {
  const generatedBy = {
    id: auth?.userId || null,
    fullName: auth?.fullName || null,
    email: auth?.email || null
  };

  if (reportType === 'finance-requests') return buildFinanceRequestRows({ reportType, query, generatedBy });
  if (reportType === 'expenses') return buildExpenseRows({ reportType, query, generatedBy });
  if (reportType === 'payments') return buildPaymentRows({ reportType, query, generatedBy });
  if (reportType === 'budgets') return buildBudgetRows({ reportType, query, generatedBy, varianceMode: false });
  if (reportType === 'budget-variance') return buildBudgetRows({ reportType, query, generatedBy, varianceMode: true });
  if (reportType === 'payroll') return buildPayrollRows({ reportType, query, generatedBy });
  if (reportType === 'petty-cash') return buildPettyCashRows({ reportType, query, generatedBy });
  if (reportType === 'tax-kra') return buildTaxKraRows({ reportType, query, generatedBy });
  if (reportType === 'payment-proofs') return buildPaymentProofRows({ reportType, query, generatedBy });
  if (reportType === 'accounts-archive') return buildAccountsArchiveRows({ reportType, query, generatedBy });
  if (reportType === 'audit-trail') return buildAuditTrailRows({ reportType, query, generatedBy });

  return createReportPayload({
    reportType,
    generatedBy,
    filters: query,
    columns: [],
    rows: [],
    totals: {},
    warnings: [],
    pagination: { page: 1, limit: 25, total: 0, totalPages: 1 }
  });
}

module.exports = {
  FINANCE_REPORT_TYPES,
  getReportRows,
  buildSummary,
  listSavedViews,
  saveView,
  deleteView
};
