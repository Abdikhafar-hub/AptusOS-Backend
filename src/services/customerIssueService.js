const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const approvalService = require('./approvalService');
const approvalPolicyService = require('./approvalPolicyService');
const customerAlertService = require('./customerAlertService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const issueInclude = {
  customer: { select: { id: true, businessName: true, customerHealthStatus: true } },
  reportedBy: { select: { id: true, fullName: true, email: true } },
  assignedTo: { select: { id: true, fullName: true, email: true } }
};

async function createSlaAlertIfBreached(tx, issue, auth, req) {
  if (!issue.slaDueAt) return;
  const isOpen = ['OPEN', 'ESCALATED', 'IN_PROGRESS'].includes(issue.status);
  if (!isOpen) return;
  if (new Date(issue.slaDueAt).getTime() > Date.now()) return;

  await customerAlertService.create(issue.customerId, {
    alertType: 'ISSUE_SLA',
    title: 'Issue SLA breached',
    description: `Issue ${issue.title} has crossed SLA due time.`,
    severity: ['HIGH', 'CRITICAL'].includes(issue.severity) ? 'CRITICAL' : 'HIGH',
    dueDate: issue.slaDueAt,
    status: 'OPEN'
  }, auth, req, tx);
}

const customerIssueService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.reportedById) where.reportedById = query.reportedById;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.status) where.status = query.status;
    if (query.issueType) where.issueType = query.issueType;
    if (query.severity) where.severity = query.severity;
    if (query.escalationDepartment) where.escalationDepartment = query.escalationDepartment;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { resolutionNotes: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.customerIssue.findMany({ where, include: issueInclude, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.customerIssue.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async create(auth, data, req) {
    const created = await prisma.$transaction(async (tx) => {
      const issue = await tx.customerIssue.create({
        data: {
          customerId: data.customerId,
          reportedById: data.reportedById || auth.userId,
          assignedToId: data.assignedToId || null,
          title: data.title,
          description: data.description,
          issueType: data.issueType,
          severity: data.severity || 'MEDIUM',
          status: data.status || 'OPEN',
          escalationDepartment: data.escalationDepartment,
          slaDueAt: data.slaDueAt ? new Date(data.slaDueAt) : null,
          resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : null,
          resolutionNotes: data.resolutionNotes
        },
        include: issueInclude
      });

      await createSlaAlertIfBreached(tx, issue, auth, req);
      return issue;
    });

    if (created.assignedToId && created.assignedToId !== auth.userId) {
      await notificationService.create({
        userId: created.assignedToId,
        type: 'SYSTEM',
        title: 'Customer issue assigned',
        body: created.title,
        entityType: 'CustomerIssue',
        entityId: created.id
      });
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerIssue',
      entityId: created.id,
      newValues: {
        ...created,
        summary: `Issue created for ${created.customer?.businessName || 'customer'}: ${created.title}`
      },
      req
    });

    return created;
  },

  async get(auth, id) {
    const issue = await prisma.customerIssue.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...issueInclude,
        tasks: {
          where: { deletedAt: null },
          include: { assignedTo: { select: { id: true, fullName: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 30
        }
      }
    });

    if (!issue) throw new AppError('Issue not found', 404);

    const approvalRequest = await prisma.approvalRequest.findFirst({
      where: { entityType: 'CUSTOMER_ISSUE', entityId: id, status: { in: ['PENDING', 'NEEDS_MORE_INFO'] }, deletedAt: null },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        currentApprover: { select: { id: true, fullName: true, email: true } },
        steps: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      ...issue,
      approvalRequest
    };
  },

  async update(auth, id, data, req) {
    const existing = await prisma.customerIssue.findFirst({ where: { id, deletedAt: null }, include: issueInclude });
    if (!existing) throw new AppError('Issue not found', 404);

    const updated = await prisma.$transaction(async (tx) => {
      const issue = await tx.customerIssue.update({
        where: { id },
        data: {
          customerId: data.customerId,
          assignedToId: data.assignedToId,
          title: data.title,
          description: data.description,
          issueType: data.issueType,
          severity: data.severity,
          status: data.status,
          escalationDepartment: data.escalationDepartment,
          slaDueAt: data.slaDueAt ? new Date(data.slaDueAt) : undefined,
          resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : undefined,
          resolutionNotes: data.resolutionNotes
        },
        include: issueInclude
      });

      await createSlaAlertIfBreached(tx, issue, auth, req);
      return issue;
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerIssue',
      entityId: id,
      oldValues: existing,
      newValues: {
        ...updated,
        summary: `Issue updated: ${updated.title}`
      },
      req
    });

    return updated;
  },

  async escalate(auth, id, payload, req) {
    const existing = await prisma.customerIssue.findFirst({ where: { id, deletedAt: null }, include: issueInclude });
    if (!existing) throw new AppError('Issue not found', 404);

    const updated = await prisma.customerIssue.update({
      where: { id },
      data: {
        status: 'ESCALATED',
        escalationDepartment: payload.escalationDepartment,
        assignedToId: payload.assignedToId || existing.assignedToId,
        resolutionNotes: payload.note
          ? `${existing.resolutionNotes || ''}\n\nEscalation Note:\n${payload.note}`.trim()
          : existing.resolutionNotes
      },
      include: issueInclude
    });

    const recipients = [updated.assignedToId].filter(Boolean);
    if (recipients.length) {
      await notificationService.createMany(recipients, {
        type: 'SYSTEM',
        title: 'Issue escalated',
        body: updated.title,
        entityType: 'CustomerIssue',
        entityId: updated.id
      });
    }

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerIssue',
      entityId: id,
      oldValues: { status: existing.status, escalationDepartment: existing.escalationDepartment },
      newValues: {
        status: updated.status,
        escalationDepartment: updated.escalationDepartment,
        summary: `Issue escalated: ${updated.title}`
      },
      req
    });

    return updated;
  },

  async resolve(auth, id, payload, req) {
    const existing = await prisma.customerIssue.findFirst({ where: { id, deletedAt: null }, include: issueInclude });
    if (!existing) throw new AppError('Issue not found', 404);

    const updated = await prisma.customerIssue.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: payload?.resolvedAt ? new Date(payload.resolvedAt) : new Date(),
        resolutionNotes: payload?.resolutionNotes
      },
      include: issueInclude
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerIssue',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: 'RESOLVED',
        summary: `Issue resolved: ${updated.title}`
      },
      req
    });

    return updated;
  },

  async close(auth, id, payload, req) {
    const existing = await prisma.customerIssue.findFirst({ where: { id, deletedAt: null }, include: issueInclude });
    if (!existing) throw new AppError('Issue not found', 404);

    if (['CRITICAL'].includes(String(existing.severity || '').toUpperCase()) && !payload?.resolutionNotes) {
      throw new AppError('Closing a critical issue requires resolution notes', 400);
    }

    const mustApproveClosure = ['CRITICAL'].includes(String(existing.severity || '').toUpperCase());

    if (mustApproveClosure) {
      const openApproval = await prisma.approvalRequest.findFirst({
        where: {
          entityType: 'CUSTOMER_ISSUE',
          entityId: id,
          status: { in: ['PENDING', 'NEEDS_MORE_INFO'] },
          deletedAt: null
        }
      });
      if (openApproval) throw new AppError('This critical issue already has a pending closure approval', 400);

      const steps = await approvalPolicyService.buildCriticalIssueClosureSteps({ requesterRoleName: auth.roleName });
      if (!steps.length) throw new AppError('Unable to resolve approvers for critical issue closure', 400);

      const queued = await prisma.$transaction(async (tx) => {
        const issue = await tx.customerIssue.update({
          where: { id },
          data: {
            status: 'ESCALATED',
            resolvedAt: new Date(),
            resolutionNotes: payload?.resolutionNotes || existing.resolutionNotes
          },
          include: issueInclude
        });

        await approvalService.create({
          requestType: 'CUSTOMER_ISSUE_CLOSURE',
          entityType: 'CUSTOMER_ISSUE',
          entityId: id,
          requestedById: auth.userId,
          reason: `Critical issue closure requested: ${issue.title}`,
          steps,
          tx
        }, auth.userId, req);

        return issue;
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
        entityType: 'CustomerIssue',
        entityId: id,
        oldValues: { status: existing.status },
        newValues: {
          status: queued.status,
          summary: `Critical issue closure submitted for approval: ${queued.title}`
        },
        req
      });

      return queued;
    }

    const updated = await prisma.customerIssue.update({
      where: { id },
      data: {
        status: 'CLOSED',
        resolvedAt: existing.resolvedAt || new Date(),
        resolutionNotes: payload?.resolutionNotes || existing.resolutionNotes
      },
      include: issueInclude
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_UPDATED,
      entityType: 'CustomerIssue',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: 'CLOSED',
        summary: `Issue closed: ${updated.title}`
      },
      req
    });

    return updated;
  }
};

module.exports = customerIssueService;
