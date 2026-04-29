const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const { normalizeRoleName, ROLES } = require('../constants/roles');
const taskService = require('./taskService');
const hrService = require('./hrService');
const approvalService = require('./approvalService');
const documentService = require('./documentService');
const communicationService = require('./communicationService');
const dashboardService = require('./dashboardService');
const { presentAuditLogs } = require('./auditPresentationService');

const TASK_OPEN_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];
const INCIDENT_OPEN_STATUSES = ['OPEN', 'INVESTIGATING', 'IN_PROGRESS', 'UNDER_REVIEW', 'PENDING', 'SUBMITTED'];

const safeDepartmentSelect = {
  id: true,
  name: true,
  slug: true,
  headId: true,
  description: true,
  status: true,
  head: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true
    }
  }
};

const safeStaffSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  isActive: true,
  employmentStatus: true,
  jobTitle: true,
  joinDate: true,
  profilePhotoUrl: true,
  role: {
    select: {
      id: true,
      name: true,
      displayName: true
    }
  }
};

const unique = (values = []) => [...new Set((values || []).filter(Boolean))];
const normalizeDateTime = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw;
  const parsed = new Date(withTime);
  if (Number.isNaN(parsed.getTime())) throw new AppError('Invalid date value provided', 422);
  return parsed;
};

const normalizeDepartmentHeadAuth = async (auth) => {
  const roleName = normalizeRoleName(auth?.roleName);
  if (roleName !== ROLES.DEPARTMENT_HEAD) {
    throw new AppError('Only Department Head can access this resource', 403);
  }

  const user = await prisma.user.findFirst({
    where: {
      id: auth.userId,
      deletedAt: null,
      isActive: true
    },
    select: {
      id: true,
      departmentId: true
    }
  });

  if (!user) throw new AppError('User not found', 404);
  if (!user.departmentId) throw new AppError('Department Head is not linked to any department', 422);

  return {
    ...auth,
    departmentIds: [user.departmentId],
    departmentId: user.departmentId
  };
};

const buildDateRange = (query = {}, field = 'createdAt') => {
  const output = {};
  if (query.dateFrom || query.dateTo) {
    output[field] = {};
    if (query.dateFrom) output[field].gte = new Date(query.dateFrom);
    if (query.dateTo) output[field].lte = new Date(query.dateTo);
  }
  return output;
};

const getDepartmentApprovalFilters = async (departmentId) => {
  const [
    documents,
    financeRequests,
    requisitions,
    leaveRequests,
    hrActions,
    separations,
    payslips,
    customerOnboarding,
    complianceItems,
    incidents,
    risks,
    tasks
  ] = await prisma.$transaction([
    prisma.document.findMany({ where: { departmentId, deletedAt: null }, select: { id: true } }),
    prisma.financeRequest.findMany({ where: { departmentId, deletedAt: null }, select: { id: true } }),
    prisma.requisition.findMany({ where: { departmentId, deletedAt: null }, select: { id: true } }),
    prisma.leaveRequest.findMany({ where: { employee: { departmentId }, deletedAt: null }, select: { id: true } }),
    prisma.hRAction.findMany({ where: { employee: { departmentId }, deletedAt: null }, select: { id: true } }),
    prisma.separation.findMany({ where: { employee: { departmentId }, deletedAt: null }, select: { id: true } }),
    prisma.payslip.findMany({ where: { employee: { departmentId }, deletedAt: null }, select: { id: true } }),
    prisma.customerOnboarding.findMany({ where: { assignedOfficer: { departmentId }, deletedAt: null }, select: { id: true } }),
    prisma.complianceItem.findMany({
      where: {
        deletedAt: null,
        OR: [{ departmentId }, { owner: { departmentId } }]
      },
      select: { id: true }
    }),
    prisma.incidentReport.findMany({
      where: {
        deletedAt: null,
        reportedBy: { departmentId }
      },
      select: { id: true }
    }),
    prisma.riskRegister.findMany({
      where: {
        deletedAt: null,
        owner: { departmentId }
      },
      select: { id: true }
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        OR: [
          { departmentId },
          { assignedTo: { departmentId } }
        ]
      },
      select: { id: true }
    })
  ]);

  return [
    ...(documents.length ? [{ entityType: 'DOCUMENT', entityId: { in: documents.map((item) => item.id) } }] : []),
    ...(financeRequests.length ? [{ entityType: 'FINANCE_REQUEST', entityId: { in: financeRequests.map((item) => item.id) } }] : []),
    ...(requisitions.length ? [{ entityType: 'REQUISITION', entityId: { in: requisitions.map((item) => item.id) } }] : []),
    ...(leaveRequests.length ? [{ entityType: 'LEAVE_REQUEST', entityId: { in: leaveRequests.map((item) => item.id) } }] : []),
    ...(hrActions.length ? [{ entityType: 'HR_ACTION', entityId: { in: hrActions.map((item) => item.id) } }] : []),
    ...(separations.length ? [{ entityType: 'SEPARATION', entityId: { in: separations.map((item) => item.id) } }] : []),
    ...(payslips.length ? [{ entityType: 'PAYSLIP', entityId: { in: payslips.map((item) => item.id) } }] : []),
    ...(customerOnboarding.length ? [{ entityType: 'CUSTOMER_ONBOARDING', entityId: { in: customerOnboarding.map((item) => item.id) } }] : []),
    ...(complianceItems.length ? [{ entityType: 'COMPLIANCE_ITEM', entityId: { in: complianceItems.map((item) => item.id) } }] : []),
    ...(incidents.length ? [{ entityType: 'INCIDENT', entityId: { in: incidents.map((item) => item.id) } }] : []),
    ...(risks.length ? [{ entityType: 'RISK', entityId: { in: risks.map((item) => item.id) } }] : []),
    ...(tasks.length ? [{ entityType: 'TASK', entityId: { in: tasks.map((item) => item.id) } }] : [])
  ];
};

