const performanceService = require('../services/performanceService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Performance reviews', await performanceService.list(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Performance review', await performanceService.get(req.params.id, req.auth))),
  create: asyncHandler(async (req, res) => success(res, 'Performance review created', await performanceService.create(req.auth, req.body, req), 201)),
  addComment: asyncHandler(async (req, res) => success(res, 'Performance review comment added', await performanceService.addComment(req.auth, req.params.id, req.body, req), 201)),
  uploadSupportingDocument: asyncHandler(async (req, res) => success(res, 'Performance review supporting document uploaded', await performanceService.uploadSupportingDocument(req.auth, req.params.id, req.file, req.body, req), 201)),
  selfReview: asyncHandler(async (req, res) => success(res, 'Self review submitted', await performanceService.submitSelfReview(req.auth, req.params.id, req.body, req))),
  managerReview: asyncHandler(async (req, res) => success(res, 'Manager review submitted', await performanceService.submitManagerReview(req.auth, req.params.id, req.body, req))),
  hrReview: asyncHandler(async (req, res) => success(res, 'HR review submitted', await performanceService.submitHrReview(req.auth, req.params.id, req.body, req)))
};
