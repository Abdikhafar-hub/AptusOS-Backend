const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const accessControlService = require('./accessControlService');
const workflowOrchestratorService = require('./workflowOrchestratorService');
const stateMachineService = require('./stateMachineService');
const domainGuardService = require('./domainGuardService');
const timelineService = require('./timelineService');

const approvalBaseInclude = {
  comments: {
    where: { deletedAt: null },
    include: { author: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  },
  requestedBy: {
    select: {
      id: true,
      fullName: true,
      email: true,
      departmentId: true,
      role: { select: { id: true, name: true, displayName: true } }
    }
  },
  currentApprover: {
    select: {
      id: true,
      fullName: true,
      email: true,
      departmentId: true,
      role: { select: { id: true, name: true, displayName: true } }
    }
  },
  steps: true
};

const safeDepartmentSelect = {
  id: true,
  name: true,
  slug: true,
  headId: true
};

const safeDocumentInclude = {
  uploadedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  department: { select: safeDepartmentSelect }
};

const normalizeEntityType = (value) => String(value || '').trim().toUpperCase();
const unique = (values) => [...new Set((values || []).filter(Boolean))];
const sortableFields = new Set(['createdAt', 'updatedAt', 'priority', 'status', 'requestType', 'entityType']);
const canViewCompensation = (auth) => (
  accessControlService.isGeneralManager(auth)
  || accessControlService.isFinance(auth)
  || accessControlService.isHr(auth)
);

const parseDocumentIds = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return unique(value.flatMap((entry) => {
      if (typeof entry === 'string') return [entry];
      if (entry && typeof entry === 'object') {
        return [
          entry.documentId,
          entry.id,
          ...(Array.isArray(entry.documents) ? parseDocumentIds(entry.documents) : [])
        ];
      }
      return [];
    }));
  }
  if (typeof value === 'string') return [value];
  if (typeof value === 'object') {
    return unique(Object.values(value).flatMap((entry) => parseDocumentIds(entry)));
  }
  return [];
};

async function getAccessibleDocuments(documentIds, auth) {
  if (!documentIds.length) return [];
  const documents = await prisma.document.findMany({
    where: { id: { in: unique(documentIds) }, deletedAt: null },
    include: safeDocumentInclude
  });
  return documents.filter((document) => accessControlService.canAccessDocument(auth, document));
}

async function buildApprovalSteps(steps = []) {
  const userIds = unique(steps.map((step) => step.approverUserId));
  const roleIds = unique(steps.map((step) => step.approverRoleId));
  const [users, roles] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        select: { id: true, fullName: true, email: true }
      })
      : [],
    roleIds.length
      ? prisma.role.findMany({
        where: { id: { in: roleIds }, deletedAt: null },
        select: { id: true, name: true, displayName: true }
      })
      : []
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const roleMap = new Map(roles.map((role) => [role.id, role]));

  return steps
    .sort((left, right) => left.stepOrder - right.stepOrder)
    .map((step) => ({
      ...step,
      approver: step.approverUserId ? userMap.get(step.approverUserId) || null : null,
      approverRole: step.approverRoleId ? roleMap.get(step.approverRoleId) || null : null
    }));
}

function resolveCurrentPendingStep(steps = []) {
  return [...steps]
    .filter((step) => step.status === 'PENDING')
    .sort((left, right) => left.stepOrder - right.stepOrder)[0] || null;
}

function actorMatchesApprovalStep(step, auth) {
  if (!step || !auth) return false;
  const matchesUser = step.approverUserId ? step.approverUserId === auth.userId : true;
  const matchesRole = step.approverRoleId ? step.approverRoleId === auth.roleId : true;
  return matchesUser && matchesRole;
}

async function getStepNotificationRecipients(step) {
  if (!step) return [];
  if (step.approverUserId) return [step.approverUserId];
  if (!step.approverRoleId) return [];
  const users = await prisma.user.findMany({
    where: { roleId: step.approverRoleId, isActive: true, deletedAt: null },
    select: { id: true }
  });
  return users.map((user) => user.id);
}

