const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { ROLES } = require('../constants/roles');
const stateMachineService = require('./stateMachineService');
const domainGuardService = require('./domainGuardService');
const timelineService = require('./timelineService');
const approvalService = require('./approvalService');
const approvalPolicyService = require('./approvalPolicyService');

const requiredLicenseTypes = new Set(['PHARMACY', 'HOSPITAL', 'CLINIC']);

const checklistBlueprint = [
  {
    label: 'Business registration certificate',
    category: 'BUSINESS_REGISTRATION_CERTIFICATE',
    required: () => true
  },
  {
    label: 'KRA PIN certificate',
    category: 'KRA_DOCUMENT',
    required: () => true
  },
  {
    label: 'Tax compliance certificate',
    category: 'TAX_DOCUMENT',
    required: () => true
  },
  {
    label: 'Business license',
    category: 'CUSTOMER_LICENSE',
    required: () => true
  },
  {
    label: 'Pharmacy or medical license',
    category: 'PHARMACY_LICENSE',
    required: (businessType) => requiredLicenseTypes.has(businessType)
  },
  {
    label: 'Business permit',
    category: 'BUSINESS_PERMIT',
    required: () => true
  },
  {
    label: 'Responsible pharmacist registration proof',
    category: 'PHARMACIST_REGISTRATION_PROOF',
    required: (businessType) => requiredLicenseTypes.has(businessType)
  },
  {
    label: 'Purchase authorization letter',
    category: 'PURCHASE_AUTHORIZATION_LETTER',
    required: (_businessType, item) => Boolean(item?.purchaseAuthorizationRequired)
  }
];

