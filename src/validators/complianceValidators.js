const { z } = require('zod');

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']);
const optionalString = z.string().trim().optional();
const optionalNonNegativeNumber = z.coerce.number().min(0).optional();
const optionalNonNegativeInteger = z.coerce.number().int().min(0).optional();
const optionalDate = z.coerce.date().optional();

const salesReportBodySchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  reportingOfficer: optionalString,
  territoryRegion: optionalString,
  department: optionalString,
  pharmaciesVisited: optionalNonNegativeInteger,
  hospitalsVisited: optionalNonNegativeInteger,
  clinicsVisited: optionalNonNegativeInteger,
  distributorsVisited: optionalNonNegativeInteger,
  wholesalersVisited: optionalNonNegativeInteger,
  newProspectsIdentified: optionalNonNegativeInteger,
  followUpsCompleted: optionalNonNegativeInteger,
  keyAccountsCovered: optionalNonNegativeInteger,
  totalOrdersDiscussed: optionalNonNegativeInteger,
  estimatedSalesValue: optionalNonNegativeNumber,
  currency: z.string().trim().max(8).optional(),
  conversionNotes: optionalString,
  lostOpportunities: optionalNonNegativeInteger,
  reasonForLostOpportunities: optionalString,
  highDemandProducts: optionalString,
  slowMovingProducts: optionalString,
  requestedProductsNotAvailable: optionalString,
  customerProductFeedback: optionalString,
  productQualityComplaints: optionalString,
  customersWithExpiredLicenses: optionalNonNegativeInteger,
  customersMissingDocuments: optionalNonNegativeInteger,
  suspiciousOrHighRiskCustomers: optionalNonNegativeInteger,
  complianceConcerns: optionalString,
  recommendedComplianceActions: optionalString,
  competitorActivity: optionalString,
  priceFeedback: optionalString,
  demandTrends: optionalString,
  marketChallenges: optionalString,
  newMarketOpportunities: optionalString,
  delayedDeliveriesReported: optionalNonNegativeInteger,
  stockAvailabilityIssues: optionalNonNegativeInteger,
  productReturnsReported: optionalNonNegativeInteger,
  damagedGoodsComplaints: optionalNonNegativeInteger,
  urgentCustomerNeeds: optionalString,
  summary: optionalString,
  keyActivities: optionalString,
  clientVisitsSummary: optionalString,
  opportunities: optionalString,
  challenges: optionalString,
  followUpActions: optionalString,
  responsiblePerson: optionalString,
  dueDate: optionalDate,
  priority: priorityEnum.optional(),
  documentId: z.string().optional(),
  attachmentDocumentIds: z.array(z.string()).optional(),
  body: z.string().optional()
}).refine((data) => data.periodEnd >= data.periodStart, {
  message: 'periodEnd cannot be before periodStart',
  path: ['periodEnd']
});

const salesReportUpdateBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  periodStart: optionalDate,
  periodEnd: optionalDate,
  reportingOfficer: optionalString,
  territoryRegion: optionalString,
  department: optionalString,
  pharmaciesVisited: optionalNonNegativeInteger,
  hospitalsVisited: optionalNonNegativeInteger,
  clinicsVisited: optionalNonNegativeInteger,
  distributorsVisited: optionalNonNegativeInteger,
  wholesalersVisited: optionalNonNegativeInteger,
  newProspectsIdentified: optionalNonNegativeInteger,
  followUpsCompleted: optionalNonNegativeInteger,
  keyAccountsCovered: optionalNonNegativeInteger,
  totalOrdersDiscussed: optionalNonNegativeInteger,
  estimatedSalesValue: optionalNonNegativeNumber,
  currency: z.string().trim().max(8).optional(),
  conversionNotes: optionalString,
  lostOpportunities: optionalNonNegativeInteger,
  reasonForLostOpportunities: optionalString,
  highDemandProducts: optionalString,
  slowMovingProducts: optionalString,
  requestedProductsNotAvailable: optionalString,
  customerProductFeedback: optionalString,
  productQualityComplaints: optionalString,
  customersWithExpiredLicenses: optionalNonNegativeInteger,
  customersMissingDocuments: optionalNonNegativeInteger,
  suspiciousOrHighRiskCustomers: optionalNonNegativeInteger,
  complianceConcerns: optionalString,
  recommendedComplianceActions: optionalString,
  competitorActivity: optionalString,
  priceFeedback: optionalString,
  demandTrends: optionalString,
  marketChallenges: optionalString,
  newMarketOpportunities: optionalString,
  delayedDeliveriesReported: optionalNonNegativeInteger,
  stockAvailabilityIssues: optionalNonNegativeInteger,
  productReturnsReported: optionalNonNegativeInteger,
  damagedGoodsComplaints: optionalNonNegativeInteger,
  urgentCustomerNeeds: optionalString,
  summary: optionalString,
  keyActivities: optionalString,
  clientVisitsSummary: optionalString,
  opportunities: optionalString,
  challenges: optionalString,
  followUpActions: optionalString,
  responsiblePerson: optionalString,
  dueDate: optionalDate,
  priority: priorityEnum.optional(),
  documentId: z.string().optional(),
  attachmentDocumentIds: z.array(z.string()).optional(),
  body: z.string().optional()
}).superRefine((data, ctx) => {
  if (data.periodStart && data.periodEnd && data.periodEnd < data.periodStart) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['periodEnd'],
      message: 'periodEnd cannot be before periodStart'
    });
  }
});

