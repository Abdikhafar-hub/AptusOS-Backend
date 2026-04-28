const departmentService = require('../services/departmentService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Department list', await departmentService.list(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Department detail', await departmentService.get(req.params.id, req.auth))),
  create: asyncHandler(async (req, res) => success(res, 'Department created', await departmentService.create(req.body, req.auth.userId, req), 201)),
  update: asyncHandler(async (req, res) => success(res, 'Department updated', await departmentService.update(req.params.id, req.body, req.auth.userId, req))),
  archive: asyncHandler(async (req, res) => success(res, 'Department archived', await departmentService.archive(req.params.id, req.auth.userId, req))),
  addStaff: asyncHandler(async (req, res) => success(res, 'Staff added to department', await departmentService.addStaff(req.params.id, req.body.userId, req.auth.userId, req))),
  removeStaff: asyncHandler(async (req, res) => success(res, 'Staff removed from department', await departmentService.removeStaff(req.params.id, req.params.userId, req.auth.userId, req))),
  transferStaff: asyncHandler(async (req, res) => success(res, 'Staff transferred', await departmentService.transferStaff(req.params.id, req.body.toDepartmentId, req.body.userId, req.auth.userId, req))),
  dashboard: asyncHandler(async (req, res) => success(res, 'Department dashboard', await departmentService.dashboard(req.params.id, req.auth)))
};
