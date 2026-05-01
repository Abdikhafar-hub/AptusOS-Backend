const slugify = require('slugify');
const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const accessControlService = require('./accessControlService');
const notificationService = require('./notificationService');

const openTaskStatuses = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];
const staffSelect = {
  id: true,
  fullName: true,
  email: true,
  jobTitle: true,
  employmentStatus: true,
  profilePhotoUrl: true,
  departmentId: true,
  joinDate: true,
  isActive: true,
  role: {
    select: {
      id: true,
      name: true,
      displayName: true
    }
  }
};

const taskPreviewInclude = {
  assignedTo: { select: { id: true, fullName: true } },
  assignedBy: { select: { id: true, fullName: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { comments: true, attachments: true } }
};

const documentPreviewInclude = {
  uploadedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } }
};

const approvalPreviewInclude = {
  requestedBy: { select: { id: true, fullName: true } },
  currentApprover: { select: { id: true, fullName: true } }
};

const countByStatus = (items, key) => items.reduce((result, item) => ({
  ...result,
  [item[key]]: typeof item._count === 'number' ? item._count : item._count?._all
}), {});

const trimText = (value, maxLength = 120) => {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
};

const isDepartmentHeadForDepartment = (auth, department) => (
  accessControlService.isDepartmentHead(auth) && department.headId === auth.userId
);

const normalizeOptionalString = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const normalizeDepartmentCode = (value) => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  return normalized.toUpperCase();
};

async function resolveHeadId(tx, headId) {
  const normalizedHeadId = normalizeOptionalString(headId);
  if (!normalizedHeadId) return null;

  const head = await tx.user.findFirst({
    where: {
      id: normalizedHeadId,
      deletedAt: null
    },
    select: { id: true }
  });

  if (!head) {
    throw new AppError('Selected department head was not found', 422);
  }

  return head.id;
}

async function buildCreateDepartmentData(tx, data) {
  return {
    name: String(data.name).trim(),
    code: normalizeDepartmentCode(data.code),
    description: normalizeOptionalString(data.description),
    businessUnit: normalizeOptionalString(data.businessUnit),
    costCenter: normalizeOptionalString(data.costCenter),
    location: normalizeOptionalString(data.location),
    contactEmail: normalizeOptionalString(data.contactEmail),
    contactPhone: normalizeOptionalString(data.contactPhone),
    mission: normalizeOptionalString(data.mission),
    operatingNotes: normalizeOptionalString(data.operatingNotes),
    status: normalizeOptionalString(data.status),
    headId: await resolveHeadId(tx, data.headId),
    slug: data.slug || slugify(data.name, { lower: true, strict: true })
  };
}

async function buildUpdateDepartmentData(tx, data) {
  const updateData = {};

  if (data.name !== undefined) {
    updateData.name = String(data.name).trim();
    updateData.slug = slugify(data.name, { lower: true, strict: true });
  }

  if (data.description !== undefined) {
    updateData.description = normalizeOptionalString(data.description) || null;
  }

  if (data.code !== undefined) {
    updateData.code = normalizeDepartmentCode(data.code) || null;
  }

  if (data.businessUnit !== undefined) {
    updateData.businessUnit = normalizeOptionalString(data.businessUnit) || null;
  }

  if (data.costCenter !== undefined) {
    updateData.costCenter = normalizeOptionalString(data.costCenter) || null;
  }

  if (data.location !== undefined) {
    updateData.location = normalizeOptionalString(data.location) || null;
  }

  if (data.contactEmail !== undefined) {
    updateData.contactEmail = normalizeOptionalString(data.contactEmail) || null;
  }

  if (data.contactPhone !== undefined) {
    updateData.contactPhone = normalizeOptionalString(data.contactPhone) || null;
  }

  if (data.mission !== undefined) {
    updateData.mission = normalizeOptionalString(data.mission) || null;
  }

  if (data.operatingNotes !== undefined) {
    updateData.operatingNotes = normalizeOptionalString(data.operatingNotes) || null;
  }

  if (data.status !== undefined) {
    updateData.status = normalizeOptionalString(data.status);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'headId')) {
    updateData.headId = await resolveHeadId(tx, data.headId);
  }

  return updateData;
}

async function getDepartmentById(id) {
  const item = await prisma.department.findFirst({
    where: { id, deletedAt: null },
    include: {
      head: { select: staffSelect },
      staff: { select: staffSelect },
      channels: true
    }
  });
  if (!item) throw new AppError('Department not found', 404);
  return item;
}

