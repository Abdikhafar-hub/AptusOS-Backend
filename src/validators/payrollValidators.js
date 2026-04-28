const { z } = require('zod');

const cycleBody = z.object({
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2000).max(3000),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  currency: z.string().min(3).optional(),
  notes: z.string().optional()
});

module.exports = {
  cycleCreate: z.object({ body: cycleBody }),
  cycleRun: z.object({ body: cycleBody }),
  recordListQuery: z.object({
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional(),
      cycleId: z.string().optional(),
      status: z.enum(['DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'FLAGGED']).optional(),
      employeeId: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      search: z.string().optional()
    }).optional()
  }),
  cycleListQuery: z.object({
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional(),
      periodMonth: z.coerce.number().int().min(1).max(12).optional(),
      periodYear: z.coerce.number().int().min(2000).max(3000).optional(),
      status: z.enum(['DRAFT', 'PROCESSING', 'PENDING_APPROVAL', 'APPROVED', 'PAID']).optional()
    }).optional()
  }),
  summaryQuery: z.object({
    query: z.object({
      cycleId: z.string().optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
      year: z.coerce.number().int().min(2000).max(3000).optional()
    }).optional()
  })
};
