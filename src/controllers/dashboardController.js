const dashboardService = require('../services/dashboardService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  generalManager: asyncHandler(async (req, res) => success(res, 'General Manager dashboard', await dashboardService.generalManager(req.auth.userId))),
  departmentHead: asyncHandler(async (req, res) => success(res, 'Department Head dashboard', await dashboardService.departmentHead(req.auth))),
  hr: asyncHandler(async (req, res) => success(res, 'HR dashboard', await dashboardService.hr(req.auth))),
  financeAccounts: asyncHandler(async (req, res) => success(res, 'Finance & Accounts dashboard', await dashboardService.financeAccounts(req.auth))),
  finance: asyncHandler(async (req, res) => success(res, 'Finance & Accounts dashboard', await dashboardService.finance(req.auth))),
  accounts: asyncHandler(async (req, res) => success(res, 'Finance & Accounts dashboard', await dashboardService.accounts(req.auth))),
  salesCompliance: asyncHandler(async (req, res) => success(res, 'Sales and Compliance dashboard', await dashboardService.salesCompliance(req.auth))),
  operations: asyncHandler(async (req, res) => success(res, 'Operations dashboard', await dashboardService.operations(req.auth))),
  employee: asyncHandler(async (req, res) => success(res, 'Employee dashboard', await dashboardService.employee(req.auth.userId)))
};