function calculateDaysUntil(value) {
  if (!value) return null;
  const target = new Date(value);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function mapChecklistStatus(document, required) {
  if (!required) return 'NOT_REQUIRED';
  if (!document) return 'MISSING';
  if (document.status === 'APPROVED') return 'APPROVED';
  if (document.status === 'REJECTED') return 'REJECTED';
  return 'UPLOADED';
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function buildFieldChecklist(item) {
  const needsPharmacist = requiredLicenseTypes.has(item.businessType);
  const requiresCredit = ['CREDIT', 'MIXED'].includes(item.paymentTerms || '');

  const fields = [
    { key: 'registrationNumber', label: 'Registration number', required: true, value: item.registrationNumber },
    { key: 'kraPin', label: 'KRA PIN', required: true, value: item.kraPin },
    { key: 'taxComplianceCertificateNumber', label: 'Tax compliance certificate number', required: true, value: item.taxComplianceCertificateNumber },
    { key: 'licenseNumber', label: 'License number', required: true, value: item.licenseNumber },
    { key: 'licenseExpiryDate', label: 'License expiry date', required: true, value: item.licenseExpiryDate },
    { key: 'ppbLicenseNumber', label: 'PPB license number', required: needsPharmacist, value: item.ppbLicenseNumber },
    { key: 'ppbLicenseExpiryDate', label: 'PPB license expiry date', required: needsPharmacist, value: item.ppbLicenseExpiryDate },
    { key: 'businessPermitNumber', label: 'Business permit number', required: true, value: item.businessPermitNumber },
    { key: 'businessPermitExpiryDate', label: 'Business permit expiry date', required: true, value: item.businessPermitExpiryDate },
    { key: 'contactPersonName', label: 'Contact person name', required: true, value: item.contactPersonName },
    { key: 'contactPersonRole', label: 'Contact person role', required: true, value: item.contactPersonRole },
    { key: 'contactEmail', label: 'Contact email', required: false, value: item.contactEmail },
    { key: 'contactPhone', label: 'Contact phone', required: true, value: item.contactPhone },
    { key: 'alternatePhone', label: 'Alternate phone', required: false, value: item.alternatePhone },
    { key: 'superintendentPharmacistName', label: 'Superintendent pharmacist name', required: needsPharmacist, value: item.superintendentPharmacistName },
    { key: 'superintendentPharmacistRegistrationNumber', label: 'Superintendent pharmacist registration number', required: needsPharmacist, value: item.superintendentPharmacistRegistrationNumber },
    { key: 'pharmacistEmail', label: 'Pharmacist email', required: false, value: item.pharmacistEmail },
    { key: 'pharmacistPhone', label: 'Pharmacist phone', required: false, value: item.pharmacistPhone },
    { key: 'county', label: 'County', required: true, value: item.county },
    { key: 'town', label: 'Town', required: true, value: item.town },
    { key: 'physicalAddress', label: 'Physical address', required: true, value: item.physicalAddress },
    { key: 'buildingName', label: 'Building name', required: false, value: item.buildingName },
    { key: 'street', label: 'Street', required: false, value: item.street },
    { key: 'gpsLocation', label: 'GPS location', required: false, value: item.gpsLocation },
    { key: 'deliveryAddress', label: 'Delivery address', required: false, value: item.deliveryAddress },
    { key: 'complianceRiskLevel', label: 'Compliance risk level', required: true, value: item.complianceRiskLevel },
    { key: 'dueDiligenceStatus', label: 'Due diligence status', required: true, value: item.dueDiligenceStatus },
    { key: 'paymentTerms', label: 'Payment terms', required: true, value: item.paymentTerms },
    { key: 'customerCategory', label: 'Customer category', required: true, value: item.customerCategory },
    { key: 'creditLimit', label: 'Credit limit', required: requiresCredit, value: item.creditLimit },
    { key: 'creditDays', label: 'Credit days', required: requiresCredit, value: item.creditDays }
  ];

  return fields.map((field) => ({ ...field, complete: !field.required || hasValue(field.value) }));
}

function buildLicenseExpiryTracking(item, documents) {
  const documentEntries = (documents || [])
    .filter((document) => ['CUSTOMER_LICENSE', 'PHARMACY_LICENSE', 'IMPORT_PERMIT', 'BUSINESS_PERMIT'].includes(document.category))
    .map((document) => ({
      id: document.id,
      title: document.title,
      category: document.category,
      status: document.status,
      expiryDate: document.expiryDate,
      daysUntilExpiry: calculateDaysUntil(document.expiryDate),
      source: 'DOCUMENT'
    }));

  const fieldEntries = [
    {
      id: 'field:licenseExpiryDate',
      title: 'License expiry date',
      category: 'CUSTOMER_ONBOARDING',
      status: hasValue(item.licenseExpiryDate) ? 'ON_FILE' : 'MISSING',
      expiryDate: item.licenseExpiryDate,
      daysUntilExpiry: calculateDaysUntil(item.licenseExpiryDate),
      source: 'RECORD'
    },
    {
      id: 'field:ppbLicenseExpiryDate',
      title: 'PPB license expiry date',
      category: 'CUSTOMER_ONBOARDING',
      status: hasValue(item.ppbLicenseExpiryDate) ? 'ON_FILE' : 'MISSING',
      expiryDate: item.ppbLicenseExpiryDate,
      daysUntilExpiry: calculateDaysUntil(item.ppbLicenseExpiryDate),
      source: 'RECORD'
    },
    {
      id: 'field:businessPermitExpiryDate',
      title: 'Business permit expiry date',
      category: 'CUSTOMER_ONBOARDING',
      status: hasValue(item.businessPermitExpiryDate) ? 'ON_FILE' : 'MISSING',
      expiryDate: item.businessPermitExpiryDate,
      daysUntilExpiry: calculateDaysUntil(item.businessPermitExpiryDate),
      source: 'RECORD'
    }
  ];

  return [...documentEntries, ...fieldEntries].sort((left, right) => {
    const leftTime = left.expiryDate ? new Date(left.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.expiryDate ? new Date(right.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

function deriveLegacyLocationFields(base, patch, includeLegacy = true) {
  if (!includeLegacy) return patch;
  const next = { ...patch };
  const merged = { ...base, ...patch };

  if (!Object.prototype.hasOwnProperty.call(patch, 'location')) {
    const location = [merged.county, merged.town].filter((value) => hasValue(value)).join(', ');
    if (hasValue(location)) next.location = location;
  }

  if (!Object.prototype.hasOwnProperty.call(patch, 'address')) {
    const address = [merged.physicalAddress, merged.buildingName, merged.street].filter((value) => hasValue(value)).join(', ');
    if (hasValue(address)) next.address = address;
  }

  return next;
}

function isExpiredDate(value) {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
}

function deriveCustomerHealthStatus(item = {}) {
  if (item.blacklistStatus === 'BLOCKED' || item.blockedForCredit || item.accountStatus === 'SUSPENDED') return 'BLOCKED';
  if (isExpiredDate(item.licenseExpiryDate) || isExpiredDate(item.ppbLicenseExpiryDate)) return 'AT_RISK';
  if (
    ['HIGH', 'CRITICAL'].includes(String(item.complianceRiskLevel || '').toUpperCase())
    || ['FAILED', 'NEEDS_REVIEW'].includes(String(item.dueDiligenceStatus || '').toUpperCase())
    || item.paymentDelayFlag
  ) {
    return 'WATCH';
  }
  return 'GOOD';
}

async function upsertOpenCustomerAlert(tx, customerId, payload) {
  const existing = await tx.customerAlert.findFirst({
    where: {
      customerId,
      alertType: payload.alertType,
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      deletedAt: null
    }
  });

  if (existing) {
    return tx.customerAlert.update({
      where: { id: existing.id },
      data: {
        title: payload.title,
        description: payload.description,
        severity: payload.severity,
        dueDate: payload.dueDate || null,
        status: 'OPEN'
      }
    });
  }

  return tx.customerAlert.create({
    data: {
      customerId,
      ...payload
    }
  });
}

async function syncCustomerAlerts(tx, customer) {
  const actions = [];
  const now = new Date();

  if (isExpiredDate(customer.licenseExpiryDate) || isExpiredDate(customer.ppbLicenseExpiryDate)) {
    actions.push(upsertOpenCustomerAlert(tx, customer.id, {
      alertType: 'LICENSE_EXPIRY',
      title: 'License expiry risk',
      description: `One or more licenses for ${customer.businessName} are expired.`,
      severity: 'HIGH',
      dueDate: customer.licenseExpiryDate || customer.ppbLicenseExpiryDate || null
    }));
  }

  if (
    ['HIGH', 'CRITICAL'].includes(String(customer.complianceRiskLevel || '').toUpperCase())
    || ['FAILED', 'NEEDS_REVIEW'].includes(String(customer.dueDiligenceStatus || '').toUpperCase())
  ) {
    actions.push(upsertOpenCustomerAlert(tx, customer.id, {
      alertType: 'COMPLIANCE_RISK',
      title: 'Compliance risk escalation',
      description: `Compliance risk review is required for ${customer.businessName}.`,
      severity: ['CRITICAL'].includes(String(customer.complianceRiskLevel || '').toUpperCase()) ? 'CRITICAL' : 'HIGH'
    }));
  }

  if (customer.blockedForCredit || customer.paymentDelayFlag) {
    actions.push(upsertOpenCustomerAlert(tx, customer.id, {
      alertType: 'CREDIT_RISK',
      title: 'Customer credit risk',
      description: `Credit follow-up is required for ${customer.businessName}.`,
      severity: customer.blockedForCredit ? 'CRITICAL' : 'HIGH'
    }));
  }

  if (customer.nextFollowUpDate && new Date(customer.nextFollowUpDate).getTime() < now.getTime()) {
    actions.push(upsertOpenCustomerAlert(tx, customer.id, {
      alertType: 'OVERDUE_FOLLOWUP',
      title: 'Customer follow-up overdue',
      description: `Follow-up for ${customer.businessName} is overdue.`,
      severity: 'MEDIUM',
      dueDate: customer.nextFollowUpDate
    }));
  }

  if (!actions.length) return;
  await Promise.all(actions);
}

const customerOnboardingService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.businessType) where.businessType = query.businessType;
    if (query.complianceRiskLevel) where.complianceRiskLevel = query.complianceRiskLevel;
    if (query.dueDiligenceStatus) where.dueDiligenceStatus = query.dueDiligenceStatus;
    if (query.assignedOfficerId) where.assignedOfficerId = query.assignedOfficerId;
    if (query.accountOwnerId) where.accountOwnerId = query.accountOwnerId;
    if (query.territoryId) where.territoryId = query.territoryId;
    if (query.accountStatus) where.accountStatus = query.accountStatus;
    if (query.customerHealthStatus) where.customerHealthStatus = query.customerHealthStatus;
    if (query.blacklistStatus) where.blacklistStatus = query.blacklistStatus;
    if (query.county) where.county = { contains: query.county, mode: 'insensitive' };
    if (query.location) where.location = { contains: query.location, mode: 'insensitive' };
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) where.OR = [{ businessName: { contains: query.search, mode: 'insensitive' } }, { contactPersonName: { contains: query.search, mode: 'insensitive' } }, { contactEmail: { contains: query.search, mode: 'insensitive' } }];
    if (query.licenseExpiryStatus) {
      const today = new Date();
      const soon = new Date();
      soon.setDate(soon.getDate() + 30);
      const status = String(query.licenseExpiryStatus || '').toUpperCase();
      const expiryFields = ['licenseExpiryDate', 'ppbLicenseExpiryDate', 'businessPermitExpiryDate'];
      const and = where.AND ? [...where.AND] : [];

      if (status === 'EXPIRED') {
        and.push({
          OR: expiryFields.map((field) => ({ [field]: { lte: today } }))
        });
      } else if (status === 'EXPIRING_SOON') {
        and.push({
          OR: expiryFields.map((field) => ({ [field]: { gt: today, lte: soon } }))
        });
      } else if (status === 'OK') {
        and.push({
          AND: [
            { NOT: { OR: expiryFields.map((field) => ({ [field]: { lte: today } })) } },
            { OR: expiryFields.map((field) => ({ [field]: { gt: soon } })) }
          ]
        });
      } else if (status === 'MISSING') {
        and.push({
          AND: expiryFields.map((field) => ({ [field]: null }))
        });
      }

      if (and.length) where.AND = and;
    }
    if (!accessControlService.isGeneralManager(auth) && !query.assignedOfficerId) where.assignedOfficerId = auth.userId;
    const [items, total] = await prisma.$transaction([
      prisma.customerOnboarding.findMany({
        where,
        include: {
          assignedOfficer: { select: { id: true, fullName: true } },
          accountOwner: { select: { id: true, fullName: true } },
          territory: { select: { id: true, name: true, region: true, county: true } }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.customerOnboarding.count({ where })
    ]);
    const enriched = items.map((item) => {
      const expiryTracking = buildLicenseExpiryTracking(item, []);
      const expiringSoon = expiryTracking.some((entry) => typeof entry.daysUntilExpiry === 'number' && entry.daysUntilExpiry > 0 && entry.daysUntilExpiry <= 30);
      const expired = expiryTracking.some((entry) => typeof entry.daysUntilExpiry === 'number' && entry.daysUntilExpiry <= 0);
      const hasAnyExpiry = expiryTracking.some((entry) => entry.expiryDate);

      return {
        ...item,
        customerHealthStatus: item.customerHealthStatus || deriveCustomerHealthStatus(item),
        licenseExpiryStatus: expired ? 'EXPIRED' : expiringSoon ? 'EXPIRING_SOON' : hasAnyExpiry ? 'OK' : 'MISSING'
      };
    });
    return paginated(enriched, total, page, limit);
  },

  async get(id, auth) {
    const item = await prisma.customerOnboarding.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignedOfficer: { select: { id: true, fullName: true } },
        accountOwner: { select: { id: true, fullName: true } },
        territory: { select: { id: true, name: true, region: true, county: true } }
      }
    });
    if (!item) throw new AppError('Customer onboarding record not found', 404);
    if (!accessControlService.isGeneralManager(auth) && item.assignedOfficerId !== auth.userId) throw new AppError('You do not have access to this customer onboarding record', 403);
    const [documents, comments, auditTrail, accountNotes, opportunities, issues, feedback, alerts, tasks, recentVisits] = await prisma.$transaction([
      prisma.document.findMany({
        where: { ownerType: 'CUSTOMER', ownerId: id, deletedAt: null },
        include: {
          uploadedBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.comment.findMany({
        where: { entityType: 'CUSTOMER_ONBOARDING', entityId: id, deletedAt: null },
        include: { author: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.auditLog.findMany({
        where: { entityType: 'CustomerOnboarding', entityId: id },
        include: { actor: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.customerAccountNote.findMany({
        where: { customerId: id },
        include: { createdBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.salesOpportunity.findMany({
        where: { customerId: id, deletedAt: null },
        include: { owner: { select: { id: true, fullName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.customerIssue.findMany({
        where: { customerId: id, deletedAt: null },
        include: {
          reportedBy: { select: { id: true, fullName: true } },
          assignedTo: { select: { id: true, fullName: true } }
        },
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.productFeedback.findMany({
        where: { customerId: id, deletedAt: null },
        include: { submittedBy: { select: { id: true, fullName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.customerAlert.findMany({
        where: { customerId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 30
      }),
      prisma.task.findMany({
        where: { customerId: id, deletedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          assignedTo: { select: { id: true, fullName: true } }
        },
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.clientVisitNote.findMany({
        where: { customerId: id, deletedAt: null },
        include: { createdBy: { select: { id: true, fullName: true } } },
        orderBy: { visitDate: 'desc' },
        take: 20
      })
    ]);
    const timeline = await timelineService.getTimeline('CUSTOMER_ONBOARDING', id);
    const approvalRequest = await prisma.approvalRequest.findFirst({
      where: { entityType: 'CUSTOMER_ONBOARDING', entityId: id, deletedAt: null },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        currentApprover: { select: { id: true, fullName: true, email: true } },
        steps: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const documentChecklist = checklistBlueprint.map((entry) => {
      const required = entry.required(item.businessType, item);
      const document = documents.find((candidate) => candidate.category === entry.category) || null;
      const status = mapChecklistStatus(document, required);

      return {
        label: entry.label,
        category: entry.category,
        required,
        status,
        documentId: document?.id || null,
        documentTitle: document?.title || null,
        documentStatus: document?.status || null,
        expiryDate: document?.expiryDate || null,
        rejectionReason: document?.rejectionReason || null
      };
    });

    const requiredChecklist = documentChecklist.filter((entry) => entry.required);
    const completeChecklist = requiredChecklist.filter((entry) => ['UPLOADED', 'APPROVED'].includes(entry.status));
    const rejectedChecklist = requiredChecklist.filter((entry) => entry.status === 'REJECTED');
    const missingChecklist = requiredChecklist.filter((entry) => entry.status === 'MISSING');
    const complianceCompletenessPercentage = requiredChecklist.length
      ? Math.round((completeChecklist.length / requiredChecklist.length) * 100)
      : 100;

    const licenseExpiryTracking = buildLicenseExpiryTracking(item, documents);
    const derivedHealthStatus = item.customerHealthStatus || deriveCustomerHealthStatus(item);

    const rejectionHistory = auditTrail
      .filter((entry) => entry.action === AUDIT_ACTIONS.COMPLIANCE_UPDATED && entry.newValues?.status === 'REJECTED')
      .map((entry) => ({
        id: entry.id,
        reason: entry.newValues?.comment || entry.newValues?.rejectionReason || item.rejectionReason || null,
        actor: entry.actor || null,
        createdAt: entry.createdAt
      }));

    const riskReasons = [
      ...(item.status === 'SUSPENDED' ? ['Customer onboarding is currently suspended.'] : []),
      ...(item.status === 'REJECTED' ? ['Customer onboarding was rejected and needs remediation.'] : []),
      ...missingChecklist.map((entry) => `${entry.label} is missing.`),
      ...rejectedChecklist.map((entry) => `${entry.label} was rejected.`),
      ...licenseExpiryTracking.filter((entry) => typeof entry.daysUntilExpiry === 'number' && entry.daysUntilExpiry <= 0).map((entry) => `${entry.title} is expired.`),
      ...licenseExpiryTracking.filter((entry) => typeof entry.daysUntilExpiry === 'number' && entry.daysUntilExpiry > 0 && entry.daysUntilExpiry <= 30).map((entry) => `${entry.title} expires within 30 days.`)
    ];

    const fieldChecklist = buildFieldChecklist(item);
    const requiredFieldChecklist = fieldChecklist.filter((entry) => entry.required);
    const completedRequiredFieldChecklist = requiredFieldChecklist.filter((entry) => entry.complete);
    const fieldCompletenessPercentage = requiredFieldChecklist.length
      ? Math.round((completedRequiredFieldChecklist.length / requiredFieldChecklist.length) * 100)
      : 100;
    const complianceReadinessScore = Math.round((complianceCompletenessPercentage + fieldCompletenessPercentage) / 2);
    const missingFields = fieldChecklist.filter((entry) => entry.required && !entry.complete).map((entry) => entry.label);

    const complianceRiskFlag = {
      level: item.status === 'SUSPENDED'
        || item.status === 'REJECTED'
        || rejectedChecklist.length
        || licenseExpiryTracking.some((entry) => typeof entry.daysUntilExpiry === 'number' && entry.daysUntilExpiry <= 0)
        ? 'HIGH'
        : missingChecklist.length || item.status === 'UNDER_REVIEW'
          ? 'MEDIUM'
          : 'LOW',
      reasons: riskReasons
    };

    return {
      ...item,
      customerHealthStatus: derivedHealthStatus,
      documents,
      comments,
      approvalRequest,
      timeline,
      accountNotes,
      opportunities,
      issues,
      productFeedback: feedback,
      alerts,
      tasks,
      recentVisits,
      documentChecklist,
      complianceCompletenessPercentage,
      fieldChecklist,
      fieldCompletenessPercentage,
      complianceReadinessScore,
      missingFields,
      rejectionHistory,
      licenseExpiryTracking,
      complianceRiskFlag
    };
  },

  async create(auth, data, req) {
    const gm = await prisma.user.findFirst({ where: { role: { name: ROLES.GENERAL_MANAGER }, isActive: true, deletedAt: null } });
    const prepared = deriveLegacyLocationFields({}, data);
    const created = await prisma.$transaction(async (tx) => {
      const draft = {
        ...prepared,
        assignedOfficerId: data.assignedOfficerId || auth.userId
      };
      const customerHealthStatus = draft.customerHealthStatus || deriveCustomerHealthStatus(draft);
      const createdRecord = await tx.customerOnboarding.create({
        data: {
          ...draft,
          customerHealthStatus
        }
      });
      await syncCustomerAlerts(tx, createdRecord);
      return createdRecord;
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'CustomerOnboarding', entityId: created.id, newValues: created, req });
    if (created.assignedOfficerId && created.assignedOfficerId !== auth.userId) {
      await notificationService.create({ userId: created.assignedOfficerId, type: 'SYSTEM', title: 'New customer onboarding assigned', body: created.businessName, entityType: 'CustomerOnboarding', entityId: created.id });
    }
    if (gm && gm.id !== auth.userId) {
      await notificationService.create({ userId: gm.id, type: 'SYSTEM', title: 'Customer onboarding created', body: created.businessName, entityType: 'CustomerOnboarding', entityId: created.id });
    }
    return created;
  },

  async update(id, auth, data, req) {
    const existing = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(existing, 'Customer onboarding', ['REJECTED']);
    if (existing.status !== 'DRAFT' && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only draft onboarding records can be edited by assigned officers', 400);
    }
    const prepared = deriveLegacyLocationFields(existing, data);
    const updated = await prisma.$transaction(async (tx) => {
      const merged = { ...existing, ...prepared };
      const customerHealthStatus = prepared.customerHealthStatus || deriveCustomerHealthStatus(merged);
      const record = await tx.customerOnboarding.update({
        where: { id },
        data: {
          ...prepared,
          customerHealthStatus
        }
      });
      await syncCustomerAlerts(tx, record);
      return record;
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'CustomerOnboarding', entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async review(id, auth, decision, comment, reviewChecklist, req) {
    const existing = await this.get(id, auth);
    if (decision === 'SUBMITTED') {
      stateMachineService.assertTransition('CUSTOMER_ONBOARDING', existing.status, decision);
      const documents = await prisma.document.findMany({ where: { ownerType: 'CUSTOMER', ownerId: id, deletedAt: null } });

      const fieldChecklist = buildFieldChecklist(existing);
      const missingFields = fieldChecklist.filter((entry) => entry.required && !entry.complete);
      if (missingFields.length) {
        throw new AppError(`Customer onboarding is missing required profile fields: ${missingFields.map((entry) => entry.label).join(', ')}`, 400);
      }

      const requiredDocuments = checklistBlueprint
        .map((entry) => {
          const required = entry.required(existing.businessType, existing);
          if (!required) return null;
          const document = documents.find((candidate) => candidate.category === entry.category) || null;
          return { ...entry, document };
        })
        .filter(Boolean);
      const missingDocuments = requiredDocuments.filter((entry) => !entry.document);
      const rejectedDocuments = requiredDocuments.filter((entry) => entry.document && entry.document.status === 'REJECTED');
      const missingLabels = missingDocuments.map((entry) => entry.label);
      const rejectedLabels = rejectedDocuments.map((entry) => entry.label);
      const documentReadinessWarnings = [];
      if (missingLabels.length) documentReadinessWarnings.push(`Missing documents: ${missingLabels.join(', ')}`);
      if (rejectedLabels.length) documentReadinessWarnings.push(`Rejected documents: ${rejectedLabels.join(', ')}`);
      const documentReadinessWarningText = documentReadinessWarnings.length
        ? `Submission warning: ${documentReadinessWarnings.join('. ')}`
        : null;

      const existingApproval = await approvalService.getOpenByEntity('CUSTOMER_ONBOARDING', id);
      if (existingApproval) throw new AppError('Customer onboarding already has a pending approval request', 400);

      const steps = await approvalPolicyService.buildCustomerOnboardingSteps({
        requesterRoleName: auth.roleName,
        escalateToGeneralManager: true
      });
      if (!steps.length) {
        throw new AppError('Customer onboarding approval workflow could not resolve a valid approver', 400);
      }
      if (
        ['HIGH', 'CRITICAL'].includes(String(existing.complianceRiskLevel || '').toUpperCase())
        && !steps.some((step) => step.approverRoleId || step.approverUserId)
      ) {
        throw new AppError('High-risk customer onboarding requires explicit approval routing', 400);
      }

      const updated = await prisma.$transaction(async (tx) => {
        const combinedComment = [comment, documentReadinessWarningText].filter(Boolean).join('\n');
        const submitted = await tx.customerOnboarding.update({
          where: { id },
          data: {
            status: 'SUBMITTED',
            rejectionReason: null,
            reviewChecklist: reviewChecklist || existing.reviewChecklist,
            notes: combinedComment ? `${existing.notes || ''}\n${combinedComment}`.trim() : existing.notes,
            customerHealthStatus: deriveCustomerHealthStatus({
              ...existing,
              status: 'SUBMITTED'
            })
          }
        });

        await syncCustomerAlerts(tx, submitted);

        await approvalService.create({
          requestType: 'CUSTOMER_ONBOARDING',
          entityType: 'CUSTOMER_ONBOARDING',
          entityId: id,
          requestedById: auth.userId,
          reason: combinedComment || `Customer onboarding submission for ${submitted.businessName}`,
          steps,
          tx
        }, auth.userId, req);

        return submitted;
      });

      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'CustomerOnboarding', entityId: id, oldValues: { status: existing.status }, newValues: { status: 'SUBMITTED', comment }, req });
      if (updated.assignedOfficerId) {
        await notificationService.create({ userId: updated.assignedOfficerId, type: 'SYSTEM', title: 'Customer onboarding submitted', body: updated.businessName, entityType: 'CustomerOnboarding', entityId: id });
      }
      return updated;
    }

    if (decision === 'APPROVED' || decision === 'REJECTED') {
      const approvalRequest = await approvalService.getOpenByEntity('CUSTOMER_ONBOARDING', id);
      if (!approvalRequest) throw new AppError('Customer onboarding is missing its approval workflow', 400);
      await approvalService.act(approvalRequest.id, decision, auth.userId, comment, req);
      return prisma.customerOnboarding.findUnique({ where: { id } });
    }

    stateMachineService.assertTransition('CUSTOMER_ONBOARDING', existing.status, decision);
    if (decision === 'SUSPENDED' && !comment) {
      throw new AppError('A suspension reason is required', 400);
    }
    const updated = await prisma.customerOnboarding.update({
      where: { id },
      data: {
        status: decision,
        reviewChecklist: reviewChecklist || existing.reviewChecklist,
        notes: comment ? `${existing.notes || ''}\n${comment}`.trim() : existing.notes,
        customerHealthStatus: deriveCustomerHealthStatus({
          ...existing,
          status: decision
        })
      }
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'CustomerOnboarding', entityId: id, oldValues: { status: existing.status }, newValues: { status: decision, comment }, req });
    if (updated.assignedOfficerId) {
      await notificationService.create({ userId: updated.assignedOfficerId, type: 'SYSTEM', title: `Customer onboarding ${decision.toLowerCase()}`, body: updated.businessName, entityType: 'CustomerOnboarding', entityId: id });
    }
    return updated;
  }
};

module.exports = customerOnboardingService;
