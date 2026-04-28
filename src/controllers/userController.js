const userService = require('../services/userService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

const userController = {
  list: asyncHandler(async (req, res) => success(res, 'Staff list', await userService.list(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Staff profile', await userService.get(req.params.id, req.auth))),
  fullProfile: asyncHandler(async (req, res) => success(res, 'Staff profile', await userService.getFullProfile(req.params.id, req.auth))),
  create: asyncHandler(async (req, res) => success(res, 'Staff created', await userService.create(req.body, req.auth.userId, req), 201)),
  update: asyncHandler(async (req, res) => success(res, 'Staff updated', await userService.update(req.params.id, req.body, req.auth.userId, req))),
  resendCredentials: asyncHandler(async (req, res) => success(res, 'Staff credentials resent', await userService.resendCredentials(req.params.id, req.auth.userId, req))),
  deactivate: asyncHandler(async (req, res) => success(res, 'Staff deactivated', await userService.deactivate(req.params.id, req.auth.userId, req))),
  activate: asyncHandler(async (req, res) => success(res, 'Staff activated', await userService.activate(req.params.id, req.auth.userId, req))),
  suspend: asyncHandler(async (req, res) => success(res, 'Staff suspended', await userService.suspend(req.params.id, req.auth.userId, req))),
  uploadProfilePhoto: asyncHandler(async (req, res) => success(res, 'Profile photo updated', await userService.uploadProfilePhoto(req.params.id, req.file, req.auth.userId, req))),
  uploadDocument: asyncHandler(async (req, res) => success(res, 'Staff document uploaded', await userService.uploadStaffDocument(req.params.id, req.file, req.body, req.auth.userId, req), 201)),
  timeline: asyncHandler(async (req, res) => success(res, 'Staff timeline', await userService.timeline(req.params.id, req.auth)))
};

module.exports = userController;
