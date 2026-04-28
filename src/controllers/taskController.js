const taskService = require('../services/taskService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Task list', await taskService.list(req.auth, req.query))),
  board: asyncHandler(async (req, res) => success(res, 'Task board', await taskService.board(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Task detail', await taskService.get(req.params.id, req.auth))),
  create: asyncHandler(async (req, res) => success(res, 'Task created', await taskService.create(req.body, req.auth, req), 201)),
  update: asyncHandler(async (req, res) => success(res, 'Task updated', await taskService.update(req.params.id, req.body, req.auth, req))),
  updateStatus: asyncHandler(async (req, res) => success(res, 'Task status updated', await taskService.updateStatus(req.params.id, req.body.status, req.auth, req.body.comment, req))),
  addAttachments: asyncHandler(async (req, res) => success(res, 'Task attachments added', await taskService.addAttachments(req.params.id, req.body.documentIds, req.auth, req)))
};
