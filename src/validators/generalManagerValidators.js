const { z } = require('zod');

const reportTypes = [
  'financeReport',
  'complianceReport',
  'procurementReport',
  'HRreport',
  'performanceReport',
  'approvalPressureReport',
  'escalationTrendReport'
];

const contractTypes = [
  'CUSTOMER',
  'VENDOR',
  'SUPPLIER',
  'EMPLOYMENT',
  'PROCUREMENT',
  'SERVICE',
  'SERVICE_AGREEMENT',
  'LEASE',
  'NDA',
  'MOU',
  'PARTNERSHIP',
  'OTHER'
];

const contractStatuses = [
  'DRAFT',
  'UNDER_REVIEW',
  'PENDING_APPROVAL',
  'ACTIVE',
  'EXPIRED',
  'TERMINATED',
  'RENEWED',
  'RENEWAL_DUE'
];

const contractFileRef = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  size: z.coerce.number().optional(),
  type: z.string().optional(),
  uploadedAt: z.string().optional()
}).passthrough();

const contractMetadataSchema = z.object({
  contractBasics: z.object({
    category: z.string().trim().optional(),
    internalResponsiblePersonId: z.string().trim().optional(),
    ownerId: z.string().trim().optional(),
    departmentId: z.string().trim().optional(),
    status: z.enum(contractStatuses).optional()
  }).partial().optional(),
  counterparty: z.object({
    type: z.enum(['INDIVIDUAL', 'COMPANY', 'GOVERNMENT', 'VENDOR', 'CUSTOMER']).optional(),
    contactPerson: z.string().trim().optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().optional(),
    address: z.string().trim().optional(),
    taxPinNumber: z.string().trim().optional()
  }).partial().optional(),
  datesAndRenewal: z.object({
    effectiveDate: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    renewalType: z.enum(['NO_RENEWAL', 'MANUAL_RENEWAL', 'AUTO_RENEWAL']).optional(),
    renewalNoticeDays: z.coerce.number().int().min(1).max(3650).optional(),
    terminationNoticeDays: z.coerce.number().int().min(0).max(3650).optional(),
    reminderDate: z.string().optional()
  }).partial().optional(),
  financialTerms: z.object({
    contractValue: z.coerce.number().min(0).optional(),
    currency: z.string().trim().optional(),
    paymentTerms: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'MILESTONE_BASED']).optional(),
    billingFrequency: z.string().trim().optional(),
    depositAmount: z.coerce.number().min(0).optional(),
    taxVatApplicable: z.boolean().optional(),
    penaltyTerms: z.string().trim().optional()
  }).partial().optional(),
  scopeAndObligations: z.object({
    scopeOfWork: z.string().trim().optional(),
    deliverables: z.string().trim().optional(),
    internalObligations: z.string().trim().optional(),
    counterpartyObligations: z.string().trim().optional(),
    slaNotes: z.string().trim().optional()
  }).partial().optional(),
  riskCompliance: z.object({
    riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    legalReviewRequired: z.boolean().optional(),
    financeReviewRequired: z.boolean().optional(),
    complianceReviewRequired: z.boolean().optional(),
    dataProtectionClauseIncluded: z.boolean().optional(),
    confidentialityClauseIncluded: z.boolean().optional()
  }).partial().optional(),
  documents: z.object({
    contractDocument: contractFileRef.optional(),
    supportingDocuments: z.array(contractFileRef).optional(),
    signedCopy: contractFileRef.optional()
  }).partial().optional(),
  approvalWorkflow: z.object({
    submissionMode: z.enum(['SAVE_DRAFT', 'SUBMIT_FOR_REVIEW', 'SUBMIT_FOR_APPROVAL']).optional(),
    approverId: z.string().trim().optional(),
    legalReviewerId: z.string().trim().optional(),
    financeReviewerId: z.string().trim().optional(),
    approvalNotes: z.string().trim().optional(),
    submittedAt: z.string().optional()
  }).partial().optional()
}).passthrough();

