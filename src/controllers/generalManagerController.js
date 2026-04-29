const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const generalManagerService = require('../services/generalManagerService');

module.exports = {
  dashboard: asyncHandler(async (req, res) => success(res, 'General Manager executive dashboard', await generalManagerService.dashboard(req.auth, req.query))),

  listEscalations: asyncHandler(async (req, res) => success(res, 'General Manager escalations', await generalManagerService.listEscalations(req.auth, req.query))),
  resolveEscalation: asyncHandler(async (req, res) => success(res, 'Escalation updated', await generalManagerService.resolveEscalation(req.auth, req.params.id, req.body, req))),

  runReport: asyncHandler(async (req, res) => success(res, 'Enterprise report generated', await generalManagerService.runEnterpriseReport(req.auth, req.body, req))),

  getSettings: asyncHandler(async (req, res) => success(res, 'Governance settings', await generalManagerService.getSettings(req.auth))),
  updateSettings: asyncHandler(async (req, res) => success(res, 'Governance settings updated', await generalManagerService.updateSettings(req.auth, req.body, req))),

  financeSummary: asyncHandler(async (req, res) => success(res, 'Finance summary', await generalManagerService.getFinanceSummary(req.auth, req.query))),
  financePayables: asyncHandler(async (req, res) => success(res, 'Finance payables', await generalManagerService.listPayables(req.auth, req.query))),
  financeReceivables: asyncHandler(async (req, res) => success(res, 'Finance receivables', await generalManagerService.listReceivables(req.auth, req.query))),

  auditLogs: asyncHandler(async (req, res) => success(res, 'Audit logs', await generalManagerService.listAuditLogs(req.auth, req.query))),
  keyAccounts: asyncHandler(async (req, res) => success(res, 'Key accounts', await generalManagerService.listKeyAccounts(req.auth, req.query))),

  listContracts: asyncHandler(async (req, res) => success(res, 'Contracts', await generalManagerService.listContracts(req.auth, req.query))),
  createContract: asyncHandler(async (req, res) => success(res, 'Contract created', await generalManagerService.createContract(req.auth, req.body, req), 201)),
  updateContract: asyncHandler(async (req, res) => success(res, 'Contract updated', await generalManagerService.updateContract(req.auth, req.params.id, req.body, req))),
  deleteContract: asyncHandler(async (req, res) => success(res, 'Contract archived', await generalManagerService.deleteContract(req.auth, req.params.id, req))),

  createDelegation: asyncHandler(async (req, res) => success(res, 'Delegation created', await generalManagerService.createDelegation(req.auth, req.body, req), 201)),
  listDelegations: asyncHandler(async (req, res) => success(res, 'Delegations', await generalManagerService.listDelegations(req.auth, req.query))),
  updateDelegation: asyncHandler(async (req, res) => success(res, 'Delegation updated', await generalManagerService.updateDelegation(req.auth, req.params.id, req.body, req)))
};
