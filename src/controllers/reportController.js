const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const reportService = require('../services/reportService');

module.exports = {
  run: asyncHandler(async (req, res) => success(res, `${req.params.type} report`, await reportService.run(req.params.type, req.query, req.auth))),
  runQuery: asyncHandler(async (req, res) => {
    const type = req.query.type;
    const result = await reportService.runQuery(type, req.query, req.auth);
    return success(res, `${type} report`, result);
  })
};
