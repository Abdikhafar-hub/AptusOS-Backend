const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const departmentHeadService = require('../services/departmentHeadService');

module.exports = {
  dashboard: asyncHandler(async (req, res) => success(res, 'Department Head dashboard', await departmentHeadService.getDashboard(req.auth))),
  department: asyncHandler(async (req, res) => success(res, 'Department profile', await departmentHeadService.getDepartment(req.auth))),

  listStaff: asyncHandler(async (req, res) => success(res, 'Department staff', await departmentHeadService.listStaff(req.auth, req.query))),
  getStaff: asyncHandler(async (req, res) => success(res, 'Department staff profile', await departmentHeadService.getStaff(req.auth, req.params.id))),

  listTasks: asyncHandler(async (req, res) => success(res, 'Department tasks', await departmentHeadService.listTasks(req.auth, req.query))),
  createTask: asyncHandler(async (req, res) => success(res, 'Department task created', await departmentHeadService.createTask(req.auth, req.body, req), 201)),
  updateTask: asyncHandler(async (req, res) => success(res, 'Department task updated', await departmentHeadService.updateTask(req.auth, req.params.id, req.body))),
  deleteTask: asyncHandler(async (req, res) => success(res, 'Department task deleted', await departmentHeadService.deleteTask(req.auth, req.params.id))),

  listLeave: asyncHandler(async (req, res) => success(res, 'Department leave requests', await departmentHeadService.listLeave(req.auth, req.query))),
  approveLeave: asyncHandler(async (req, res) => success(res, 'Leave request approved', await departmentHeadService.approveLeave(req.auth, req.params.id, req.body.comment, req))),
  rejectLeave: asyncHandler(async (req, res) => success(res, 'Leave request rejected', await departmentHeadService.rejectLeave(req.auth, req.params.id, req.body.comment, req))),

  listAttendance: asyncHandler(async (req, res) => success(res, 'Department attendance', await departmentHeadService.listAttendance(req.auth, req.query))),

  listApprovals: asyncHandler(async (req, res) => success(res, 'Department approvals', await departmentHeadService.listApprovals(req.auth, req.query))),
  actOnApproval: asyncHandler(async (req, res) => success(res, 'Approval action completed', await departmentHeadService.actOnApproval(req.auth, req.params.id, req.body, req))),

  runReport: asyncHandler(async (req, res) => success(res, 'Department report', await departmentHeadService.runReport(req.auth, req.body))),

  listDocuments: asyncHandler(async (req, res) => success(res, 'Department documents', await departmentHeadService.listDocuments(req.auth, req.query))),
  uploadDocument: asyncHandler(async (req, res) => success(res, 'Department document uploaded', await departmentHeadService.uploadDocument(req.auth, req.file, req.body, req), 201)),
  deleteDocument: asyncHandler(async (req, res) => success(res, 'Department document deleted', await departmentHeadService.deleteDocument(req.auth, req.params.id, req))),

  inbox: asyncHandler(async (req, res) => success(res, 'Department inbox', await departmentHeadService.listInbox(req.auth, req.query))),
  sent: asyncHandler(async (req, res) => success(res, 'Department sent', await departmentHeadService.listSent(req.auth, req.query))),
  thread: asyncHandler(async (req, res) => success(res, 'Department thread', await departmentHeadService.getThread(req.auth, req.params.id))),
  sendMessage: asyncHandler(async (req, res) => success(res, 'Department message sent', await departmentHeadService.sendMessage(req.auth, req.body, req.files || [], req), 201)),

  listAuditLogs: asyncHandler(async (req, res) => success(res, 'Department audit logs', await departmentHeadService.listAuditLogs(req.auth, req.query)))
};
