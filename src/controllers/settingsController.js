const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const settingsService = require('../services/settingsService');

const settingsController = {
  list: asyncHandler(async (req, res) => success(res, 'Settings overview', await settingsService.getOverview(req.auth))),
  getSection: asyncHandler(async (req, res) => success(res, 'Settings section', await settingsService.getSection(req.auth, req.params.section))),
  updateSection: asyncHandler(async (req, res) => success(res, 'Settings section updated', await settingsService.updateSection(req.auth, req.params.section, req.body, req))),
  getRoleSettings: asyncHandler(async (req, res) => success(res, 'Role settings', await settingsService.getRoleSettings(req.auth, req.params.role))),
  updateRoleSettings: asyncHandler(async (req, res) => success(res, 'Role settings updated', await settingsService.updateRoleSettings(req.auth, req.params.role, req.body, req)))
};

module.exports = settingsController;
