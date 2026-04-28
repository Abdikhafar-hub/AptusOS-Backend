const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const notificationService = require('./notificationService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { ROLES } = require('../constants/roles');
const stateMachineService = require('./stateMachineService');
const timelineService = require('./timelineService');
const approvalService = require('./approvalService');
const approvalPolicyService = require('./approvalPolicyService');

const severityMap = {
  'LOW:LOW': 'LOW',
  'LOW:MEDIUM': 'MEDIUM',
  'LOW:HIGH': 'HIGH',
  'LOW:CRITICAL': 'HIGH',
  'MEDIUM:LOW': 'MEDIUM',
  'MEDIUM:MEDIUM': 'HIGH',
  'MEDIUM:HIGH': 'URGENT',
  'MEDIUM:CRITICAL': 'CRITICAL',
  'HIGH:LOW': 'HIGH',
  'HIGH:MEDIUM': 'URGENT',
  'HIGH:HIGH': 'CRITICAL',
  'HIGH:CRITICAL': 'CRITICAL'
};

const priorityOrder = ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'];
const highSeverityValues = new Set(['HIGH', 'URGENT', 'CRITICAL']);
const salesReportPriorityValues = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL', 'NORMAL', 'IMPORTANT']);
const salesReportBodyVersion = 2;

const salesReportTextFields = [
  'reportingOfficer',
  'territoryRegion',
  'department',
  'conversionNotes',
  'reasonForLostOpportunities',
  'highDemandProducts',
  'slowMovingProducts',
  'requestedProductsNotAvailable',
  'customerProductFeedback',
  'productQualityComplaints',
  'complianceConcerns',
  'recommendedComplianceActions',
  'competitorActivity',
  'priceFeedback',
  'demandTrends',
  'marketChallenges',
  'newMarketOpportunities',
  'urgentCustomerNeeds',
  'summary',
  'keyActivities',
  'clientVisitsSummary',
  'opportunities',
  'challenges',
  'followUpActions',
  'responsiblePerson'
];

const salesReportIntegerFields = [
  'pharmaciesVisited',
  'hospitalsVisited',
  'clinicsVisited',
  'distributorsVisited',
  'wholesalersVisited',
  'newProspectsIdentified',
  'followUpsCompleted',
  'keyAccountsCovered',
  'totalOrdersDiscussed',
  'lostOpportunities',
  'customersWithExpiredLicenses',
  'customersMissingDocuments',
  'suspiciousOrHighRiskCustomers',
  'delayedDeliveriesReported',
  'stockAvailabilityIssues',
  'productReturnsReported',
  'damagedGoodsComplaints'
];

function normalizeTextValue(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeNonNegativeNumber(value, integerOnly = false) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  if (integerOnly) return Math.trunc(number);
  return number;
}

function normalizeDateValue(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function parseLegacyStructuredNotes(value = '') {
  const sections = String(value || '').split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
  const parsed = sections.reduce((acc, section) => {
    const [label, ...rest] = section.split(':\n');
    if (!label || rest.length === 0) {
      acc.notes = [acc.notes, section].filter(Boolean).join('\n\n').trim();
      return acc;
    }
    acc[label.trim()] = rest.join(':\n').trim();
    return acc;
  }, {});

  return {
    summary: parsed.Summary || parsed.notes || undefined,
    keyActivities: parsed['Key Activities'] || undefined,
    clientVisitsSummary: parsed['Client Visits Summary'] || undefined,
    opportunities: parsed.Opportunities || undefined,
    challenges: parsed.Challenges || undefined,
    followUpActions: parsed['Follow-up Actions'] || undefined
  };
}

function sanitizeSalesReportBodyValues(payload = {}) {
  const normalized = {};

  salesReportTextFields.forEach((field) => {
    const value = normalizeTextValue(payload[field]);
    if (value !== undefined) normalized[field] = value;
  });

  salesReportIntegerFields.forEach((field) => {
    const value = normalizeNonNegativeNumber(payload[field], true);
    if (value !== undefined) normalized[field] = value;
  });

  const estimatedSalesValue = normalizeNonNegativeNumber(payload.estimatedSalesValue);
  if (estimatedSalesValue !== undefined) normalized.estimatedSalesValue = estimatedSalesValue;

  const currency = normalizeTextValue(payload.currency);
  if (currency !== undefined) normalized.currency = currency.toUpperCase();

  const dueDate = normalizeDateValue(payload.dueDate);
  if (dueDate !== undefined) normalized.dueDate = dueDate;

  const priority = normalizeTextValue(payload.priority)?.toUpperCase();
  if (priority && salesReportPriorityValues.has(priority)) normalized.priority = priority;

  if (Array.isArray(payload.attachmentDocumentIds)) {
    normalized.attachmentDocumentIds = uniqueStrings(payload.attachmentDocumentIds);
  }

  return normalized;
}

function parseSalesReportBody(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return {};

  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object') {
      const normalized = sanitizeSalesReportBodyValues(parsed);
      if (parsed.schemaVersion === salesReportBodyVersion) normalized.schemaVersion = salesReportBodyVersion;
      return normalized;
    }
  } catch (_) {
    return parseLegacyStructuredNotes(rawBody);
  }

  return parseLegacyStructuredNotes(rawBody);
}

