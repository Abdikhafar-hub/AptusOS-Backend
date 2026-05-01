const { z } = require('zod');

const departmentStatuses = ['ACTIVE', 'ARCHIVED'];
const optionalShortText = z.string().trim().max(120).optional();
const optionalLongText = z.string().trim().max(2000).optional();
const optionalDepartmentCode = z.string().trim().max(24).optional();
const optionalPhone = z.string().trim().max(32).optional();
const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().email().optional()
);

const mailListQuery = z.object({
  query: z.object({
    search: z.string().optional(),
    unreadOnly: z.string().optional(),
    priority: z.string().optional(),
    senderId: z.string().optional(),
    departmentId: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
  }).passthrough()
});

module.exports = {
  departmentCreate: z.object({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      code: optionalDepartmentCode,
      description: optionalLongText,
      businessUnit: optionalShortText,
      costCenter: optionalShortText,
      location: optionalShortText,
      contactEmail: optionalEmail,
      contactPhone: optionalPhone,
      mission: optionalLongText,
      operatingNotes: optionalLongText,
      headId: z.string().optional(),
      status: z.enum(departmentStatuses).optional()
    })
  }),
  departmentUpdate: z.object({
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      code: optionalDepartmentCode,
      description: optionalLongText,
      businessUnit: optionalShortText,
      costCenter: optionalShortText,
      location: optionalShortText,
      contactEmail: optionalEmail,
      contactPhone: optionalPhone,
      mission: optionalLongText,
      operatingNotes: optionalLongText,
      headId: z.string().optional(),
      status: z.enum(departmentStatuses).optional()
    })
  }),
  addStaff: z.object({ body: z.object({ userId: z.string().min(1) }) }),
  transferStaff: z.object({ body: z.object({ userId: z.string().min(1), toDepartmentId: z.string().min(1) }) }),
  documentUpload: z.object({ body: z.object({ title: z.string().min(1), description: z.string().optional(), category: z.string().min(1), documentType: z.string().optional(), ownerType: z.string().min(1), ownerId: z.string().optional(), departmentId: z.string().optional(), visibility: z.string().optional(), status: z.string().optional(), expiryDate: z.coerce.date().optional(), reminderDate: z.coerce.date().optional(), folder: z.string().optional() }).passthrough() }),
  approvalCreate: z.object({ body: z.object({ requestType: z.string().min(1), entityType: z.string().min(1), entityId: z.string().min(1), requestedById: z.string().optional(), currentApproverId: z.string().optional(), priority: z.string().optional(), reason: z.string().optional(), steps: z.array(z.record(z.any())).optional() }) }),
  comment: z.object({ body: z.object({ entityType: z.string().min(1), entityId: z.string().min(1), body: z.string().min(1), attachments: z.any().optional(), mentions: z.array(z.string()).optional() }) }),
  message: z.object({ body: z.object({ conversationId: z.string().optional(), recipientIds: z.array(z.string()).optional(), body: z.string().min(1), attachments: z.any().optional() }) }),
  mailMessageParam: z.object({ params: z.object({ messageId: z.string().min(1) }) }),
  mailThreadParam: z.object({ params: z.object({ threadId: z.string().min(1) }) }),
  mailRecipientQuery: z.object({
    query: z.object({
      search: z.string().optional(),
      departmentId: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional()
    }).passthrough()
  }),
  mailListQuery,
  channelMessage: z.object({ body: z.object({ body: z.string().min(1), attachments: z.any().optional(), mentions: z.array(z.string()).optional() }) }),
  announcement: z.object({ body: z.object({ title: z.string().min(1), body: z.string().min(1), priority: z.string().optional(), departmentId: z.string().optional(), expiresAt: z.coerce.date().optional(), emailNotification: z.boolean().optional() }) })
};
