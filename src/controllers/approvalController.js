const approvalService = require('../services/approvalService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Approval list', await approvalService.list(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Approval detail', await approvalService.get(req.params.id, req.auth))),
  create: asyncHandler(async (req, res) => success(res, 'Approval created', await approvalService.create(req.body, req.auth.userId, req), 201)),
  approve: asyncHandler(async (req, res) => success(res, 'Approval approved', await approvalService.act(req.params.id, 'APPROVED', req.auth.userId, req.body.comment, req))),
  reject: asyncHandler(async (req, res) => success(res, 'Approval rejected', await approvalService.act(req.params.id, 'REJECTED', req.auth.userId, req.body.comment, req))),
  moreInfo: asyncHandler(async (req, res) => success(res, 'More information requested', await approvalService.act(req.params.id, 'NEEDS_MORE_INFO', req.auth.userId, req.body.comment, req))),
  cancel: asyncHandler(async (req, res) => success(res, 'Approval cancelled', await approvalService.cancel(req.params.id, req.auth.userId, req))),
  resubmit: asyncHandler(async (req, res) => success(res, 'Approval resubmitted', await approvalService.resubmit(req.params.id, req.auth.userId, req.body.comment, req)))
};
