const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const notificationService = require('./notificationService');
const accessControlService = require('./accessControlService');
const workflowSupportService = require('./workflowSupportService');
const auditService = require('./auditService');
const uploadService = require('../uploads/uploadService');
const emailService = require('../emails/emailService');
const env = require('../config/env');
const { ROLES, normalizeRoleName } = require('../constants/roles');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const MAIL_PRIORITIES = new Set(['NORMAL', 'IMPORTANT', 'URGENT']);
const MAIL_DELIVERY_STATUS = Object.freeze({
  INTERNAL_STORED: 'INTERNAL_STORED',
  EMAIL_SENT: 'EMAIL_SENT',
  EMAIL_FAILED: 'EMAIL_FAILED'
});

function toIdArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return [];
    if (normalized.startsWith('[')) {
      try {
        const parsed = JSON.parse(normalized);
        if (Array.isArray(parsed)) return [...new Set(parsed.map(String).map((item) => item.trim()).filter(Boolean))];
      } catch (_) {
        return [];
      }
    }
    return [...new Set(normalized.split(',').map((item) => item.trim()).filter(Boolean))];
  }
  return [];
}

function toAttachmentList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return [];
    if (normalized.startsWith('[')) {
      try {
        const parsed = JSON.parse(normalized);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [{ fileUrl: normalized, fileName: normalized }];
  }
  return [];
}

function normalizePriority(priority) {
  const value = String(priority || 'NORMAL').toUpperCase();
  return MAIL_PRIORITIES.has(value) ? value : 'NORMAL';
}

function readMessageEnvelope(attachments) {
  if (attachments && typeof attachments === 'object' && !Array.isArray(attachments)) {
    const files = Array.isArray(attachments.files) ? attachments.files : [];
    const meta = attachments.meta && typeof attachments.meta === 'object' ? attachments.meta : {};
    return { files, meta };
  }

  if (Array.isArray(attachments)) {
    return {
      files: attachments,
      meta: { priority: 'NORMAL', deliveryStatus: MAIL_DELIVERY_STATUS.INTERNAL_STORED, toDepartmentIds: [] }
    };
  }

  return {
    files: [],
    meta: { priority: 'NORMAL', deliveryStatus: MAIL_DELIVERY_STATUS.INTERNAL_STORED, toDepartmentIds: [] }
  };
}

function buildMessageEnvelope({ files = [], priority = 'NORMAL', deliveryStatus = MAIL_DELIVERY_STATUS.INTERNAL_STORED, toDepartmentIds = [], email = null }) {
  return {
    files,
    meta: {
      priority,
      deliveryStatus,
      toDepartmentIds,
      email
    }
  };
}

function extractThreadParticipantNames(participants = []) {
  return participants.map((participant) => participant.user?.fullName).filter(Boolean).join(' ').toLowerCase();
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMailPreviewMessage(message) {
  const envelope = readMessageEnvelope(message?.attachments);
  const toDepartmentIds = Array.isArray(envelope.meta.toDepartmentIds) ? envelope.meta.toDepartmentIds : [];
  return {
    id: message?.id || null,
    body: message?.body || '',
    preview: String(message?.body || '').slice(0, 180),
    createdAt: message?.createdAt || null,
    senderId: message?.senderId || null,
    sender: message?.sender
      ? { id: message.sender.id, fullName: message.sender.fullName, email: message.sender.email || null }
      : null,
    priority: normalizePriority(envelope.meta.priority),
    deliveryStatus: envelope.meta.deliveryStatus || MAIL_DELIVERY_STATUS.INTERNAL_STORED,
    hasAttachments: envelope.files.length > 0,
    attachmentCount: envelope.files.length,
    toDepartmentIds,
    isDepartmentBroadcast: toDepartmentIds.length > 0
  };
}

function applyThreadFilters(items, query = {}, userId) {
  const search = String(query.search || '').trim().toLowerCase();
  const unreadOnly = String(query.unreadOnly || 'false') === 'true';
  const priority = query.priority ? String(query.priority).toUpperCase() : null;
  const senderId = query.senderId ? String(query.senderId) : null;
  const departmentId = query.departmentId ? String(query.departmentId) : null;
  const dateFrom = safeDate(query.dateFrom);
  const dateTo = safeDate(query.dateTo);

  return items.filter((item) => {
    if (unreadOnly && item.unreadCount < 1) return false;
    if (priority && item.lastMessage?.priority !== priority) return false;
    if (senderId && item.lastMessage?.senderId !== senderId) return false;
    if (departmentId && !item.participants.some((participant) => participant.user?.departmentId === departmentId)) return false;

    if (dateFrom || dateTo) {
      const messageDate = safeDate(item.lastMessage?.createdAt);
      if (!messageDate) return false;
      if (dateFrom && messageDate < dateFrom) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (messageDate > end) return false;
      }
    }

    if (!search) return true;
    const subject = String(item.subject || '').toLowerCase();
    const preview = String(item.lastMessage?.preview || '').toLowerCase();
    const sender = String(item.lastMessage?.sender?.fullName || '').toLowerCase();
    const recipients = extractThreadParticipantNames(item.participants.filter((participant) => participant.userId !== userId));
    return [subject, preview, sender, recipients].some((value) => value.includes(search));
  });
}

