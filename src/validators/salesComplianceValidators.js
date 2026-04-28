const { z } = require('zod');

const optionalDate = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.date().optional());
const optionalString = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().optional());
const optionalNumber = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().min(0).optional());
const optionalInt = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().int().min(0).optional());

const customerPayload = z.object({
  businessName: z.string().min(2).optional(),
  businessType: z.enum(['PHARMACY', 'HOSPITAL', 'CLINIC', 'DISTRIBUTOR', 'WHOLESALER', 'CORPORATE', 'OTHER']).optional(),
  registrationNumber: optionalString,
  kraPin: optionalString,
  taxComplianceCertificateNumber: optionalString,
  taxComplianceExpiryDate: optionalDate,
  licenseNumber: optionalString,
  licenseExpiryDate: optionalDate,
  ppbLicenseNumber: optionalString,
  ppbLicenseExpiryDate: optionalDate,
  businessPermitNumber: optionalString,
  businessPermitExpiryDate: optionalDate,
  contactPersonName: optionalString,
  contactPersonRole: optionalString,
  contactEmail: z.string().email().optional(),
  contactPhone: optionalString,
  alternatePhone: optionalString,
  superintendentPharmacistName: optionalString,
  superintendentPharmacistRegistrationNumber: optionalString,
  pharmacistPhone: optionalString,
  pharmacistEmail: z.string().email().optional(),
  county: optionalString,
  town: optionalString,
  physicalAddress: optionalString,
  buildingName: optionalString,
  street: optionalString,
  gpsLocation: optionalString,
  deliveryAddress: optionalString,
  territoryId: optionalString,
  complianceRiskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  dueDiligenceStatus: z.enum(['PENDING', 'PASSED', 'FAILED', 'NEEDS_REVIEW']).optional(),
  inspectionRequired: z.boolean().optional(),
  blacklistStatus: z.enum(['CLEAR', 'WATCHLISTED', 'BLOCKED']).optional(),
  accountStatus: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL']).optional(),
  complianceNotes: optionalString,
  customerCategory: z.enum(['RETAIL', 'WHOLESALE', 'INSTITUTION', 'CORPORATE']).optional(),
  accountTier: z.enum(['A', 'B', 'C', 'D']).optional(),
  isKeyAccount: z.boolean().optional(),
  accountOwnerId: optionalString,
  paymentTerms: z.enum(['CASH', 'CREDIT', 'MIXED']).optional(),
  creditLimit: optionalNumber,
  creditDays: optionalInt,
  outstandingBalance: optionalNumber,
  paymentDelayFlag: z.boolean().optional(),
  blockedForCredit: z.boolean().optional(),
  preferredDeliverySchedule: optionalString,
  preferredOrderChannel: optionalString,
  lastVisitDate: optionalDate,
  nextFollowUpDate: optionalDate,
  customerHealthStatus: z.enum(['GOOD', 'WATCH', 'AT_RISK', 'BLOCKED']).optional(),
  notes: optionalString
}).passthrough();

const territoryPayload = z.object({
  name: z.string().min(2),
  region: optionalString,
  county: optionalString,
  towns: z.array(z.string().min(1)).default([]),
  assignedOfficerId: optionalString,
  description: optionalString,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional()
});

const territoryPatchPayload = territoryPayload.partial();

