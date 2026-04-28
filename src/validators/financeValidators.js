const { z } = require('zod');

const budgetLineItem = z.object({
  category: z.string().trim().min(1),
  description: z.string().trim().optional(),
  allocatedAmount: z.coerce.number().positive()
});

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
      name: z.string().trim().optional(),
      budgetType: z.enum(['ANNUAL', 'QUARTERLY', 'MONTHLY', 'PROJECT_BASED']).optional(),
      budgetCategory: z.enum(['OPERATIONAL', 'CAPEX', 'PAYROLL', 'MARKETING', 'IT', 'OTHER']).optional(),
      year: z.number().int().min(2000).max(3000),
      month: z.number().int().min(1).max(12).optional(),
      periodStartDate: z.coerce.date().optional(),
      periodEndDate: z.coerce.date().optional(),
      amount: z.coerce.number().min(0),
      currency: z.string().min(3).optional(),
      lineItems: z.array(budgetLineItem).optional(),
      approvalStatus: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED']).optional(),
      budgetOwnerId: z.string().optional(),
      approverId: z.string().optional(),
      allowOverspending: z.boolean().optional(),
      overspendingLimitType: z.enum(['PERCENT', 'AMOUNT']).optional(),
      overspendingLimitValue: z.coerce.number().optional(),
      alertThresholds: z.array(z.coerce.number().int().min(1).max(100)).optional(),
      allowDuplicatePeriod: z.boolean().optional(),
      costCenter: z.string().trim().optional(),
      projectCode: z.string().trim().optional(),
      notes: z.string().trim().optional(),
      supportingDocumentId: z.string().optional()
    }).superRefine((value, ctx) => {
      const status = value.approvalStatus || 'DRAFT';
      const isDraft = status === 'DRAFT';

      if (value.periodStartDate && value.periodEndDate && value.periodStartDate >= value.periodEndDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodStartDate'], message: 'Start date must be before end date' });
      }

      if (value.allowOverspending) {
        if (!value.overspendingLimitType) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['overspendingLimitType'], message: 'Overspending limit type is required' });
        }
        if (value.overspendingLimitValue === undefined || value.overspendingLimitValue <= 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['overspendingLimitValue'], message: 'Overspending limit must be greater than zero' });
        }
      }

      if (isDraft) return;

      if (!value.name?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Budget name is required' });
      }

      if (!value.periodStartDate || !value.periodEndDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodStartDate'], message: 'Budget period is required' });
      }

      const lines = value.lineItems || [];
      if (lines.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lineItems'], message: 'At least 1 budget line is required' });
      }

      const lineTotal = lines.reduce((sum, line) => sum + Number(line.allocatedAmount || 0), 0);
      if (Math.abs(Number(value.amount || 0) - lineTotal) > 0.01) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'Total must match sum of line items' });
      }
      if (lineTotal <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lineItems'], message: 'Line item total must be greater than zero' });
      }
    })
  })
};
