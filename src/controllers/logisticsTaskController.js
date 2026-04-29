const logisticsTaskService = require('../services/logisticsTaskService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Logistics task list', await logisticsTaskService.list(req.auth, req.query))),
  board: asyncHandler(async (req, res) => success(res, 'Logistics task board', await logisticsTaskService.board(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Logistics task detail', await logisticsTaskService.get(req.auth, req.params.id))),
  create: asyncHandler(async (req, res) => success(res, 'Logistics task created', await logisticsTaskService.create(req.auth, req.body, req), 201)),
  update: asyncHandler(async (req, res) => success(res, 'Logistics task updated', await logisticsTaskService.update(req.auth, req.params.id, req.body, req))),
  updateStatus: asyncHandler(async (req, res) => success(res, 'Logistics task status updated', await logisticsTaskService.updateStatus(req.auth, req.params.id, req.body.status, req.body.comment, req.body.delayReason, req.body.incidentReport, req))),
  addDocuments: asyncHandler(async (req, res) => success(res, 'Logistics task documents uploaded', await logisticsTaskService.addDocuments(req.auth, req.params.id, req.body.documents, req)))
};