function paginateItems(items, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  return paginated(items.slice(skip, skip + limit), items.length, page, limit);
}

function mapThreadSummary(conversation, userId) {
  const participant = conversation.participants.find((entry) => entry.userId === userId);
  const lastReadAt = participant?.lastReadAt || new Date(0);
  const lastMessage = conversation.messages[0] || null;
  const unreadCount = conversation.messages.filter(
    (message) => message.senderId !== userId && message.createdAt > lastReadAt
  ).length;

  return {
    id: conversation.id,
    subject: conversation.subject || '(No subject)',
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
    unreadCount,
    messageCount: conversation.messages.length,
    participants: conversation.participants.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      lastReadAt: entry.lastReadAt,
      user: entry.user
        ? {
            id: entry.user.id,
            fullName: entry.user.fullName,
            email: entry.user.email,
            departmentId: entry.user.departmentId
          }
        : null
    })),
    lastMessage: lastMessage ? toMailPreviewMessage(lastMessage) : null
  };
}

function resolveMessageReadState(messageDate, participant, senderId) {
  if (participant.userId === senderId) {
    return { isRead: true, readAt: messageDate };
  }
  const readAt = participant.lastReadAt || null;
  if (!readAt) {
    return { isRead: false, readAt: null };
  }
  return { isRead: new Date(readAt) >= new Date(messageDate), readAt };
}