const buildTaskWhere = (departmentId, query = {}) => {
  const where = {
    deletedAt: null,
    OR: [
      { departmentId },
      { assignedTo: { departmentId } }
    ]
  };

  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.assignedToId) where.assignedToId = query.assignedToId;
  if (query.overdueOnly === 'true') {
    where.dueDate = { lt: new Date() };
    where.status = { in: TASK_OPEN_STATUSES };
  }

  if (query.search) {
    where.AND = [
      {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } }
        ]
      }
    ];
  }

  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
    if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
  }

  return where;
};

const buildTaskInclude = {
  assignedTo: {
    select: {
      id: true,
      fullName: true,
      departmentId: true,
      role: {
        select: {
          id: true,
          name: true,
          displayName: true
        }
      }
    }
  },
  assignedBy: {
    select: {
      id: true,
      fullName: true
    }
  },
  department: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  }
};

const getMailCounts = async (userId) => {
  const [participants, sentCount] = await prisma.$transaction([
    prisma.conversationParticipant.findMany({
      where: {
        userId,
        conversation: { deletedAt: null }
      },
      select: {
        lastReadAt: true,
        conversation: {
          select: {
            messages: {
              where: {
                deletedAt: null,
                senderId: { not: userId }
              },
              select: { createdAt: true }
            }
          }
        }
      }
    }),
    prisma.message.count({
      where: {
        senderId: userId,
        deletedAt: null,
        conversation: { deletedAt: null }
      }
    })
  ]);

  const unreadCount = participants.reduce((total, row) => {
    const unread = row.conversation.messages.filter((message) => !row.lastReadAt || message.createdAt > row.lastReadAt).length;
    return total + unread;
  }, 0);

  return {
    inboxCount: unreadCount,
    unreadCount,
    sentCount
  };
};

