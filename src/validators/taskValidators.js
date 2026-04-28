const { z } = require('zod');

const baseTask = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  assignedToId: z.string().optional(),
  departmentId: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']).optional(),
  dueDate: z.coerce.date().optional(),
  requiresApproval: z.boolean().optional(),
  recurringRule: z.any().optional(),
  parentTaskId: z.string().optional(),
  customerId: z.string().optional(),
  opportunityId: z.string().optional(),
  issueId: z.string().optional(),
  visitId: z.string().optional(),
  attachmentDocumentIds: z.array(z.string()).optional(),
  mentions: z.array(z.string()).optional()
});

module.exports = {
  create: z.object({ body: baseTask }),
  update: z.object({ body: baseTask.partial() }),
  status: z.object({ body: z.object({ status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']), comment: z.string().optional() }) }),
  attachments: z.object({ body: z.object({ documentIds: z.array(z.string()).min(1) }) })
};