const routePayload = z.object({
  title: z.string().min(2),
  assignedOfficerId: z.string().min(1),
  territoryId: z.string().min(1),
  routeDate: z.coerce.date(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  notes: optionalString
});

const routePatchPayload = z.object({
  title: z.string().min(2).optional(),
  assignedOfficerId: z.string().min(1).optional(),
  territoryId: z.string().min(1).optional(),
  routeDate: optionalDate,
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  notes: optionalString
});

const routeStopPayload = z.object({
  customerId: z.string().min(1),
  plannedTime: optionalDate,
  visitOrder: z.coerce.number().int().min(1),
  status: z.enum(['PLANNED', 'VISITED', 'MISSED', 'CANCELLED']).optional(),
  visitId: optionalString,
  notes: optionalString
});

const routeStopPatchPayload = z.object({
  customerId: z.string().min(1).optional(),
  plannedTime: optionalDate,
  visitOrder: z.coerce.number().int().min(1).optional(),
  status: z.enum(['PLANNED', 'VISITED', 'MISSED', 'CANCELLED']).optional(),
  visitId: optionalString,
  notes: optionalString
});

const opportunityPayload = z.object({
  customerId: z.string().min(1),
  ownerId: z.string().min(1),
  title: z.string().min(2),
  description: optionalString,
  stage: z.enum(['PROSPECTING', 'QUALIFICATION', 'NEGOTIATION', 'EXPECTED_ORDER', 'WON', 'LOST']).optional(),
  expectedValue: optionalNumber,
  currency: z.string().trim().max(8).optional(),
  expectedOrderDate: optionalDate,
  competitorInvolved: z.boolean().optional(),
  competitorName: optionalString,
  lossReason: optionalString,
  probability: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(['OPEN', 'WON', 'LOST', 'CANCELLED']).optional()
});

const opportunityPatchPayload = opportunityPayload.partial();

const productFeedbackPayload = z.object({
  customerId: optionalString,
  submittedById: z.string().min(1).optional(),
  productName: z.string().min(1),
  productCategory: optionalString,
  feedbackType: z.enum(['DEMAND_SPIKE', 'QUALITY_COMPLAINT', 'SUBSTITUTION_REQUEST', 'PRICE_FEEDBACK', 'AVAILABILITY_ISSUE', 'OTHER']),
  description: z.string().min(3),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED']).optional(),
  relatedVisitId: optionalString
});

const productFeedbackPatchPayload = productFeedbackPayload.partial();

const customerIssuePayload = z.object({
  customerId: z.string().min(1),
  reportedById: z.string().min(1).optional(),
  assignedToId: optionalString,
  title: z.string().min(2),
  description: z.string().min(3),
  issueType: z.enum(['DELIVERY', 'PRODUCT', 'PRICING', 'COMPLIANCE', 'PAYMENT', 'RELATIONSHIP', 'OTHER']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'ESCALATED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  escalationDepartment: z.enum(['HR', 'FINANCE', 'OPERATIONS', 'COMPLIANCE', 'MANAGEMENT']).optional(),
  slaDueAt: optionalDate,
  resolvedAt: optionalDate,
  resolutionNotes: optionalString
});

const customerIssuePatchPayload = customerIssuePayload.partial();

const discountRequestPayload = z.object({
  customerId: z.string().min(1),
  requestedById: z.string().min(1).optional(),
  reason: z.string().min(3),
  standardPrice: z.coerce.number().min(0),
  requestedPrice: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100),
  estimatedValue: optionalNumber,
  currency: z.string().trim().max(8).optional(),
  approvalRequired: z.boolean().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED']).optional()
});

const discountRequestPatchPayload = discountRequestPayload.partial();

const customerAlertPatchPayload = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
  dueDate: optionalDate,
  description: optionalString,
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional()
});

const accountNotePayload = z.object({
  note: z.string().min(2),
  noteType: z.enum(['GENERAL', 'COMMERCIAL', 'COMPLIANCE', 'PAYMENT', 'RELATIONSHIP']).optional()
});

module.exports = {
  customerUpdate: z.object({ body: customerPayload }),
  territory: z.object({ body: territoryPayload }),
  territoryPatch: z.object({ body: territoryPatchPayload }),
  route: z.object({ body: routePayload }),
  routePatch: z.object({ body: routePatchPayload }),
  routeStop: z.object({ body: routeStopPayload }),
  routeStopPatch: z.object({ body: routeStopPatchPayload }),
  opportunity: z.object({ body: opportunityPayload }),
  opportunityPatch: z.object({ body: opportunityPatchPayload }),
  opportunityCloseLost: z.object({ body: z.object({ lossReason: z.string().min(2), competitorName: optionalString }) }),
  productFeedback: z.object({ body: productFeedbackPayload }),
  productFeedbackPatch: z.object({ body: productFeedbackPatchPayload }),
  productFeedbackResolve: z.object({ body: z.object({ resolutionNotes: optionalString }) }),
  customerIssue: z.object({ body: customerIssuePayload }),
  customerIssuePatch: z.object({ body: customerIssuePatchPayload }),
  customerIssueEscalate: z.object({ body: z.object({ escalationDepartment: z.enum(['HR', 'FINANCE', 'OPERATIONS', 'COMPLIANCE', 'MANAGEMENT']), assignedToId: optionalString, note: optionalString }) }),
  customerIssueResolve: z.object({ body: z.object({ resolutionNotes: z.string().min(2), resolvedAt: optionalDate }) }),
  customerIssueClose: z.object({ body: z.object({ resolutionNotes: optionalString }) }),
  discountRequest: z.object({ body: discountRequestPayload }),
  discountRequestPatch: z.object({ body: discountRequestPatchPayload }),
  discountRequestSubmit: z.object({ body: z.object({ note: optionalString }) }),
  customerAlertPatch: z.object({ body: customerAlertPatchPayload }),
  accountNote: z.object({ body: accountNotePayload }),
  completeRoute: z.object({ body: z.object({ notes: optionalString }) })
};