async function validateApprovalSteps(steps = []) {
  const normalizedSteps = (steps || []).map((step, index) => ({
    ...step,
    stepOrder: step.stepOrder || index + 1
  }));
  const userIds = unique(normalizedSteps.map((step) => step.approverUserId));
  const roleIds = unique(normalizedSteps.map((step) => step.approverRoleId));
  const [users, roles, roleUsers] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true, deletedAt: null },
        select: { id: true }
      })
      : [],
    roleIds.length
      ? prisma.role.findMany({
        where: { id: { in: roleIds }, deletedAt: null },
        select: { id: true }
      })
      : [],
    roleIds.length
      ? prisma.user.groupBy({
        by: ['roleId'],
        where: { roleId: { in: roleIds }, isActive: true, deletedAt: null },
        _count: true
      })
      : []
  ]);

  const validUserIds = new Set(users.map((user) => user.id));
  const validRoleIds = new Set(roles.map((role) => role.id));
  const activeRoleIds = new Set(roleUsers.filter((entry) => entry._count).map((entry) => entry.roleId));

  normalizedSteps.forEach((step) => {
    if (!step.approverUserId && !step.approverRoleId) {
      throw new AppError('Approval workflow step must define an approver user or role', 400);
    }
    if (step.approverUserId && !validUserIds.has(step.approverUserId)) {
      throw new AppError('Approval workflow contains an inactive or missing approver user', 400);
    }
    if (step.approverRoleId && !validRoleIds.has(step.approverRoleId)) {
      throw new AppError('Approval workflow contains an invalid approver role', 400);
    }
    if (step.approverRoleId && !activeRoleIds.has(step.approverRoleId) && !step.approverUserId) {
      throw new AppError('Approval workflow role step has no active approver available', 400);
    }
  });

  return normalizedSteps;
}

async function findOpenApprovalByEntity(entityType, entityId) {
  return prisma.approvalRequest.findFirst({
    where: {
      entityType: normalizeEntityType(entityType),
      entityId,
      status: { in: ['PENDING', 'NEEDS_MORE_INFO'] },
      deletedAt: null
    },
    include: approvalBaseInclude,
    orderBy: { createdAt: 'desc' }
  });
}

