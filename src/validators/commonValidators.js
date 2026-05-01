const { z } = require('zod');

const idParam = z.object({ params: z.object({ id: z.string().min(1) }) });
const fileIdParam = z.object({ params: z.object({ fileId: z.string().min(1) }) });
const userIdParam = z.object({ params: z.object({ id: z.string().min(1), userId: z.string().min(1) }) });
const channelMessageParam = z.object({ params: z.object({ id: z.string().min(1), messageId: z.string().min(1) }) });
const itemParam = z.object({ params: z.object({ id: z.string().min(1), itemId: z.string().min(1) }) });
const participantParam = z.object({ params: z.object({ id: z.string().min(1), participantId: z.string().min(1) }) });

const listQuery = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    status: z.string().optional(),
    departmentId: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
  }).passthrough()
});

const anyBody = z.object({ body: z.record(z.any()) }).passthrough();

module.exports = { idParam, fileIdParam, userIdParam, channelMessageParam, itemParam, participantParam, listQuery, anyBody };