module.exports = {
  salesReport: z.object({
    body: salesReportBodySchema
  }),
  salesReportUpdate: z.object({
    body: salesReportUpdateBodySchema
  }),
  clientVisit: z.object({
    body: z.object({
      clientName: z.string().min(2),
      visitDate: z.coerce.date(),
      notes: z.string().min(3),
      followUpAt: z.coerce.date().optional(),
      purpose: z.string().optional(),
      outcome: z.string().optional(),
      nextAction: z.string().optional(),
      nextFollowUpDate: z.coerce.date().optional(),
      customerId: z.string().optional(),
      territoryId: z.string().optional(),
      routeStopId: z.string().optional(),
      attachments: z.any().optional(),
      geoLocation: z.string().optional(),
      visitType: z.enum(['SALES', 'FOLLOW_UP', 'COMPLIANCE_CHECK', 'COMPLAINT', 'COLLECTION', 'RELATIONSHIP']).optional()
    })
  }),
  clientVisitUpdate: z.object({
    body: z.object({
      clientName: z.string().min(2).optional(),
      visitDate: z.coerce.date().optional(),
      notes: z.string().min(3).optional(),
      followUpAt: z.coerce.date().optional(),
      purpose: z.string().optional(),
      outcome: z.string().optional(),
      nextAction: z.string().optional(),
      nextFollowUpDate: z.coerce.date().optional(),
      customerId: z.string().optional(),
      territoryId: z.string().optional(),
      routeStopId: z.string().optional(),
      attachments: z.any().optional(),
      geoLocation: z.string().optional(),
      visitType: z.enum(['SALES', 'FOLLOW_UP', 'COMPLIANCE_CHECK', 'COMPLAINT', 'COLLECTION', 'RELATIONSHIP']).optional()
    })
  }),
  complaint: z.object({
    body: z.object({
      title: z.string().min(3),
      description: z.string().min(3),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']).optional(),
      ownerId: z.string().optional(),
      documentId: z.string().optional()
    })
  }),
  complaintUpdate: z.object({
    body: z.object({
      title: z.string().min(3).optional(),
      description: z.string().min(3).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']).optional(),
      ownerId: z.string().optional(),
      documentId: z.string().optional()
    })
  }),
  complaintStatus: z.object({ body: z.object({ status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED']), resolutionNotes: z.string().optional() }) }),
  complianceItem: z.object({
    body: z.object({
      title: z.string().min(3),
      type: z.enum(['LICENSE', 'IMPORT_PERMIT', 'SOP', 'POLICY', 'AUDIT_CHECKLIST', 'RISK', 'INCIDENT', 'REGULATORY_DOCUMENT', 'OTHER']),
      description: z.string().optional(),
      ownerId: z.string().optional(),
      departmentId: z.string().optional(),
      dueDate: z.coerce.date().optional(),
      expiryDate: z.coerce.date().optional(),
      documentId: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']).optional()
    })
  }),
  complianceStatus: z.object({ body: z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'ARCHIVED']) }) }),
  risk: z.object({
    body: z.object({
      title: z.string().min(3),
      description: z.string().optional(),
      likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      impact: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      mitigationPlan: z.string().optional(),
      ownerId: z.string().optional()
    })
  }),
  riskUpdate: z.object({
    body: z.object({
      title: z.string().min(3).optional(),
      description: z.string().optional(),
      likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      impact: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      mitigationPlan: z.string().optional(),
      ownerId: z.string().optional(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'ARCHIVED', 'CLOSED']).optional()
    })
  }),
  incident: z.object({
    body: z.object({
      title: z.string().min(3),
      description: z.string().min(3),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']),
      documentId: z.string().optional()
    })
  }),
  incidentStatus: z.object({ body: z.object({ status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED']), resolutionNotes: z.string().optional() }) }),
  policyAssign: z.object({ body: z.object({ policyDocumentId: z.string().min(1), userId: z.string().min(1) }) })
};
