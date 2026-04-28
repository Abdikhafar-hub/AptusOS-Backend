const documentService = require('../services/documentService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Document list', await documentService.list(req.auth, req.query))),
  expiring: asyncHandler(async (req, res) => success(res, 'Expiring documents', await documentService.expiringDocuments(req.auth, req.query))),
  metrics: asyncHandler(async (req, res) => success(res, 'Document metrics', await documentService.dashboardMetrics(req.auth))),
  get: asyncHandler(async (req, res) => success(res, 'Document detail', await documentService.get(req.params.id, req.auth))),
  upload: asyncHandler(async (req, res) => success(res, 'Document uploaded', await documentService.upload(req.file, req.body, req.auth.userId, req), 201)),
  version: asyncHandler(async (req, res) => success(res, 'Document version uploaded', await documentService.version(req.params.id, req.file, req.auth.userId, req))),
  requestApproval: asyncHandler(async (req, res) => success(res, 'Document approval requested', await documentService.requestApproval(req.params.id, req.auth.userId, req.body, req), 201)),
  approve: asyncHandler(async (req, res) => success(res, 'Document approved', await documentService.approve(req.params.id, req.auth.userId, req))),
  reject: asyncHandler(async (req, res) => success(res, 'Document rejected', await documentService.reject(req.params.id, req.body.rejectionReason, req.auth.userId, req))),
  archive: asyncHandler(async (req, res) => success(res, 'Document archived', await documentService.archive(req.params.id, req.auth.userId, req)))
};
