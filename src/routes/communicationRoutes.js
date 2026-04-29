const express = require('express');
const controller = require('../controllers/communicationController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/guards');
const { uploadMultiple } = require('../middleware/upload');
const { idParam, channelMessageParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/domainValidators');

const messageRouter = express.Router();
messageRouter.use(authenticate, requirePermission('communication:use'));
messageRouter.get('/inbox', validate(v.mailListQuery), controller.getInbox);
messageRouter.get('/sent', validate(v.mailListQuery), controller.getSent);
messageRouter.get('/threads/:threadId', validate(v.mailThreadParam), controller.getThread);
messageRouter.post('/send', uploadMultiple('attachments', 10), controller.sendMail);
messageRouter.get('/recipients/users', validate(v.mailRecipientQuery), controller.recipientUsers);
messageRouter.get('/recipients/departments', validate(v.mailRecipientQuery), controller.recipientDepartments);
messageRouter.post('/:messageId/read', validate(v.mailMessageParam), controller.markMessageRead);
messageRouter.post('/threads/:threadId/read', validate(v.mailThreadParam), controller.markThreadRead);
messageRouter.get('/', validate(listQuery), controller.listConversations);
messageRouter.get('/unread-count', controller.unreadCount);
messageRouter.get('/mail-counts', controller.mailCounts);
messageRouter.post('/', validate(v.message), controller.sendMessage);
messageRouter.get('/:id', validate(idParam), controller.getConversationMessages);

const channelRouter = express.Router();
channelRouter.use(authenticate, requirePermission('communication:use'));
channelRouter.get('/', validate(listQuery), controller.listChannels);
channelRouter.get('/:id/messages', validate(idParam), controller.getChannelMessages);
channelRouter.post('/:id/messages', validate(idParam), validate(v.channelMessage), controller.sendChannelMessage);
channelRouter.post('/:id/read', validate(idParam), controller.markChannelRead);
channelRouter.post('/:id/messages/:messageId/pin', validate(channelMessageParam), controller.pinChannelMessage);

const announcementRouter = express.Router();
announcementRouter.use(authenticate, requirePermission('communication:use'));
announcementRouter.get('/', validate(listQuery), controller.listAnnouncements);
announcementRouter.post('/', requirePermission('announcements:publish'), validate(v.announcement), controller.publishAnnouncement);
announcementRouter.post('/:id/read', validate(idParam), controller.markAnnouncementRead);

const commentRouter = express.Router();
commentRouter.use(authenticate, requirePermission('communication:use'));
commentRouter.post('/', validate(v.comment), controller.addComment);

module.exports = { messageRouter, channelRouter, announcementRouter, commentRouter };
