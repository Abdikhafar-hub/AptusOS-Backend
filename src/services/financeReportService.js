const AppError = require('../utils/AppError');
const { ROLES, normalizeRoleName } = require('../constants/roles');
const financeReportRepository = require('./financeReportRepository');
const exportService = require('./exportService');

const SENSITIVE_REPORTS = new Set(['payroll', 'tax-kra', 'audit-trail']);
const EXPORT_RESTRICTED_REPORTS = new Set(['payroll', 'tax-kra', 'audit-trail']);

function canAccessFinanceReport(auth) {
  const roleName = normalizeRoleName(auth?.roleName);
  if (roleName === ROLES.GENERAL_MANAGER) return true;
  if (roleName === ROLES.FINANCE_ACCOUNTS_MANAGER) return true;
  return false;
}

function canAccessSensitiveFinanceReport(auth) {
  if (!canAccessFinanceReport(auth)) return false;
  const permissions = new Set(auth?.permissions || []);
  return permissions.has('payroll:read') || permissions.has('payroll:manage') || permissions.has('accounts:manage');
}

function assertReportAccess(auth, reportType) {
  if (!canAccessFinanceReport(auth)) {
    throw new AppError('You do not have access to finance reporting center', 403);
  }

  if (!financeReportRepository.FINANCE_REPORT_TYPES.includes(reportType)) {
    throw new AppError('Unsupported finance report type', 400);
  }

  if (SENSITIVE_REPORTS.has(reportType) && !canAccessSensitiveFinanceReport(auth)) {
    throw new AppError('You do not have access to this sensitive finance report', 403);
  }
}

const financeReportService = {
  async summary(auth, query = {}) {
    if (!canAccessFinanceReport(auth)) {
      throw new AppError('You do not have access to finance reporting center', 403);
    }
    return financeReportRepository.buildSummary(query);
  },

  async run(auth, reportType, query = {}) {
    assertReportAccess(auth, reportType);
    return financeReportRepository.getReportRows({ reportType, query, auth });
  },

  async export(auth, reportType, query = {}) {
    assertReportAccess(auth, reportType);

    if (EXPORT_RESTRICTED_REPORTS.has(reportType) && !canAccessSensitiveFinanceReport(auth)) {
      throw new AppError('You do not have access to export this sensitive finance report', 403);
    }

    const report = await financeReportRepository.getReportRows({
      reportType,
      query: {
        ...query,
        page: 1,
        limit: 10000
      },
      auth
    });

    return exportService.buildExport(report, query.format || 'csv');
  },

  async listSavedViews(auth) {
    if (!canAccessFinanceReport(auth)) {
      throw new AppError('You do not have access to finance reporting center', 403);
    }
    return financeReportRepository.listSavedViews(auth);
  },

  async saveView(auth, payload) {
    if (!canAccessFinanceReport(auth)) {
      throw new AppError('You do not have access to finance reporting center', 403);
    }

    if (!payload?.name) throw new AppError('View name is required', 422);
    if (!payload?.reportType) throw new AppError('Report type is required', 422);

    assertReportAccess(auth, payload.reportType);
    return financeReportRepository.saveView(auth, payload);
  },

  async deleteView(auth, id) {
    if (!canAccessFinanceReport(auth)) {
      throw new AppError('You do not have access to finance reporting center', 403);
    }
    if (!id) throw new AppError('Saved view id is required', 422);
    return financeReportRepository.deleteView(auth, id);
  }
};

module.exports = financeReportService;
