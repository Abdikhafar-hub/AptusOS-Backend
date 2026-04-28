const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const customerOnboardingService = require('./customerOnboardingService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

function deriveHealthStatus(item = {}) {
  if (item.blacklistStatus === 'BLOCKED' || item.blockedForCredit || item.accountStatus === 'SUSPENDED') return 'BLOCKED';
  const now = Date.now();
  const licenseExpired = item.licenseExpiryDate && new Date(item.licenseExpiryDate).getTime() < now;
  const ppbExpired = item.ppbLicenseExpiryDate && new Date(item.ppbLicenseExpiryDate).getTime() < now;
  if (licenseExpired || ppbExpired) return 'AT_RISK';
  if (item.paymentDelayFlag || ['HIGH', 'CRITICAL'].includes(String(item.complianceRiskLevel || '').toUpperCase())) return 'WATCH';
  return 'GOOD';
}

function buildComplianceScore(customer) {
  if (!customer) return 0;
  const score = Number(customer.complianceReadinessScore || customer.complianceCompletenessPercentage || 0);
  if (Number.isFinite(score)) return Math.max(0, Math.min(100, Math.round(score)));

  let fallback = 80;
  if (['HIGH', 'CRITICAL'].includes(String(customer.complianceRiskLevel || '').toUpperCase())) fallback -= 30;
  if (['FAILED', 'NEEDS_REVIEW'].includes(String(customer.dueDiligenceStatus || '').toUpperCase())) fallback -= 20;
  if (customer.licenseExpiryTracking?.some((entry) => typeof entry.daysUntilExpiry === 'number' && entry.daysUntilExpiry <= 0)) fallback -= 25;
  return Math.max(0, fallback);
}

const salesComplianceService = {
  async getDashboard(auth) {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(startOfToday);
    endOfWeek.setDate(startOfToday.getDate() + 7);

    const soon = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));

    const [
      customersByStatus,
      activeCustomers,
      keyAccounts,
      pendingOnboarding,
      expiringLicenses,
      highRiskCustomers,
      customerHealthSummary,
      territoryCoverage,
      visitsDueToday,
      visitsDueWeek,
      missedVisits,
      openIssues,
      slaBreaches,
      opportunities,
      opportunitiesByStage,
      pipelineAggregate,
      pendingDiscountApprovals,
      feedbackByType,
      unresolvedIssues,
      pendingApprovals,
      unreadNotifications,
      unreadMessages,
      recentActivity,
      criticalAlerts,
      alertsSummary,
      issueByDepartment,
      unresolvedComplaints,
      onboardingPipeline
    ] = await prisma.$transaction([
      prisma.customerOnboarding.groupBy({ by: ['accountStatus'], where: { deletedAt: null }, _count: true }),
      prisma.customerOnboarding.count({ where: { deletedAt: null, accountStatus: 'ACTIVE' } }),
      prisma.customerOnboarding.count({ where: { deletedAt: null, isKeyAccount: true } }),
      prisma.customerOnboarding.count({ where: { deletedAt: null, status: { in: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'] } } }),
      prisma.customerOnboarding.count({
        where: {
          deletedAt: null,
          OR: [
            { licenseExpiryDate: { lte: soon } },
            { ppbLicenseExpiryDate: { lte: soon } },
            { businessPermitExpiryDate: { lte: soon } },
            { taxComplianceExpiryDate: { lte: soon } }
          ]
        }
      }),
      prisma.customerOnboarding.count({ where: { deletedAt: null, complianceRiskLevel: { in: ['HIGH', 'CRITICAL'] } } }),
      prisma.customerOnboarding.groupBy({ by: ['customerHealthStatus'], where: { deletedAt: null }, _count: true }),
      prisma.salesTerritory.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          assignedOfficer: { select: { id: true, fullName: true } },
          _count: { select: { customers: true, routes: true, clientVisits: true } }
        },
        orderBy: { name: 'asc' },
        take: 50
      }),
      prisma.clientVisitNote.count({ where: { deletedAt: null, visitDate: { gte: startOfToday, lt: endOfToday } } }),
      prisma.clientVisitNote.count({ where: { deletedAt: null, visitDate: { gte: startOfToday, lt: endOfWeek } } }),
      prisma.visitRouteStop.count({ where: { status: 'MISSED', route: { deletedAt: null, routeDate: { gte: startOfToday, lt: endOfWeek } } } }),
      prisma.customerIssue.count({ where: { deletedAt: null, status: { in: ['OPEN', 'ESCALATED', 'IN_PROGRESS'] } } }),
      prisma.customerIssue.count({ where: { deletedAt: null, status: { in: ['OPEN', 'ESCALATED', 'IN_PROGRESS'] }, slaDueAt: { lt: now } } }),
      prisma.salesOpportunity.count({ where: { deletedAt: null, status: 'OPEN' } }),
      prisma.salesOpportunity.groupBy({ by: ['stage'], where: { deletedAt: null }, _count: true }),
      prisma.salesOpportunity.aggregate({ where: { deletedAt: null, status: 'OPEN' }, _sum: { expectedValue: true } }),
      prisma.discountRequest.count({ where: { deletedAt: null, status: 'UNDER_REVIEW' } }),
      prisma.productFeedback.groupBy({ by: ['feedbackType'], where: { deletedAt: null }, _count: true }),
      prisma.customerIssue.count({ where: { deletedAt: null, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      prisma.approvalRequest.count({ where: { status: 'PENDING', OR: [{ currentApproverId: auth.userId }, { requestedById: auth.userId }] } }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null, type: { in: ['DIRECT_MESSAGE', 'DEPARTMENT_MESSAGE', 'MENTION'] } } }),
      prisma.auditLog.findMany({
        where: {
          entityType: {
            in: [
              'CustomerOnboarding',
              'SalesTerritory',
              'VisitRoute',
              'ClientVisitNote',
              'CustomerIssue',
              'SalesOpportunity',
              'DiscountRequest',
              'ProductFeedback',
              'CustomerAlert',
              'Task'
            ]
          }
        },
        include: { actor: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      prisma.customerAlert.count({ where: { deletedAt: null, status: 'OPEN', severity: 'CRITICAL' } }),
      prisma.customerAlert.groupBy({ by: ['alertType'], where: { deletedAt: null, status: 'OPEN' }, _count: true }),
      prisma.customerIssue.groupBy({ by: ['escalationDepartment'], where: { deletedAt: null, status: { in: ['OPEN', 'ESCALATED', 'IN_PROGRESS'] } }, _count: true }),
      prisma.complaintEscalation.count({ where: { deletedAt: null, status: { in: ['OPEN', 'INVESTIGATING'] } } }),
      prisma.customerOnboarding.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true })
    ]);

    const accountsNotVisited = await prisma.customerOnboarding.count({
      where: {
        deletedAt: null,
        OR: [
          { lastVisitDate: null },
          { lastVisitDate: { lt: new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)) } }
        ]
      }
    });

    return {
      customerCounts: customersByStatus,
      activeCustomers,
      keyAccounts,
      pendingOnboarding,
      complianceAlerts: alertsSummary,
      licenseExpiries: expiringLicenses,
      highRiskCustomers,
      customerHealthSummary,
      keyAccountsSummary: {
        total: keyAccounts,
        active: await prisma.customerOnboarding.count({ where: { deletedAt: null, isKeyAccount: true, accountStatus: 'ACTIVE' } })
      },
      onboardingPipeline,
      territoryCoverage: {
        territories: territoryCoverage,
        accountsNotVisited
      },
      visits: {
        dueToday: visitsDueToday,
        dueWeek: visitsDueWeek,
        missedVisits
      },
      issues: {
        open: openIssues,
        slaBreaches,
        unresolved: unresolvedIssues,
        byEscalationDepartment: issueByDepartment,
        unresolvedComplaints
      },
      opportunities: {
        open: opportunities,
        byStage: opportunitiesByStage,
        expectedPipelineValue: pipelineAggregate._sum.expectedValue || 0
      },
      discountRequests: {
        pendingApproval: pendingDiscountApprovals
      },
      productFeedback: {
        summary: feedbackByType
      },
      approvals: {
        pending: pendingApprovals
      },
      communication: {
        unreadNotifications,
        unreadMessages
      },
      alerts: {
        critical: criticalAlerts,
        openByType: alertsSummary
      },
      recentActivity
    };
  },

  async listCustomers(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.search) {
      where.OR = [
        { businessName: { contains: query.search, mode: 'insensitive' } },
        { county: { contains: query.search, mode: 'insensitive' } },
        { town: { contains: query.search, mode: 'insensitive' } },
        { contactPersonName: { contains: query.search, mode: 'insensitive' } }
      ];
    }
    if (query.status) where.accountStatus = query.status;
    if (query.complianceRiskLevel) where.complianceRiskLevel = query.complianceRiskLevel;
    if (query.customerHealthStatus) where.customerHealthStatus = query.customerHealthStatus;
    if (query.territoryId) where.territoryId = query.territoryId;
    if (query.assignedOfficerId) where.assignedOfficerId = query.assignedOfficerId;
    if (query.accountOwnerId) where.accountOwnerId = query.accountOwnerId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [items, total] = await prisma.$transaction([
      prisma.customerOnboarding.findMany({
        where,
        include: {
          assignedOfficer: { select: { id: true, fullName: true } },
          accountOwner: { select: { id: true, fullName: true } },
          territory: { select: { id: true, name: true, region: true, county: true } },
          _count: {
            select: {
              opportunities: true,
              issues: true,
              alerts: true,
              productFeedback: true,
              tasks: true,
              clientVisits: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.customerOnboarding.count({ where })
    ]);

    const normalized = items.map((item) => ({
      ...item,
      customerHealthStatus: item.customerHealthStatus || deriveHealthStatus(item)
    }));

    return paginated(normalized, total, page, limit);
  },

  async getCustomer(auth, id) {
    const detail = await customerOnboardingService.get(id, auth);
    return {
      ...detail,
      profile: {
        id: detail.id,
        businessName: detail.businessName,
        businessType: detail.businessType,
        accountTier: detail.accountTier,
        accountStatus: detail.accountStatus,
        customerHealthStatus: detail.customerHealthStatus || deriveHealthStatus(detail),
        riskLevel: detail.complianceRiskLevel,
        isKeyAccount: detail.isKeyAccount,
        territory: detail.territory,
        accountOwner: detail.accountOwner,
        assignedOfficer: detail.assignedOfficer
      },
      complianceScore: buildComplianceScore(detail),
      expiryWarnings: (detail.licenseExpiryTracking || []).filter((entry) => typeof entry.daysUntilExpiry === 'number' && entry.daysUntilExpiry <= 30),
      documentChecklist: detail.documentChecklist || [],
      auditTimeline: detail.timeline || []
    };
  },

  async updateCustomer(auth, id, payload, req) {
    const existing = await prisma.customerOnboarding.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Customer not found', 404);

    const merged = { ...existing, ...payload };
    const customerHealthStatus = payload.customerHealthStatus || deriveHealthStatus(merged);

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.customerOnboarding.update({
        where: { id },
        data: {
          ...payload,
          customerHealthStatus,
          accountStatus: payload.accountStatus,
          complianceNotes: payload.complianceNotes,
          territoryId: payload.territoryId,
          accountOwnerId: payload.accountOwnerId,
          nextFollowUpDate: payload.nextFollowUpDate ? new Date(payload.nextFollowUpDate) : payload.nextFollowUpDate,
          lastVisitDate: payload.lastVisitDate ? new Date(payload.lastVisitDate) : payload.lastVisitDate
        }
      });

      if ((record.licenseExpiryDate && new Date(record.licenseExpiryDate).getTime() < Date.now()) || (record.ppbLicenseExpiryDate && new Date(record.ppbLicenseExpiryDate).getTime() < Date.now())) {
        await tx.customerAlert.create({
          data: {
            customerId: id,
            alertType: 'LICENSE_EXPIRY',
            title: 'License expiry detected',
            description: `License expiry detected for ${record.businessName}.`,
            severity: 'HIGH',
            status: 'OPEN',
            dueDate: record.licenseExpiryDate || record.ppbLicenseExpiryDate || null
          }
        });
      }

      return record;
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerOnboarding',
      entityId: id,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Customer profile updated: ${updated.businessName}`
      },
      req
    });

    if (updated.assignedOfficerId && updated.assignedOfficerId !== auth.userId) {
      await notificationService.create({
        userId: updated.assignedOfficerId,
        type: 'SYSTEM',
        title: 'Customer profile updated',
        body: updated.businessName,
        entityType: 'CustomerOnboarding',
        entityId: updated.id
      });
    }

    return this.getCustomer(auth, id);
  },

  async listCustomerNotes(auth, customerId) {
    const customer = await prisma.customerOnboarding.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw new AppError('Customer not found', 404);

    return prisma.customerAccountNote.findMany({
      where: { customerId },
      include: { createdBy: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    });
  },

  async createCustomerNote(auth, customerId, payload, req) {
    const customer = await prisma.customerOnboarding.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw new AppError('Customer not found', 404);

    const created = await prisma.customerAccountNote.create({
      data: {
        customerId,
        createdById: auth.userId,
        note: payload.note,
        noteType: payload.noteType || 'GENERAL'
      },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } }
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerAccountNote',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Account note added for ${customer.businessName}`
      },
      req
    });

    return created;
  }
};

module.exports = salesComplianceService;
