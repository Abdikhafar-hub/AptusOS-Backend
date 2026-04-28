const { z } = require('zod');

const businessType = z.enum(['PHARMACY', 'HOSPITAL', 'CLINIC', 'DISTRIBUTOR', 'WHOLESALER', 'CORPORATE', 'OTHER']);
const complianceRiskLevel = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const dueDiligenceStatus = z.enum(['PENDING', 'PASSED', 'FAILED', 'NEEDS_REVIEW']);
const paymentTerms = z.enum(['CASH', 'CREDIT', 'MIXED']);
const customerCategory = z.enum(['RETAIL', 'WHOLESALE', 'INSTITUTION', 'CORPORATE']);
const blacklistStatus = z.enum(['CLEAR', 'WATCHLISTED', 'BLOCKED']);
const accountStatus = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL']);
const accountTier = z.enum(['A', 'B', 'C', 'D']);
const customerHealthStatus = z.enum(['GOOD', 'WATCH', 'AT_RISK', 'BLOCKED']);
const optionalEmail = z.string().email().or(z.literal('')).optional().transform((value) => (value ? value : undefined));
const optionalDate = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.date().optional());
const optionalNumber = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().min(0).optional());
const optionalInt = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().int().min(0).optional());
const optionalString = z.preprocess((value) => (value === null ? undefined : value), z.string().optional());

module.exports = {
  create: z.object({
    body: z.object({
      businessName: z.string().min(2),
      businessType,
      registrationNumber: z.string().optional(),
      kraPin: z.string().optional(),
      taxComplianceCertificateNumber: z.string().optional(),
      taxComplianceExpiryDate: optionalDate,
      licenseNumber: z.string().optional(),
      licenseExpiryDate: optionalDate,
      ppbLicenseNumber: z.string().optional(),
      ppbLicenseExpiryDate: optionalDate,
      businessPermitNumber: z.string().optional(),
      businessPermitExpiryDate: optionalDate,
      contactPersonName: z.string().optional(),
      contactPersonRole: z.string().optional(),
      contactEmail: optionalEmail,
      contactPhone: z.string().optional(),
      alternatePhone: z.string().optional(),
      superintendentPharmacistName: z.string().optional(),
      superintendentPharmacistRegistrationNumber: z.string().optional(),
      pharmacistPhone: z.string().optional(),
      pharmacistEmail: optionalEmail,
      county: z.string().optional(),
      town: z.string().optional(),
      physicalAddress: z.string().optional(),
      buildingName: z.string().optional(),
      street: z.string().optional(),
      gpsLocation: z.string().optional(),
      deliveryAddress: z.string().optional(),
      location: z.string().optional(),
      address: z.string().optional(),
      complianceRiskLevel: complianceRiskLevel.optional(),
      dueDiligenceStatus: dueDiligenceStatus.optional(),
      inspectionRequired: z.boolean().optional(),
      blacklistStatus: blacklistStatus.optional(),
      accountStatus: accountStatus.optional(),
      complianceNotes: z.string().optional(),
      paymentTerms: paymentTerms.optional(),
      creditLimit: optionalNumber,
      creditDays: optionalInt,
      outstandingBalance: optionalNumber,
      paymentDelayFlag: z.boolean().optional(),
      blockedForCredit: z.boolean().optional(),
      preferredDeliverySchedule: z.string().optional(),
      preferredOrderChannel: z.string().optional(),
      customerCategory: customerCategory.optional(),
      accountTier: accountTier.optional(),
      isKeyAccount: z.boolean().optional(),
      accountOwnerId: z.string().optional(),
      territoryId: z.string().optional(),
      lastVisitDate: optionalDate,
      nextFollowUpDate: optionalDate,
      customerHealthStatus: customerHealthStatus.optional(),
      purchaseAuthorizationRequired: z.boolean().optional(),
      assignedOfficerId: z.string().optional(),
      notes: z.string().optional()
    }).passthrough()
  }),
  update: z.object({
    body: z.object({
      businessName: z.string().min(2).optional(),
      businessType: businessType.optional(),
      registrationNumber: z.string().optional(),
      kraPin: z.string().optional(),
      taxComplianceCertificateNumber: z.string().optional(),
      taxComplianceExpiryDate: optionalDate,
      licenseNumber: z.string().optional(),
      licenseExpiryDate: optionalDate,
      ppbLicenseNumber: z.string().optional(),
      ppbLicenseExpiryDate: optionalDate,
      businessPermitNumber: z.string().optional(),
      businessPermitExpiryDate: optionalDate,
      contactPersonName: z.string().optional(),
      contactPersonRole: z.string().optional(),
      contactEmail: optionalEmail,
      contactPhone: z.string().optional(),
      alternatePhone: z.string().optional(),
      superintendentPharmacistName: z.string().optional(),
      superintendentPharmacistRegistrationNumber: z.string().optional(),
      pharmacistPhone: z.string().optional(),
      pharmacistEmail: optionalEmail,
      county: z.string().optional(),
      town: z.string().optional(),
      physicalAddress: z.string().optional(),
      buildingName: z.string().optional(),
      street: z.string().optional(),
      gpsLocation: z.string().optional(),
      deliveryAddress: z.string().optional(),
      location: z.string().optional(),
      address: z.string().optional(),
      complianceRiskLevel: complianceRiskLevel.optional(),
      dueDiligenceStatus: dueDiligenceStatus.optional(),
      inspectionRequired: z.boolean().optional(),
      blacklistStatus: blacklistStatus.optional(),
      accountStatus: accountStatus.optional(),
      complianceNotes: z.string().optional(),
      paymentTerms: paymentTerms.optional(),
      creditLimit: optionalNumber,
      creditDays: optionalInt,
      outstandingBalance: optionalNumber,
      paymentDelayFlag: z.boolean().optional(),
      blockedForCredit: z.boolean().optional(),
      preferredDeliverySchedule: z.string().optional(),
      preferredOrderChannel: z.string().optional(),
      customerCategory: customerCategory.optional(),
      accountTier: accountTier.optional(),
      isKeyAccount: z.boolean().optional(),
      accountOwnerId: z.string().optional(),
      territoryId: z.string().optional(),
      lastVisitDate: optionalDate,
      nextFollowUpDate: optionalDate,
      customerHealthStatus: customerHealthStatus.optional(),
      purchaseAuthorizationRequired: z.boolean().optional(),
      assignedOfficerId: z.string().optional(),
      notes: z.string().optional()
    }).passthrough()
  }),
  review: z.object({
    body: z.object({
      decision: z.preprocess((value) => {
        const normalized = String(value || '').trim().toUpperCase();
        if (!normalized) return 'SUBMITTED';
        if (normalized === 'SUBMIT' || normalized === 'SEND_TO_APPROVAL') return 'SUBMITTED';
        return normalized;
      }, z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'])),
      comment: optionalString,
      reason: optionalString,
      reviewChecklist: z.any().optional()
    }).passthrough()
  })
};