async function getApprovalFiltersForDepartment(departmentId) {
  const [documents, financeRequests, requisitions, leaveRequests, hrActions, separations, payslips, customerOnboarding, complianceItems] = await prisma.$transaction([
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
    ...(complianceItems.length ? [{ entityType: 'COMPLIANCE_ITEM', entityId: { in: complianceItems.map((item) => item.id) } }] : [])
  ];
}

async function buildRelatedEntityContext(approval, auth) {
  const type = normalizeEntityType(approval.entityType);

  if (type === 'DOCUMENT') {
    const document = await prisma.document.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: safeDocumentInclude
    });

    return {
      type,
      department: document?.department || null,
      attachedDocuments: document ? [document] : [],
      relatedEntitySummary: document ? {
        id: document.id,
        title: document.title,
        type: document.category,
        status: document.status,
        ownerType: document.ownerType
      } : null,
      relatedEntityPayload: document ? {
        id: document.id,
        title: document.title,
        description: document.description,
        category: document.category,
        documentType: document.documentType,
        status: document.status,
        visibility: document.visibility,
        ownerType: document.ownerType,
        ownerId: document.ownerId,
        department: document.department,
        fileName: document.fileName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        expiryDate: document.expiryDate,
        reminderDate: document.reminderDate,
        uploadedBy: document.uploadedBy,
        approvedBy: document.approvedBy
      } : null
    };
  }

  if (type === 'LEAVE_REQUEST') {
    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        }
      }
    });
    const currentYear = new Date().getFullYear();
    const leaveBalances = leaveRequest
      ? await prisma.leaveBalance.findMany({
        where: {
          employeeId: leaveRequest.employeeId,
          year: currentYear,
          leaveType: leaveRequest.leaveType
        }
      })
      : [];

    return {
      type,
      department: leaveRequest?.employee?.department || null,
      attachedDocuments: [],
      relatedEntitySummary: leaveRequest ? {
        id: leaveRequest.id,
        leaveType: leaveRequest.leaveType,
        status: leaveRequest.status,
        employee: leaveRequest.employee
      } : null,
      relatedEntityPayload: leaveRequest ? {
        id: leaveRequest.id,
        leaveType: leaveRequest.leaveType,
        startDate: leaveRequest.startDate,
        endDate: leaveRequest.endDate,
        days: leaveRequest.days,
        reason: leaveRequest.reason,
        status: leaveRequest.status,
        employee: leaveRequest.employee,
        leaveBalanceSummary: leaveBalances.map((balance) => ({
          year: balance.year,
          leaveType: balance.leaveType,
          allocated: balance.allocated,
          used: balance.used,
          pending: balance.pending,
          remaining: Number(balance.allocated) - Number(balance.used) - Number(balance.pending)
        }))
      } : null
    };
  }

  if (type === 'FINANCE_REQUEST') {
    const financeRequest = await prisma.financeRequest.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        department: { select: safeDepartmentSelect }
      }
    });
    const attachedDocuments = financeRequest
      ? await getAccessibleDocuments([financeRequest.receiptDocumentId, financeRequest.paymentProofDocumentId], auth)
      : [];
    const budgetImpact = financeRequest?.departmentId
      ? await prisma.budget.findFirst({
        where: {
          departmentId: financeRequest.departmentId,
          year: new Date().getFullYear(),
          deletedAt: null
        },
        orderBy: { month: 'desc' }
      })
      : null;

    return {
      type,
      department: financeRequest?.department || null,
      attachedDocuments,
      relatedEntitySummary: financeRequest ? {
        id: financeRequest.id,
        title: financeRequest.title,
        type: financeRequest.type,
        status: financeRequest.status,
        amount: financeRequest.amount,
        currency: financeRequest.currency
      } : null,
      relatedEntityPayload: financeRequest ? {
        id: financeRequest.id,
        title: financeRequest.title,
        type: financeRequest.type,
        description: financeRequest.description,
        amount: financeRequest.amount,
        currency: financeRequest.currency,
        status: financeRequest.status,
        requestedBy: financeRequest.requestedBy,
        department: financeRequest.department,
        financeNotes: financeRequest.financeNotes,
        paidAt: financeRequest.paidAt,
        receipts: attachedDocuments,
        budgetImpact: budgetImpact ? {
          id: budgetImpact.id,
          year: budgetImpact.year,
          month: budgetImpact.month,
          amount: budgetImpact.amount,
          spent: budgetImpact.spent,
          currency: budgetImpact.currency,
          remaining: Number(budgetImpact.amount) - Number(budgetImpact.spent) - Number(financeRequest.amount || 0)
        } : null
      } : null
    };
  }

  if (type === 'REQUISITION') {
    const requisition = await prisma.requisition.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        department: { select: safeDepartmentSelect }
      }
    });
    const attachedDocuments = requisition
      ? await getAccessibleDocuments(parseDocumentIds(requisition.documents), auth)
      : [];

    return {
      type,
      department: requisition?.department || null,
      attachedDocuments,
      relatedEntitySummary: requisition ? {
        id: requisition.id,
        title: requisition.title,
        status: requisition.status,
        estimatedAmount: requisition.estimatedAmount,
        priority: requisition.priority
      } : null,
      relatedEntityPayload: requisition ? {
        id: requisition.id,
        title: requisition.title,
        description: requisition.description,
        estimatedAmount: requisition.estimatedAmount,
        priority: requisition.priority,
        status: requisition.status,
        requestedBy: requisition.requestedBy,
        department: requisition.department,
        documents: attachedDocuments
      } : null
    };
  }

  if (type === 'HR_ACTION') {
    const hrAction = await prisma.hRAction.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        }
      }
    });
    const attachedDocuments = hrAction
      ? await getAccessibleDocuments([hrAction.supportingDocumentId], auth)
      : [];
    const sanitizedChanges = hrAction?.actionType === 'SALARY_ADJUSTMENT' && !canViewCompensation(auth)
      ? { restricted: true }
      : hrAction?.changes;

    return {
      type,
      department: hrAction?.employee?.department || null,
      attachedDocuments,
      relatedEntitySummary: hrAction ? {
        id: hrAction.id,
        actionType: hrAction.actionType,
        status: hrAction.status,
        employee: hrAction.employee
      } : null,
      relatedEntityPayload: hrAction ? {
        id: hrAction.id,
        actionType: hrAction.actionType,
        reason: hrAction.reason,
        effectiveDate: hrAction.effectiveDate,
        status: hrAction.status,
        employee: hrAction.employee,
        changes: sanitizedChanges,
        supportingDocuments: attachedDocuments,
        sensitiveDetailsRestricted: hrAction.actionType === 'SALARY_ADJUSTMENT' && !canViewCompensation(auth)
      } : null
    };
  }

  if (type === 'CUSTOMER_ONBOARDING') {
    const onboarding = await prisma.customerOnboarding.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        assignedOfficer: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        }
      }
    });
    const attachedDocuments = onboarding
      ? await prisma.document.findMany({
        where: { ownerType: 'CUSTOMER', ownerId: approval.entityId, deletedAt: null },
        include: safeDocumentInclude,
        orderBy: { createdAt: 'desc' }
      })
      : [];

    return {
      type,
      department: onboarding?.assignedOfficer?.department || null,
      attachedDocuments: attachedDocuments.filter((document) => accessControlService.canAccessDocument(auth, document)),
      relatedEntitySummary: onboarding ? {
        id: onboarding.id,
        businessName: onboarding.businessName,
        businessType: onboarding.businessType,
        status: onboarding.status
      } : null,
      relatedEntityPayload: onboarding ? {
        id: onboarding.id,
        businessName: onboarding.businessName,
        businessType: onboarding.businessType,
        contactPersonName: onboarding.contactPersonName,
        contactEmail: onboarding.contactEmail,
        contactPhone: onboarding.contactPhone,
        kraPin: onboarding.kraPin,
        licenseNumber: onboarding.licenseNumber,
        location: onboarding.location,
        address: onboarding.address,
        status: onboarding.status,
        assignedOfficer: onboarding.assignedOfficer,
        notes: onboarding.notes,
        rejectionReason: onboarding.rejectionReason,
        documentsChecklist: onboarding.reviewChecklist,
        documents: attachedDocuments.filter((document) => accessControlService.canAccessDocument(auth, document))
      } : null
    };
  }

  if (type === 'SEPARATION') {
    const separation = await prisma.separation.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        }
      }
    });
    const attachedDocuments = separation?.finalDocuments?.length
      ? await getAccessibleDocuments(separation.finalDocuments, auth)
      : [];

    return {
      type,
      department: separation?.employee?.department || null,
      attachedDocuments,
      relatedEntitySummary: separation ? {
        id: separation.id,
        type: separation.type,
        status: separation.status,
        employee: separation.employee
      } : null,
      relatedEntityPayload: separation ? {
        id: separation.id,
        type: separation.type,
        reason: separation.reason,
        exitDate: separation.exitDate,
        status: separation.status,
        employee: separation.employee,
        finalPaymentStatus: separation.finalPaymentStatus,
        exitInterviewNotes: separation.exitInterviewNotes,
        finalDocuments: attachedDocuments
      } : null
    };
  }

  if (type === 'PAYSLIP') {
    const payslip = await prisma.payslip.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        },
        generatedBy: { select: { id: true, fullName: true, email: true } }
      }
    });

    return {
      type,
      department: payslip?.employee?.department || null,
      attachedDocuments: [],
      relatedEntitySummary: payslip ? {
        id: payslip.id,
        month: payslip.month,
        year: payslip.year,
        approvalStatus: payslip.approvalStatus,
        employee: payslip.employee
      } : null,
      relatedEntityPayload: payslip ? {
        id: payslip.id,
        month: payslip.month,
        year: payslip.year,
        grossPay: payslip.grossPay,
        totalDeductions: payslip.totalDeductions,
        netPay: payslip.netPay,
        approvalStatus: payslip.approvalStatus,
        employee: payslip.employee,
        generatedBy: payslip.generatedBy,
        lockedAt: payslip.lockedAt
      } : null
    };
  }

  if (type === 'COMPLIANCE_ITEM') {
    const item = await prisma.complianceItem.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        }
      }
    });
    const attachedDocuments = item ? await getAccessibleDocuments([item.documentId], auth) : [];

    return {
      type,
      department: item?.owner?.department || (item?.departmentId ? { id: item.departmentId } : null),
      attachedDocuments,
      relatedEntitySummary: item ? {
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
        priority: item.priority
      } : null,
      relatedEntityPayload: item ? {
        id: item.id,
        title: item.title,
        type: item.type,
        description: item.description,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate,
        expiryDate: item.expiryDate,
        owner: item.owner,
        linkedDocuments: attachedDocuments
      } : null
    };
  }

  if (type === 'INCIDENT') {
    const incident = await prisma.incidentReport.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        reportedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        }
      }
    });
    const attachedDocuments = incident ? await getAccessibleDocuments([incident.documentId], auth) : [];

    return {
      type,
      department: incident?.reportedBy?.department || null,
      attachedDocuments,
      relatedEntitySummary: incident ? {
        id: incident.id,
        title: incident.title,
        status: incident.status,
        severity: incident.severity
      } : null,
      relatedEntityPayload: incident ? {
        id: incident.id,
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        resolutionNotes: incident.resolutionNotes,
        reportedBy: incident.reportedBy,
        linkedDocuments: attachedDocuments
      } : null
    };
  }

  if (type === 'RISK') {
    const risk = await prisma.riskRegister.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: safeDepartmentSelect }
          }
        }
      }
    });

    return {
      type,
      department: risk?.owner?.department || null,
      attachedDocuments: [],
      relatedEntitySummary: risk ? {
        id: risk.id,
        title: risk.title,
        status: risk.status,
        severity: risk.severity
      } : null,
      relatedEntityPayload: risk ? {
        id: risk.id,
        title: risk.title,
        description: risk.description,
        likelihood: risk.likelihood,
        impact: risk.impact,
        severity: risk.severity,
        mitigationPlan: risk.mitigationPlan,
        status: risk.status,
        owner: risk.owner
      } : null
    };
  }

  if (type === 'DISCOUNT_REQUEST') {
    const discountRequest = await prisma.discountRequest.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        customer: {
          select: {
            id: true,
            businessName: true,
            accountStatus: true,
            customerHealthStatus: true
          }
        },
        requestedBy: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    return {
      type,
      department: null,
      attachedDocuments: [],
      relatedEntitySummary: discountRequest ? {
        id: discountRequest.id,
        customerName: discountRequest.customer?.businessName,
        requestedPrice: discountRequest.requestedPrice,
        standardPrice: discountRequest.standardPrice,
        discountPercent: discountRequest.discountPercent,
        status: discountRequest.status
      } : null,
      relatedEntityPayload: discountRequest ? {
        id: discountRequest.id,
        customer: discountRequest.customer,
        requestedBy: discountRequest.requestedBy,
        reason: discountRequest.reason,
        standardPrice: discountRequest.standardPrice,
        requestedPrice: discountRequest.requestedPrice,
        discountPercent: discountRequest.discountPercent,
        estimatedValue: discountRequest.estimatedValue,
        currency: discountRequest.currency,
        status: discountRequest.status,
        approvalRequired: discountRequest.approvalRequired
      } : null
    };
  }

  if (type === 'CUSTOMER_ISSUE') {
    const issue = await prisma.customerIssue.findFirst({
      where: { id: approval.entityId, deletedAt: null },
      include: {
        customer: {
          select: {
            id: true,
            businessName: true,
            accountStatus: true,
            customerHealthStatus: true
          }
        },
        reportedBy: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } }
      }
    });

    return {
      type,
      department: null,
      attachedDocuments: [],
      relatedEntitySummary: issue ? {
        id: issue.id,
        title: issue.title,
        severity: issue.severity,
        status: issue.status,
        customerName: issue.customer?.businessName
      } : null,
      relatedEntityPayload: issue ? {
        id: issue.id,
        title: issue.title,
        description: issue.description,
        issueType: issue.issueType,
        severity: issue.severity,
        status: issue.status,
        escalationDepartment: issue.escalationDepartment,
        slaDueAt: issue.slaDueAt,
        resolvedAt: issue.resolvedAt,
        resolutionNotes: issue.resolutionNotes,
        customer: issue.customer,
        reportedBy: issue.reportedBy,
        assignedTo: issue.assignedTo
      } : null
    };
  }

  return {
    type,
    department: null,
    attachedDocuments: [],
    relatedEntitySummary: null,
    relatedEntityPayload: null
  };
}