const communicationService = {
  canMessageDepartment(auth, departmentId) {
    if (!departmentId) return false;
    if (accessControlService.isGeneralManager(auth) || accessControlService.isHr(auth)) return true;
    return auth.departmentIds?.includes(departmentId);
  },

  canMessageUser(auth, targetUser) {
    if (!targetUser || !targetUser.isActive || targetUser.deletedAt) return false;
    if (targetUser.id === auth.userId) return false;

    const roleName = normalizeRoleName(targetUser.role?.name);
    if (accessControlService.isGeneralManager(auth) || accessControlService.isHr(auth)) return true;

    if (accessControlService.isDepartmentHead(auth)) {
      return Boolean(targetUser.departmentId && auth.departmentIds?.includes(targetUser.departmentId));
    }

    if (accessControlService.isFinance(auth)) {
      return roleName === ROLES.FINANCE_ACCOUNTS_MANAGER || Boolean(targetUser.departmentId && auth.departmentIds?.includes(targetUser.departmentId));
    }

    if (accessControlService.isSalesCompliance(auth)) {
      return roleName === ROLES.SALES_COMPLIANCE_OFFICER || Boolean(targetUser.departmentId && auth.departmentIds?.includes(targetUser.departmentId));
    }

    if (accessControlService.isOperations(auth)) {
      return roleName === ROLES.OPERATIONS_PROCUREMENT_OFFICER || Boolean(targetUser.departmentId && auth.departmentIds?.includes(targetUser.departmentId));
    }

    return Boolean(targetUser.departmentId && auth.departmentIds?.includes(targetUser.departmentId));
  },

  async getRecipientUsers(auth, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where = {
      deletedAt: null,
      isActive: true,
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } }
            ]
          }
        : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {})
    };

    const users = await prisma.user.findMany({
      where,
      include: { role: true },
      orderBy: { fullName: 'asc' }
    });

    const filtered = users.filter((user) => this.canMessageUser(auth, user));
    return paginated(
      filtered.slice(skip, skip + limit).map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        roleName: normalizeRoleName(user.role?.name),
        roleDisplayName: user.role?.displayName,
        departmentId: user.departmentId
      })),
      filtered.length,
      page,
      limit
    );
  },

  async getRecipientDepartments(auth, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where = {
      deletedAt: null,
      status: 'ACTIVE',
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {})
    };
    const departments = await prisma.department.findMany({
      where,
      orderBy: { name: 'asc' }
    });

    const filtered = departments.filter((department) => this.canMessageDepartment(auth, department.id));
    return paginated(
      filtered.slice(skip, skip + limit).map((department) => ({
        id: department.id,
        name: department.name,
        slug: department.slug
      })),
      filtered.length,
      page,
      limit
    );
  },

  async resolveRecipients(auth, senderId, { toUserIds = [], toDepartmentIds = [] }) {
    const userIds = toIdArray(toUserIds);
    const departmentIds = toIdArray(toDepartmentIds);

    if (!userIds.length && !departmentIds.length) {
      throw new AppError('At least one recipient is required', 400);
    }

    const usersById = new Map();
    if (userIds.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds }, deletedAt: null, isActive: true },
        include: { role: true }
      });
      users.forEach((user) => usersById.set(user.id, user));
      const invalidUserId = userIds.find((userId) => !usersById.has(userId));
      if (invalidUserId) throw new AppError('Some recipients were not found or inactive', 422);
    }

    let departmentRecipientUsers = [];
    if (departmentIds.length) {
      const departments = await prisma.department.findMany({
        where: { id: { in: departmentIds }, deletedAt: null, status: 'ACTIVE' }
      });
      if (departments.length !== departmentIds.length) throw new AppError('Some departments are not available', 422);

      departments.forEach((department) => {
        if (!this.canMessageDepartment(auth, department.id)) {
          throw new AppError(`You do not have permission to message ${department.name}`, 403);
        }
      });

      departmentRecipientUsers = await prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          OR: [
            { departmentId: { in: departmentIds } },
            { departmentMemberships: { some: { departmentId: { in: departmentIds } } } }
          ]
        },
        include: { role: true }
      });
      departmentRecipientUsers.forEach((user) => usersById.set(user.id, user));
    }

    const recipients = Array.from(usersById.values()).filter((user) => this.canMessageUser(auth, user));
    const deniedDirectRecipients = userIds.filter((userId) => !recipients.some((user) => user.id === userId));
    if (deniedDirectRecipients.length) {
      throw new AppError('You do not have permission to message one or more selected recipients', 403);
    }

    const recipientIds = [...new Set(recipients.map((user) => user.id).filter((id) => id !== senderId))];
    if (!recipientIds.length) {
      throw new AppError('No allowed recipients were found for this message', 403);
    }

    return {
      recipientIds,
      recipients,
      departmentIds
    };
  },

  async deliverMessageEmails({ sender, recipients, subject, body, priority, threadId }) {
    const loginUrl = `${env.frontendAppUrl}/messages`;
    const failedRecipients = [];
    let sentCount = 0;

    for (const recipient of recipients) {
      if (!recipient.email) {
        failedRecipients.push({
          userId: recipient.id,
          email: null,
          reason: 'Recipient has no email address'
        });
        continue;
      }

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#0f172a">
          <p>Hello ${recipient.fullName || 'there'},</p>
          <p>You received a new internal message in AptusOS.</p>
          <p><strong>Sender</strong>: ${sender.fullName}</p>
          <p><strong>Subject</strong>: ${subject}</p>
          <p><strong>Priority</strong>: ${priority}</p>
          <p style="white-space:pre-line">${String(body || '').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>
          <p><a href="${loginUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 14px;border-radius:8px;text-decoration:none">Open in AptusOS</a></p>
          <p style="margin-top:24px;font-size:12px;color:#64748b">This message was sent from AptusOS internal communication center.</p>
        </div>
      `;

      const text = [
        `Sender: ${sender.fullName}`,
        `Subject: ${subject}`,
        `Priority: ${priority}`,
        '',
        body,
        '',
        `Open in AptusOS: ${loginUrl}`,
        'This message was sent from AptusOS internal communication center.'
      ].join('\n');

      const result = await emailService.sendEmail({
        to: recipient.email,
        subject: `[AptusOS] ${subject}`,
        html,
        text
      });

      if (result.sent) {
        sentCount += 1;
      } else {
        failedRecipients.push({
          userId: recipient.id,
          email: recipient.email,
          reason: result.error || 'Email delivery failed'
        });
      }
    }

    return {
      sentCount,
      failedCount: failedRecipients.length,
      failedRecipients,
      deliveryStatus: failedRecipients.length ? MAIL_DELIVERY_STATUS.EMAIL_FAILED : MAIL_DELIVERY_STATUS.EMAIL_SENT,
      threadId
    };
  },

  async upsertThreadParticipants(tx, threadId, participantIds = []) {
    if (!participantIds.length) return;
    await Promise.all(participantIds.map((userId) =>
      tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: threadId,
            userId
          }
        },
        update: {},
        create: {
          conversationId: threadId,
          userId
        }
      })));
  },

  async sendMail(auth, payload, files = [], req) {
    const toUserIds = toIdArray(payload.toUserIds);
    const toDepartmentIds = toIdArray(payload.toDepartmentIds);
    const subject = String(payload.subject || '').trim();
    const body = String(payload.body || '').trim();
    const priority = normalizePriority(payload.priority);
    const threadId = payload.threadId ? String(payload.threadId) : null;

    if (!subject) throw new AppError('Subject is required', 422);
    if (!body) throw new AppError('Message body is required', 422);

    let recipientIds = [];
    let recipients = [];
    let departmentIds = [...toDepartmentIds];

    if (!toUserIds.length && !toDepartmentIds.length && threadId) {
      const existingThread = await prisma.conversation.findFirst({
        where: {
          id: threadId,
          deletedAt: null,
          participants: { some: { userId: auth.userId } }
        },
        include: {
          participants: true
        }
      });
      if (!existingThread) throw new AppError('Thread not found', 404);

      recipientIds = existingThread.participants.map((entry) => entry.userId).filter((id) => id !== auth.userId);
      if (!recipientIds.length) throw new AppError('At least one recipient is required', 400);
      recipients = await prisma.user.findMany({
        where: {
          id: { in: recipientIds },
          deletedAt: null,
          isActive: true
        },
        include: { role: true }
      });
    } else {
      const resolved = await this.resolveRecipients(auth, auth.userId, {
        toUserIds,
        toDepartmentIds
      });
      recipientIds = resolved.recipientIds;
      recipients = resolved.recipients;
      departmentIds = resolved.departmentIds;
    }

    const uploadedAttachments = files?.length ? await uploadService.uploadMultipleFiles(files, 'messages/attachments') : [];
    const inlineAttachments = toAttachmentList(payload.attachments);
    const attachmentList = [...inlineAttachments, ...uploadedAttachments];

    const sender = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, fullName: true, email: true }
    });
    const resolvedRecipientIds = recipientIds.filter((id) => id !== auth.userId);
    const recipientNames = recipients
      .filter((recipient) => recipient.id !== auth.userId)
      .map((recipient) => recipient.fullName)
      .filter(Boolean);
    const hasAttachments = attachmentList.length > 0;

    const created = await prisma.$transaction(async (tx) => {
      let thread = null;
      if (threadId) {
        const participant = await tx.conversationParticipant.findFirst({
          where: { conversationId: threadId, userId: auth.userId }
        });
        if (!participant) throw new AppError('Thread not found', 404);
        thread = await tx.conversation.update({
          where: { id: threadId },
          data: { subject, updatedAt: new Date() }
        });
      } else {
        thread = await tx.conversation.create({
          data: {
            subject,
            participants: {
              create: [...new Set([auth.userId, ...recipientIds])].map((userId) => ({ userId }))
            }
          }
        });
      }

      await this.upsertThreadParticipants(tx, thread.id, recipientIds);

      const message = await tx.message.create({
        data: {
          conversationId: thread.id,
          senderId: auth.userId,
          body,
          attachments: buildMessageEnvelope({
            files: attachmentList,
            priority,
            deliveryStatus: MAIL_DELIVERY_STATUS.INTERNAL_STORED,
            toDepartmentIds: departmentIds
          })
        },
        include: {
          sender: {
            select: { id: true, fullName: true, email: true }
          }
        }
      });

      await tx.conversation.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      await tx.conversationParticipant.updateMany({
        where: { conversationId: thread.id, userId: auth.userId },
        data: { lastReadAt: message.createdAt }
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.MESSAGE_SENT,
        entityType: 'MailThread',
        entityId: thread.id,
        newValues: {
          subject,
          priority,
          toUserIds: resolvedRecipientIds,
          toDepartmentIds: departmentIds,
          recipientNames,
          senderName: sender?.fullName || null,
          hasAttachments
        },
        req
      }, tx);

      return { thread, message };
    });

    await notificationService.createMany(recipientIds, {
      type: 'DIRECT_MESSAGE',
      title: subject,
      body: body.slice(0, 240),
      entityType: 'MailThread',
      entityId: created.thread.id
    });

    const emailSummary = await this.deliverMessageEmails({
      sender,
      recipients: recipients.filter((recipient) => recipient.id !== auth.userId),
      subject,
      body,
      priority,
      threadId: created.thread.id
    });

    const persistedDeliveryStatus = emailSummary.failedCount
      ? MAIL_DELIVERY_STATUS.EMAIL_FAILED
      : MAIL_DELIVERY_STATUS.EMAIL_SENT;

    const updatedMessage = await prisma.message.update({
      where: { id: created.message.id },
      data: {
        attachments: buildMessageEnvelope({
          files: attachmentList,
          priority,
          deliveryStatus: persistedDeliveryStatus,
          toDepartmentIds: departmentIds,
          email: {
            sentCount: emailSummary.sentCount,
            failedCount: emailSummary.failedCount,
            failedRecipients: emailSummary.failedRecipients
          }
        })
      },
      include: {
        sender: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: emailSummary.failedCount ? AUDIT_ACTIONS.MESSAGE_EMAIL_FAILED : AUDIT_ACTIONS.MESSAGE_EMAIL_DELIVERED,
      entityType: 'MailMessage',
      entityId: updatedMessage.id,
      newValues: {
        ...emailSummary,
        subject,
        toUserIds: resolvedRecipientIds,
        recipientNames,
        senderName: sender?.fullName || null,
        hasAttachments,
        deliveryStatus: persistedDeliveryStatus
      },
      req
    });

    return {
      threadId: created.thread.id,
      message: toMailPreviewMessage(updatedMessage),
      deliveryStatus: persistedDeliveryStatus,
      internalStored: true,
      email: emailSummary
    };
  },

  async listInbox(auth, query = {}) {
    const conversations = await prisma.conversation.findMany({
      where: {
        deletedAt: null,
        participants: { some: { userId: auth.userId } },
        messages: {
          some: {
            deletedAt: null,
            senderId: { not: auth.userId }
          }
        }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                departmentId: true
              }
            }
          }
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: {
            sender: {
              select: { id: true, fullName: true, email: true }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const threadItems = conversations
      .filter((conversation) => conversation.messages.length > 0)
      .map((conversation) => mapThreadSummary(conversation, auth.userId));
    const filtered = applyThreadFilters(threadItems, query, auth.userId);
    return paginateItems(filtered, query);
  },

  async listSent(auth, query = {}) {
    const conversations = await prisma.conversation.findMany({
      where: {
        deletedAt: null,
        participants: { some: { userId: auth.userId } },
        messages: { some: { senderId: auth.userId, deletedAt: null } }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                departmentId: true
              }
            }
          }
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: {
            sender: {
              select: { id: true, fullName: true, email: true }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const threadItems = conversations
      .filter((conversation) => conversation.messages.length > 0)
      .map((conversation) => ({
        ...mapThreadSummary(conversation, auth.userId),
        sentCount: conversation.messages.filter((message) => message.senderId === auth.userId).length
      }));
    const filtered = applyThreadFilters(threadItems, query, auth.userId);
    return paginateItems(filtered, query);
  },

  async getThread(auth, threadId) {
    const thread = await prisma.conversation.findFirst({
      where: {
        id: threadId,
        deletedAt: null,
        participants: { some: { userId: auth.userId } }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                departmentId: true
              }
            }
          }
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: {
                id: true,
                fullName: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!thread) throw new AppError('Thread not found', 404);
    const summary = mapThreadSummary(
      {
        ...thread,
        messages: [...thread.messages].reverse()
      },
      auth.userId
    );

    return {
      id: thread.id,
      subject: thread.subject || '(No subject)',
      updatedAt: thread.updatedAt,
      createdAt: thread.createdAt,
      participants: thread.participants.map((participant) => ({
        id: participant.userId,
        fullName: participant.user?.fullName || 'AptusOS User',
        email: participant.user?.email || null,
        departmentId: participant.user?.departmentId || null,
        lastReadAt: participant.lastReadAt
      })),
      unreadCount: summary.unreadCount,
      messages: thread.messages.map((message) => {
        const envelope = readMessageEnvelope(message.attachments);
        return {
          id: message.id,
          threadId: thread.id,
          body: message.body,
          createdAt: message.createdAt,
          senderId: message.senderId,
          sender: message.sender
            ? {
                id: message.sender.id,
                fullName: message.sender.fullName,
                email: message.sender.email || null
              }
            : null,
          priority: normalizePriority(envelope.meta.priority),
          deliveryStatus: envelope.meta.deliveryStatus || MAIL_DELIVERY_STATUS.INTERNAL_STORED,
          attachments: envelope.files,
          recipientContext: {
            toDepartmentIds: Array.isArray(envelope.meta.toDepartmentIds) ? envelope.meta.toDepartmentIds : []
          },
          readStates: thread.participants.map((participant) => {
            const readState = resolveMessageReadState(message.createdAt, participant, message.senderId);
            return {
              userId: participant.userId,
              fullName: participant.user?.fullName || 'AptusOS User',
              isRead: readState.isRead,
              readAt: readState.readAt
            };
          })
        };
      })
    };
  },

  async markMessageRead(auth, messageId, req) {
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        conversation: {
          participants: { some: { userId: auth.userId } }
        }
      },
      include: {
        conversation: true
      }
    });
    if (!message) throw new AppError('Message not found', 404);

    const readAt = new Date();
    await prisma.$transaction([
      prisma.conversationParticipant.updateMany({
        where: { conversationId: message.conversationId, userId: auth.userId },
        data: { lastReadAt: readAt }
      }),
      ...(message.senderId === auth.userId || message.seenAt
        ? []
        : [prisma.message.update({ where: { id: message.id }, data: { seenAt: readAt } })])
    ]);

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.MESSAGE_READ,
      entityType: 'MailMessage',
      entityId: message.id,
      newValues: { readAt },
      req
    });

    return { messageId: message.id, readAt };
  },

  async markThreadRead(auth, threadId, req) {
    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId: threadId, userId: auth.userId }
    });
    if (!participant) throw new AppError('Thread not found', 404);

    const readAt = new Date();
    await prisma.$transaction([
      prisma.conversationParticipant.update({
        where: { id: participant.id },
        data: { lastReadAt: readAt }
      }),
      prisma.message.updateMany({
        where: {
          conversationId: threadId,
          senderId: { not: auth.userId },
          seenAt: null
        },
        data: { seenAt: readAt }
      })
    ]);

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.MESSAGE_READ,
      entityType: 'MailThread',
      entityId: threadId,
      newValues: { readAt },
      req
    });

    return { threadId, readAt };
  },

  async listConversations(userId, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where = { participants: { some: { userId } }, deletedAt: null };
    const [items, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where,
        include: {
          participants: { include: { user: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 }
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.conversation.count({ where })
    ]);
    return paginated(items.map((conversation) => {
      const participant = conversation.participants.find((item) => item.userId === userId);
      const lastReadAt = participant?.lastReadAt || new Date(0);
      return {
        ...conversation,
        unreadCount: conversation.messages[0]?.createdAt > lastReadAt && conversation.messages[0]?.senderId !== userId ? 1 : 0
      };
    }), total, page, limit);
  },

  async createOrGetDirectConversation(senderId, recipientId) {
    if (senderId === recipientId) throw new AppError('You cannot create a direct conversation with yourself', 400);
    const existing = await prisma.conversation.findFirst({
      where: {
        deletedAt: null,
        participants: {
          every: { userId: { in: [senderId, recipientId] } }
        }
      },
      include: { participants: true }
    });
    if (existing && existing.participants.length === 2) return existing;
    return prisma.conversation.create({
      data: {
        participants: {
          create: [{ userId: senderId }, { userId: recipientId }]
        }
      },
      include: { participants: true }
    });
  },

  async getConversationMessages(userId, conversationId, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const participant = await prisma.conversationParticipant.findFirst({ where: { conversationId, userId } });
    if (!participant) throw new AppError('Conversation not found', 404);
    const [messages, total] = await prisma.$transaction([
      prisma.message.findMany({ where: { conversationId, deletedAt: null }, include: { sender: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.message.count({ where: { conversationId, deletedAt: null } })
    ]);
    return paginated(messages, total, page, limit);
  },

  async sendDirectMessage(senderId, { recipientIds = [], conversationId, body, attachments }, req) {
    const uniqueParticipants = [...new Set([senderId, ...recipientIds])];
    if (!conversationId && uniqueParticipants.length < 2) throw new AppError('At least one recipient is required', 400);
    const result = await prisma.$transaction(async (tx) => {
      let conversation;
      if (conversationId) {
        const participant = await tx.conversationParticipant.findFirst({ where: { conversationId, userId: senderId } });
        if (!participant) throw new AppError('Conversation not found', 404);
        conversation = await tx.conversation.findUnique({ where: { id: conversationId } });
      } else if (uniqueParticipants.length === 2) {
        conversation = await this.createOrGetDirectConversation(senderId, uniqueParticipants.find((id) => id !== senderId));
      } else {
        conversation = await tx.conversation.create({ data: { participants: { create: uniqueParticipants.map((userId) => ({ userId })) } } });
      }
      if (!conversation) throw new AppError('Conversation not found', 404);
      const message = await tx.message.create({ data: { conversationId: conversation.id, senderId, body, attachments } });
      await tx.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      await auditService.log({ actorId: senderId, action: AUDIT_ACTIONS.MESSAGE_SENT, entityType: 'Conversation', entityId: conversation.id, newValues: { body }, req }, tx);
      return { conversation, message };
    });

    const participantRows = await prisma.conversationParticipant.findMany({ where: { conversationId: result.conversation.id, userId: { not: senderId } } });
    await notificationService.createMany(participantRows.map((row) => row.userId), { type: 'DIRECT_MESSAGE', title: 'New direct message', body, entityType: 'Conversation', entityId: result.conversation.id });
    return result;
  },

  async markConversationRead(userId, conversationId) {
    const participant = await prisma.conversationParticipant.findFirst({ where: { conversationId, userId } });
    if (!participant) throw new AppError('Conversation not found', 404);
    await prisma.$transaction([
      prisma.conversationParticipant.update({ where: { id: participant.id }, data: { lastReadAt: new Date() } }),
      prisma.message.updateMany({ where: { conversationId, senderId: { not: userId }, seenAt: null }, data: { seenAt: new Date() } })
    ]);
    return true;
  },

  async unreadCount(userId) {
    const conversations = await prisma.conversationParticipant.findMany({
      where: {
        userId,
        conversation: { deletedAt: null }
      },
      select: {
        lastReadAt: true,
        conversation: {
          select: {
            messages: {
              where: {
                deletedAt: null,
                senderId: { not: userId }
              },
              select: { createdAt: true }
            }
          }
        }
      }
    });
    return conversations.reduce((total, item) => {
      const unreadInConversation = item.conversation.messages.filter(
        (message) => !item.lastReadAt || message.createdAt > item.lastReadAt
      ).length;
      return total + unreadInConversation;
    }, 0);
  },

  async mailCounts(userId) {
    const [inbox, sent, unread] = await Promise.all([
      prisma.message.count({
        where: {
          deletedAt: null,
          senderId: { not: userId },
          conversation: {
            deletedAt: null,
            participants: { some: { userId } }
          }
        }
      }),
      prisma.message.count({
        where: {
          deletedAt: null,
          senderId: userId,
          conversation: {
            deletedAt: null,
            participants: { some: { userId } }
          }
        }
      }),
      this.unreadCount(userId)
    ]);

    return { inbox, sent, unread };
  },

  async listChannels(auth, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where = accessControlService.isGeneralManager(auth)
      ? { deletedAt: null }
      : { OR: [{ isCompany: true }, { members: { some: { userId: auth.userId } } }, { departmentId: { in: auth.departmentIds } }], deletedAt: null };
    const [items, total] = await prisma.$transaction([
      prisma.channel.findMany({ where, include: { department: true, _count: { select: { messages: true, members: true } } }, skip, take: limit, orderBy: { name: 'asc' } }),
      prisma.channel.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async getChannelMessages(auth, channelId, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const channel = await prisma.channel.findFirst({ where: { id: channelId, deletedAt: null } });
    if (!channel) throw new AppError('Channel not found', 404);
    accessControlService.assertChannelAccess(auth, channel);
    const [items, total] = await prisma.$transaction([
      prisma.channelMessage.findMany({ where: { channelId, deletedAt: null }, include: { sender: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.channelMessage.count({ where: { channelId, deletedAt: null } })
    ]);
    return paginated(items, total, page, limit);
  },

  async sendChannelMessage(auth, channelId, { body, attachments, mentions }, req) {
    const channel = await prisma.channel.findFirst({ where: { id: channelId, deletedAt: null }, include: { members: true } });
    if (!channel) throw new AppError('Channel not found', 404);
    accessControlService.assertChannelAccess(auth, channel);
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.channelMessage.create({ data: { channelId, senderId: auth.userId, body, attachments, mentions } });
      await tx.channelMember.upsert({
        where: { channelId_userId: { channelId, userId: auth.userId } },
        update: { lastReadAt: new Date() },
        create: { channelId, userId: auth.userId, lastReadAt: new Date() }
      });
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.MESSAGE_SENT, entityType: 'Channel', entityId: channelId, newValues: { body }, req }, tx);
      return created;
    });
    await notificationService.createMany(
      channel.members.filter((member) => member.userId !== auth.userId).map((member) => member.userId),
      { type: 'DEPARTMENT_MESSAGE', title: `New message in ${channel.name}`, body, entityType: 'Channel', entityId: channelId }
    );
    if (Array.isArray(mentions)) {
      await notificationService.createMany(mentions, { type: 'MENTION', title: `You were mentioned in ${channel.name}`, body, entityType: 'ChannelMessage', entityId: message.id });
    }
    return message;
  },

  async markChannelRead(auth, channelId) {
    const channel = await prisma.channel.findFirst({ where: { id: channelId, deletedAt: null } });
    if (!channel) throw new AppError('Channel not found', 404);
    accessControlService.assertChannelAccess(auth, channel);
    await prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId: auth.userId } },
      update: { lastReadAt: new Date() },
      create: { channelId, userId: auth.userId, lastReadAt: new Date() }
    });
    return true;
  },

  async pinChannelMessage(auth, messageId) {
    const message = await prisma.channelMessage.findUnique({ where: { id: messageId }, include: { channel: true } });
    if (!message) throw new AppError('Message not found', 404);
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isDepartmentHead(auth)) {
      throw new AppError('Only General Manager or Department Head can pin channel messages', 403);
    }
    if (message.channel.departmentId) accessControlService.assertDepartmentAccess(auth, message.channel.departmentId);
    return prisma.channelMessage.update({ where: { id: messageId }, data: { pinnedAt: new Date() } });
  },

  async publishAnnouncement(auth, data, req) {
    if (data.departmentId) accessControlService.assertDepartmentAccess(auth, data.departmentId);
    const announcement = await prisma.announcement.create({ data: { ...data, publishedById: auth.userId } });
    const users = await prisma.user.findMany({ where: { deletedAt: null, isActive: true, ...(data.departmentId ? { departmentId: data.departmentId } : {}) }, select: { id: true } });
    await notificationService.createMany(users.map((user) => user.id), { type: 'ANNOUNCEMENT_PUBLISHED', title: data.title, body: data.body, entityType: 'Announcement', entityId: announcement.id });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED, entityType: 'Announcement', entityId: announcement.id, newValues: announcement, req });
    return announcement;
  },

  async listAnnouncements(auth, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where = {
      deletedAt: null,
      AND: [
        { OR: [{ departmentId: null }, { departmentId: { in: auth.departmentIds } }] },
        ...(query.unreadOnly === 'true' ? [{ reads: { none: { userId: auth.userId } } }] : []),
        ...(query.activeOnly === 'true' ? [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] : [])
      ]
    };
    const [items, total] = await prisma.$transaction([
      prisma.announcement.findMany({ where, include: { reads: { where: { userId: auth.userId } }, publishedBy: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.announcement.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async markAnnouncementRead(auth, announcementId) {
    const announcement = await prisma.announcement.findFirst({
      where: { id: announcementId, deletedAt: null, OR: [{ departmentId: null }, { departmentId: { in: auth.departmentIds } }] }
    });
    if (!announcement) throw new AppError('Announcement not found', 404);
    return prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId, userId: auth.userId } },
      update: { readAt: new Date() },
      create: { announcementId, userId: auth.userId, readAt: new Date() }
    });
  },

  async addComment(actorId, data, req) {
    return workflowSupportService.createComment({ authorId: actorId, ...data }, req);
  }
};

module.exports = communicationService;
