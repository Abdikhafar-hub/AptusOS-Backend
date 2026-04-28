const prisma = require('../prisma/client');
const { parsePagination, paginated } = require('../utils/pagination');
const { presentAuditLogs, CATEGORY_ACTIONS } = require('./auditPresentationService');

function inferActionsFromSearch(termRaw) {
  const term = String(termRaw || '').toLowerCase();
  const actions = new Set();

  if (term.includes('login')) {
    actions.add('USER_LOGIN');
    actions.add('USER_FAILED_LOGIN');
  }
  if (term.includes('logout')) actions.add('USER_LOGOUT');
  if (term.includes('email') || term.includes('mail') || term.includes('message')) {
    actions.add('MESSAGE_SENT');
    actions.add('MESSAGE_EMAIL_DELIVERED');
    actions.add('MESSAGE_EMAIL_FAILED');
  }
  if (term.includes('approval') || term.includes('approve') || term.includes('reject')) {
    actions.add('APPROVAL_CREATED');
    actions.add('APPROVAL_APPROVED');
    actions.add('APPROVAL_REJECTED');
  }
  if (term.includes('leave')) {
    actions.add('LEAVE_REQUESTED');
    actions.add('LEAVE_APPROVED');
    actions.add('LEAVE_UPDATED');
    actions.add('LEAVE_CREATED_FOR_STAFF');
  }
  if (term.includes('finance') || term.includes('payment') || term.includes('paid')) {
    actions.add('FINANCE_REQUEST_CREATED');
    actions.add('FINANCE_REQUEST_UPDATED');
    actions.add('FINANCE_REQUEST_PAID');
  }
  if (term.includes('document') || term.includes('upload')) {
    actions.add('DOCUMENT_UPLOADED');
    actions.add('DOCUMENT_APPROVED');
    actions.add('DOCUMENT_REJECTED');
  }

  return [...actions];
}

const auditLogService = {
  async list(query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = {};
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.actorId) where.actorId = query.actorId;
    if (query.user) {
      where.actor = {
        ...(where.actor || {}),
        fullName: { contains: String(query.user), mode: 'insensitive' }
      };
    }
    if (query.departmentId) {
      where.actor = {
        ...(where.actor || {}),
        departmentId: String(query.departmentId)
      };
    }

    if (query.category) {
      const normalized = String(query.category).trim();
      const actionsForCategory = CATEGORY_ACTIONS[normalized];
      if (Array.isArray(actionsForCategory) && actionsForCategory.length) {
        where.action = { in: actionsForCategory };
      }
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) {
        const start = new Date(query.dateFrom);
        if (!Number.isNaN(start.valueOf())) where.createdAt.gte = start;
      }
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        if (!Number.isNaN(end.valueOf())) {
          // If the frontend sends a date-only value, include the whole day.
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo))) {
            end.setHours(23, 59, 59, 999);
          }
          where.createdAt.lte = end;
        }
      }
    }

    if (query.search) {
      const term = String(query.search).trim();
      if (term) {
        const inferredActions = inferActionsFromSearch(term);
        where.OR = [
          { entityType: { contains: term, mode: 'insensitive' } },
          { entityId: { contains: term, mode: 'insensitive' } },
          { actor: { fullName: { contains: term, mode: 'insensitive' } } },
          { actor: { email: { contains: term, mode: 'insensitive' } } },
          ...(inferredActions.length ? [{ action: { in: inferredActions } }] : [])
        ];
      }
    }

    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              email: true,
              departmentId: true,
              role: { select: { displayName: true } }
            }
          }
        }
      }),
      prisma.auditLog.count({ where })
    ]);

    const presented = await presentAuditLogs(items, prisma);
    return paginated(presented, total, page, limit);
  }
};

module.exports = auditLogService;
