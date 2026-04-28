const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const auditLogService = require('../services/auditLogService');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Audit logs', await auditLogService.list(req.query)))
};
