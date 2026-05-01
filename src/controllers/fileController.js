const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const fileAccessService = require('../services/fileAccessService');

module.exports = {
  getAccess: asyncHandler(async (req, res) => {
    const file = await fileAccessService.getSignedAccess(req.params.fileId, req.auth, req);
    return success(res, 'Secure file URL generated', file);
  }),

  download: asyncHandler(async (req, res) => {
    await fileAccessService.streamFile(req.params.fileId, req.auth, req, res);
  })
};
