const financeService = require('../services/financeService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  listRequests: asyncHandler(async (req, res) => success(res, 'Finance requests', await financeService.listRequests(req.auth, req.query))),
  getRequest: asyncHandler(async (req, res) => success(res, 'Finance request', await financeService.getRequest(req.params.id, req.auth))),
  createRequest: asyncHandler(async (req, res) => success(res, 'Finance request created', await financeService.createRequest(req.auth, req.body, req), 201)),
  updateRequest: asyncHandler(async (req, res) => success(res, 'Finance request updated', await financeService.updateRequest(req.params.id, req.auth, req.body, req))),
  reviewRequest: asyncHandler(async (req, res) => success(res, 'Finance request reviewed', await financeService.reviewRequest(req.params.id, req.auth, req.body.decision, req.body.comment, req))),
  markPaid: asyncHandler(async (req, res) => success(res, 'Finance request marked paid', await financeService.markPaid(req.params.id, req.auth, req.body, req))),
  attachPaymentProof: asyncHandler(async (req, res) => success(res, 'Payment proof attached', await financeService.attachPaymentProof(req.params.id, req.auth, req.body, req))),
  listBudgets: asyncHandler(async (req, res) => success(res, 'Budgets', await financeService.listBudgets(req.auth, req.query))),
  createBudget: asyncHandler(async (req, res) => success(res, 'Budget created', await financeService.createBudget(req.auth, req.body, req), 201)),
  monthlySummary: asyncHandler(async (req, res) => success(res, 'Finance summary', await financeService.monthlySummary(req.auth, req.query))),
  accountsSummary: asyncHandler(async (req, res) => success(res, 'Accounts records', await financeService.accountsSummary(req.auth)))
};