const departmentHeadService = {
  async getUserDepartmentId(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true }
    });
    return user?.departmentId || null;
  },

  async getDashboard(auth) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    return dashboardService.departmentHead(scopedAuth);
  },

  async getDepartment(auth) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;

    const [department, totalStaff, activeTasks, overdueTasks, pendingLeave, pendingApprovals, openIncidents, attendanceToday] = await prisma.$transaction([
      prisma.department.findFirst({
        where: { id: departmentId, deletedAt: null },
        select: safeDepartmentSelect
      }),
      prisma.user.count({ where: { departmentId, deletedAt: null } }),
      prisma.task.count({
        where: {
          deletedAt: null,
          status: { in: TASK_OPEN_STATUSES },
          OR: [{ departmentId }, { assignedTo: { departmentId } }]
        }
      }),
      prisma.task.count({
        where: {
          deletedAt: null,
          status: { in: TASK_OPEN_STATUSES },
          dueDate: { lt: new Date() },
          OR: [{ departmentId }, { assignedTo: { departmentId } }]
        }
      }),
      prisma.leaveRequest.count({
        where: {
          deletedAt: null,
          status: 'PENDING',
          employee: { departmentId }
        }
      }),
      prisma.approvalRequest.count({
        where: {
          deletedAt: null,
          status: 'PENDING',
          OR: [
            { currentApproverId: scopedAuth.userId },
            { requestedBy: { departmentId } }
          ]
        }
      }),
      prisma.incidentReport.count({
        where: {
          deletedAt: null,
          status: { in: INCIDENT_OPEN_STATUSES },
          reportedBy: { departmentId }
        }
      }),
      prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(24, 0, 0, 0))
          },
          employee: { departmentId }
        },
        _count: true
      })
    ]);

    if (!department) throw new AppError('Department not found', 404);

    const attendance = attendanceToday.reduce((acc, row) => {
      acc[row.status] = typeof row._count === 'number' ? row._count : Object.values(row._count || {}).find((value) => typeof value === 'number') || 0;
      return acc;
    }, {});

    return {
      department,
      kpis: {
        totalStaff,
        activeTasks,
        overdueTasks,
        pendingLeave,
        pendingApprovals,
        openIncidents,
        attendanceToday: {
          present: attendance.PRESENT || 0,
          absent: attendance.ABSENT || 0,
          late: attendance.LATE || 0,
          halfDay: attendance.HALF_DAY || 0,
          remote: attendance.REMOTE || 0,
          onLeave: attendance.ON_LEAVE || 0
        }
      },
      contactDetails: {
        headName: department.head?.fullName || null,
        headEmail: department.head?.email || null,
        headPhone: department.head?.phone || null
      }
    };
  },

  async listStaff(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const departmentId = scopedAuth.departmentId;

    const where = {
      departmentId,
      deletedAt: null
    };

    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { jobTitle: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    if (query.status) {
      if (query.status === 'active') {
        where.isActive = true;
      } else if (query.status === 'inactive') {
        where.isActive = false;
      }
    }

    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: safeStaffSelect,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.user.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async getStaff(auth, staffId) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;

    const staff = await prisma.user.findFirst({
      where: {
        id: staffId,
        departmentId,
        deletedAt: null
      },
      select: {
        ...safeStaffSelect,
        manager: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    if (!staff) throw new AppError('Staff record not found in your department', 404);

    const [taskSummary, leaveHistory, attendanceSummary, assignedTasks] = await prisma.$transaction([
      prisma.task.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          assignedToId: staffId
        },
        _count: true
      }),
      prisma.leaveRequest.findMany({
        where: {
          deletedAt: null,
          employeeId: staffId
        },
        orderBy: { createdAt: 'desc' },
        take: 12
      }),
      prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          employeeId: staffId,
          date: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        },
        _count: true
      }),
      prisma.task.findMany({
        where: {
          deletedAt: null,
          assignedToId: staffId
        },
        include: buildTaskInclude,
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    return {
      staff,
      taskSummary,
      leaveHistory,
      attendanceSummary,
      assignedTasks
    };
  },

  async listTasks(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const departmentId = scopedAuth.departmentId;
    const where = buildTaskWhere(departmentId, query);

    const [items, total] = await prisma.$transaction([
      prisma.task.findMany({
        where,
        include: buildTaskInclude,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.task.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async createTask(auth, payload, req) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;

    if (payload.assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: payload.assignedToId,
          departmentId,
          deletedAt: null,
          isActive: true
        },
        select: { id: true }
      });
      if (!assignee) {
        throw new AppError('Task assignee must belong to your department', 422);
      }
    }

    const createPayload = {
      ...payload,
      title: String(payload?.title || '').trim() || 'Untitled task',
      dueDate: normalizeDateTime(payload?.dueDate),
      departmentId
    };

    return taskService.create(createPayload, scopedAuth, { ...req, auth: scopedAuth });
  },

  async updateTask(auth, taskId, payload) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;

    const existing = await prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [
          { departmentId },
          { assignedTo: { departmentId } }
        ]
      }
    });

    if (!existing) throw new AppError('Task not found in your department scope', 404);

    if (payload.assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: payload.assignedToId,
          departmentId,
          deletedAt: null,
          isActive: true
        },
        select: { id: true }
      });

      if (!assignee) throw new AppError('Task assignee must belong to your department', 422);
    }

    const data = {
      title: payload.title === undefined ? undefined : (String(payload.title || '').trim() || 'Untitled task'),
      description: payload.description,
      assignedToId: payload.assignedToId,
      priority: payload.priority,
      status: payload.status,
      dueDate: normalizeDateTime(payload.dueDate),
      requiresApproval: payload.requiresApproval,
      departmentId
    };

    return prisma.task.update({
      where: { id: taskId },
      data,
      include: buildTaskInclude
    });
  },

  async deleteTask(auth, taskId) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;

    const existing = await prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [
          { departmentId },
          { assignedTo: { departmentId } }
        ]
      },
      select: { id: true }
    });

    if (!existing) throw new AppError('Task not found in your department scope', 404);

    await prisma.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() }
    });

    return { id: taskId, deleted: true };
  },

  async listLeave(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    return hrService.listLeaveRequests(scopedAuth, {
      ...query,
      departmentId: scopedAuth.departmentId
    });
  },

  async approveLeave(auth, leaveId, comment, req) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;

    const leave = await prisma.leaveRequest.findFirst({
      where: {
        id: leaveId,
        deletedAt: null,
        employee: { departmentId }
      },
      select: {
        id: true,
        approvalRequestId: true
      }
    });

    if (!leave) throw new AppError('Leave request not found in your department', 404);
    if (!leave.approvalRequestId) throw new AppError('Leave request has no workflow approval request', 400);

    return approvalService.act(leave.approvalRequestId, 'APPROVED', scopedAuth.userId, comment, { ...req, auth: scopedAuth });
  },

  async rejectLeave(auth, leaveId, comment, req) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;

    const leave = await prisma.leaveRequest.findFirst({
      where: {
        id: leaveId,
        deletedAt: null,
        employee: { departmentId }
      },
      select: {
        id: true,
        approvalRequestId: true
      }
    });

    if (!leave) throw new AppError('Leave request not found in your department', 404);
    if (!leave.approvalRequestId) throw new AppError('Leave request has no workflow approval request', 400);
    if (!comment) throw new AppError('Rejection comment is required', 422);

    return approvalService.act(leave.approvalRequestId, 'REJECTED', scopedAuth.userId, comment, { ...req, auth: scopedAuth });
  },

  async listAttendance(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;
    const rows = await hrService.listAttendance(scopedAuth, {
      ...query,
      departmentId
    });

    const where = {
      deletedAt: null,
      employee: { departmentId },
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...buildDateRange(query, 'date')
    };

    const [lateCount, absentCount] = await prisma.$transaction([
      prisma.attendanceRecord.count({ where: { ...where, status: 'LATE' } }),
      prisma.attendanceRecord.count({ where: { ...where, status: 'ABSENT' } })
    ]);

    return {
      ...rows,
      summary: {
        lateCount,
        absentCount
      }
    };
  },

  async listApprovals(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);

    const where = {
      deletedAt: null,
      AND: []
    };

    if (query.status) where.status = query.status;
    if (query.requestType) where.requestType = query.requestType;
    if (query.entityType) where.entityType = query.entityType;
    if (query.priority) where.priority = query.priority;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    if (query.search) {
      where.AND.push({
        OR: [
          { requestType: { contains: query.search, mode: 'insensitive' } },
          { entityType: { contains: query.search, mode: 'insensitive' } },
          { reason: { contains: query.search, mode: 'insensitive' } },
          { requestedBy: { fullName: { contains: query.search, mode: 'insensitive' } } }
        ]
      });
    }

    const departmentFilters = await getDepartmentApprovalFilters(departmentId);
    where.AND.push({
      OR: [
        { currentApproverId: scopedAuth.userId },
        { requestedBy: { departmentId } },
        ...(departmentFilters.length ? departmentFilters : [{ id: '__none__' }])
      ]
    });

    const [items, total] = await prisma.$transaction([
      prisma.approvalRequest.findMany({
        where,
        include: {
          requestedBy: {
            select: {
              id: true,
              fullName: true,
              email: true,
              departmentId: true,
              role: { select: { name: true, displayName: true } }
            }
          },
          currentApprover: {
            select: {
              id: true,
              fullName: true,
              email: true,
              departmentId: true,
              role: { select: { name: true, displayName: true } }
            }
          },
          steps: true
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.approvalRequest.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async actOnApproval(auth, approvalId, payload, req) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const decision = String(payload?.decision || '').toUpperCase();

    if (!['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO', 'CANCELLED'].includes(decision)) {
      throw new AppError('Decision must be one of APPROVED, REJECTED, NEEDS_MORE_INFO, CANCELLED', 422);
    }

    if (decision === 'REJECTED' && !payload?.comment) {
      throw new AppError('Rejection comment is required', 422);
    }

    return approvalService.act(approvalId, decision, scopedAuth.userId, payload?.comment, { ...req, auth: scopedAuth });
  },

  async runReport(auth, payload = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const departmentId = scopedAuth.departmentId;
    const reportType = String(payload.reportType || '').toLowerCase();
    const filters = payload.filters || {};

    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;
    const dateFilter = (field) => ({
      ...(dateFrom || dateTo ? {
        [field]: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateTo ? { lte: dateTo } : {})
        }
      } : {})
    });

    if (reportType === 'attendance') {
      const rows = await prisma.attendanceRecord.findMany({
        where: {
          deletedAt: null,
          employee: { departmentId },
          ...dateFilter('date')
        },
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              role: { select: { displayName: true } }
            }
          }
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 10000
      });

      return {
        reportType,
        columns: ['date', 'staffName', 'role', 'status', 'checkInAt', 'checkOutAt'],
        rows: rows.map((row) => ({
          date: row.date,
          staffName: row.employee?.fullName || 'Unknown',
          role: row.employee?.role?.displayName || 'Unknown',
          status: row.status,
          checkInAt: row.checkInAt,
          checkOutAt: row.checkOutAt
        }))
      };
    }

    if (reportType === 'leave') {
      const rows = await prisma.leaveRequest.findMany({
        where: {
          deletedAt: null,
          employee: { departmentId },
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.leaveType ? { leaveType: filters.leaveType } : {}),
          ...(dateFrom || dateTo
            ? {
                startDate: {
                  ...(dateFrom ? { gte: dateFrom } : {}),
                  ...(dateTo ? { lte: dateTo } : {})
                }
              }
            : {})
        },
        include: { employee: { select: { id: true, fullName: true } } },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        take: 10000
      });

      return {
        reportType,
        columns: ['staffName', 'leaveType', 'startDate', 'endDate', 'days', 'status', 'createdAt'],
        rows: rows.map((row) => ({
          staffName: row.employee?.fullName || 'Unknown',
          leaveType: row.leaveType,
          startDate: row.startDate,
          endDate: row.endDate,
          days: Number(row.days || 0),
          status: row.status,
          createdAt: row.createdAt
        }))
      };
    }

    if (reportType === 'tasks' || reportType === 'productivity') {
      const rows = await prisma.task.findMany({
        where: {
          deletedAt: null,
          OR: [{ departmentId }, { assignedTo: { departmentId } }],
          ...(filters.status ? { status: filters.status } : {}),
          ...dateFilter('createdAt')
        },
        include: {
          assignedTo: { select: { id: true, fullName: true } },
          assignedBy: { select: { id: true, fullName: true } }
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 10000
      });

      const mapped = rows.map((row) => ({
        taskTitle: row.title,
        assignee: row.assignedTo?.fullName || 'Unassigned',
        assignedBy: row.assignedBy?.fullName || 'Unknown',
        priority: row.priority,
        status: row.status,
        dueDate: row.dueDate,
        completedAt: row.completedAt,
        createdAt: row.createdAt
      }));

      if (reportType === 'productivity') {
        const completionRate = rows.length
          ? Math.round((rows.filter((row) => row.status === 'COMPLETED').length / rows.length) * 100)
          : 0;
        return {
          reportType,
          summary: {
            totalTasks: rows.length,
            completedTasks: rows.filter((row) => row.status === 'COMPLETED').length,
            completionRate
          },
          columns: ['taskTitle', 'assignee', 'status', 'priority', 'dueDate', 'completedAt', 'createdAt'],
          rows: mapped
        };
      }

      return {
        reportType,
        columns: ['taskTitle', 'assignee', 'assignedBy', 'priority', 'status', 'dueDate', 'completedAt', 'createdAt'],
        rows: mapped
      };
    }

    if (reportType === 'incidents') {
      const [incidentRows, riskRows] = await prisma.$transaction([
        prisma.incidentReport.findMany({
          where: {
            deletedAt: null,
            reportedBy: { departmentId },
            ...(filters.status ? { status: filters.status } : {}),
            ...dateFilter('createdAt')
          },
          include: { reportedBy: { select: { id: true, fullName: true } } },
          orderBy: [{ createdAt: 'desc' }],
          take: 5000
        }),
        prisma.riskRegister.findMany({
          where: {
            deletedAt: null,
            owner: { departmentId },
            ...(filters.status ? { status: filters.status } : {}),
            ...dateFilter('createdAt')
          },
          include: { owner: { select: { id: true, fullName: true } } },
          orderBy: [{ createdAt: 'desc' }],
          take: 5000
        })
      ]);

      const rows = [
        ...incidentRows.map((row) => ({
          source: 'INCIDENT',
          title: row.title,
          severity: row.severity,
          status: row.status,
          owner: row.reportedBy?.fullName || 'Unknown',
          createdAt: row.createdAt
        })),
        ...riskRows.map((row) => ({
          source: 'RISK',
          title: row.title,
          severity: row.severity,
          status: row.status,
          owner: row.owner?.fullName || 'Unknown',
          createdAt: row.createdAt
        }))
      ];

      return {
        reportType,
        columns: ['source', 'title', 'severity', 'status', 'owner', 'createdAt'],
        rows
      };
    }

    throw new AppError('Unsupported reportType. Use attendance, leave, tasks, productivity, or incidents.', 422);
  },

  async listDocuments(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    return documentService.list(scopedAuth, {
      ...query,
      departmentId: scopedAuth.departmentId
    });
  },

  async uploadDocument(auth, file, payload, req) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);

    return documentService.upload(file, {
      ...payload,
      departmentId: scopedAuth.departmentId,
      ownerType: payload.ownerType || 'DEPARTMENT',
      visibility: payload.visibility || 'DEPARTMENT_ONLY'
    }, scopedAuth.userId, { ...req, auth: scopedAuth });
  },

  async deleteDocument(auth, documentId, req) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        departmentId: scopedAuth.departmentId,
        deletedAt: null
      },
      select: {
        id: true,
        uploadedById: true
      }
    });

    if (!document) throw new AppError('Document not found in your department', 404);
    if (document.uploadedById !== scopedAuth.userId) {
      throw new AppError('You can only delete documents you uploaded', 403);
    }

    await documentService.archive(document.id, scopedAuth.userId, { ...req, auth: scopedAuth });
    return { id: document.id, deleted: true };
  },

  async listInbox(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const [threads, counts] = await Promise.all([
      communicationService.listInbox(scopedAuth, query),
      getMailCounts(scopedAuth.userId)
    ]);

    return {
      ...threads,
      counts
    };
  },

  async listSent(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const [threads, counts] = await Promise.all([
      communicationService.listSent(scopedAuth, query),
      getMailCounts(scopedAuth.userId)
    ]);

    return {
      ...threads,
      counts
    };
  },

  async getThread(auth, threadId) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    return communicationService.getThread(scopedAuth, threadId);
  },

  async sendMessage(auth, payload, files, req) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);

    const toDepartmentIds = unique(payload?.toDepartmentIds || []);
    if (toDepartmentIds.length && !toDepartmentIds.every((id) => id === scopedAuth.departmentId)) {
      throw new AppError('Department Head can only send to their own department', 403);
    }

    return communicationService.sendMail(scopedAuth, payload, files || [], { ...req, auth: scopedAuth });
  },

  async listAuditLogs(auth, query = {}) {
    const scopedAuth = await normalizeDepartmentHeadAuth(auth);
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const departmentId = scopedAuth.departmentId;

    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      actor: {
        departmentId
      }
    };

    if (query.staffName) {
      where.actor = {
        ...where.actor,
        fullName: {
          contains: String(query.staffName),
          mode: 'insensitive'
        }
      };
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo))) {
          end.setHours(23, 59, 59, 999);
        }
        where.createdAt.lte = end;
      }
    }

    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
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
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.auditLog.count({ where })
    ]);

    const presented = await presentAuditLogs(items, prisma);
    return paginated(presented, total, page, limit);
  }
};

module.exports = departmentHeadService;
