const { z } = require('zod');

module.exports = {
  create: z.object({
    body: z.object({
      employeeId: z.string().min(1),
      reviewerId: z.string().min(1),
      cycleName: z.string().min(3),
      periodStart: z.coerce.date(),
      periodEnd: z.coerce.date(),
      initialStatus: z.enum(['NOT_STARTED', 'SELF_REVIEW_PENDING', 'MANAGER_REVIEW_PENDING', 'COMPLETED']).optional(),
      goals: z.any().optional(),
      recommendation: z.string().optional(),
      supportingDocs: z.any().optional()
    }).superRefine((values, ctx) => {
      if (values.periodEnd <= values.periodStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['periodEnd'],
          message: 'Period end must be after period start'
        });
      }
    })
  }),
  selfReview: z.object({ body: z.object({ selfReview: z.any(), goals: z.any().optional() }) }),
  managerReview: z.object({ body: z.object({ managerReview: z.any(), score: z.coerce.number().min(0).max(100).optional(), recommendation: z.string().optional() }) }),
  hrReview: z.object({ body: z.object({ rating: z.string().min(1), recommendation: z.string().optional(), score: z.coerce.number().min(0).max(100).optional() }) }),
  supportingDocumentUpload: z.object({
    body: z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      visibility: z.enum(['COMPANY_INTERNAL', 'DEPARTMENT_ONLY', 'PRIVATE', 'RESTRICTED']).optional()
    }).passthrough()
  }),
  comment: z.object({
    body: z.object({
      body: z.string().min(1),
      mentions: z.array(z.string()).optional(),
      attachments: z.any().optional()
    })
  })
};
