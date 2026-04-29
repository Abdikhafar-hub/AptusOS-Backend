const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const workflowSupportService = require('./workflowSupportService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { ROLES } = require('../constants/roles');
const stateMachineService = require('./stateMachineService');
const domainGuardService = require('./domainGuardService');
const timelineService = require('./timelineService');

const openStatuses = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];
const boardStatusMap = {
  TODO: 'todo',
  IN_PROGRESS: 'inProgress',
  BLOCKED: 'blocked',
  IN_REVIEW: 'inReview',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const listSortableFields = new Set(['createdAt', 'updatedAt', 'dueDate', 'priority', 'status', 'title']);

const baseInclude = {
  assignedTo: { select: { id: true, fullName: true, departmentId: true, role: true } },
  assignedBy: { select: { id: true, fullName: true } },
  department: true,
  attachments: true,
  comments: {
    where: { deletedAt: null },
    include: { author: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20
  },
  customer: { select: { id: true, businessName: true } },
  opportunity: { select: { id: true, title: true, stage: true, status: true } },
  issue: { select: { id: true, title: true, status: true, severity: true } },
  visit: { select: { id: true, clientName: true, visitDate: true, visitType: true } }
};

const boardInclude = {
  assignedTo: { select: { id: true, fullName: true } },
  assignedBy: { select: { id: true, fullName: true } },
  department: { select: { id: true, name: true, slug: true } },
  _count: { select: { comments: true, attachments: true } }
};

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const trimText = (value, maxLength = 140) => {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
};

const withOverdueFlag = (task) => ({
  ...task,
  isOverdue: Boolean(task.dueDate && task.dueDate < new Date() && !['COMPLETED', 'CANCELLED'].includes(task.status))
});

const buildBoardCard = (task) => ({
  id: task.id,
  title: task.title,
  descriptionPreview: trimText(task.description),
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate,
  overdue: Boolean(task.dueDate && task.dueDate < new Date() && !['COMPLETED', 'CANCELLED'].includes(task.status)),
  assignee: task.assignedTo,
  department: task.department,
  createdBy: task.assignedBy,
  commentCount: task._count?.comments || 0,
  attachmentCount: task._count?.attachments || 0
});

const resolveSortBy = (sortBy) => (listSortableFields.has(sortBy) ? sortBy : 'createdAt');

const taskService = {
  buildWhere(auth, query = {}) {
    const where = { deletedAt: null, AND: [] };
    if (query.search) {
      where.AND.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } }
        ]
      });
    }
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.priority) where.priority = query.priority;
    if (query.customerId) where.customerId = query.customerId;
    if (query.opportunityId) where.opportunityId = query.opportunityId;
    if (query.issueId) where.issueId = query.issueId;
    if (query.visitId) where.visitId = query.visitId;
    if (query.mine === 'true') where.assignedToId = auth.userId;
    if (query.overdueOnly === 'true') {
      where.dueDate = { lt: new Date() };
      where.status = where.status || { in: openStatuses };
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = startOfDay(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = endOfDay(query.dateTo);
    }
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isHr(auth)) {
      if (accessControlService.isDepartmentHead(auth)) {
        where.AND.push({
          OR: [
            { departmentId: { in: auth.departmentIds } },
            { assignedToId: auth.userId }
          ]
        });
      } else {
        where.assignedToId = auth.userId;
      }
    }
    if (!where.AND.length) delete where.AND;
    return where;
  },

  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = this.buildWhere(auth, query);
    const resolvedSortBy = resolveSortBy(sortBy);
    const [items, total] = await prisma.$transaction([
      prisma.task.findMany({ where, include: baseInclude, skip, take: limit, orderBy: { [resolvedSortBy]: sortOrder } }),
      prisma.task.count({ where })
    ]);
    return paginated(items.map(withOverdueFlag), total, page, limit);
  },

  async board(auth, query = {}) {
    const { sortBy, sortOrder } = parsePagination(query);
    const where = this.buildWhere(auth, query);
    const resolvedSortBy = resolveSortBy(sortBy);
    const tasks = await prisma.task.findMany({
      where,
      include: boardInclude,
      orderBy: [{ status: 'asc' }, { [resolvedSortBy]: sortOrder }]
    });

    return tasks.reduce((groups, task) => {
      const bucket = boardStatusMap[task.status];
      if (!bucket) return groups;
      groups[bucket].push(buildBoardCard(task));
      return groups;
    }, {
      todo: [],
      inProgress: [],
      blocked: [],
      inReview: [],
      completed: [],
      cancelled: []
    });
  },

  async get(id, auth) {
    const task = await prisma.task.findFirst({ where: { id, deletedAt: null }, include: baseInclude });
    if (!task) throw new AppError('Task not found', 404);
    if (
      !accessControlService.isGeneralManager(auth)
      && !accessControlService.isHr(auth)
      && task.assignedToId !== auth.userId
      && !(task.departmentId && auth.departmentIds.includes(task.departmentId))
    ) {
      throw new AppError('You do not have access to this task', 403);
    }
    const timeline = await timelineService.getTimeline('TASK', id);
    return { ...withOverdueFlag(task), timeline };
  },

  async create(data, auth, req) {
    if (!data.assignedToId && !data.departmentId) throw new AppError('A task must be assigned to a user or department', 400);
    const {
      attachmentDocumentIds = [],
      mentions = [],
      ...taskData
    } = data || {};
    const assignee = data.assignedToId ? await prisma.user.findUnique({ where: { id: data.assignedToId }, include: { role: true } }) : null;
    if (assignee?.role?.name === ROLES.GENERAL_MANAGER && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only General Manager can assign tasks directly to General Manager', 403);
    }
    if (data.departmentId && !accessControlService.isGeneralManager(auth) && !accessControlService.isHr(auth)) {
      accessControlService.assertDepartmentAccess(auth, data.departmentId);
    }

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          ...taskData,
          assignedById: auth.userId
        },
        include: baseInclude
      });
      if (attachmentDocumentIds.length) {
        await tx.taskAttachment.createMany({ data: attachmentDocumentIds.map((documentId) => ({ taskId: created.id, documentId })) });
      }
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.TASK_CREATED, entityType: 'Task', entityId: created.id, newValues: created, req }, tx);
      return created;
    });
    if (task.assignedToId) {
      await notificationService.create({ userId: task.assignedToId, type: 'TASK_ASSIGNED', title: task.title, body: task.description, entityType: 'Task', entityId: task.id });
    }
    if (mentions.length) {
      await notificationService.createMany(mentions, { type: 'MENTION', title: `Mentioned in task ${task.title}`, body: task.description, entityType: 'Task', entityId: task.id });
    }
    return this.get(task.id, auth);
  },

  async update(id, data, auth, req) {
    const existing = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(existing, 'Task', ['COMPLETED', 'CANCELLED']);
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isHr(auth) && existing.assignedById !== auth.userId && existing.assignedToId !== auth.userId) {
      throw new AppError('You do not have permission to update this task', 403);
    }
    const updated = await prisma.task.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        assignedToId: data.assignedToId,
        departmentId: data.departmentId,
        priority: data.priority,
        dueDate: data.dueDate,
        requiresApproval: data.requiresApproval,
        recurringRule: data.recurringRule,
        parentTaskId: data.parentTaskId,
        customerId: data.customerId,
        opportunityId: data.opportunityId,
        issueId: data.issueId,
        visitId: data.visitId
      },
      include: baseInclude
    });
    if (data.attachmentDocumentIds?.length) {
      await prisma.taskAttachment.createMany({ data: data.attachmentDocumentIds.map((documentId) => ({ taskId: id, documentId })), skipDuplicates: true });
    }
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.TASK_UPDATED, entityType: 'Task', entityId: id, oldValues: existing, newValues: updated, req });
    return this.get(id, auth);
  },

  async updateStatus(id, nextStatus, auth, comment, req) {
    const existing = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(existing, 'Task', ['COMPLETED', 'CANCELLED']);
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isHr(auth) && existing.assignedToId !== auth.userId && existing.assignedById !== auth.userId) {
      throw new AppError('You do not have permission to change this task status', 403);
    }
    stateMachineService.assertTransition('TASK', existing.status, nextStatus);
    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: nextStatus,
        completedAt: nextStatus === 'COMPLETED' ? new Date() : null
      }
    });
    if (comment) {
      await workflowSupportService.createComment({ authorId: auth.userId, entityType: 'TASK', entityId: id, body: comment }, req);
    }
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.TASK_UPDATED, entityType: 'Task', entityId: id, oldValues: { status: existing.status }, newValues: { status: nextStatus }, req });
    if (updated.assignedToId && updated.assignedToId !== auth.userId) {
      await notificationService.create({ userId: updated.assignedToId, type: 'TASK_ASSIGNED', title: `Task status updated: ${updated.title}`, body: nextStatus, entityType: 'Task', entityId: id });
    }
    return this.get(id, auth);
  },

  async addAttachments(id, documentIds, auth, req) {
    const existing = await this.get(id, auth);
    domainGuardService.cannotEditAfterFinalState(existing, 'Task', ['COMPLETED', 'CANCELLED']);
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isHr(auth) && existing.assignedById !== auth.userId && existing.assignedToId !== auth.userId) {
      throw new AppError('You do not have permission to add task attachments', 403);
    }
    await prisma.taskAttachment.createMany({ data: documentIds.map((documentId) => ({ taskId: id, documentId })), skipDuplicates: true });
    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.TASK_UPDATED, entityType: 'Task', entityId: id, newValues: { documentIds }, req });
    return this.get(id, auth);
  }
};

module.exports = taskService;