const validateContractBody = (data, ctx, { partial = false } = {}) => {
  const metadata = data.metadata || {};
  const metadataDates = metadata.datesAndRenewal || {};
  const resolvedStart = data.startDate || metadataDates.startDate;
  const resolvedEnd = data.endDate || metadataDates.endDate;
  const startDate = resolvedStart ? new Date(resolvedStart) : null;
  const endDate = resolvedEnd ? new Date(resolvedEnd) : null;

  if (resolvedStart && Number.isNaN(startDate?.getTime?.())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'startDate must be a valid date' });
  }
  if (resolvedEnd && Number.isNaN(endDate?.getTime?.())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'endDate must be a valid date' });
  }
  if (startDate && endDate && startDate >= endDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Start date must be before end date' });
  }

  const status = data.status || metadata.contractBasics?.status;
  const documents = metadata.documents || {};
  const hasUploadedDocuments = Boolean(
    documents.contractDocument
      || documents.signedCopy
      || (Array.isArray(documents.supportingDocuments) && documents.supportingDocuments.length)
  );

  if (status === 'ACTIVE' && hasUploadedDocuments) {
    const signedCopy = documents.signedCopy;
    if (!signedCopy || (!signedCopy.id && !signedCopy.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata', 'documents', 'signedCopy'],
        message: 'Active status requires a signed copy document when documents are attached'
      });
    }
  }

  const riskLevel = metadata.riskCompliance?.riskLevel;
  const legalReviewRequired = metadata.riskCompliance?.legalReviewRequired;
  if ((riskLevel === 'HIGH' || riskLevel === 'CRITICAL') && legalReviewRequired !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['metadata', 'riskCompliance', 'legalReviewRequired'],
      message: 'High-risk contracts require legal review'
    });
  }

  const renewalType = metadataDates.renewalType;
  const renewalNoticeDays = metadataDates.renewalNoticeDays;
  if (renewalType === 'AUTO_RENEWAL' && !(Number(renewalNoticeDays) > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['metadata', 'datesAndRenewal', 'renewalNoticeDays'],
      message: 'Auto-renewal requires renewal notice days'
    });
  }

  if (!partial && (data.amount !== undefined) && Number(data.amount) < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'Contract value must be greater than or equal to 0' });
  }
};

const listQuery = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    status: z.string().optional(),
    severity: z.string().optional(),
    type: z.string().optional(),
    departmentId: z.string().optional(),
    relatedEntityType: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional()
  }).passthrough()
});

const resolveEscalation = z.object({
  body: z.object({
    action: z.enum(['RESOLVE', 'ACKNOWLEDGE']).optional(),
    resolutionNotes: z.string().trim().optional()
  }).passthrough()
});

const runReport = z.object({
  body: z.object({
    reportType: z.enum(reportTypes),
    filters: z.record(z.any()).optional()
  })
});

const updateSettings = z.object({
  body: z.object({
    settings: z.array(z.object({
      key: z.string().min(1),
      value: z.any(),
      description: z.string().optional()
    })).optional()
  }).passthrough()
});

const contractBodySchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(contractTypes),
  status: z.enum(contractStatuses).optional(),
  category: z.string().trim().optional(),
  counterpartyName: z.string().trim().min(2),
  amount: z.coerce.number().min(0).optional(),
  currency: z.string().trim().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  renewalReminderDays: z.coerce.number().int().min(1).max(3650).optional(),
  ownerId: z.string().trim().optional(),
  departmentId: z.string().trim().optional(),
  documentId: z.string().trim().optional(),
  notes: z.string().optional(),
  metadata: contractMetadataSchema.optional()
}).passthrough();

const contractCreate = z.object({
  body: contractBodySchema.superRefine((data, ctx) => validateContractBody(data, ctx, { partial: false }))
});

const contractUpdate = z.object({
  body: contractBodySchema.partial().passthrough().superRefine((data, ctx) => validateContractBody(data, ctx, { partial: true }))
});

const delegationScopeModules = [
  'TASKS',
  'APPROVALS',
  'FINANCE_APPROVALS',
  'HR_ACTIONS',
  'PROCUREMENT_APPROVALS',
  'REPORTS_ACCESS',
  'CONTRACTS',
  'FULL_ACCESS',
  'ALL'
];

