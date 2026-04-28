const prisma = require('../prisma/client');
const salesComplianceService = require('./salesComplianceService');

const countBy = async (model, by, where = {}) => prisma[model].groupBy({ by: [by], where, _count: true });
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const endOfToday = () => {
  const value = startOfToday();
  value.setDate(value.getDate() + 1);
  return value;
};

const startOfWeek = () => {
  const now = startOfToday();
  const day = now.getDay();
  const diff = (day + 6) % 7;
  now.setDate(now.getDate() - diff);
  return now;
};

const normalizeGroupedCount = (value) => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    return Object.values(value).find((entry) => typeof entry === 'number') || 0;
  }
  return 0;
};

const safeDepartmentSelect = {
  id: true,
  name: true,
  slug: true,
  headId: true
};

const dashboardService = {
  async generalManager(userId) {
    const now = new Date();
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [totalStaff, activeDepartments, pendingApprovals, overdueTasks, expiringDocuments, financeRequestsSummary, complianceAlerts, recentActivity, unreadMessages, latestAnnouncements] = await prisma.$transaction([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.department.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
      prisma.task.count({ where: { dueDate: { lt: now }, status: { not: 'COMPLETED' }, deletedAt: null } }),
      prisma.document.count({ where: { expiryDate: { gte: now, lte: soon }, deletedAt: null } }),
      prisma.financeRequest.groupBy({ by: ['status'], _count: true, _sum: { amount: true } }),
      prisma.complianceItem.count({ where: { OR: [{ dueDate: { lt: now } }, { expiryDate: { lte: soon } }], deletedAt: null } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.notification.count({ where: { userId, readAt: null } }),
      prisma.announcement.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5 })
    ]);
    return { totalStaff, activeDepartments, pendingApprovals, overdueTasks, expiringDocuments, financeRequestsSummary, complianceAlerts, recentActivity, unreadMessages, latestAnnouncements };
  },

  async hr(auth) {
    const today = startOfToday();
    const tomorrow = endOfToday();
    const weekStart = startOfWeek();
    const now = new Date();

    const [
      totalEmployees,
      activeEmployees,
      onboardingInProgress,
      pendingLeaveRequests,
      upcomingTrainings,
      pendingReviews,
      activeSeparations,
      openHrActions,
      attendanceGroupedToday,
      unreadNotifications,
      unreadMessages,
      employeesByDepartmentRaw,
      activeEmployeesByDepartmentRaw,
      employmentStatusesRaw,
      onboardingRaw,
      pendingLeaveRaw,
      approvedLeaveTodayRaw,
      approvedLeaveWeekRaw,
      attendanceExceptions,
      pendingLeaveItems,
      pendingPerformanceItems,
      pendingHrActions,
      pendingSeparations,
      trainingAttentionItems,
      recentActivity,
      announcements,
      channels,
      notificationPreview,
      directConversationPreview,
      completedReviews,
      absentEmployees,
      approvedLeavesTodayCount,
      approvedLeavesWeekCount
    ] = await prisma.$transaction([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, isActive: true, employmentStatus: 'ACTIVE' } }),
      prisma.onboardingChecklist.count({ where: { status: 'IN_PROGRESS', deletedAt: null } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING', deletedAt: null } }),
      prisma.training.count({ where: { trainingDate: { gte: now }, deletedAt: null } }),
      prisma.performanceReview.count({ where: { status: { in: ['SELF_REVIEW_PENDING', 'MANAGER_REVIEW_PENDING', 'HR_REVIEW_PENDING'] }, deletedAt: null } }),
      prisma.separation.count({ where: { status: 'PENDING', deletedAt: null } }),
      prisma.hRAction.count({ where: { status: 'PENDING', deletedAt: null } }),
      prisma.attendanceRecord.groupBy({ by: ['status'], where: { deletedAt: null, date: { gte: today, lt: tomorrow } }, _count: true }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null, type: { in: ['DIRECT_MESSAGE', 'DEPARTMENT_MESSAGE', 'MENTION'] } } }),
      prisma.user.groupBy({ by: ['departmentId'], where: { deletedAt: null }, _count: true }),
      prisma.user.groupBy({ by: ['departmentId'], where: { deletedAt: null, isActive: true, employmentStatus: 'ACTIVE' }, _count: true }),
      prisma.user.groupBy({ by: ['employmentStatus'], where: { deletedAt: null }, _count: true }),
      prisma.onboardingChecklist.findMany({
        where: { deletedAt: null },
        include: {
          employee: { select: { id: true, fullName: true, email: true, departmentId: true, department: { select: safeDepartmentSelect } } },
          items: true
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 12
      }),
      prisma.leaveRequest.findMany({
        where: { deletedAt: null, status: 'PENDING' },
        include: { employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } } }
      }),
      prisma.leaveRequest.findMany({
        where: { deletedAt: null, status: 'APPROVED', startDate: { gte: today, lt: tomorrow } },
        include: { employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } } }
      }),
      prisma.leaveRequest.findMany({
        where: { deletedAt: null, status: 'APPROVED', startDate: { gte: weekStart } },
        include: { employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } } }
      }),
      prisma.attendanceRecord.findMany({
        where: { deletedAt: null, date: { gte: today, lt: tomorrow }, status: { in: ['ABSENT', 'LATE', 'HALF_DAY'] } },
        include: { employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 12
      }),
      prisma.leaveRequest.findMany({
        where: { deletedAt: null, status: 'PENDING' },
        include: { employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } } },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.performanceReview.findMany({
        where: { deletedAt: null, status: { in: ['MANAGER_REVIEW_PENDING', 'HR_REVIEW_PENDING'] } },
        include: {
          employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } },
          reviewer: { select: { id: true, fullName: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.hRAction.findMany({
        where: { deletedAt: null, status: 'PENDING' },
        include: {
          employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } }
        },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.separation.findMany({
        where: { deletedAt: null, status: 'PENDING' },
        include: {
          employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } }
        },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.training.findMany({
        where: {
          deletedAt: null,
          OR: [
            { trainingDate: { gte: now } },
            { participants: { some: { status: { in: ['ASSIGNED', 'MISSED'] } } } }
          ]
        },
        include: {
          participants: {
            include: { employee: { select: { id: true, fullName: true } } }
          }
        },
        orderBy: [{ trainingDate: 'asc' }, { createdAt: 'desc' }],
        take: 6
      }),
      prisma.auditLog.findMany({
        where: {
          entityType: {
            in: ['OnboardingChecklist', 'LeaveRequest', 'AttendanceRecord', 'HRAction', 'Separation', 'Training', 'PerformanceReview', 'ApprovalRequest', 'Announcement', 'Channel']
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: { actor: { select: { id: true, fullName: true, email: true } } }
      }),
      prisma.announcement.findMany({
        where: {
          deletedAt: null,
          OR: [{ departmentId: null }, { departmentId: { in: auth.departmentIds || [] } }]
        },
        include: {
          department: { select: safeDepartmentSelect },
          publishedBy: { select: { id: true, fullName: true } },
          reads: { where: { userId: auth.userId } }
        },
        orderBy: { createdAt: 'desc' },
        take: 4
      }),
      prisma.channel.findMany({
        where: {
          deletedAt: null,
          OR: [{ isCompany: true }, { departmentId: { in: auth.departmentIds || [] } }]
        },
        include: {
          department: { select: safeDepartmentSelect },
          _count: { select: { messages: true, members: true } }
        },
        orderBy: [{ isCompany: 'desc' }, { updatedAt: 'desc' }],
        take: 4
      }),
      prisma.notification.findMany({
        where: {
          userId: auth.userId,
          readAt: null,
          type: {
            in: [
              'LEAVE_STATUS_CHANGED',
              'TRAINING_ASSIGNED',
              'PERFORMANCE_REVIEW_REQUESTED',
              'DOCUMENT_UPLOADED',
              'APPROVAL_REQUEST',
              'ANNOUNCEMENT_PUBLISHED',
              'DIRECT_MESSAGE',
              'DEPARTMENT_MESSAGE',
              'MENTION',
              'SYSTEM'
            ]
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.conversation.findMany({
        where: { participants: { some: { userId: auth.userId } }, deletedAt: null },
        include: {
          participants: {
            include: { user: { select: { id: true, fullName: true, email: true } } }
          },
          messages: {
            where: { deletedAt: null },
            include: { sender: { select: { id: true, fullName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: 4
      }),
      prisma.performanceReview.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
      prisma.attendanceRecord.findMany({
        where: { deletedAt: null, date: { gte: today, lt: tomorrow }, status: 'ABSENT' },
        include: { employee: { select: { id: true, fullName: true, departmentId: true, department: { select: safeDepartmentSelect } } } },
        take: 10
      }),
      prisma.leaveRequest.count({ where: { deletedAt: null, status: 'APPROVED', startDate: { gte: today, lt: tomorrow } } }),
      prisma.leaveRequest.count({ where: { deletedAt: null, status: 'APPROVED', startDate: { gte: weekStart } } })
    ]);

    const departmentIds = [...new Set(employeesByDepartmentRaw.map((entry) => entry.departmentId).filter(Boolean))];
    const departments = departmentIds.length
      ? await prisma.department.findMany({
        where: { id: { in: departmentIds }, deletedAt: null },
        select: safeDepartmentSelect
      })
      : [];

    const departmentMap = new Map(departments.map((department) => [department.id, department]));
    const activeDepartmentCountMap = new Map(activeEmployeesByDepartmentRaw.map((entry) => [entry.departmentId, normalizeGroupedCount(entry._count)]));

    const employeesByDepartment = employeesByDepartmentRaw
      .filter((entry) => entry.departmentId)
      .map((entry) => ({
        department: departmentMap.get(entry.departmentId) || { id: entry.departmentId, name: 'Unassigned' },
        totalEmployees: normalizeGroupedCount(entry._count),
        activeEmployees: activeDepartmentCountMap.get(entry.departmentId) || 0
      }))
      .sort((left, right) => right.totalEmployees - left.totalEmployees);

    const onboardingProgress = onboardingRaw.map((checklist) => {
      const totalItems = checklist.items.length;
      const completedItems = checklist.items.filter((item) => item.completedAt).length;
      return {
        ...checklist,
        completedItems,
        totalItems,
        progressPercentage: totalItems ? Math.round((completedItems / totalItems) * 100) : 0
      };
    });

    const leavePressureMap = new Map();
    const captureLeavePressure = (items, field) => {
      items.forEach((item) => {
        const departmentId = item.employee?.department?.id || item.employee?.departmentId || 'unassigned';
        if (!leavePressureMap.has(departmentId)) {
          leavePressureMap.set(departmentId, {
            department: item.employee?.department || { id: departmentId, name: departmentId === 'unassigned' ? 'Unassigned' : 'Unknown department' },
            pending: 0,
            approvedToday: 0,
            approvedThisWeek: 0
          });
        }
        leavePressureMap.get(departmentId)[field] += 1;
      });
    };
    captureLeavePressure(pendingLeaveRaw, 'pending');
    captureLeavePressure(approvedLeaveTodayRaw, 'approvedToday');
    captureLeavePressure(approvedLeaveWeekRaw, 'approvedThisWeek');

    const attendanceToday = attendanceGroupedToday.reduce((acc, item) => {
      acc[item.status] = normalizeGroupedCount(item._count);
      return acc;
    }, {
      PRESENT: 0,
      ABSENT: 0,
      LATE: 0,
      HALF_DAY: 0,
      REMOTE: 0,
      ON_LEAVE: 0
    });

    return {
      totalEmployees,
      activeEmployees,
      onboardingInProgress,
      pendingLeaveRequests,
      upcomingTrainings,
      pendingReviews,
      activeSeparations,
      openHrActions,
      unreadNotifications,
      unreadMessages,
      attendanceToday: {
        present: attendanceToday.PRESENT || 0,
        absent: attendanceToday.ABSENT || 0,
        late: attendanceToday.LATE || 0,
        halfDay: attendanceToday.HALF_DAY || 0,
        remote: attendanceToday.REMOTE || 0,
        onLeave: attendanceToday.ON_LEAVE || 0,
        totalRecorded: Object.values(attendanceToday).reduce((sum, value) => sum + Number(value || 0), 0)
      },
      employeesByDepartment,
      employmentStatuses: employmentStatusesRaw.map((entry) => ({
        status: entry.employmentStatus,
        count: normalizeGroupedCount(entry._count)
      })),
      onboardingProgress,
      leavePressure: [...leavePressureMap.values()].sort((left, right) => right.pending - left.pending),
      attendanceExceptions,
      pendingWorkQueue: {
        onboarding: onboardingProgress.filter((item) => item.status === 'IN_PROGRESS').slice(0, 6),
        leave: pendingLeaveItems,
        performance: pendingPerformanceItems,
        hrActions: pendingHrActions,
        separations: pendingSeparations,
        trainings: trainingAttentionItems
      },
      leaveSnapshot: {
        pendingLeave: pendingLeaveRequests,
        approvedToday: approvedLeavesTodayCount,
        approvedThisWeek: approvedLeavesWeekCount,
        absentEmployees,
        attendanceSummary: attendanceGroupedToday.map((entry) => ({
          status: entry.status,
          count: normalizeGroupedCount(entry._count)
        }))
      },
      trainingPerformanceSnapshot: {
        upcomingTrainings: trainingAttentionItems.filter((item) => item.trainingDate && new Date(item.trainingDate) >= now),
        incompleteTrainingAssignments: trainingAttentionItems
          .map((item) => ({
            ...item,
            pendingParticipants: item.participants.filter((participant) => ['ASSIGNED', 'MISSED'].includes(participant.status))
          }))
          .filter((item) => item.pendingParticipants.length > 0),
        pendingReviews: pendingPerformanceItems,
        completedReviews
      },
      recentActivity,
      communicationPreview: {
        channels,
        announcements,
        unreadDirectMessages: unreadMessages,
        notifications: notificationPreview,
        conversations: directConversationPreview
      }
    };
  },

  async financeAccounts(auth) {
    const start = monthStart();
    const [pendingFinanceRequests, approvedRequests, paidRequests, rejectedRequests, totalRequestedAmount, totalPaidAmount, requestPipeline, departmentBudgetUsage, payrollStatus, payrollTotals, latestPayslip, pendingPaymentProofs, uploadedPaymentProofs, financialDocuments, taxKraDocuments, accountsReports, financeNotifications, unreadFinanceAccountMessages, pendingApprovals, recentRequests, recentFinanceDocuments] = await prisma.$transaction([
      prisma.financeRequest.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, deletedAt: null } }),
      prisma.financeRequest.count({ where: { status: 'APPROVED', deletedAt: null } }),
      prisma.financeRequest.count({ where: { status: 'PAID', deletedAt: null } }),
      prisma.financeRequest.count({ where: { status: 'REJECTED', deletedAt: null } }),
      prisma.financeRequest.aggregate({ where: { deletedAt: null, createdAt: { gte: start } }, _sum: { amount: true } }),
      prisma.financeRequest.aggregate({ where: { deletedAt: null, status: 'PAID', paidAt: { gte: start } }, _sum: { amount: true } }),
      prisma.financeRequest.groupBy({ by: ['status'], where: { deletedAt: null, createdAt: { gte: start } }, _count: true, _sum: { amount: true } }),
      prisma.budget.findMany({ include: { department: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      prisma.payslip.groupBy({ by: ['approvalStatus'], _count: true }),
      prisma.payslip.aggregate({ where: { deletedAt: null }, _count: true, _sum: { grossPay: true, totalDeductions: true, netPay: true } }),
      prisma.payslip.findFirst({ where: { deletedAt: null }, orderBy: [{ year: 'desc' }, { month: 'desc' }] }),
      prisma.financeRequest.count({ where: { status: 'PAID', paymentProofDocumentId: null, deletedAt: null } }),
      prisma.financeRequest.count({ where: { paymentProofDocumentId: { not: null }, deletedAt: null } }),
      prisma.document.count({ where: { ownerType: 'FINANCE', deletedAt: null, category: { in: ['FINANCE_DOCUMENT', 'KRA_DOCUMENT', 'TAX_DOCUMENT'] } } }),
      prisma.document.count({ where: { ownerType: 'FINANCE', deletedAt: null, category: { in: ['KRA_DOCUMENT', 'TAX_DOCUMENT'] } } }),
      prisma.document.count({ where: { ownerType: 'FINANCE', deletedAt: null, category: 'FINANCE_DOCUMENT', createdAt: { gte: start } } }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null, type: { in: ['APPROVAL_REQUEST', 'EXPENSE_STATUS_CHANGED', 'DOCUMENT_UPLOADED', 'SYSTEM'] } } }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
      prisma.approvalRequest.findMany({
        where: {
          status: 'PENDING',
          OR: [
            { currentApproverId: auth.userId },
            { entityType: { in: ['FINANCE_REQUEST', 'PAYSLIP', 'DOCUMENT'] }, requestedById: auth.userId }
          ]
        },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          currentApprover: { select: { id: true, fullName: true, email: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 8
      }),
      prisma.financeRequest.findMany({
        where: { deletedAt: null },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          department: { select: safeDepartmentSelect }
        },
        orderBy: { createdAt: 'desc' },
        take: 8
      }),
      prisma.document.findMany({
        where: { ownerType: 'FINANCE', deletedAt: null },
        include: {
          uploadedBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          department: { select: safeDepartmentSelect }
        },
        orderBy: { createdAt: 'desc' },
        take: 8
      })
    ]);

    const currentDate = new Date();
    const financialPeriodLabel = currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    return {
      currentDate: currentDate.toISOString(),
      financialPeriodLabel,
      pendingFinanceRequests,
      approvedRequests,
      paidRequests,
      rejectedRequests,
      totalRequestedAmount: totalRequestedAmount._sum.amount || 0,
      totalPaidAmount: totalPaidAmount._sum.amount || 0,
      requestPipeline: requestPipeline.map((entry) => ({
        status: entry.status,
        count: normalizeGroupedCount(entry._count),
        amount: entry._sum.amount || 0
      })),
      departmentBudgetUsage,
      payrollStatus,
      payrollTotals,
      currentPayrollPeriod: latestPayslip ? {
        month: latestPayslip.month,
        year: latestPayslip.year
      } : null,
      pendingPaymentProofs,
      uploadedPaymentProofs,
      financialDocuments,
      taxKraDocuments,
      accountsReports,
      financeNotifications,
      unreadFinanceAccountMessages,
      pendingApprovals,
      recentRequests,
      recentFinanceDocuments
    };
  },

  async finance(auth) {
    return this.financeAccounts(auth);
  },

  async salesCompliance(auth) {
    const dashboard = await salesComplianceService.getDashboard(auth);

    // Preserve legacy keys consumed by existing frontend while returning enriched payload.
    return {
      ...dashboard,
      customerOnboardingStatus: dashboard.onboardingPipeline || [],
      expiringLicenses: dashboard.licenseExpiries || 0,
      complianceTasks: dashboard.issues?.open || 0,
      openRisks: dashboard.highRiskCustomers || 0,
      incidents: [],
      salesReportsDue: dashboard.pendingOnboarding || 0,
      complaintsOpen: dashboard.issues?.unresolvedComplaints || 0
    };
  },

  async employee(userId) {
    const [myTasks, myLeaveBalance, myPayslips, myTrainings, myApprovals, myUnreadMessages, announcements] = await prisma.$transaction([
      prisma.task.findMany({ where: { assignedToId: userId, deletedAt: null }, orderBy: { dueDate: 'asc' }, take: 10 }),
      prisma.leaveBalance.findMany({ where: { employeeId: userId } }),
      prisma.payslip.findMany({ where: { employeeId: userId, deletedAt: null }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 6 }),
      prisma.trainingParticipant.findMany({ where: { employeeId: userId }, include: { training: true }, take: 10 }),
      prisma.approvalRequest.findMany({ where: { requestedById: userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.notification.count({ where: { userId, readAt: null } }),
      prisma.announcement.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5 })
    ]);
    return { myTasks, myLeaveBalance, myPayslips, myTrainings, myApprovals, myUnreadMessages, announcements };
  },

  async departmentHead(auth) {
    const today = new Date();
    const [staff, activeTasks, overdueTasks, pendingApprovals, documents, announcements, unreadMessages, leaveCalendar] = await prisma.$transaction([
      prisma.user.count({ where: { departmentId: { in: auth.departmentIds }, deletedAt: null } }),
      prisma.task.count({ where: { departmentId: { in: auth.departmentIds }, deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] } } }),
      prisma.task.count({ where: { departmentId: { in: auth.departmentIds }, deletedAt: null, dueDate: { lt: today }, status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] } } }),
      prisma.approvalRequest.count({ where: { currentApproverId: auth.userId, status: 'PENDING' } }),
      prisma.document.count({ where: { departmentId: { in: auth.departmentIds }, deletedAt: null } }),
      prisma.announcement.findMany({ where: { departmentId: { in: auth.departmentIds }, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
      prisma.leaveRequest.findMany({ where: { employee: { departmentId: { in: auth.departmentIds } }, deletedAt: null, status: 'APPROVED', endDate: { gte: today } }, include: { employee: { select: { id: true, fullName: true } } }, take: 10 })
    ]);
    return { staff, activeTasks, overdueTasks, pendingApprovals, documents, announcements, unreadMessages, leaveCalendar };
  },

  async accounts(auth) {
    return this.financeAccounts(auth);
  },

  async operations(auth) {
    const [requisitions, pendingRequisitions, fulfilledThisMonth, vendorDocuments, unreadMessages] = await prisma.$transaction([
      prisma.requisition.count({ where: { deletedAt: null } }),
      prisma.requisition.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] }, deletedAt: null } }),
      prisma.requisition.count({ where: { status: 'FULFILLED', updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }, deletedAt: null } }),
      prisma.vendorDocument.count({ where: { deletedAt: null } }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } })
    ]);
    return { requisitions, pendingRequisitions, fulfilledThisMonth, vendorDocuments, unreadMessages };
  }
};

module.exports = dashboardService;