async function getLinkedApprovalWhere(departmentId) {
  const [documents, financeRequests, requisitions, leaveRequests, hrActions] = await prisma.$transaction([
    prisma.document.findMany({ where: { departmentId, deletedAt: null }, select: { id: true } }),
    prisma.financeRequest.findMany({ where: { departmentId, deletedAt: null }, select: { id: true } }),
    prisma.requisition.findMany({ where: { departmentId, deletedAt: null }, select: { id: true } }),
    prisma.leaveRequest.findMany({
      where: { employee: { departmentId }, deletedAt: null },
      select: { id: true }
    }),
    prisma.hRAction.findMany({
      where: { employee: { departmentId }, deletedAt: null },
      select: { id: true }
    })
  ]);

  const filters = [
    ...(documents.length ? [{ entityType: 'DOCUMENT', entityId: { in: documents.map((item) => item.id) } }] : []),
    ...(financeRequests.length ? [{ entityType: 'FINANCE_REQUEST', entityId: { in: financeRequests.map((item) => item.id) } }] : []),
    ...(requisitions.length ? [{ entityType: 'REQUISITION', entityId: { in: requisitions.map((item) => item.id) } }] : []),
    ...(leaveRequests.length ? [{ entityType: 'LEAVE_REQUEST', entityId: { in: leaveRequests.map((item) => item.id) } }] : []),
    ...(hrActions.length ? [{ entityType: 'HR_ACTION', entityId: { in: hrActions.map((item) => item.id) } }] : [])
  ];

  return {
    filters,
    relatedIds: {
      documentIds: documents.map((item) => item.id),
      financeRequestIds: financeRequests.map((item) => item.id),
      requisitionIds: requisitions.map((item) => item.id),
      leaveRequestIds: leaveRequests.map((item) => item.id),
      hrActionIds: hrActions.map((item) => item.id)
    }
  };
}