const delegationStatuses = [
  'DRAFT',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'ACTIVE',
  'EXPIRED',
  'REVOKED'
];

const validateDelegationPayload = (data, ctx, { partial = false } = {}) => {
  const now = new Date();

  const startAt = data.startAt ? new Date(data.startAt) : null;
  const endAt = data.endAt ? new Date(data.endAt) : null;

  if (data.startAt && Number.isNaN(startAt?.getTime?.())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startAt'], message: 'startAt must be a valid date-time' });
  }
  if (data.endAt && Number.isNaN(endAt?.getTime?.())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be a valid date-time' });
  }
  if (startAt && endAt && startAt >= endAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startAt'], message: 'Delegation startAt must be before endAt' });
  }

  if (!partial && startAt && startAt < now && data.immediateActivation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startAt'], message: 'Cannot create delegation in the past unless immediate activation is enabled' });
  }

  if (!partial && (!Array.isArray(data.modules) || data.modules.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modules'], message: 'At least one delegation permission is required' });
  }

  if (!partial && !data.justification?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['justification'], message: 'Detailed justification is required' });
  }

  if (!partial && !data.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Delegation reason is required' });
  }

  if (data.approvalRequired && !data.approverId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['approverId'], message: 'Approver is required when approval is enabled' });
  }

  if (data.maxApprovalAmount !== undefined && Number(data.maxApprovalAmount) < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxApprovalAmount'], message: 'Maximum approval limit must be greater than or equal to 0' });
  }
};

const delegationCreate = z.object({
  body: z.object({
    delegateUserId: z.string().min(1),
    modules: z.array(z.enum(delegationScopeModules)).min(1),
    restrictedModules: z.array(z.string().min(1)).optional(),
    restrictedDepartmentId: z.string().optional(),
    maxApprovalAmount: z.coerce.number().min(0).optional(),
    allowFinancialApprovals: z.boolean().optional(),
    allowContractApprovals: z.boolean().optional(),
    immediateActivation: z.boolean().optional(),
    autoExpire: z.boolean().optional(),
    reason: z.enum(['LEAVE', 'TRAVEL', 'SICK', 'TEMPORARY_REASSIGNMENT', 'OTHER']),
    justification: z.string().trim().min(5),
    approvalRequired: z.boolean().optional(),
    approverId: z.string().optional(),
    status: z.enum(delegationStatuses).optional(),
    metadata: z.record(z.any()).optional(),
    startAt: z.string().min(1),
    endAt: z.string().min(1),
    notes: z.string().optional()
  }).passthrough().superRefine((data, ctx) => validateDelegationPayload(data, ctx, { partial: false }))
});

const delegationUpdate = z.object({
  body: z.object({
    delegateUserId: z.string().optional(),
    modules: z.array(z.enum(delegationScopeModules)).optional(),
    restrictedModules: z.array(z.string().min(1)).optional(),
    restrictedDepartmentId: z.string().optional(),
    maxApprovalAmount: z.coerce.number().min(0).optional(),
    allowFinancialApprovals: z.boolean().optional(),
    allowContractApprovals: z.boolean().optional(),
    immediateActivation: z.boolean().optional(),
    autoExpire: z.boolean().optional(),
    reason: z.enum(['LEAVE', 'TRAVEL', 'SICK', 'TEMPORARY_REASSIGNMENT', 'OTHER']).optional(),
    justification: z.string().trim().min(5).optional(),
    approvalRequired: z.boolean().optional(),
    approverId: z.string().optional(),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    status: z.enum(delegationStatuses).optional(),
    revokedReason: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    notes: z.string().optional(),
    approvedAt: z.string().optional()
  }).passthrough().superRefine((data, ctx) => validateDelegationPayload(data, ctx, { partial: true }))
});

module.exports = {
  listQuery,
  resolveEscalation,
  runReport,
  updateSettings,
  contractCreate,
  contractUpdate,
  delegationCreate,
  delegationUpdate
};
