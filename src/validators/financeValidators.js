const { z } = require('zod');

module.exports = {
  financeRequestCreate: z.object({
    body: z.object({
      type: z.enum(['EXPENSE_REIMBURSEMENT', 'PAYMENT_REQUEST', 'PETTY_CASH', 'TRAVEL_REQUEST', 'PROCUREMENT_PAYMENT', 'OTHER']),
      title: z.string().min(3),
      description: z.string().optional(),
      amount: z.coerce.number().positive(),
      currency: z.string().min(3).optional(),
      departmentId: z.string().optional(),
      receiptDocumentId: z.string().optional(),
      status: z.enum(['DRAFT', 'SUBMITTED']).optional()
    })
  }),
  financeRequestUpdate: z.object({
    body: z.object({
      title: z.string().min(3).optional(),
      description: z.string().optional(),
      amount: z.coerce.number().positive().optional(),
      currency: z.string().min(3).optional(),
      departmentId: z.string().optional(),
      receiptDocumentId: z.string().optional()
    })
  }),
  financeReview: z.object({
    body: z.object({
      decision: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED']),
      comment: z.string().min(1).optional()
    })
  }),
  financePay: z.object({
    body: z.object({
      paymentProofDocumentId: z.string().optional(),
      financeNotes: z.string().optional(),
      paidAt: z.coerce.date().optional()
    })
  }),
  paymentProofAttach: z.object({
    body: z.object({
      paymentProofDocumentId: z.string().min(1),
      financeNotes: z.string().optional(),
      paidAt: z.coerce.date().optional()
    })
  }),
  budget: z.object({
    body: z.object({
      departmentId: z.string().min(1),
      year: z.number().int().min(2000).max(3000),
      month: z.number().int().min(1).max(12).optional(),
      amount: z.coerce.number().positive(),
      currency: z.string().min(3).optional()
    })
  })
};