function buildSalesReportBody(payload = {}) {
  return JSON.stringify({
    schemaVersion: salesReportBodyVersion,
    ...sanitizeSalesReportBodyValues(payload)
  });
}

function buildSalesReportSections(fields = {}) {
  return {
    reportIdentity: {
      reportingOfficer: fields.reportingOfficer || null,
      territoryRegion: fields.territoryRegion || null,
      department: fields.department || null
    },
    customerCoverage: {
      pharmaciesVisited: fields.pharmaciesVisited ?? null,
      hospitalsVisited: fields.hospitalsVisited ?? null,
      clinicsVisited: fields.clinicsVisited ?? null,
      distributorsVisited: fields.distributorsVisited ?? null,
      wholesalersVisited: fields.wholesalersVisited ?? null,
      newProspectsIdentified: fields.newProspectsIdentified ?? null,
      followUpsCompleted: fields.followUpsCompleted ?? null,
      keyAccountsCovered: fields.keyAccountsCovered ?? null
    },
    salesActivitySummary: {
      totalOrdersDiscussed: fields.totalOrdersDiscussed ?? null,
      estimatedSalesValue: fields.estimatedSalesValue ?? null,
      currency: fields.currency || null,
      conversionNotes: fields.conversionNotes || null,
      lostOpportunities: fields.lostOpportunities ?? null,
      reasonForLostOpportunities: fields.reasonForLostOpportunities || null
    },
    productCategoryDemand: {
      highDemandProducts: fields.highDemandProducts || null,
      slowMovingProducts: fields.slowMovingProducts || null,
      requestedProductsNotAvailable: fields.requestedProductsNotAvailable || null,
      customerProductFeedback: fields.customerProductFeedback || null,
      productQualityComplaints: fields.productQualityComplaints || null
    },
    customerComplianceNotes: {
      customersWithExpiredLicenses: fields.customersWithExpiredLicenses ?? null,
      customersMissingDocuments: fields.customersMissingDocuments ?? null,
      suspiciousOrHighRiskCustomers: fields.suspiciousOrHighRiskCustomers ?? null,
      complianceConcerns: fields.complianceConcerns || null,
      recommendedComplianceActions: fields.recommendedComplianceActions || null
    },
    marketIntelligence: {
      competitorActivity: fields.competitorActivity || null,
      priceFeedback: fields.priceFeedback || null,
      demandTrends: fields.demandTrends || null,
      marketChallenges: fields.marketChallenges || null,
      newMarketOpportunities: fields.newMarketOpportunities || null
    },
    distributionServiceIssues: {
      delayedDeliveriesReported: fields.delayedDeliveriesReported ?? null,
      stockAvailabilityIssues: fields.stockAvailabilityIssues ?? null,
      productReturnsReported: fields.productReturnsReported ?? null,
      damagedGoodsComplaints: fields.damagedGoodsComplaints ?? null,
      urgentCustomerNeeds: fields.urgentCustomerNeeds || null
    },
    keyActivities: {
      summary: fields.summary || null,
      keyActivities: fields.keyActivities || null,
      clientVisitsSummary: fields.clientVisitsSummary || null,
      opportunities: fields.opportunities || null,
      challenges: fields.challenges || null
    },
    followUp: {
      followUpActions: fields.followUpActions || null,
      responsiblePerson: fields.responsiblePerson || null,
      dueDate: fields.dueDate || null,
      priority: fields.priority || null
    }
  };
}

