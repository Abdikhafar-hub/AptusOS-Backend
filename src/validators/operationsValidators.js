const { z } = require('zod');

module.exports = {
  requisition: z.object({
    body: z.object({
      departmentId: z.string().optional(),
      title: z.string().min(3),
      description: z.string().optional(),
      estimatedAmount: z.coerce.number().positive().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']).optional(),
      documents: z.array(z.string()).optional(),
      status: z.enum(['DRAFT', 'SUBMITTED']).optional()
    })
  }),
  requisitionReview: z.object({ body: z.object({ decision: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_MORE_INFO', 'FULFILLED', 'CANCELLED']), comment: z.string().optional() }) }),
  requisitionAttachments: z.object({
    body: z.object({
      documentIds: z.array(z.string()).min(1)
    })
  }),
  vendorDocument: z.object({
    body: z.object({
      vendorName: z.string().min(2),
      documentType: z.string().min(2),
      documentId: z.string().min(1),
      expiryDate: z.coerce.date().optional(),
      notes: z.string().optional()
    })
  })
};
