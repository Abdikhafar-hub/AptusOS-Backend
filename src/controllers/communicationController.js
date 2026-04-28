const communicationService = require('../services/communicationService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  getInbox: asyncHandler(async (req, res) => success(res, 'Inbox threads', await communicationService.listInbox(req.auth, req.query))),
  getSent: asyncHandler(async (req, res) => success(res, 'Sent threads', await communicationService.listSent(req.auth, req.query))),
  getThread: asyncHandler(async (req, res) => success(res, 'Thread detail', await communicationService.getThread(req.auth, req.params.threadId))),
  sendMail: asyncHandler(async (req, res) => success(res, 'Message sent', await communicationService.sendMail(req.auth, req.body, req.files || [], req), 201)),
  markMessageRead: asyncHandler(async (req, res) => success(res, 'Message marked read', await communicationService.markMessageRead(req.auth, req.params.messageId, req))),
  markThreadRead: asyncHandler(async (req, res) => success(res, 'Thread marked read', await communicationService.markThreadRead(req.auth, req.params.threadId, req))),
  recipientUsers: asyncHandler(async (req, res) => success(res, 'Recipient users', await communicationService.getRecipientUsers(req.auth, req.query))),
  recipientDepartments: asyncHandler(async (req, res) => success(res, 'Recipient departments', await communicationService.getRecipientDepartments(req.auth, req.query))),
  listConversations: asyncHandler(async (req, res) => success(res, 'Conversation list', await communicationService.listConversations(req.auth.userId, req.query))),
  unreadCount: asyncHandler(async (req, res) => success(res, 'Unread message count', { count: await communicationService.unreadCount(req.auth.userId) })),
  getConversationMessages: asyncHandler(async (req, res) => success(res, 'Conversation messages', await communicationService.getConversationMessages(req.auth.userId, req.params.id, req.query))),
  sendMessage: asyncHandler(async (req, res) => success(res, 'Message sent', await communicationService.sendDirectMessage(req.auth.userId, req.body, req), 201)),
  markConversationRead: asyncHandler(async (req, res) => success(res, 'Conversation marked read', await communicationService.markConversationRead(req.auth.userId, req.params.id))),
  listChannels: asyncHandler(async (req, res) => success(res, 'Channel list', await communicationService.listChannels(req.auth, req.query))),
  getChannelMessages: asyncHandler(async (req, res) => success(res, 'Channel messages', await communicationService.getChannelMessages(req.auth, req.params.id, req.query))),
  sendChannelMessage: asyncHandler(async (req, res) => success(res, 'Channel message sent', await communicationService.sendChannelMessage(req.auth, req.params.id, req.body, req), 201)),
  markChannelRead: asyncHandler(async (req, res) => success(res, 'Channel marked read', await communicationService.markChannelRead(req.auth, req.params.id))),
  pinChannelMessage: asyncHandler(async (req, res) => success(res, 'Channel message pinned', await communicationService.pinChannelMessage(req.auth, req.params.messageId))),
  listAnnouncements: asyncHandler(async (req, res) => success(res, 'Announcements', await communicationService.listAnnouncements(req.auth, req.query))),
  markAnnouncementRead: asyncHandler(async (req, res) => success(res, 'Announcement marked read', await communicationService.markAnnouncementRead(req.auth, req.params.id))),
  publishAnnouncement: asyncHandler(async (req, res) => success(res, 'Announcement published', await communicationService.publishAnnouncement(req.auth, req.body, req), 201)),
  addComment: asyncHandler(async (req, res) => success(res, 'Comment added', await communicationService.addComment(req.auth.userId, req.body, req), 201))
};
