const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const notificationQueryService = require('../services/notificationQueryService');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Notifications', await notificationQueryService.list(req.auth, req.query))),
  markRead: asyncHandler(async (req, res) => success(res, 'Notification marked read', await notificationQueryService.markRead(req.auth.userId, req.params.id))),
  markAllRead: asyncHandler(async (req, res) => success(res, 'Notifications marked read', await notificationQueryService.markAllRead(req.auth.userId)))
};