function toSalesReportView(report = {}) {
  const parsedFields = parseSalesReportBody(report.body);
  const attachmentDocumentIds = uniqueStrings(parsedFields.attachmentDocumentIds || []);
  const allAttachmentIds = uniqueStrings([report.documentId, ...attachmentDocumentIds]);
  const totalVisits = ['pharmaciesVisited', 'hospitalsVisited', 'clinicsVisited', 'distributorsVisited', 'wholesalersVisited']
    .reduce((acc, key) => acc + (Number(parsedFields[key]) || 0), 0);

  return {
    ...report,
    ...parsedFields,
    reportingOfficer: parsedFields.reportingOfficer || report.createdBy?.fullName || null,
    attachmentDocumentIds: allAttachmentIds,
    summarySnapshot: {
      territoryRegion: parsedFields.territoryRegion || null,
      department: parsedFields.department || null,
      totalVisits,
      estimatedSalesValue: parsedFields.estimatedSalesValue ?? null,
      currency: parsedFields.currency || null,
      followUpsCompleted: parsedFields.followUpsCompleted ?? null,
      complianceConcerns: parsedFields.complianceConcerns || null
    },
    sections: buildSalesReportSections(parsedFields)
  };
}

async function notifySalesReportReviewManagers(report, requesterId) {
  if (!['SUBMITTED', 'PENDING', 'UNDER_REVIEW'].includes(report.status)) return;

  const managers = await prisma.user.findMany({
    where: {
      role: { name: ROLES.GENERAL_MANAGER },
      isActive: true,
      deletedAt: null
    },
    select: { id: true }
  });

  const recipients = managers.map((item) => item.id).filter((id) => id !== requesterId);
  if (!recipients.length) return;

  await notificationService.createMany(recipients, {
    type: 'SYSTEM',
    title: 'Sales report submitted for manager review',
    body: report.title,
    entityType: 'SalesReport',
    entityId: report.id
  });
}