function assertApprovalAccess(auth, approval, context) {
  if (accessControlService.isGeneralManager(auth)) return;
  if ([approval.requestedById, approval.currentApproverId].includes(auth.userId)) return;
  if (actorMatchesApprovalStep(resolveCurrentPendingStep(approval.steps || []), auth)) return;

  const departmentId = context.department?.id;
  const type = normalizeEntityType(approval.entityType);

  if (type === 'DOCUMENT' && context.relatedEntityPayload && accessControlService.canAccessDocument(auth, context.relatedEntityPayload)) return;
  if (departmentId && accessControlService.isDepartmentHead(auth) && auth.departmentIds.includes(departmentId)) return;
  if (['LEAVE_REQUEST', 'HR_ACTION', 'SEPARATION'].includes(type) && accessControlService.isHr(auth)) return;
  if (type === 'FINANCE_REQUEST' && accessControlService.isFinance(auth)) return;
  if (type === 'REQUISITION' && accessControlService.isOperations(auth)) return;
  if (type === 'CUSTOMER_ONBOARDING' && accessControlService.isSalesCompliance(auth)) return;
  if (['DISCOUNT_REQUEST', 'CUSTOMER_ISSUE', 'RISK', 'INCIDENT', 'COMPLIANCE_ITEM'].includes(type) && accessControlService.isSalesCompliance(auth)) return;

  throw new AppError('You do not have access to this approval request', 403);
}