const departmentService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isHr(auth)) {
      where.id = { in: auth.departmentIds };
    }
    const [items, total] = await prisma.$transaction([
      prisma.department.findMany({ where, include: { head: { select: { id: true, fullName: true, email: true } }, _count: { select: { staff: true, tasks: true, documents: true } } }, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.department.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async get(id, auth) {
    const item = await getDepartmentById(id);
    accessControlService.assertDepartmentAccess(auth, id);
    return item;
  },

  async create(data, actorId, req) {
    const department = await prisma.$transaction(async (tx) => {
      const createData = await buildCreateDepartmentData(tx, data);
      const created = await tx.department.create({ data: createData });
      await tx.channel.create({ data: { name: `${created.name} Channel`, slug: `${created.slug}-channel`, departmentId: created.id } });
      await auditService.log({ actorId, action: AUDIT_ACTIONS.DEPARTMENT_CHANGED, entityType: 'Department', entityId: created.id, newValues: created, req }, tx);
      return created;
    });
    return department;
  },

  async update(id, data, actorId, req) {
    const existing = await this.get(id, req.auth);
    const updated = await prisma.$transaction(async (tx) => {
      const updateData = await buildUpdateDepartmentData(tx, data);
      return tx.department.update({ where: { id }, data: updateData });
    });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DEPARTMENT_CHANGED, entityType: 'Department', entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async archive(id, actorId, req) {
    accessControlService.assertDepartmentAccess(req.auth, id);
    const [activeStaff, openTasks, pendingApprovals, openFinanceRequests] = await prisma.$transaction([
      prisma.user.count({ where: { departmentId: id, employmentStatus: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'] }, deletedAt: null } }),
      prisma.task.count({ where: { departmentId: id, deletedAt: null, status: { in: openTaskStatuses } } }),
      prisma.approvalRequest.count({ where: { status: 'PENDING', entityType: { in: ['LEAVE_REQUEST', 'FINANCE_REQUEST', 'REQUISITION', 'HR_ACTION'] } } }),
      prisma.financeRequest.count({ where: { departmentId: id, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } } })
    ]);
    if (activeStaff || openTasks || pendingApprovals || openFinanceRequests) {
      throw new AppError('Department cannot be archived while active staff or critical open records exist', 400);
    }
    const updated = await prisma.department.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DEPARTMENT_CHANGED, entityType: 'Department', entityId: id, newValues: updated, req });
    return updated;
  },

  async addStaff(departmentId, userId, actorId, req) {
    accessControlService.assertDepartmentAccess(req.auth, departmentId);
    const result = await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { departmentId } }),
      prisma.departmentMember.upsert({ where: { departmentId_userId: { departmentId, userId } }, update: {}, create: { departmentId, userId } })
    ]);
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DEPARTMENT_CHANGED, entityType: 'Department', entityId: departmentId, newValues: { userId }, req });
    await notificationService.create({
      userId,
      type: 'SYSTEM',
      title: 'Department assignment updated',
      body: 'You have been added to a department.',
      entityType: 'Department',
      entityId: departmentId
    });
    return result[1];
  },

  async removeStaff(departmentId, userId, actorId, req) {
    accessControlService.assertDepartmentAccess(req.auth, departmentId);
    await prisma.departmentMember.deleteMany({ where: { departmentId, userId } });
    await prisma.user.updateMany({ where: { id: userId, departmentId }, data: { departmentId: null } });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DEPARTMENT_CHANGED, entityType: 'Department', entityId: departmentId, oldValues: { userId }, req });
    return true;
  },

  async transferStaff(fromDepartmentId, toDepartmentId, userId, actorId, req) {
    accessControlService.assertDepartmentAccess(req.auth, fromDepartmentId);
    accessControlService.assertDepartmentAccess(req.auth, toDepartmentId);
    const result = await prisma.$transaction(async (tx) => {
      await tx.departmentMember.deleteMany({ where: { departmentId: fromDepartmentId, userId } });
      await tx.departmentMember.upsert({
        where: { departmentId_userId: { departmentId: toDepartmentId, userId } },
        update: {},
        create: { departmentId: toDepartmentId, userId }
      });
      const user = await tx.user.update({ where: { id: userId }, data: { departmentId: toDepartmentId } });
      await auditService.log({
        actorId,
        action: AUDIT_ACTIONS.DEPARTMENT_CHANGED,
        entityType: 'Department',
        entityId: toDepartmentId,
        oldValues: { fromDepartmentId, userId },
        newValues: { toDepartmentId, userId },
        req
      }, tx);
      return user;
    });
    return result;
  },

  async dashboard(id, auth) {
    const department = await getDepartmentById(id);
    if (accessControlService.isGeneralManager(auth) || accessControlService.isHr(auth)) {
      // Allowed across departments.
    } else if (accessControlService.isDepartmentHead(auth)) {
      if (!isDepartmentHeadForDepartment(auth, department)) {
        throw new AppError('Department heads can only access the dashboard for their assigned department', 403);
      }
    } else {
      accessControlService.assertDepartmentAccess(auth, id);
    }

    const today = new Date();
    const nextThirty = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { filters: approvalFilters, relatedIds } = await getLinkedApprovalWhere(id);
    const [taskIds, channelIds] = await prisma.$transaction([
      prisma.task.findMany({ where: { departmentId: id, deletedAt: null }, select: { id: true }, take: 50 }),
      prisma.channel.findMany({ where: { departmentId: id, deletedAt: null }, select: { id: true } })
    ]);
    const [pendingApprovalCount, pendingApprovals] = approvalFilters.length
      ? await Promise.all([
        prisma.approvalRequest.count({
          where: { status: 'PENDING', OR: approvalFilters }
        }),
        prisma.approvalRequest.findMany({
          where: { status: 'PENDING', OR: approvalFilters },
          include: approvalPreviewInclude,
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
          take: 6
        })
      ])
      : [0, []];

    const [
      staffCounts,
      staffPreview,
      activeTaskCount,
      overdueTaskCount,
      activeTasksPreview,
      overdueTasksPreview,
      recentCompletedTasks,
      recentDocuments,
      expiringDocumentCount,
      expiringDepartmentDocuments,
      channels,
      recentMessages,
      recentAnnouncements,
      leaveCalendarSummary
    ] = await prisma.$transaction([
      prisma.user.groupBy({
        by: ['employmentStatus'],
        where: { departmentId: id, deletedAt: null },
        _count: true
      }),
      prisma.user.findMany({
        where: { departmentId: id, deletedAt: null },
        select: staffSelect,
        orderBy: [{ employmentStatus: 'asc' }, { fullName: 'asc' }],
        take: 8
      }),
      prisma.task.count({
        where: { departmentId: id, deletedAt: null, status: { in: openTaskStatuses } }
      }),
      prisma.task.count({
        where: { departmentId: id, deletedAt: null, dueDate: { lt: today }, status: { in: openTaskStatuses } }
      }),
      prisma.task.findMany({
        where: { departmentId: id, deletedAt: null, status: { in: openTaskStatuses } },
        include: taskPreviewInclude,
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 6
      }),
      prisma.task.findMany({
        where: { departmentId: id, deletedAt: null, dueDate: { lt: today }, status: { in: openTaskStatuses } },
        include: taskPreviewInclude,
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
        take: 6
      }),
      prisma.task.findMany({
        where: { departmentId: id, deletedAt: null, status: 'COMPLETED' },
        include: taskPreviewInclude,
        orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
        take: 6
      }),
      prisma.document.findMany({
        where: { departmentId: id, deletedAt: null },
        include: documentPreviewInclude,
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.document.count({
        where: { departmentId: id, deletedAt: null, expiryDate: { gte: today, lte: nextThirty } }
      }),
      prisma.document.findMany({
        where: { departmentId: id, deletedAt: null, expiryDate: { gte: today, lte: nextThirty } },
        include: documentPreviewInclude,
        orderBy: { expiryDate: 'asc' },
        take: 6
      }),
      prisma.channel.findMany({
        where: { departmentId: id, deletedAt: null },
        include: { _count: { select: { messages: true, members: true } } },
        orderBy: { name: 'asc' },
        take: 4
      }),
      prisma.channelMessage.findMany({
        where: { channel: { departmentId: id, deletedAt: null }, deletedAt: null },
        include: {
          sender: { select: { id: true, fullName: true } },
          channel: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 8
      }),
      prisma.announcement.findMany({
        where: { departmentId: id, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: today } }] },
        include: { publishedBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5
      }),
      prisma.leaveRequest.findMany({
        where: { employee: { departmentId: id }, deletedAt: null, startDate: { lte: nextThirty }, endDate: { gte: today }, status: 'APPROVED' },
        include: { employee: { select: { id: true, fullName: true } } },
        orderBy: { startDate: 'asc' },
        take: 10
      })
    ]);

    const activityTimeline = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'Department', entityId: id },
          ...(taskIds.length ? [{ entityType: 'Task', entityId: { in: taskIds.map((item) => item.id) } }] : []),
          ...(relatedIds.documentIds.length ? [{ entityType: 'Document', entityId: { in: relatedIds.documentIds } }] : []),
          ...(relatedIds.financeRequestIds.length ? [{ entityType: 'FinanceRequest', entityId: { in: relatedIds.financeRequestIds } }] : []),
          ...(relatedIds.requisitionIds.length ? [{ entityType: 'Requisition', entityId: { in: relatedIds.requisitionIds } }] : []),
          ...(relatedIds.leaveRequestIds.length ? [{ entityType: 'LeaveRequest', entityId: { in: relatedIds.leaveRequestIds } }] : []),
          ...(relatedIds.hrActionIds.length ? [{ entityType: 'HRAction', entityId: { in: relatedIds.hrActionIds } }] : []),
          ...(channelIds.length ? [{ entityType: 'Channel', entityId: { in: channelIds.map((item) => item.id) } }] : []),
          ...(recentAnnouncements.length ? [{ entityType: 'Announcement', entityId: { in: recentAnnouncements.map((announcement) => announcement.id) } }] : []),
          ...(pendingApprovals.length ? [{ entityType: 'ApprovalRequest', entityId: { in: pendingApprovals.map((approval) => approval.id) } }] : [])
        ]
      },
      include: { actor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 12
    });

    const byEmploymentStatus = countByStatus(staffCounts, 'employmentStatus');
    const totalStaff = Object.values(byEmploymentStatus).reduce((sum, count) => sum + Number(count || 0), 0);

    return {
      department: {
        id: department.id,
        name: department.name,
        slug: department.slug,
        code: department.code,
        description: department.description,
        businessUnit: department.businessUnit,
        costCenter: department.costCenter,
        location: department.location,
        contactEmail: department.contactEmail,
        contactPhone: department.contactPhone,
        mission: department.mission,
        operatingNotes: department.operatingNotes,
        status: department.status,
        createdAt: department.createdAt,
        updatedAt: department.updatedAt
      },
      departmentHead: department.head,
      staffSummary: {
        total: totalStaff,
        active: Number(byEmploymentStatus.ACTIVE || 0),
        onLeave: Number(byEmploymentStatus.ON_LEAVE || 0),
        suspended: Number(byEmploymentStatus.SUSPENDED || 0),
        inactive: Number(byEmploymentStatus.INACTIVE || 0),
        terminated: Number(byEmploymentStatus.TERMINATED || 0),
        resigned: Number(byEmploymentStatus.RESIGNED || 0),
        byEmploymentStatus
      },
      taskSummary: {
        active: activeTaskCount,
        overdue: overdueTaskCount,
        recentCompleted: recentCompletedTasks.length
      },
      documentSummary: {
        recent: recentDocuments.length,
        expiringSoon: expiringDocumentCount
      },
      approvalSummary: {
        pending: pendingApprovalCount
      },
      staffPreview,
      activeTasksPreview: activeTasksPreview.map((task) => ({
        ...task,
        descriptionPreview: trimText(task.description),
        isOverdue: Boolean(task.dueDate && task.dueDate < today && openTaskStatuses.includes(task.status))
      })),
      overdueTasksPreview: overdueTasksPreview.map((task) => ({
        ...task,
        descriptionPreview: trimText(task.description),
        isOverdue: true
      })),
      recentCompletedTasks: recentCompletedTasks.map((task) => ({
        ...task,
        descriptionPreview: trimText(task.description),
        isOverdue: false
      })),
      recentDocuments,
      expiringDepartmentDocuments,
      pendingApprovals,
      messagesPreview: {
        channels,
        recentMessages
      },
      recentAnnouncements,
      activityTimeline,
      leaveCalendarSummary
    };
  }
};

module.exports = departmentService;