function calculateDaysOverdue(value, status) {
  if (!value || ['COMPLETED', 'ARCHIVED', 'CLOSED'].includes(status)) return 0;
  const dueDate = new Date(value);
  const now = new Date();
  if (dueDate >= now) return 0;
  return Math.ceil((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
}

function escalatePriority(priority = 'MEDIUM', daysOverdue = 0) {
  const currentIndex = Math.max(0, priorityOrder.indexOf(priority));
  const escalationSteps = daysOverdue >= 30 ? 2 : daysOverdue >= 7 ? 1 : 0;
  const nextIndex = Math.min(priorityOrder.length - 1, currentIndex + escalationSteps);
  return priorityOrder[nextIndex];
}

function deriveStatusTrend(timeline = []) {
  return timeline
    .filter((entry) => entry.type === 'AUDIT' && entry.metadata?.newValues?.status)
    .map((entry) => ({
      id: entry.id,
      status: entry.metadata?.newValues?.status,
      previousStatus: entry.metadata?.oldValues?.status || null,
      createdAt: entry.createdAt,
      actor: entry.actor || null
    }));
}

const detailConfig = {
  salesReport: {
    entityType: 'SALES_REPORT',
    include: { createdBy: { select: { id: true, fullName: true } } },
    documentField: 'documentId'
  },
  clientVisitNote: {
    entityType: 'CLIENT_VISIT',
    include: { createdBy: { select: { id: true, fullName: true } } }
  },
  complaintEscalation: {
    entityType: 'COMPLAINT',
    include: { owner: { select: { id: true, fullName: true } } },
    documentField: 'documentId'
  },
  riskRegister: {
    entityType: 'RISK',
    include: { owner: { select: { id: true, fullName: true } } }
  },
  incidentReport: {
    entityType: 'INCIDENT',
    include: { reportedBy: { select: { id: true, fullName: true } } },
    documentField: 'documentId'
  }
};

async function createApprovalBackedStatusChange({ auth, req, requestType, entityType, entityId, reason, steps, tx = prisma }) {
  if (!steps.length) {
    throw new AppError('This approval workflow could not resolve a valid approver', 400);
  }
  const existingApproval = await tx.approvalRequest.findFirst({
    where: {
      entityType,
      entityId,
      status: { in: ['PENDING', 'NEEDS_MORE_INFO'] },
      deletedAt: null
    }
  });
  if (existingApproval) {
    throw new AppError('This record already has a pending approval request', 400);
  }

  return approvalService.create({
    requestType,
    entityType,
    entityId,
    requestedById: auth.userId,
    reason,
    steps,
    tx
  }, auth.userId, req);
}

const modelsWithSoftDelete = new Set([
  'salesReport',
  'clientVisitNote',
  'complaintEscalation',
  'complianceItem',
  'riskRegister',
  'incidentReport'
]);

const modelsWithStatus = new Set([
  'salesReport',
  'complaintEscalation',
  'complianceItem',
  'riskRegister',
  'incidentReport'
]);

const modelsWithType = new Set(['complianceItem']);

const modelSearchFields = {
  salesReport: ['title', 'body'],
  clientVisitNote: ['clientName', 'notes'],
  complaintEscalation: ['title', 'description'],
  complianceItem: ['title', 'description'],
  riskRegister: ['title', 'description'],
  incidentReport: ['title', 'description']
};

const complianceService = {
  async listModel(model, auth, query = {}, include = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = {};
    if (modelsWithSoftDelete.has(model)) where.deletedAt = null;
    if (query.status && modelsWithStatus.has(model)) where.status = query.status;
    if (query.type && modelsWithType.has(model)) where.type = query.type;
    if (query.departmentId && model === 'complianceItem') where.departmentId = query.departmentId;
    if (query.ownerId && ['complaintEscalation', 'complianceItem', 'riskRegister'].includes(model)) where.ownerId = query.ownerId;
    if (query.severity && ['complaintEscalation', 'incidentReport', 'riskRegister'].includes(model)) where.severity = query.severity;
    if (query.customerId && model === 'clientVisitNote') where.customerId = query.customerId;
    if (query.territoryId && model === 'clientVisitNote') where.territoryId = query.territoryId;
    if (query.visitType && model === 'clientVisitNote') where.visitType = query.visitType;
    if (query.routeStopId && model === 'clientVisitNote') where.routeStopId = query.routeStopId;
    if (query.likelihood && model === 'riskRegister') where.likelihood = query.likelihood;
    if (query.impact && model === 'riskRegister') where.impact = query.impact;
    if (query.userId) {
      if (model === 'salesReport' || model === 'clientVisitNote') where.createdById = query.userId;
      if (model === 'incidentReport') where.reportedById = query.userId;
      if (model === 'complaintEscalation') where.ownerId = query.userId;
      if (model === 'complianceItem' || model === 'riskRegister') where.ownerId = query.userId;
      if (model === 'policyAcknowledgement') where.userId = query.userId;
    }
    if (query.dateFrom || query.dateTo) {
      if (model === 'salesReport') {
        where.periodStart = {};
        if (query.dateFrom) where.periodStart.gte = new Date(query.dateFrom);
        if (query.dateTo) where.periodStart.lte = new Date(query.dateTo);
      } else {
        where.createdAt = {};
        if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
        if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
      }
    }

    if (query.region && model === 'salesReport') {
      where.body = { contains: query.region, mode: 'insensitive' };
    }

    const searchFields = modelSearchFields[model] || [];
    if (query.search && searchFields.length) {
      where.OR = searchFields.map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' } }));
    }

    const [items, total] = await prisma.$transaction([
      prisma[model].findMany({ where, include, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma[model].count({ where })
    ]);

    const normalizedItems = model === 'salesReport' ? items.map((item) => toSalesReportView(item)) : items;
    return paginated(normalizedItems, total, page, limit);
  },

  async getModelDetail(model, auth, id) {
    const config = detailConfig[model];
    if (!config) throw new AppError('Unsupported compliance detail model', 400);

    const item = await prisma[model].findFirst({
      where: { id, deletedAt: null },
      include: config.include
    });
    if (!item) throw new AppError('Record not found', 404);

    const comments = await prisma.comment.findMany({
      where: { entityType: config.entityType, entityId: id, deletedAt: null },
      include: { author: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const [timeline, approvalRequest] = await Promise.all([
      timelineService.getTimeline(config.entityType, id),
      ['RISK', 'INCIDENT'].includes(config.entityType)
        ? prisma.approvalRequest.findFirst({
          where: { entityType: config.entityType, entityId: id, deletedAt: null },
          include: {
            requestedBy: { select: { id: true, fullName: true, email: true } },
            currentApprover: { select: { id: true, fullName: true, email: true } },
            steps: true
          },
          orderBy: { createdAt: 'desc' }
        })
        : Promise.resolve(null)
    ]);
    const document = config.documentField && item[config.documentField]
      ? await prisma.document.findFirst({ where: { id: item[config.documentField], deletedAt: null } })
      : null;

    const payload = {
      ...item,
      document,
      approvalRequest,
      comments,
      timeline
    };

    if (model === 'salesReport') {
      const normalized = toSalesReportView(payload);
      const attachmentIds = uniqueStrings([normalized.documentId, ...(normalized.attachmentDocumentIds || [])]);
      const attachments = attachmentIds.length
        ? await prisma.document.findMany({
          where: { id: { in: attachmentIds }, deletedAt: null },
          orderBy: { createdAt: 'desc' }
        })
        : [];

      return {
        ...normalized,
        attachments
      };
    }

    if (model === 'riskRegister') {
      return {
        ...payload,
        statusTrend: deriveStatusTrend(timeline)
      };
    }

    if (model === 'incidentReport') {
      const linkedComplianceItems = item.documentId
        ? await prisma.complianceItem.findMany({
          where: { documentId: item.documentId, deletedAt: null },
          include: { owner: { select: { id: true, fullName: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 10
        })
        : [];

      return {
        ...payload,
        linkedComplianceItems,
        linkedRisks: [],
        statusTrend: deriveStatusTrend(timeline)
      };
    }

    return payload;
  },

  async getComplianceItem(auth, id) {
    const item = await prisma.complianceItem.findFirst({
      where: { id, deletedAt: null },
      include: { owner: { select: { id: true, fullName: true } } }
    });
    if (!item) throw new AppError('Compliance item not found', 404);
    const allowed = accessControlService.isGeneralManager(auth)
      || accessControlService.isSalesCompliance(auth)
      || item.ownerId === auth.userId
      || (item.departmentId && auth.departmentIds.includes(item.departmentId));
    if (!allowed) throw new AppError('You do not have access to this compliance item', 403);
    const [comments, document, linkedIncidents, approvalRequest] = await Promise.all([
      prisma.comment.findMany({
        where: { entityType: 'COMPLIANCE_ITEM', entityId: id, deletedAt: null },
        include: { author: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      item.documentId
        ? prisma.document.findFirst({ where: { id: item.documentId, deletedAt: null } })
        : Promise.resolve(null),
      item.documentId
        ? prisma.incidentReport.findMany({
          where: { documentId: item.documentId, deletedAt: null },
          include: { reportedBy: { select: { id: true, fullName: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 10
        })
        : Promise.resolve([]),
      prisma.approvalRequest.findFirst({
        where: { entityType: 'COMPLIANCE_ITEM', entityId: id, deletedAt: null },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          currentApprover: { select: { id: true, fullName: true, email: true } },
          steps: true
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);
    const timeline = await timelineService.getTimeline('COMPLIANCE_ITEM', id);
    const daysOverdue = calculateDaysOverdue(item.dueDate, item.status);

    return {
      ...item,
      document,
      approvalRequest,
      comments,
      timeline,
      daysOverdue,
      escalationLevel: escalatePriority(item.priority, daysOverdue),
      linkedDocuments: document ? [document] : [],
      linkedRisks: [],
      linkedIncidents,
      dependencies: []
    };
  },

  async createSalesReport(auth, data, req) {
    const initialBodyFields = {
      ...parseSalesReportBody(data.body),
      ...sanitizeSalesReportBodyValues(data)
    };

    const attachmentDocumentIds = uniqueStrings([data.documentId, ...(initialBodyFields.attachmentDocumentIds || [])]);
    const documentId = normalizeTextValue(data.documentId) || attachmentDocumentIds[0] || null;
    const nextBody = {
      ...initialBodyFields,
      attachmentDocumentIds
    };

    const report = await prisma.salesReport.create({
      data: {
        title: data.title,
        periodStart: data.periodStart ? new Date(data.periodStart) : null,
        periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
        body: buildSalesReportBody(nextBody),
        documentId,
        createdById: auth.userId,
        status: 'SUBMITTED'
      },
      include: { createdBy: { select: { id: true, fullName: true } } }
    });

    const normalized = toSalesReportView(report);
    await notifySalesReportReviewManagers(report, auth.userId);
    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesReport',
      entityId: report.id,
      newValues: normalized,
      req
    });
    return normalized;
  },

  async updateSalesReport(auth, id, data, req) {
    const existing = await prisma.salesReport.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Sales report not found', 404);

    const hasDocumentIdInPayload = Object.prototype.hasOwnProperty.call(data, 'documentId');
    const hasAttachmentIdsInPayload = Array.isArray(data.attachmentDocumentIds);

    const existingBody = parseSalesReportBody(existing.body);
    const incomingBody = {
      ...parseSalesReportBody(data.body),
      ...sanitizeSalesReportBodyValues(data)
    };
    const mergedBody = {
      ...existingBody,
      ...incomingBody
    };

    const nextAttachmentIds = uniqueStrings([
      ...(hasAttachmentIdsInPayload ? (incomingBody.attachmentDocumentIds || []) : (existingBody.attachmentDocumentIds || [])),
      hasDocumentIdInPayload ? data.documentId : existing.documentId
    ]);
    mergedBody.attachmentDocumentIds = nextAttachmentIds;

    const updateData = {
      body: buildSalesReportBody(mergedBody)
    };

    if (data.title !== undefined) updateData.title = data.title;

    const nextPeriodStart = data.periodStart !== undefined
      ? (data.periodStart ? new Date(data.periodStart) : null)
      : existing.periodStart;
    const nextPeriodEnd = data.periodEnd !== undefined
      ? (data.periodEnd ? new Date(data.periodEnd) : null)
      : existing.periodEnd;
    if (nextPeriodStart && nextPeriodEnd && nextPeriodEnd < nextPeriodStart) {
      throw new AppError('periodEnd cannot be before periodStart', 400);
    }

    if (data.periodStart !== undefined) updateData.periodStart = nextPeriodStart;
    if (data.periodEnd !== undefined) updateData.periodEnd = nextPeriodEnd;
    if (hasDocumentIdInPayload || hasAttachmentIdsInPayload) {
      updateData.documentId = normalizeTextValue(data.documentId) || nextAttachmentIds[0] || null;
    }

    const updated = await prisma.salesReport.update({
      where: { id },
      data: updateData,
      include: { createdBy: { select: { id: true, fullName: true } } }
    });

    const normalized = toSalesReportView(updated);
    await notifySalesReportReviewManagers(updated, auth.userId);
    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'SalesReport',
      entityId: id,
      oldValues: toSalesReportView(existing),
      newValues: normalized,
      req
    });
    return normalized;
  },

  async createClientVisit(auth, data, req) {
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.clientVisitNote.create({
        data: {
          clientName: data.clientName,
          visitDate: data.visitDate,
          notes: data.notes,
          followUpAt: data.followUpAt,
          purpose: data.purpose,
          outcome: data.outcome,
          nextAction: data.nextAction,
          nextFollowUpDate: data.nextFollowUpDate,
          customerId: data.customerId,
          territoryId: data.territoryId,
          routeStopId: data.routeStopId,
          attachments: data.attachments,
          geoLocation: data.geoLocation,
          visitType: data.visitType,
          createdById: auth.userId
        }
      });

      if (data.routeStopId) {
        await tx.visitRouteStop.updateMany({
          where: { id: data.routeStopId, route: { deletedAt: null } },
          data: { status: 'VISITED', visitId: created.id }
        });
      }

      if (data.customerId) {
        await tx.customerOnboarding.update({
          where: { id: data.customerId },
          data: {
            lastVisitDate: created.visitDate,
            nextFollowUpDate: data.nextFollowUpDate || data.followUpAt || undefined,
            customerHealthStatus: 'GOOD'
          }
        });
      }

      return created;
    });
    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'ClientVisitNote',
      entityId: note.id,
      newValues: { ...note, summary: `Client visit logged for ${note.clientName}` },
      req
    });
    return note;
  },

  async updateClientVisit(auth, id, data, req) {
    const existing = await prisma.clientVisitNote.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Client visit note not found', 404);
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.clientVisitNote.update({
        where: { id },
        data: {
          clientName: data.clientName,
          visitDate: data.visitDate,
          notes: data.notes,
          followUpAt: data.followUpAt,
          purpose: data.purpose,
          outcome: data.outcome,
          nextAction: data.nextAction,
          nextFollowUpDate: data.nextFollowUpDate,
          customerId: data.customerId,
          territoryId: data.territoryId,
          routeStopId: data.routeStopId,
          attachments: data.attachments,
          geoLocation: data.geoLocation,
          visitType: data.visitType
        }
      });

      if (data.routeStopId) {
        await tx.visitRouteStop.updateMany({
          where: { id: data.routeStopId, route: { deletedAt: null } },
          data: { status: 'VISITED', visitId: id }
        });
      }

      if (record.customerId) {
        await tx.customerOnboarding.update({
          where: { id: record.customerId },
          data: {
            lastVisitDate: record.visitDate,
            nextFollowUpDate: record.nextFollowUpDate || record.followUpAt || undefined
          }
        });
      }
      return record;
    });
    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'ClientVisitNote',
      entityId: id,
      oldValues: existing,
      newValues: { ...updated, summary: `Client visit updated for ${updated.clientName}` },
      req
    });
    return updated;
  },

  async createComplaint(auth, data, req) {
    const complaint = await prisma.complaintEscalation.create({ data: { ...data, status: 'OPEN' } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'ComplaintEscalation', entityId: complaint.id, newValues: complaint, req });
    if (data.ownerId) await notificationService.create({ userId: data.ownerId, type: 'SYSTEM', title: 'Complaint escalation assigned', body: complaint.title, entityType: 'ComplaintEscalation', entityId: complaint.id });
    return complaint;
  },

  async updateComplaint(auth, id, data, req) {
    const existing = await prisma.complaintEscalation.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Complaint escalation not found', 404);
    const updated = await prisma.complaintEscalation.update({ where: { id }, data });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'ComplaintEscalation', entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async updateComplaintStatus(auth, id, status, resolutionNotes, req) {
    const complaint = await prisma.complaintEscalation.findFirst({ where: { id, deletedAt: null } });
    if (!complaint) throw new AppError('Complaint escalation not found', 404);
    stateMachineService.assertTransition('COMPLAINT', complaint.status, status);
    const updated = await prisma.complaintEscalation.update({ where: { id }, data: { status, description: resolutionNotes ? `${complaint.description}\n${resolutionNotes}` : complaint.description } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'ComplaintEscalation', entityId: id, oldValues: { status: complaint.status }, newValues: { status, resolutionNotes }, req });
    return updated;
  },

  async createComplianceItem(auth, data, req) {
    const item = await prisma.complianceItem.create({ data: { ...data, status: 'OPEN' } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'ComplianceItem', entityId: item.id, newValues: item, req });
    if (data.ownerId) await notificationService.create({ userId: data.ownerId, type: 'SYSTEM', title: 'Compliance item assigned', body: item.title, entityType: 'ComplianceItem', entityId: item.id });
    return item;
  },

  async updateComplianceStatus(auth, id, status, req) {
    const item = await prisma.complianceItem.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new AppError('Compliance item not found', 404);
    stateMachineService.assertTransition('COMPLIANCE_ITEM', item.status, status);
    if (status === 'COMPLETED') {
      const steps = await approvalPolicyService.buildComplianceItemApprovalSteps({
        requesterRoleName: auth.roleName,
        type: item.type,
        priority: item.priority
      });
      const updated = await prisma.$transaction(async (tx) => {
        await createApprovalBackedStatusChange({
          auth,
          req,
          requestType: 'COMPLIANCE_ITEM',
          entityType: 'COMPLIANCE_ITEM',
          entityId: id,
          reason: `Compliance item ready for approval: ${item.title}`,
          steps,
          tx
        });
        return tx.complianceItem.update({ where: { id }, data: { status: 'UNDER_REVIEW' } });
      });
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'ComplianceItem', entityId: id, oldValues: { status: item.status }, newValues: { status: 'UNDER_REVIEW', pendingApprovalFor: 'COMPLETED' }, req });
      if (updated.ownerId) {
        await notificationService.create({ userId: updated.ownerId, type: 'SYSTEM', title: 'Compliance item submitted for approval', body: updated.title, entityType: 'ComplianceItem', entityId: id });
      }
      return updated;
    }
    const updated = await prisma.complianceItem.update({ where: { id }, data: { status } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'ComplianceItem', entityId: id, oldValues: { status: item.status }, newValues: { status }, req });
    return updated;
  },

  async createRisk(auth, data, req) {
    const severity = severityMap[`${data.likelihood}:${data.impact}`] || 'MEDIUM';
    const risk = await prisma.riskRegister.create({ data: { ...data, severity, status: 'OPEN' } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'RiskRegister', entityId: risk.id, newValues: risk, req });
    return risk;
  },

  async updateRisk(auth, id, data, req) {
    const existing = await prisma.riskRegister.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Risk not found', 404);

    const nextLikelihood = data.likelihood || existing.likelihood;
    const nextImpact = data.impact || existing.impact;
    const severity = severityMap[`${nextLikelihood}:${nextImpact}`] || existing.severity || 'MEDIUM';

    if (data.status === 'CLOSED' && highSeverityValues.has(String(severity || '').toUpperCase())) {
      const steps = await approvalPolicyService.buildRiskMitigationSteps({ requesterRoleName: auth.roleName });
      const queued = await prisma.$transaction(async (tx) => {
        await createApprovalBackedStatusChange({
          auth,
          req,
          requestType: 'RISK_MITIGATION',
          entityType: 'RISK',
          entityId: id,
          reason: `High-risk closure ready for approval: ${existing.title}`,
          steps,
          tx
        });
        return tx.riskRegister.update({
          where: { id },
          data: {
            ...data,
            severity,
            status: 'UNDER_REVIEW'
          }
        });
      });
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'RiskRegister', entityId: id, oldValues: existing, newValues: { ...queued, pendingApprovalFor: 'CLOSED' }, req });
      if (queued.ownerId) {
        await notificationService.create({ userId: queued.ownerId, type: 'SYSTEM', title: 'Risk closure submitted for approval', body: queued.title, entityType: 'RiskRegister', entityId: id });
      }
      return queued;
    }

    const updated = await prisma.riskRegister.update({
      where: { id },
      data: {
        ...data,
        severity
      }
    });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'RiskRegister', entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async createIncident(auth, data, req) {
    const incident = await prisma.incidentReport.create({ data: { ...data, reportedById: auth.userId, status: 'OPEN' } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'IncidentReport', entityId: incident.id, newValues: incident, req });
    return incident;
  },

  async updateIncidentStatus(auth, id, status, resolutionNotes, req) {
    const incident = await prisma.incidentReport.findFirst({ where: { id, deletedAt: null } });
    if (!incident) throw new AppError('Incident report not found', 404);
    stateMachineService.assertTransition('INCIDENT', incident.status, status);
    if (status === 'CLOSED') {
      const steps = await approvalPolicyService.buildIncidentClosureSteps({
        requesterRoleName: auth.roleName,
        severity: incident.severity
      });
      const queued = await prisma.$transaction(async (tx) => {
        await createApprovalBackedStatusChange({
          auth,
          req,
          requestType: 'INCIDENT_CLOSURE',
          entityType: 'INCIDENT',
          entityId: id,
          reason: `Incident closure approval requested: ${incident.title}`,
          steps,
          tx
        });
        return tx.incidentReport.update({ where: { id }, data: { resolutionNotes: resolutionNotes || incident.resolutionNotes } });
      });
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'IncidentReport', entityId: id, oldValues: { status: incident.status }, newValues: { status: queued.status, resolutionNotes, pendingApprovalFor: 'CLOSED' }, req });
      return queued;
    }
    const updated = await prisma.incidentReport.update({ where: { id }, data: { status, resolutionNotes: resolutionNotes || incident.resolutionNotes } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'IncidentReport', entityId: id, oldValues: { status: incident.status }, newValues: { status, resolutionNotes }, req });
    return updated;
  },

  async assignPolicy(auth, data, req) {
    const acknowledgement = await prisma.policyAcknowledgement.upsert({
      where: { policyDocumentId_userId: { policyDocumentId: data.policyDocumentId, userId: data.userId } },
      update: {},
      create: data
    });
    await notificationService.create({ userId: data.userId, type: 'SYSTEM', title: 'Policy acknowledgement required', body: 'A policy document requires your acknowledgement.', entityType: 'PolicyAcknowledgement', entityId: acknowledgement.id });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'PolicyAcknowledgement', entityId: acknowledgement.id, newValues: acknowledgement, req });
    return acknowledgement;
  },

  async acknowledgePolicy(auth, id, req) {
    const acknowledgement = await prisma.policyAcknowledgement.findFirst({ where: { id } });
    if (!acknowledgement || acknowledgement.userId !== auth.userId) throw new AppError('Policy acknowledgement not found', 404);
    const updated = await prisma.policyAcknowledgement.update({ where: { id }, data: { acknowledgedAt: new Date() } });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.COMPLIANCE_UPDATED, entityType: 'PolicyAcknowledgement', entityId: id, newValues: updated, req });
    return updated;
  },

  async getPolicySummary(auth, id) {
    const [document, acknowledgements, activeUsers] = await prisma.$transaction([
      prisma.document.findFirst({
        where: { id, ownerType: 'COMPLIANCE', deletedAt: null },
        include: {
          comments: {
            where: { deletedAt: null },
            include: { author: { select: { id: true, fullName: true, email: true } } },
            orderBy: { createdAt: 'desc' }
          },
          uploadedBy: { select: { id: true, fullName: true, email: true } },
          approvedBy: { select: { id: true, fullName: true, email: true } },
          department: { select: { id: true, name: true, slug: true, headId: true } }
        }
      }),
      prisma.policyAcknowledgement.findMany({
        where: { policyDocumentId: id },
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, fullName: true, email: true }
      })
    ]);

    if (!document) throw new AppError('Policy document not found', 404);

    accessControlService.assertDocumentAccess(auth, document);

    const acknowledgedUserIds = new Set(acknowledgements.map((entry) => entry.userId));
    const pendingUsers = activeUsers.filter((user) => !acknowledgedUserIds.has(user.id));
    const overdueAcknowledgements = pendingUsers;
    const acknowledgementPercentage = activeUsers.length
      ? Math.round((acknowledgements.length / activeUsers.length) * 100)
      : 0;
    const timeline = await timelineService.getTimeline('DOCUMENT', id);

    return {
      ...document,
      acknowledgements,
      acknowledgedUsers: acknowledgements,
      pendingUsers,
      overdueAcknowledgements,
      activeUsersCount: activeUsers.length,
      acknowledgementPercentage,
      enforcementIndicator: pendingUsers.length
        ? acknowledgementPercentage >= 75 ? 'AT_RISK' : 'ACTION_REQUIRED'
        : 'ENFORCED',
      timeline
    };
  }
};

module.exports = complianceService;