const approvalService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const resolvedSortBy = sortableFields.has(sortBy) ? sortBy : 'createdAt';
    const where = { AND: [] };

    if (query.status) where.status = query.status;
    if (query.currentApproverId) where.currentApproverId = query.currentApproverId;
    if (query.requestedById) where.requestedById = query.requestedById;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.requestType) where.requestType = query.requestType;
    if (query.priority) where.priority = query.priority;
    if (query.search) {
      where.AND.push({
        OR: [
          { requestType: { contains: query.search, mode: 'insensitive' } },
          { entityType: { contains: query.search, mode: 'insensitive' } },
          { reason: { contains: query.search, mode: 'insensitive' } },
          { requestedBy: { is: { fullName: { contains: query.search, mode: 'insensitive' } } } },
          { currentApprover: { is: { fullName: { contains: query.search, mode: 'insensitive' } } } }
        ]
      });
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.departmentId) {
      const departmentFilters = await getApprovalFiltersForDepartment(query.departmentId);
      if (departmentFilters.length) {
        where.AND.push({ OR: departmentFilters });
      } else {
        where.AND.push({ id: '__no-match__' });
      }
    }
    if (!accessControlService.isGeneralManager(auth)) {
      where.AND.push({
        OR: [
          { requestedById: auth.userId },
          { currentApproverId: auth.userId },
          { steps: { some: { status: 'PENDING', approverUserId: auth.userId } } },
          { steps: { some: { status: 'PENDING', approverRoleId: auth.roleId, approverUserId: null } } }
        ]
      });
    }
    if (!where.AND.length) delete where.AND;

    const [items, total] = await prisma.$transaction([
      prisma.approvalRequest.findMany({
        where,
        include: { steps: true, requestedBy: approvalBaseInclude.requestedBy, currentApprover: approvalBaseInclude.currentApprover },
        skip,
        take: limit,
        orderBy: { [resolvedSortBy]: sortOrder }
      }),
      prisma.approvalRequest.count({ where })
    ]);
    const hydratedItems = await Promise.all(items.map(async (item) => ({
      ...item,
      steps: await buildApprovalSteps(item.steps || [])
    })));
    return paginated(hydratedItems, total, page, limit);
  },

  async get(id, auth) {
    const approval = await prisma.approvalRequest.findUnique({ where: { id }, include: approvalBaseInclude });
    if (!approval) throw new AppError('Approval request not found', 404);

    const relatedContext = await buildRelatedEntityContext(approval, auth);
    assertApprovalAccess(auth, approval, relatedContext);

    const [steps, timeline] = await Promise.all([
      buildApprovalSteps(approval.steps || []),
      timelineService.getTimeline('APPROVAL', id)
    ]);

    return {
      ...approval,
      requester: approval.requestedBy,
      currentApprover: approval.currentApprover,
      department: relatedContext.department,
      steps,
      comments: approval.comments,
      timeline,
      attachedDocuments: relatedContext.attachedDocuments,
      relatedEntitySummary: relatedContext.relatedEntitySummary,
      relatedEntityPayload: relatedContext.relatedEntityPayload
    };
  },

  async create(data, actorId, req) {
    if (!data.steps?.length) throw new AppError('Approval workflow must include at least one step', 400);
    if (!data.allowSelfApproval && data.steps.some((step) => step.approverUserId === actorId)) domainGuardService.cannotApproveOwnRequest(actorId, actorId);
    const normalizedEntityType = normalizeEntityType(data.entityType);
    const validatedSteps = await validateApprovalSteps(data.steps || []);
    const firstStep = validatedSteps.sort((left, right) => left.stepOrder - right.stepOrder)[0];
    const createApproval = async (tx) => {
      const created = await tx.approvalRequest.create({
        data: {
          requestType: data.requestType,
          entityType: normalizedEntityType,
          entityId: data.entityId,
          requestedById: data.requestedById || actorId,
          currentApproverId: data.currentApproverId || firstStep?.approverUserId || null,
          priority: data.priority || 'MEDIUM',
          reason: data.reason,
          steps: {
            create: validatedSteps
          }
        },
        include: { steps: true }
      });
      await auditService.log({ actorId, action: AUDIT_ACTIONS.APPROVAL_CREATED, entityType: 'ApprovalRequest', entityId: created.id, newValues: created, req }, tx);
      return created;
    };
    const approval = data.tx ? await createApproval(data.tx) : await prisma.$transaction(createApproval);

    const recipients = await getStepNotificationRecipients(firstStep);
    if (recipients.length) {
      await notificationService.createMany(recipients, {
        type: 'APPROVAL_REQUEST',
        title: 'Approval request pending',
        entityType: approval.entityType,
        entityId: approval.entityId
      });
    }
    return approval;
  },

  async act(id, status, actorId, comment, req) {
    const approval = await this.get(id, req.auth);
    if (!['PENDING', 'NEEDS_MORE_INFO'].includes(approval.status)) throw new AppError('Approval is already closed', 400);
    stateMachineService.assertTransition('APPROVAL', approval.status, status);
    const currentStep = resolveCurrentPendingStep(approval.steps || []);
    if (!currentStep) throw new AppError('Approval has no pending step', 400);
    if (!currentStep.approverUserId && !currentStep.approverRoleId) {
      throw new AppError('This approval step has no resolvable approver assignment', 400);
    }
    if (currentStep.approverUserId && !currentStep.approver) {
      throw new AppError('The assigned approver for this approval step is no longer available', 400);
    }
    if (currentStep.approverRoleId && !currentStep.approverRole) {
      throw new AppError('The approver role for this approval step is no longer available', 400);
    }
    const explicitGeneralManagerOverride = req?.body?.gmOverride === true;
    const canUseGeneralManagerOverride = explicitGeneralManagerOverride && accessControlService.isGeneralManager(req.auth);
    const leaveWorkflowHrOverride = normalizeEntityType(approval.entityType) === 'LEAVE_REQUEST'
      && (accessControlService.isHr(req.auth) || accessControlService.isGeneralManager(req.auth));
    if (!actorMatchesApprovalStep(currentStep, req.auth) && !canUseGeneralManagerOverride && !leaveWorkflowHrOverride) {
      throw new AppError('You are not allowed to act on this approval step', 403);
    }
    if (canUseGeneralManagerOverride && !comment) {
      throw new AppError('A comment is required when using General Manager override', 400);
    }
    if (approval.requestedById === actorId && !canUseGeneralManagerOverride) domainGuardService.cannotApproveOwnRequest(actorId, approval.requestedById);
    if (status === 'REJECTED' && !comment) throw new AppError('A rejection comment is required', 400);

    const action = status === 'APPROVED'
      ? AUDIT_ACTIONS.APPROVAL_APPROVED
      : status === 'REJECTED'
        ? AUDIT_ACTIONS.APPROVAL_REJECTED
        : AUDIT_ACTIONS.APPROVAL_CREATED;
    const { updated, nextStep } = await prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: currentStep.id },
        data: { status, comment, actedAt: new Date() }
      });
      let data = {};
      let pendingNextStep = null;
      if (status === 'APPROVED') {
        pendingNextStep = approval.steps
          .filter((step) => step.id !== currentStep.id && step.status === 'PENDING')
          .sort((a, b) => a.stepOrder - b.stepOrder)[0];
        data = pendingNextStep
          ? { status: 'PENDING', currentApproverId: pendingNextStep.approverUserId || null }
          : { status: 'APPROVED', currentApproverId: null, approvedAt: new Date() };
      } else if (status === 'REJECTED') {
        data = { status: 'REJECTED', currentApproverId: null, rejectedAt: new Date(), rejectionReason: comment };
      } else if (status === 'NEEDS_MORE_INFO') {
        data = { status: 'NEEDS_MORE_INFO', currentApproverId: null };
      } else if (status === 'CANCELLED') {
        data = { status: 'CANCELLED', currentApproverId: null };
      }
      const result = await tx.approvalRequest.update({ where: { id }, data, include: { steps: true } });
      if (result.status === 'APPROVED') {
        await workflowOrchestratorService.onApprovalApproved(result.entityType, result.entityId, { actorId, req }, tx);
      }
      if (result.status === 'REJECTED') {
        await workflowOrchestratorService.onApprovalRejected(result.entityType, result.entityId, { actorId, req }, tx);
      }
      await auditService.log({
        actorId,
        action,
        entityType: 'ApprovalRequest',
        entityId: id,
        oldValues: approval,
        newValues: {
          ...result,
          gmOverrideUsed: canUseGeneralManagerOverride || undefined
        },
        req
      }, tx);
      return { updated: result, nextStep: pendingNextStep };
    });
    await notificationService.create({ userId: updated.requestedById, type: 'APPROVAL_REQUEST', title: `Approval ${status.toLowerCase()}`, body: comment, entityType: updated.entityType, entityId: updated.entityId });
    const nextStepRecipients = await getStepNotificationRecipients(nextStep);
    if (nextStepRecipients.length) {
      await notificationService.createMany(nextStepRecipients, {
        type: 'APPROVAL_REQUEST',
        title: 'Approval request pending',
        entityType: updated.entityType,
        entityId: updated.entityId
      });
    }
    return updated;
  },

  async cancel(id, actorId, req) {
    const approval = await this.get(id, req.auth);
    if (approval.requestedById !== actorId && !accessControlService.isGeneralManager(req.auth)) {
      throw new AppError('Only the requester or General Manager can cancel this approval', 403);
    }
    stateMachineService.assertTransition('APPROVAL', approval.status, 'CANCELLED');
    const updated = await prisma.$transaction(async (tx) => {
      await tx.approvalStep.updateMany({
        where: { approvalRequestId: id, status: 'PENDING' },
        data: { status: 'CANCELLED', comment: req.body?.comment || 'Cancelled by requester', actedAt: new Date() }
      });
      const result = await tx.approvalRequest.update({
        where: { id },
        data: { status: 'CANCELLED', currentApproverId: null },
        include: { steps: true }
      });
      await auditService.log({
        actorId,
        action: AUDIT_ACTIONS.APPROVAL_REJECTED,
        entityType: 'ApprovalRequest',
        entityId: id,
        oldValues: approval,
        newValues: result,
        req
      }, tx);
      return result;
    });
    await notificationService.create({ userId: updated.requestedById, type: 'APPROVAL_REQUEST', title: 'Approval cancelled', body: req.body?.comment, entityType: updated.entityType, entityId: updated.entityId });
    return updated;
  },

  async resubmit(id, actorId, comment, req) {
    const approval = await this.get(id, req.auth);
    if (approval.requestedById !== actorId && !accessControlService.isGeneralManager(req.auth)) {
      throw new AppError('Only the requester or General Manager can resubmit this approval', 403);
    }
    stateMachineService.assertTransition('APPROVAL', approval.status, 'PENDING');
    await prisma.approvalStep.updateMany({
      where: { approvalRequestId: id, status: 'NEEDS_MORE_INFO' },
      data: { status: 'PENDING', comment: null, actedAt: null }
    });
    const steps = await prisma.approvalStep.findMany({ where: { approvalRequestId: id }, orderBy: { stepOrder: 'asc' } });
    const firstPendingStep = steps.find((step) => step.status === 'PENDING') || steps.find((step) => step.status !== 'APPROVED');
    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: { status: 'PENDING', currentApproverId: firstPendingStep?.approverUserId || null, rejectionReason: null, rejectedAt: null },
      include: { steps: true }
    });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.APPROVAL_CREATED, entityType: 'ApprovalRequest', entityId: id, oldValues: approval, newValues: updated, req });
    const recipients = await getStepNotificationRecipients(firstPendingStep);
    if (recipients.length) {
      await notificationService.createMany(recipients, { type: 'APPROVAL_REQUEST', title: 'Approval resubmitted', body: comment, entityType: updated.entityType, entityId: updated.entityId });
    }
    return updated;
  },

  async getOpenByEntity(entityType, entityId) {
    return findOpenApprovalByEntity(entityType, entityId);
  }
};

module.exports = approvalService;
