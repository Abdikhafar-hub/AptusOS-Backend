const { z } = require('zod');

const requisitionAttachmentType = z.enum([
  'SUPPLIER_QUOTATION',
  'SPECIFICATION_DOCUMENT',
  'APPROVAL_MEMO',
  'PREVIOUS_INVOICE_RECEIPT',
  'EMERGENCY_JUSTIFICATION',
  'OTHER'
]);

const requisitionLineItem = z.object({
  itemName: z.string().min(1),
  specification: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitOfMeasure: z.string().min(1),
  estimatedUnitCost: z.coerce.number().positive(),
  estimatedTotalCost: z.coerce.number().positive().optional(),
  preferredBrandModel: z.string().optional(),
  requiredByDate: z.coerce.date(),
  budgetCode: z.string().optional(),
  costCenter: z.string().optional()
});

const requisitionAttachment = z.object({
  attachmentType: requisitionAttachmentType,
  documentId: z.string().min(1),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  fileSize: z.coerce.number().int().nonnegative().optional()
});

module.exports = {
  requisition: z.object({
    body: z.object({
      departmentId: z.string().min(1),
      title: z.string().min(3),
      description: z.string().optional(),
      requestCategory: z.enum(['GOODS', 'SERVICES', 'MAINTENANCE', 'IT_EQUIPMENT', 'OFFICE_SUPPLIES', 'MEDICAL_CLINICAL_SUPPLIES', 'LOGISTICS', 'EMERGENCY_PROCUREMENT', 'OTHER']),
      requestType: z.enum(['NEW_PURCHASE', 'REPLACEMENT', 'REPAIR', 'RENEWAL', 'SERVICE_CONTRACT']),
      businessJustification: z.string().min(1),
      requiredByDate: z.coerce.date(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']).optional(),
      urgencyReason: z.string().optional(),
      emergencyJustification: z.string().optional(),
      lineItems: z.array(requisitionLineItem).min(1),
      subtotal: z.coerce.number().nonnegative().optional(),
      taxApplicable: z.boolean().optional(),
      taxRate: z.coerce.number().nonnegative().optional(),
      taxAmount: z.coerce.number().nonnegative().optional(),
      grandTotal: z.coerce.number().positive(),
      preferredSupplier: z.string().optional(),
      supplierContact: z.string().optional(),
      supplierQuoteReference: z.string().optional(),
      requireMultipleQuotes: z.boolean().optional(),
      quotesRequired: z.coerce.number().int().min(2).optional(),
      budgetLine: z.string().optional(),
      costCenter: z.string().optional(),
      fundingSource: z.enum(['DEPARTMENT_BUDGET', 'PROJECT_BUDGET', 'EMERGENCY_FUND', 'OTHER']),
      expenditureType: z.enum(['CAPEX', 'OPEX']),
      currency: z.string().min(3).max(3),
      budgetOverrideRequested: z.boolean().optional(),
      budgetOverrideReason: z.string().optional(),
      approvalRoute: z.enum(['AUTO', 'MANUAL']).optional(),
      manualApproverIds: z.array(z.string()).optional(),
      complianceChecks: z.object({
        businessPurposeConfirmed: z.boolean(),
        pricesAreEstimatesConfirmed: z.boolean(),
        nonDuplicateConfirmed: z.boolean(),
        emergencyJustificationConfirmed: z.boolean().optional()
      }),
      attachments: z.array(requisitionAttachment).optional(),
      documents: z.array(z.string()).optional(),
      status: z.enum(['DRAFT', 'SUBMITTED']).optional()
    }).superRefine((body, ctx) => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (body.requiredByDate < now) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requiredByDate'], message: 'Required by date cannot be in the past' });
      }
      if (['HIGH', 'CRITICAL'].includes(String(body.priority || '')) && !String(body.urgencyReason || '').trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['urgencyReason'], message: 'Urgency reason is required for high or critical priority' });
      }
      if (body.requestCategory === 'EMERGENCY_PROCUREMENT' && !String(body.emergencyJustification || '').trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['emergencyJustification'], message: 'Emergency justification is required for emergency procurement' });
      }
      if (body.requestCategory === 'EMERGENCY_PROCUREMENT' && body.complianceChecks?.emergencyJustificationConfirmed !== true) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['complianceChecks', 'emergencyJustificationConfirmed'], message: 'Emergency justification confirmation is required' });
      }
      const computedSubtotal = (body.lineItems || []).reduce((sum, item) => sum + Number(item.quantity) * Number(item.estimatedUnitCost), 0);
      const computedTaxAmount = body.taxApplicable
        ? Number(body.taxAmount ?? (computedSubtotal * Number(body.taxRate || 0)) / 100)
        : 0;
      const computedGrandTotal = computedSubtotal + computedTaxAmount;
      if (Math.abs(computedGrandTotal - Number(body.grandTotal || 0)) > 0.01) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['grandTotal'], message: 'Grand total must equal line item subtotal plus tax' });
      }
      (body.lineItems || []).forEach((item, index) => {
        const lineRequiredByDate = new Date(item.requiredByDate);
        lineRequiredByDate.setHours(0, 0, 0, 0);
        if (lineRequiredByDate < now) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lineItems', index, 'requiredByDate'], message: 'Required by date cannot be in the past' });
        }
      });
      if (body.requireMultipleQuotes) {
        const hasQuoteUpload = (body.attachments || []).some((attachment) => attachment.attachmentType === 'SUPPLIER_QUOTATION');
        const hasQuoteReference = Boolean(String(body.supplierQuoteReference || '').trim());
        if (!hasQuoteUpload && !hasQuoteReference) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachments'], message: 'Quote upload or supplier quote reference is required when multiple quotes are required' });
        }
      }
      if (body.approvalRoute === 'MANUAL' && !(body.manualApproverIds || []).length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['manualApproverIds'], message: 'At least one manual approver is required' });
      }
      if (body.budgetOverrideRequested && !String(body.budgetOverrideReason || '').trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['budgetOverrideReason'], message: 'Budget override reason is required when override is requested' });
      }
      if (!body.complianceChecks?.businessPurposeConfirmed || !body.complianceChecks?.pricesAreEstimatesConfirmed || !body.complianceChecks?.nonDuplicateConfirmed) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['complianceChecks'], message: 'All mandatory compliance confirmations are required' });
      }
    })
  }),
  requisitionReview: z.object({ body: z.object({ decision: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_MORE_INFO', 'FULFILLED', 'CANCELLED']), comment: z.string().optional() }) }),
  requisitionAttachments: z.object({
    body: z.object({
      documentIds: z.array(z.string()).min(1)
    })
  }),
  requisitionBudgetAvailability: z.object({
    query: z.object({
      departmentId: z.string().min(1),
      costCenter: z.string().optional(),
      amount: z.coerce.number().nonnegative().optional(),
      currency: z.string().min(3).max(3).optional()
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
