const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const approvalService = require('./approvalService');
const notificationService = require('./notificationService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { ROLES } = require('../constants/roles');
const timelineService = require('./timelineService');
const domainGuardService = require('./domainGuardService');
const workflowSupportService = require('./workflowSupportService');
const uploadService = require('../uploads/uploadService');

const DEFAULT_ONBOARDING_ITEMS = [
  'Personal information',
  'ID/passport upload',
  'KRA PIN upload',
  'Contract upload',
  'Emergency contact',
  'Department assignment',
  'Company email confirmation',
  'Policy acknowledgement',
  'Mandatory training assignment'
];

const safeDepartmentSelect = {
  id: true,
  name: true,
  slug: true,
  headId: true
};

const safeEmployeeSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  departmentId: true,
  jobTitle: true,
  employmentType: true,
  employmentStatus: true,
  managerId: true,
  department: { select: safeDepartmentSelect },
  manager: { select: { id: true, fullName: true, email: true } }
};

const safeApprovalInclude = {
  steps: true,
  requestedBy: { select: { id: true, fullName: true, email: true } },
  currentApprover: { select: { id: true, fullName: true, email: true } },
  comments: {
    where: { deletedAt: null },
    include: { author: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  }
};

const resolveDateRangeQuery = (query = {}) => ({
  dateFrom: query.dateFrom || query.startDate || query.start_date || null,
  dateTo: query.dateTo || query.endDate || query.end_date || null
});

const validateDateRangeQuery = (query = {}) => {
  const normalized = resolveDateRangeQuery(query);
  if (normalized.dateFrom && normalized.dateTo && new Date(normalized.dateTo) < new Date(normalized.dateFrom)) {
    throw new AppError('End date cannot be earlier than start date', 400);
  }
  return normalized;
};

const buildDateRangeFilter = (field, query = {}) => {
  const { dateFrom, dateTo } = resolveDateRangeQuery(query);
  if (!dateFrom && !dateTo) return {};

  const range = {};
  if (dateFrom) range.gte = new Date(dateFrom);
  if (dateTo) range.lte = new Date(dateTo);

  return { [field]: range };
};

const diffDaysInclusive = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.floor((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / (1000 * 60 * 60 * 24)) + 1;
};

const HALF_DAY_OPTIONS = Object.freeze({
  NONE: 'NONE',
  FIRST_DAY: 'FIRST_DAY',
  LAST_DAY: 'LAST_DAY',
  FULL_HALF_DAY: 'FULL_HALF_DAY'
});

const STAFF_LEAVE_CREATE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED'
});

const startOfDayDate = (value) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const isWeekend = (date) => [0, 6].includes(date.getDay());

const getWorkingDays = (startDate, endDate) => {
  const start = startOfDayDate(startDate);
  const end = startOfDayDate(endDate);
  const days = [];
  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    if (!isWeekend(day)) days.push(new Date(day));
  }
  return days;
};

const calculateLeaveDays = (startDate, endDate, halfDay = HALF_DAY_OPTIONS.NONE) => {
  const workingDays = getWorkingDays(startDate, endDate).length;
  if (!workingDays) return 0;
  if (halfDay === HALF_DAY_OPTIONS.FULL_HALF_DAY) return 0.5;
  if (halfDay === HALF_DAY_OPTIONS.FIRST_DAY || halfDay === HALF_DAY_OPTIONS.LAST_DAY) {
    return Math.max(0.5, workingDays - 0.5);
  }
  return workingDays;
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
};

const parseBooleanInput = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  if (value === null || value === undefined) return fallback;
  return Boolean(value);
};

const parseJsonRecord = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
};

const HR_ACTION_CREATE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED'
});

const HR_ACTION_TYPE_MAP = Object.freeze({
  PROMOTION: 'PROMOTION',
  DEMOTION: 'PROMOTION',
  TRANSFER: 'TRANSFER',
  WARNING: 'WARNING',
  SUSPENSION: 'SUSPENSION',
  TERMINATION: 'TERMINATION',
  SALARY_ADJUSTMENT: 'SALARY_ADJUSTMENT',
  ROLE_CHANGE: 'ROLE_CHANGE',
  DEPARTMENT_CHANGE: 'DEPARTMENT_CHANGE',
  CONTRACT_UPDATE: 'ROLE_CHANGE'
});

const normalizeHrActionType = (actionType) => HR_ACTION_TYPE_MAP[actionType] || actionType;

const parseNumericInput = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
};

const SEPARATION_CREATE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
});

const SEPARATION_UI_TYPE_TO_DB = Object.freeze({
  RESIGNATION: 'RESIGNATION',
  TERMINATION: 'TERMINATION',
  CONTRACT_ENDED: 'CONTRACT_END',
  RETIREMENT: 'RETIREMENT',
  REDUNDANCY: 'TERMINATION',
  ABSCONDED: 'TERMINATION',
  DEATH: 'TERMINATION',
  OTHER: 'TERMINATION'
});

const normalizeSeparationUiType = (value, fallback = 'RESIGNATION') => {
  const candidate = firstNonEmpty(value, fallback) || fallback;
  return String(candidate).toUpperCase();
};

const normalizeSeparationDbType = (value, fallback = 'RESIGNATION') => {
  const candidate = firstNonEmpty(value, fallback) || fallback;
  return SEPARATION_UI_TYPE_TO_DB[candidate] || candidate;
};

const parseStringArrayInput = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [String(value)];
};

const applySeparationLifecycleToUser = async (tx, separation, actorId, req, context = {}) => {
  const exitDate = new Date(separation.exitDate);
  const today = startOfDayDate(new Date());
  const separationDay = startOfDayDate(exitDate);
  const isEffectiveNow = separationDay <= today;
  if (!isEffectiveNow) {
    await auditService.log({
      actorId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'Separation',
      entityId: separation.id,
      oldValues: { deferredUntil: null },
      newValues: {
        deferredUntil: separation.exitDate,
        note: 'Employee status updates are deferred until exit date.'
      },
      req
    }, tx);
    return;
  }

  const employmentStatus = separation.type === 'RESIGNATION'
    ? 'RESIGNED'
    : separation.type === 'RETIREMENT'
      ? 'INACTIVE'
      : 'TERMINATED';

  const beforeUser = await tx.user.findUnique({ where: { id: separation.employeeId } });
  const afterUser = await tx.user.update({
    where: { id: separation.employeeId },
    data: {
      employmentStatus,
      isActive: false
    }
  });

  await auditService.log({
    actorId,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: 'User',
    entityId: separation.employeeId,
    oldValues: {
      employmentStatus: beforeUser?.employmentStatus || null,
      isActive: beforeUser?.isActive
    },
    newValues: {
      employmentStatus: afterUser.employmentStatus,
      isActive: afterUser.isActive,
      trigger: context.trigger || 'SEPARATION_APPROVED'
    },
    req
  }, tx);
};

async function getLatestSalary(tx, employeeId) {
  const latest = await tx.remuneration.findFirst({
    where: { employeeId, deletedAt: null },
    orderBy: { effectiveFrom: 'desc' }
  });
  if (!latest) return null;
  return Number(latest.baseSalary);
}

function buildHrActionUserData(actionType, changes = {}) {
  const userData = {};
  const uiActionType = changes.uiActionType || actionType;

  if (changes.roleId) userData.roleId = changes.roleId;
  if (changes.departmentId) userData.departmentId = changes.departmentId;
  if (changes.managerId) userData.managerId = changes.managerId;
  if ((actionType === 'PROMOTION' || uiActionType === 'DEMOTION') && changes.jobTitle) userData.jobTitle = changes.jobTitle;

  if (actionType === 'SUSPENSION') {
    userData.employmentStatus = 'SUSPENDED';
    userData.isActive = false;
  }
  if (actionType === 'TERMINATION') {
    userData.employmentStatus = 'TERMINATED';
    userData.isActive = false;
  }
  return userData;
}

function ensureRequiredActionFields(actionType, changes = {}) {
  const uiActionType = changes.uiActionType || actionType;

  if ((uiActionType === 'PROMOTION' || uiActionType === 'DEMOTION') && !firstNonEmpty(changes.jobTitle, changes.newJobTitle)) {
    throw new AppError('New job title is required for promotion/demotion', 422);
  }
  if (uiActionType === 'TRANSFER' && !changes.departmentId) {
    throw new AppError('New department is required for transfer', 422);
  }
  if (uiActionType === 'SALARY_ADJUSTMENT') {
    const salary = parseNumericInput(changes.newSalary);
    if (salary === null || salary <= 0) throw new AppError('A valid new salary is required for salary adjustment', 422);
    if (!changes.salaryChangeType) throw new AppError('Salary change type is required for salary adjustment', 422);
    if (!changes.effectivePayrollDate) throw new AppError('Effective payroll date is required for salary adjustment', 422);
  }
  if (uiActionType === 'ROLE_CHANGE' && !changes.roleId) {
    throw new AppError('New role is required for role change', 422);
  }
  if (uiActionType === 'TERMINATION') {
    if (!changes.terminationType) throw new AppError('Termination type is required', 422);
    if (!changes.lastWorkingDay) throw new AppError('Last working day is required', 422);
    if (!firstNonEmpty(changes.exitReason)) throw new AppError('Exit reason is required', 422);
    if (changes.rehireEligible === undefined || changes.rehireEligible === null) throw new AppError('Rehire eligibility is required', 422);
  }
  if (uiActionType === 'CONTRACT_UPDATE' && !firstNonEmpty(changes.contractUpdateNotes)) {
    throw new AppError('Contract update details are required', 422);
  }
}

const getFirstUserByRole = async (roleName) => prisma.user.findFirst({
  where: { role: { name: roleName }, isActive: true, deletedAt: null },
  orderBy: { createdAt: 'asc' }
});

const normalizeSearch = (value) => (typeof value === 'string' ? value.trim() : '');
const uniqueIds = (values = []) => [...new Set((values || []).filter(Boolean))];

const parseMentionIds = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return uniqueIds(value.map((item) => String(item).trim()).filter(Boolean));
  return [];
};

const getOnboardingItemDocumentCategory = (itemTitle = '') => {
  const normalized = String(itemTitle || '').toLowerCase();
  if (normalized.includes('contract')) return 'STAFF_CONTRACT';
  if (normalized.includes('kra')) return 'KRA_DOCUMENT';
  return 'HR_DOCUMENT';
};

async function getApprovalContext(approvalRequestId) {
  if (!approvalRequestId) return null;
  return prisma.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: safeApprovalInclude
  });
}

async function getComments(entityType, entityId) {
  return prisma.comment.findMany({
    where: { entityType, entityId, deletedAt: null },
    include: { author: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
}

async function getPendingApprovalStep(approvalRequestId) {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: { steps: true, currentApprover: { select: { id: true, fullName: true, email: true } } }
  });
  if (!approval) throw new AppError('Approval workflow not found', 404);
  const currentStep = (approval.steps || [])
    .filter((step) => step.status === 'PENDING')
    .sort((left, right) => left.stepOrder - right.stepOrder)[0];
  if (!currentStep) throw new AppError('Approval workflow has no pending step', 400);
  return { approval, currentStep };
}

async function createWorkflowDocument(file, data, actorId, req, defaults) {
  if (!file) throw new AppError('A file upload is required', 400);
  const uploaded = await uploadService.uploadSingleFile(file, defaults.folder || 'documents');
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title: data.title || defaults.title,
        description: data.description || defaults.description,
        category: defaults.category,
        documentType: defaults.documentType,
        ownerType: defaults.ownerType,
        ownerId: defaults.ownerId,
        departmentId: defaults.departmentId,
        visibility: data.visibility || defaults.visibility || 'PRIVATE',
        status: defaults.status || 'DRAFT',
        approvedAt: defaults.status === 'APPROVED' ? new Date() : undefined,
        approvedById: defaults.status === 'APPROVED' ? actorId : undefined,
        uploadedById: actorId,
        ...uploaded
      }
    });
    await auditService.log({
      actorId,
      action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      entityType: 'Document',
      entityId: document.id,
      newValues: document,
      req
    }, tx);
    return document;
  });
}

function ensureHrOrOwnerAccess(auth, employeeId, departmentId) {
  if (accessControlService.isHr(auth) || accessControlService.isGeneralManager(auth)) return;
  if (accessControlService.isDepartmentHead(auth)) {
    domainGuardService.cannotAccessOtherDepartmentData(auth, departmentId);
    return;
  }
  if (employeeId !== auth.userId) {
    throw new AppError('You do not have access to this record', 403);
  }
}

async function applyHrActionChanges({
  tx,
  action,
  employee,
  changes,
  actorId,
  req
}) {
  const userData = buildHrActionUserData(action.actionType, changes);
  const updatedUserFields = {};

  if (Object.keys(userData).length) {
    const beforeUser = await tx.user.findUnique({ where: { id: employee.id } });
    const afterUser = await tx.user.update({ where: { id: employee.id }, data: userData });
    Object.assign(updatedUserFields, userData);

    await auditService.log({
      actorId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: employee.id,
      oldValues: {
        roleId: beforeUser?.roleId || null,
        departmentId: beforeUser?.departmentId || null,
        managerId: beforeUser?.managerId || null,
        jobTitle: beforeUser?.jobTitle || null,
        employmentStatus: beforeUser?.employmentStatus || null,
        isActive: beforeUser?.isActive
      },
      newValues: {
        roleId: afterUser.roleId,
        departmentId: afterUser.departmentId,
        managerId: afterUser.managerId,
        jobTitle: afterUser.jobTitle,
        employmentStatus: afterUser.employmentStatus,
        isActive: afterUser.isActive
      },
      req
    }, tx);
  }

  const normalizedSalary = parseNumericInput(changes.newSalary);
  if (normalizedSalary !== null && normalizedSalary > 0) {
    const previousSalaryRecord = await tx.remuneration.findFirst({
      where: { employeeId: employee.id, deletedAt: null },
      orderBy: { effectiveFrom: 'desc' }
    });
    const previousSalary = previousSalaryRecord ? Number(previousSalaryRecord.baseSalary) : null;

    if (previousSalary === null || previousSalary !== normalizedSalary) {
      const effectiveFrom = new Date(changes.effectivePayrollDate || action.effectiveDate);
      if (previousSalaryRecord?.status === 'ACTIVE') {
        await tx.remuneration.update({
          where: { id: previousSalaryRecord.id },
          data: {
            status: 'INACTIVE',
            effectiveTo: effectiveFrom
          }
        });
      }

      const salaryRecord = await tx.remuneration.create({
        data: {
          employeeId: employee.id,
          baseSalary: normalizedSalary,
          allowances: {},
          deductions: {},
          netSalary: normalizedSalary,
          currency: previousSalaryRecord?.currency || 'KES',
          effectiveFrom,
          status: 'ACTIVE'
        }
      });

      await auditService.log({
        actorId,
        action: AUDIT_ACTIONS.PAYROLL_UPDATED,
        entityType: 'Remuneration',
        entityId: salaryRecord.id,
        oldValues: {
          baseSalary: previousSalary
        },
        newValues: {
          baseSalary: normalizedSalary,
          salaryChangeType: changes.salaryChangeType || null,
          effectivePayrollDate: changes.effectivePayrollDate || action.effectiveDate
        },
        req
      }, tx);
    }
  }

  return updatedUserFields;
}

function normalizeStaffLeaveCreateInput(data = {}) {
  return {
    employeeId: firstNonEmpty(data.employeeId, data.employee_id),
    leaveType: firstNonEmpty(data.leaveType, data.leave_type),
    startDate: data.startDate || data.start_date || null,
    endDate: data.endDate || data.end_date || null,
    halfDay: firstNonEmpty(data.halfDay, data.half_day) || HALF_DAY_OPTIONS.NONE,
    reason: firstNonEmpty(data.reason) || null,
    notes: firstNonEmpty(data.notes) || null,
    approvalStatus: firstNonEmpty(data.approvalStatus, data.status) || STAFF_LEAVE_CREATE_STATUS.PENDING_APPROVAL,
    notifyEmployee: parseBooleanInput(data.notifyEmployee ?? data.notify_employee, false),
    notifyManager: parseBooleanInput(data.notifyManager ?? data.notify_manager, false)
  };
}

async function buildLeaveApprovalSteps(employee, actorId, days) {
  const [hrManager, gm] = await Promise.all([
    getFirstUserByRole(ROLES.HR_MANAGER),
    getFirstUserByRole(ROLES.GENERAL_MANAGER)
  ]);

  const rawApprovers = [
    hrManager?.id,
    employee.department?.headId,
    (days >= 10 || employee.role?.name !== ROLES.EMPLOYEE) ? gm?.id : null
  ];

  const steps = uniqueIds(rawApprovers)
    .filter(Boolean)
    .map((approverUserId, index) => ({ approverUserId, stepOrder: index + 1 }));

  if (!steps.length) {
    return [{ approverUserId: actorId, stepOrder: 1 }];
  }

  return steps;
}

const hrService = {
  async listOnboarding(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const search = normalizeSearch(query.search);
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...buildDateRangeFilter('createdAt', query)
    };

    if (query.departmentId || search) {
      where.employee = {
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(search ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } }
          ]
        } : {})
      };
    }

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) {
        where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      } else {
        where.employeeId = auth.userId;
      }
    }

    const [items, total] = await prisma.$transaction([
      prisma.onboardingChecklist.findMany({
        where,
        include: {
          employee: { select: safeEmployeeSelect },
          items: true
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.onboardingChecklist.count({ where })
    ]);

    return paginated(items.map((item) => {
      const totalItems = item.items.length;
      const completedItems = item.items.filter((entry) => entry.completedAt).length;
      return {
        ...item,
        totalItems,
        completedItems,
        progressPercentage: totalItems ? Math.round((completedItems / totalItems) * 100) : 0
      };
    }), total, page, limit);
  },

  async getOnboarding(auth, id) {
    const checklist = await prisma.onboardingChecklist.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect },
        items: true
      }
    });
    if (!checklist) throw new AppError('Onboarding checklist not found', 404);

    ensureHrOrOwnerAccess(auth, checklist.employeeId, checklist.employee?.departmentId);

    const itemIds = checklist.items.map((item) => item.id);
    const documentIds = checklist.items.map((item) => item.documentId).filter(Boolean);
    const [timeline, comments, employeeDocuments, itemComments, itemDocuments] = await Promise.all([
      timelineService.getTimeline('ONBOARDING', id),
      getComments('ONBOARDING', id),
      prisma.document.findMany({
        where: { ownerType: 'USER', ownerId: checklist.employeeId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      itemIds.length
        ? prisma.comment.findMany({
          where: { entityType: 'ONBOARDING_ITEM', entityId: { in: itemIds }, deletedAt: null },
          include: { author: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: 'desc' }
        })
        : Promise.resolve([]),
      documentIds.length
        ? prisma.document.findMany({
          where: { id: { in: documentIds }, deletedAt: null },
          orderBy: { createdAt: 'desc' }
        })
        : Promise.resolve([])
    ]);
    const itemCommentsMap = new Map();
    itemComments.forEach((comment) => {
      const list = itemCommentsMap.get(comment.entityId) || [];
      list.push(comment);
      itemCommentsMap.set(comment.entityId, list);
    });
    const itemDocumentMap = new Map(itemDocuments.map((document) => [document.id, document]));

    const totalItems = checklist.items.length;
    const completedItems = checklist.items.filter((item) => item.completedAt).length;

    return {
      ...checklist,
      items: checklist.items.map((item) => ({
        ...item,
        comments: itemCommentsMap.get(item.id) || [],
        documentRecord: item.documentId ? itemDocumentMap.get(item.documentId) || null : null
      })),
      totalItems,
      completedItems,
      progressPercentage: totalItems ? Math.round((completedItems / totalItems) * 100) : 0,
      requiredDocuments: employeeDocuments,
      comments,
      timeline
    };
  },

  async createOnboardingChecklist(auth, data, req) {
    const employee = await prisma.user.findUnique({ where: { id: data.employeeId }, include: { department: true } });
    if (!employee) throw new AppError('Employee not found', 404);

    const normalizedChecklistItems = Array.isArray(data.checklistItems) && data.checklistItems.length
      ? data.checklistItems
        .map((item) => ({
          title: String(item?.title || '').trim(),
          description: item?.description ? String(item.description).trim() : undefined,
          isRequired: item?.isRequired !== false
        }))
        .filter((item) => item.title)
      : [];

    const fallbackItems = Array.isArray(data.requiredItems) && data.requiredItems.length
      ? data.requiredItems
        .map((item) => String(item).trim())
        .filter(Boolean)
        .map((title) => ({ title, isRequired: true }))
      : DEFAULT_ONBOARDING_ITEMS.map((title) => ({ title, isRequired: true }));

    const checklistItems = normalizedChecklistItems.length ? normalizedChecklistItems : fallbackItems;

    const checklist = await prisma.$transaction(async (tx) => {
      const created = await tx.onboardingChecklist.create({
        data: {
          employeeId: data.employeeId,
          title: data.title || `Onboarding checklist for ${employee.fullName}`,
          items: {
            create: checklistItems.map((item) => ({
              title: item.title,
              description: item.description || undefined,
              isRequired: item.isRequired !== false
            }))
          }
        },
        include: {
          employee: { select: safeEmployeeSelect },
          items: true
        }
      });
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'OnboardingChecklist', entityId: created.id, newValues: created, req }, tx);
      return created;
    });

    await notificationService.create({
      userId: data.employeeId,
      type: 'SYSTEM',
      title: 'Onboarding checklist assigned',
      body: checklist.title,
      entityType: 'OnboardingChecklist',
      entityId: checklist.id
    });

    return checklist;
  },

  async completeOnboardingItem(auth, checklistId, itemId, data, req) {
    const checklist = await prisma.onboardingChecklist.findFirst({
      where: { id: checklistId, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect },
        items: true
      }
    });
    if (!checklist) throw new AppError('Onboarding checklist not found', 404);

    ensureHrOrOwnerAccess(auth, checklist.employeeId, checklist.employee?.departmentId);

    const item = checklist.items.find((entry) => entry.id === itemId);
    if (!item) throw new AppError('Onboarding item not found', 404);

    const updated = await prisma.onboardingItem.update({
      where: { id: itemId },
      data: {
        completedAt: new Date(),
        documentId: data.documentId || item.documentId
      }
    });

    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'OnboardingItem', entityId: itemId, newValues: updated, req });
    return updated;
  },

  async addOnboardingItemComment(auth, checklistId, itemId, data, req) {
    const checklist = await prisma.onboardingChecklist.findFirst({
      where: { id: checklistId, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect },
        items: true
      }
    });
    if (!checklist) throw new AppError('Onboarding checklist not found', 404);

    ensureHrOrOwnerAccess(auth, checklist.employeeId, checklist.employee?.departmentId);

    const item = checklist.items.find((entry) => entry.id === itemId);
    if (!item) throw new AppError('Onboarding item not found', 404);

    const mentions = parseMentionIds(data.mentions);
    const recipients = uniqueIds([checklist.employeeId, ...mentions]).filter((userId) => userId !== auth.userId);

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          entityType: 'ONBOARDING_ITEM',
          entityId: itemId,
          authorId: auth.userId,
          body: data.body,
          attachments: data.attachments || undefined,
          mentions: mentions.length ? mentions : undefined
        },
        include: { author: { select: { id: true, fullName: true, email: true } } }
      });
      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.COMMENT_ADDED,
        entityType: 'OnboardingItem',
        entityId: itemId,
        newValues: { body: data.body, mentions, attachments: data.attachments || null },
        req
      }, tx);
      return created;
    });

    if (recipients.length) {
      await notificationService.createMany(recipients, {
        type: 'MENTION',
        title: `Comment on onboarding item: ${item.title}`,
        body: data.body,
        entityType: 'OnboardingItem',
        entityId: itemId
      });
    }

    return {
      checklistId,
      itemId,
      itemTitle: item.title,
      comment
    };
  },

  async uploadOnboardingItemDocument(auth, checklistId, itemId, file, data, req) {
    const checklist = await prisma.onboardingChecklist.findFirst({
      where: { id: checklistId, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect },
        items: true
      }
    });
    if (!checklist) throw new AppError('Onboarding checklist not found', 404);

    ensureHrOrOwnerAccess(auth, checklist.employeeId, checklist.employee?.departmentId);

    const item = checklist.items.find((entry) => entry.id === itemId);
    if (!item) throw new AppError('Onboarding item not found', 404);

    const document = await createWorkflowDocument(file, data, auth.userId, req, {
      folder: 'hr/onboarding',
      title: `${checklist.employee.fullName} - ${item.title}`,
      description: item.description || `Onboarding checklist document for ${item.title}`,
      category: getOnboardingItemDocumentCategory(item.title),
      documentType: 'ONBOARDING_CHECKLIST_ITEM',
      ownerType: 'USER',
      ownerId: checklist.employeeId,
      departmentId: checklist.employee?.departmentId,
      visibility: 'PRIVATE',
      status: 'DRAFT'
    });

    const updatedItem = await prisma.$transaction(async (tx) => {
      const updated = await tx.onboardingItem.update({
        where: { id: itemId },
        data: { documentId: document.id }
      });
      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'OnboardingItem',
        entityId: itemId,
        oldValues: { documentId: item.documentId },
        newValues: { documentId: document.id },
        req
      }, tx);
      return updated;
    });

    if (checklist.employeeId !== auth.userId) {
      await notificationService.create({
        userId: checklist.employeeId,
        type: 'DOCUMENT_UPLOADED',
        title: `Onboarding document uploaded: ${item.title}`,
        body: document.title,
        entityType: 'OnboardingItem',
        entityId: itemId
      });
    }

    return {
      checklistId,
      item: updatedItem,
      document
    };
  },

  async approveOnboarding(auth, checklistId, req) {
    const checklist = await prisma.onboardingChecklist.findFirst({
      where: { id: checklistId, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect },
        items: true
      }
    });
    if (!checklist) throw new AppError('Onboarding checklist not found', 404);

    const incompleteRequired = checklist.items.filter((item) => item.isRequired && !item.completedAt);
    if (incompleteRequired.length) {
      throw new AppError('All required onboarding items must be completed before approval', 400);
    }

    const updated = await prisma.onboardingChecklist.update({
      where: { id: checklistId },
      data: { status: 'COMPLETED' },
      include: {
        employee: { select: safeEmployeeSelect },
        items: true
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'OnboardingChecklist',
      entityId: checklistId,
      oldValues: { status: checklist.status },
      newValues: { status: 'COMPLETED' },
      req
    });

    await notificationService.create({
      userId: updated.employeeId,
      type: 'SYSTEM',
      title: 'Onboarding approved',
      body: updated.title,
      entityType: 'OnboardingChecklist',
      entityId: updated.id
    });

    return updated;
  },

  async listLeaveRequests(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const search = normalizeSearch(query.search);
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.leaveType ? { leaveType: query.leaveType } : {}),
      ...buildDateRangeFilter('startDate', query)
    };

    if (query.departmentId || search) {
      where.employee = {
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(search ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } }
          ]
        } : {})
      };
    }

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      else where.employeeId = auth.userId;
    }

    const [items, total] = await prisma.$transaction([
      prisma.leaveRequest.findMany({
        where,
        include: {
          employee: { select: safeEmployeeSelect }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.leaveRequest.count({ where })
    ]);

    const approvalRequests = await prisma.approvalRequest.findMany({
      where: { id: { in: items.map((item) => item.approvalRequestId).filter(Boolean) } },
      include: {
        currentApprover: { select: { id: true, fullName: true, email: true } }
      }
    });

    const approvalMap = new Map(approvalRequests.map((approval) => [approval.id, approval]));

    return paginated(items.map((item) => ({
      ...item,
      approvalRequest: item.approvalRequestId ? approvalMap.get(item.approvalRequestId) || null : null
    })), total, page, limit);
  },

  async getLeaveRequest(auth, id) {
    const leave = await prisma.leaveRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!leave) throw new AppError('Leave request not found', 404);

    ensureHrOrOwnerAccess(auth, leave.employeeId, leave.employee?.departmentId);

    const year = leave.startDate.getFullYear();
    const [comments, timeline, approvalRequest, leaveBalances] = await Promise.all([
      getComments('LEAVE_REQUEST', id),
      timelineService.getTimeline('LEAVE_REQUEST', id),
      getApprovalContext(leave.approvalRequestId),
      prisma.leaveBalance.findMany({
        where: {
          employeeId: leave.employeeId,
          year
        },
        orderBy: { leaveType: 'asc' }
      })
    ]);

    return {
      ...leave,
      comments,
      timeline,
      approvalRequest,
      leaveBalances: leaveBalances.map((balance) => ({
        ...balance,
        remaining: Number(balance.allocated) - Number(balance.used) - Number(balance.pending)
      }))
    };
  },

  async leaveCalendar(auth, query = {}) {
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : { status: 'APPROVED' }),
      ...(query.leaveType ? { leaveType: query.leaveType } : {}),
      ...(query.dateFrom || query.dateTo ? {
        startDate: query.dateTo ? { lte: new Date(query.dateTo) } : undefined,
        endDate: query.dateFrom ? { gte: new Date(query.dateFrom) } : undefined
      } : {})
    };

    if (query.departmentId || query.employeeId) {
      where.employee = {
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.employeeId ? { id: query.employeeId } : {})
      };
    }

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      else where.employeeId = auth.userId;
    }

    return prisma.leaveRequest.findMany({
      where,
      include: {
        employee: { select: safeEmployeeSelect }
      },
      orderBy: { startDate: 'asc' }
    });
  },

  async requestLeave(auth, data, req) {
    if (data.endDate < data.startDate) throw new AppError('End date must be after start date', 400);

    const employee = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: {
        department: true,
        role: true
      }
    });

    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: auth.userId,
        deletedAt: null,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: data.endDate },
        endDate: { gte: data.startDate }
      }
    });
    if (overlapping) throw new AppError('Leave dates overlap with an existing leave request', 400);

    const days = diffDaysInclusive(data.startDate, data.endDate);
    const year = new Date(data.startDate).getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveType_year: {
          employeeId: auth.userId,
          leaveType: data.leaveType,
          year
        }
      }
    });
    if (balance && Number(balance.allocated) - Number(balance.used) - Number(balance.pending) < days) {
      throw new AppError('Insufficient leave balance', 400);
    }

    const hrManager = await getFirstUserByRole(ROLES.HR_MANAGER);
    const gm = await getFirstUserByRole(ROLES.GENERAL_MANAGER);
    const steps = [];
    if (hrManager) steps.push({ approverUserId: hrManager.id, stepOrder: 1 });
    if (employee.department?.headId) steps.push({ approverUserId: employee.department.headId, stepOrder: steps.length + 1 });
    if (days >= 10 || employee.role?.name !== ROLES.EMPLOYEE) steps.push({ approverUserId: gm?.id, stepOrder: steps.length + 1 });

    return prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          employeeId: auth.userId,
          leaveType: data.leaveType,
          startDate: data.startDate,
          endDate: data.endDate,
          days,
          reason: data.reason
        }
      });

      if (balance) {
        await tx.leaveBalance.update({ where: { id: balance.id }, data: { pending: { increment: days } } });
      }

      const approval = await approvalService.create({
        requestType: 'LEAVE',
        entityType: 'LEAVE_REQUEST',
        entityId: created.id,
        requestedById: auth.userId,
        currentApproverId: steps[0]?.approverUserId,
        reason: data.reason,
        steps
      }, auth.userId, req);

      const updated = await tx.leaveRequest.update({
        where: { id: created.id },
        data: { approvalRequestId: approval.id }
      });

      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.LEAVE_REQUESTED, entityType: 'LeaveRequest', entityId: created.id, newValues: updated, req }, tx);
      return updated;
    });
  },

  async createStaffLeave(auth, payload, file, req) {
    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only HR/Admin can create leave for staff', 403);
    }

    const data = normalizeStaffLeaveCreateInput(payload);
    if (!data.employeeId || !data.leaveType || !data.startDate || !data.endDate) {
      throw new AppError('Employee, leave type, start date, and end date are required', 422);
    }
    if (!Object.values(HALF_DAY_OPTIONS).includes(data.halfDay)) {
      throw new AppError('Invalid half-day option', 422);
    }
    if (!Object.values(STAFF_LEAVE_CREATE_STATUS).includes(data.approvalStatus)) {
      throw new AppError('Invalid approval status', 422);
    }
    if (data.endDate < data.startDate) throw new AppError('Start date must be before or equal to end date', 400);

    const employee = await prisma.user.findFirst({
      where: { id: data.employeeId, isActive: true, deletedAt: null },
      include: { department: true, role: true, manager: { select: { id: true, fullName: true } } }
    });
    if (!employee) throw new AppError('Staff member was not found or is inactive', 404);

    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        deletedAt: null,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: data.endDate },
        endDate: { gte: data.startDate }
      }
    });
    if (overlapping) throw new AppError('Leave dates overlap with an existing pending or approved leave request', 400);

    const workingDays = getWorkingDays(data.startDate, data.endDate);
    const days = calculateLeaveDays(data.startDate, data.endDate, data.halfDay);
    if (days <= 0) throw new AppError('Selected dates do not include a valid working day for leave', 400);

    const year = new Date(data.startDate).getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveType_year: {
          employeeId: employee.id,
          leaveType: data.leaveType,
          year
        }
      }
    });

    const remaining = balance ? Number(balance.allocated) - Number(balance.used) - Number(balance.pending) : 0;
    const exceedsBalance = data.leaveType !== 'UNPAID' && days > remaining;
    if (data.approvalStatus === STAFF_LEAVE_CREATE_STATUS.APPROVED && exceedsBalance) {
      throw new AppError(
        `Insufficient ${data.leaveType.replaceAll('_', ' ').toLowerCase()} leave balance. Remaining: ${remaining} day(s), requested: ${days} day(s). Save as Pending approval or Draft to continue.`,
        400
      );
    }

    const uploadedAttachment = file ? await uploadService.uploadSingleFile(file, 'hr/leave') : null;

    const resolvedLeaveStatus = data.approvalStatus === STAFF_LEAVE_CREATE_STATUS.DRAFT
      ? 'NEEDS_MORE_INFO'
      : data.approvalStatus === STAFF_LEAVE_CREATE_STATUS.PENDING_APPROVAL
        ? 'PENDING'
        : 'APPROVED';

    const notes = [data.reason, data.notes, `Half-day: ${data.halfDay}`].filter(Boolean).join('\n\n');

    const created = await prisma.$transaction(async (tx) => {
      let attachment = null;
      if (uploadedAttachment) {
        attachment = await tx.document.create({
          data: {
            title: `${employee.fullName} leave attachment`,
            description: 'Supporting attachment for HR-created leave request.',
            category: 'HR_DOCUMENT',
            documentType: 'LEAVE_SUPPORTING_DOCUMENT',
            ownerType: 'USER',
            ownerId: employee.id,
            departmentId: employee.departmentId,
            visibility: 'PRIVATE',
            status: 'DRAFT',
            uploadedById: auth.userId,
            ...uploadedAttachment
          }
        });
        await auditService.log({
          actorId: auth.userId,
          action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
          entityType: 'Document',
          entityId: attachment.id,
          newValues: attachment,
          req
        }, tx);
      }

      const leave = await tx.leaveRequest.create({
        data: {
          employeeId: employee.id,
          leaveType: data.leaveType,
          startDate: data.startDate,
          endDate: data.endDate,
          days,
          reason: notes || null,
          status: resolvedLeaveStatus,
          lockedAt: data.approvalStatus === STAFF_LEAVE_CREATE_STATUS.APPROVED ? new Date() : null
        }
      });

      if (attachment) {
        await tx.comment.create({
          data: {
            entityType: 'LEAVE_REQUEST',
            entityId: leave.id,
            authorId: auth.userId,
            body: `Supporting attachment uploaded: ${attachment.fileName}`,
            attachments: {
              documents: [{
                id: attachment.id,
                title: attachment.title,
                fileUrl: attachment.fileUrl,
                fileName: attachment.fileName
              }]
            }
          }
        });
      }

      if (data.approvalStatus === STAFF_LEAVE_CREATE_STATUS.PENDING_APPROVAL) {
        const steps = await buildLeaveApprovalSteps(employee, auth.userId, days);
        const approval = await approvalService.create({
          requestType: 'LEAVE',
          entityType: 'LEAVE_REQUEST',
          entityId: leave.id,
          requestedById: employee.id,
          currentApproverId: steps[0]?.approverUserId,
          reason: notes || undefined,
          steps,
          allowSelfApproval: true,
          tx
        }, auth.userId, req);

        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: { approvalRequestId: approval.id }
        });

        if (data.leaveType !== 'UNPAID') {
          if (balance) {
            await tx.leaveBalance.update({
              where: { id: balance.id },
              data: { pending: { increment: days } }
            });
          } else {
            await tx.leaveBalance.create({
              data: {
                employeeId: employee.id,
                leaveType: data.leaveType,
                year,
                allocated: 0,
                used: 0,
                pending: days
              }
            });
          }
        }
      } else if (data.approvalStatus === STAFF_LEAVE_CREATE_STATUS.APPROVED) {
        if (data.leaveType !== 'UNPAID') {
          if (balance) {
            await tx.leaveBalance.update({
              where: { id: balance.id },
              data: { used: { increment: days } }
            });
          } else {
            await tx.leaveBalance.create({
              data: {
                employeeId: employee.id,
                leaveType: data.leaveType,
                year,
                allocated: 0,
                used: days,
                pending: 0
              }
            });
          }
        }
        for (const day of workingDays) {
          const date = startOfDayDate(day);
          await tx.attendanceRecord.upsert({
            where: { employeeId_date: { employeeId: employee.id, date } },
            update: { status: 'ON_LEAVE' },
            create: { employeeId: employee.id, date, status: 'ON_LEAVE' }
          });
        }
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.LEAVE_CREATED_FOR_STAFF,
        entityType: 'LeaveRequest',
        entityId: leave.id,
        newValues: {
          staffId: employee.id,
          staffName: employee.fullName,
          leaveType: data.leaveType,
          startDate: data.startDate,
          endDate: data.endDate,
          days,
          halfDay: data.halfDay,
          approvalStatus: data.approvalStatus,
          leaveStatus: resolvedLeaveStatus,
          balanceWarning: exceedsBalance ? `Leave exceeds available balance. Remaining: ${remaining} day(s), requested: ${days} day(s).` : null,
          notifyEmployee: data.notifyEmployee,
          notifyManager: data.notifyManager,
          attachmentDocumentId: attachment?.id || null
        },
        req
      }, tx);

      return { leave, attachment };
    });

    if (data.notifyEmployee && employee.id !== auth.userId) {
      await notificationService.create({
        userId: employee.id,
        type: 'LEAVE_STATUS_CHANGED',
        title: 'Leave created by HR',
        body: `HR created a ${data.leaveType.replaceAll('_', ' ')} leave entry (${data.approvalStatus.replaceAll('_', ' ')}) for ${days} day(s).`,
        entityType: 'LeaveRequest',
        entityId: created.leave.id
      });
    }

    if (data.notifyManager && employee.managerId && employee.managerId !== auth.userId) {
      await notificationService.create({
        userId: employee.managerId,
        type: 'SYSTEM',
        title: 'Staff leave created by HR',
        body: `${employee.fullName} has a ${data.approvalStatus.replaceAll('_', ' ').toLowerCase()} leave entry from HR.`,
        entityType: 'LeaveRequest',
        entityId: created.leave.id
      });
    }

    return this.getLeaveRequest(auth, created.leave.id);
  },

  async reviewLeave(auth, id, decision, comment, req) {
    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!leaveRequest) throw new AppError('Leave request not found', 404);
    if (!leaveRequest.approvalRequestId) throw new AppError('Leave request is missing its approval workflow', 400);

    await approvalService.act(leaveRequest.approvalRequestId, decision, auth.userId, comment, req);
    const updated = await prisma.leaveRequest.findUnique({ where: { id } });

    await notificationService.create({
      userId: leaveRequest.employeeId,
      type: 'LEAVE_STATUS_CHANGED',
      title: 'Leave request updated',
      body: `${decision}: ${comment}`,
      entityType: 'LeaveRequest',
      entityId: id
    });

    return updated;
  },

  async forwardLeave(auth, id, data, req) {
    return this._routeLeaveApproval(auth, id, data, req, 'FORWARDED');
  },

  async reassignLeaveApprover(auth, id, data, req) {
    return this._routeLeaveApproval(auth, id, data, req, 'REASSIGNED');
  },

  async _routeLeaveApproval(auth, id, data, req, mode) {
    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!leaveRequest) throw new AppError('Leave request not found', 404);
    if (!leaveRequest.approvalRequestId) throw new AppError('Leave request is missing its approval workflow', 400);
    domainGuardService.cannotEditAfterFinalState(leaveRequest, 'Leave request', ['APPROVED', 'REJECTED', 'CANCELLED']);

    const [approver, approvalState] = await Promise.all([
      prisma.user.findFirst({
        where: { id: data.approverUserId, isActive: true, deletedAt: null },
        select: { id: true, fullName: true, email: true }
      }),
      getPendingApprovalStep(leaveRequest.approvalRequestId)
    ]);
    if (!approver) throw new AppError('Approver not found', 404);
    if (approvalState.approval.status !== 'PENDING') {
      throw new AppError('Only pending leave approvals can be forwarded or reassigned', 400);
    }
    domainGuardService.cannotApproveOwnRequest(approver.id, approvalState.approval.requestedById);

    const previousApproverId = approvalState.currentStep.approverUserId || approvalState.approval.currentApproverId;
    const previousApprover = approvalState.approval.currentApprover;
    if (previousApproverId === approver.id) {
      throw new AppError('The selected approver is already assigned to this leave request', 400);
    }

    const updatedApproval = await prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: approvalState.currentStep.id },
        data: { approverUserId: approver.id, comment: data.comment }
      });
      const updated = await tx.approvalRequest.update({
        where: { id: leaveRequest.approvalRequestId },
        data: { currentApproverId: approver.id },
        include: safeApprovalInclude
      });
      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.LEAVE_UPDATED,
        entityType: 'LeaveRequest',
        entityId: id,
        oldValues: { currentApproverId: previousApproverId, mode },
        newValues: { currentApproverId: approver.id, comment: data.comment, mode },
        req
      }, tx);
      return updated;
    });

    await workflowSupportService.createComment({
      authorId: auth.userId,
      entityType: 'LEAVE_REQUEST',
      entityId: id,
      body: `${mode === 'FORWARDED' ? 'Forwarded' : 'Reassigned'} leave approval to ${approver.fullName}. ${data.comment}`.trim(),
      mentions: [approver.id]
    }, req);

    await notificationService.create({
      userId: approver.id,
      type: 'APPROVAL_REQUEST',
      title: mode === 'FORWARDED' ? 'Leave approval forwarded to you' : 'Leave approval reassigned to you',
      body: data.comment,
      entityType: 'LeaveRequest',
      entityId: id
    });

    if (previousApproverId && previousApproverId !== approver.id) {
      await notificationService.create({
        userId: previousApproverId,
        type: 'APPROVAL_REQUEST',
        title: mode === 'FORWARDED' ? 'Leave approval forwarded onward' : 'Leave approval reassigned',
        body: data.comment,
        entityType: 'LeaveRequest',
        entityId: id
      });
    }

    await notificationService.create({
      userId: leaveRequest.employeeId,
      type: 'LEAVE_STATUS_CHANGED',
      title: mode === 'FORWARDED' ? 'Leave approval forwarded' : 'Leave approver changed',
      body: data.comment,
      entityType: 'LeaveRequest',
      entityId: id
    });

    return {
      leaveRequest: await this.getLeaveRequest(auth, id),
      approvalRequest: updatedApproval,
      previousApprover,
      newApprover: approver,
      action: mode
    };
  },

  async listAttendance(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const search = normalizeSearch(query.search);
    const dateRangeQuery = validateDateRangeQuery(query);
    const where = {
      deletedAt: null,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...buildDateRangeFilter('date', dateRangeQuery)
    };

    if (query.departmentId || search) {
      where.employee = {
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(search ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } }
          ]
        } : {})
      };
    }

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      else where.employeeId = auth.userId;
    }

    const [items, total] = await prisma.$transaction([
      prisma.attendanceRecord.findMany({
        where,
        include: {
          employee: { select: safeEmployeeSelect }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.attendanceRecord.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async createManualAttendance(auth, data, req) {
    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: data.employeeId,
          date: data.date
        }
      }
    });
    if (existing) throw new AppError('Attendance record already exists for this employee and date', 400);

    const record = await prisma.attendanceRecord.create({
      data
    });

    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'AttendanceRecord', entityId: record.id, newValues: record, req });
    return record;
  },

  async getAttendanceHistory(auth, id) {
    const record = await prisma.attendanceRecord.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!record) throw new AppError('Attendance record not found', 404);

    ensureHrOrOwnerAccess(auth, record.employeeId, record.employee?.departmentId);

    const timeline = await timelineService.getTimeline('ATTENDANCE', id);
    return {
      record,
      timeline
    };
  },

  async checkIn(auth, req) {
    const date = new Date();
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: auth.userId,
          date: startOfDay
        }
      }
    });
    if (existing?.checkInAt) throw new AppError('You already checked in today', 400);

    const record = existing
      ? await prisma.attendanceRecord.update({ where: { id: existing.id }, data: { checkInAt: new Date(), status: 'PRESENT' } })
      : await prisma.attendanceRecord.create({ data: { employeeId: auth.userId, date: startOfDay, checkInAt: new Date(), status: 'PRESENT' } });

    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'AttendanceRecord', entityId: record.id, newValues: { checkInAt: record.checkInAt }, req });
    return record;
  },

  async checkOut(auth, req) {
    const date = new Date();
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: auth.userId,
          date: startOfDay
        }
      }
    });
    if (!existing?.checkInAt) throw new AppError('You need to check in before checking out', 400);
    if (existing.checkOutAt) throw new AppError('You already checked out today', 400);

    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: { checkOutAt: new Date() }
    });

    await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'AttendanceRecord', entityId: record.id, newValues: { checkOutAt: record.checkOutAt }, req });
    return record;
  },

  async attendanceSummary(auth, query = {}) {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dateRangeQuery = validateDateRangeQuery(query);
    const where = {
      deletedAt: null,
      ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
      ...(dateRangeQuery.dateFrom || dateRangeQuery.dateTo ? buildDateRangeFilter('date', dateRangeQuery) : { date: { gte: startOfToday } })
    };

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      else where.employeeId = auth.userId;
    }

    const [byStatus, absences, departmentBreakdown] = await prisma.$transaction([
      prisma.attendanceRecord.groupBy({ by: ['status'], where, _count: true }),
      prisma.attendanceRecord.findMany({
        where: { ...where, status: 'ABSENT' },
        include: { employee: { select: safeEmployeeSelect } },
        orderBy: { date: 'desc' },
        take: 50
      }),
      prisma.attendanceRecord.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              departmentId: true,
              department: { select: safeDepartmentSelect }
            }
          }
        }
      })
    ]);

    const groupedDepartments = {};
    departmentBreakdown.forEach((item) => {
      const key = item.employee?.department?.id || item.employee?.departmentId || 'unassigned';
      if (!groupedDepartments[key]) {
        groupedDepartments[key] = {
          department: item.employee?.department || { id: key, name: key === 'unassigned' ? 'Unassigned' : 'Unknown department' },
          total: 0,
          exceptions: 0
        };
      }
      groupedDepartments[key].total += 1;
      if (['ABSENT', 'LATE', 'HALF_DAY'].includes(item.status)) groupedDepartments[key].exceptions += 1;
    });

    return {
      byStatus,
      absences,
      departments: Object.values(groupedDepartments)
    };
  },

  async listHrActions(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const search = normalizeSearch(query.search);
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.actionType || query.type ? { actionType: query.actionType || query.type } : {}),
      ...buildDateRangeFilter('effectiveDate', query)
    };

    if (query.departmentId || search) {
      where.employee = {
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(search ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } }
          ]
        } : {})
      };
    }

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      else where.employeeId = auth.userId;
    }

    const [items, total] = await prisma.$transaction([
      prisma.hRAction.findMany({
        where,
        include: {
          employee: { select: safeEmployeeSelect }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.hRAction.count({ where })
    ]);

    const approvalRequests = await prisma.approvalRequest.findMany({
      where: { id: { in: items.map((item) => item.approvalRequestId).filter(Boolean) } },
      include: { currentApprover: { select: { id: true, fullName: true } } }
    });
    const approvalMap = new Map(approvalRequests.map((approval) => [approval.id, approval]));

    return paginated(items.map((item) => ({
      ...item,
      approvalRequest: item.approvalRequestId ? approvalMap.get(item.approvalRequestId) || null : null
    })), total, page, limit);
  },

  async getHrAction(auth, id) {
    const action = await prisma.hRAction.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!action) throw new AppError('HR action not found', 404);

    ensureHrOrOwnerAccess(auth, action.employeeId, action.employee?.departmentId);

    const [timeline, approvalRequest, comments, supportingDocument] = await Promise.all([
      timelineService.getTimeline('HR_ACTION', id),
      getApprovalContext(action.approvalRequestId),
      getComments('HR_ACTION', id),
      action.supportingDocumentId ? prisma.document.findUnique({ where: { id: action.supportingDocumentId } }) : Promise.resolve(null)
    ]);

    return {
      ...action,
      timeline,
      approvalRequest,
      comments,
      supportingDocument
    };
  },

  async createHrAction(auth, data, files = [], req) {
    const employee = await prisma.user.findUnique({
      where: { id: data.employeeId },
      include: { department: true, manager: true, role: true }
    });
    if (!employee) throw new AppError('Employee not found', 404);

    const approvalStatus = firstNonEmpty(data.approvalStatus, data.status) || HR_ACTION_CREATE_STATUS.PENDING_APPROVAL;
    if (!Object.values(HR_ACTION_CREATE_STATUS).includes(approvalStatus)) {
      throw new AppError('Invalid approval status', 422);
    }

    const normalizedActionType = normalizeHrActionType(data.actionType);
    const changes = parseJsonRecord(data.changes);
    changes.uiActionType = firstNonEmpty(changes.uiActionType, data.actionType) || data.actionType;

    if (changes.rehireEligible !== undefined) {
      changes.rehireEligible = parseBooleanInput(changes.rehireEligible);
    }

    ensureRequiredActionFields(normalizedActionType, changes);

    const currentSalary = await getLatestSalary(prisma, employee.id);
    const normalizedSalary = parseNumericInput(changes.newSalary);
    const changedValues = {
      roleChanged: Boolean(changes.roleId && changes.roleId !== employee.roleId),
      departmentChanged: Boolean(changes.departmentId && changes.departmentId !== employee.departmentId),
      titleChanged: Boolean(firstNonEmpty(changes.jobTitle) && firstNonEmpty(changes.jobTitle) !== firstNonEmpty(employee.jobTitle)),
      managerChanged: Boolean(changes.managerId && changes.managerId !== employee.managerId),
      salaryChanged: normalizedSalary !== null ? currentSalary === null || normalizedSalary !== currentSalary : false
    };

    if ((changes.uiActionType === 'PROMOTION' || changes.uiActionType === 'DEMOTION')
      && !changedValues.roleChanged
      && !changedValues.departmentChanged
      && !changedValues.titleChanged
      && !changedValues.managerChanged
      && !changedValues.salaryChanged) {
      throw new AppError('No changes detected. New values must differ from current employee values.', 422);
    }

    if (changes.uiActionType === 'TRANSFER' && !changedValues.departmentChanged && !firstNonEmpty(changes.newLocation) && !changedValues.managerChanged) {
      throw new AppError('Transfer must include a different department, location, or manager.', 422);
    }

    if (changes.uiActionType === 'ROLE_CHANGE' && !changedValues.roleChanged) {
      throw new AppError('New role must be different from current role.', 422);
    }

    if (changes.uiActionType === 'SALARY_ADJUSTMENT' && !changedValues.salaryChanged) {
      throw new AppError('New salary must be different from current salary.', 422);
    }

    changes.before = {
      ...(changes.before && typeof changes.before === 'object' ? changes.before : {}),
      roleId: employee.roleId,
      roleName: employee.role?.displayName || null,
      departmentId: employee.departmentId || null,
      departmentName: employee.department?.name || null,
      jobTitle: employee.jobTitle || null,
      managerId: employee.managerId || null,
      managerName: employee.manager?.fullName || null,
      currentSalary
    };

    const uploadedFiles = Array.isArray(files) ? files : [];
    return prisma.$transaction(async (tx) => {
      const supportingDocuments = [];
      for (const file of uploadedFiles) {
        const uploaded = await uploadService.uploadSingleFile(file, 'hr/actions');
        const document = await tx.document.create({
          data: {
            ...uploaded,
            title: `${employee.fullName} HR action document`,
            description: `Supporting document for ${changes.uiActionType.replaceAll('_', ' ').toLowerCase()} action`,
            category: 'HR_DOCUMENT',
            documentType: 'HR_ACTION_SUPPORTING_DOCUMENT',
            ownerType: 'USER',
            ownerId: employee.id,
            uploadedById: auth.userId,
            departmentId: employee.departmentId,
            visibility: 'PRIVATE',
            status: 'DRAFT'
          }
        });
        await auditService.log({
          actorId: auth.userId,
          action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
          entityType: 'Document',
          entityId: document.id,
          newValues: document,
          req
        }, tx);
        supportingDocuments.push({
          documentId: document.id,
          title: document.title,
          fileUrl: document.fileUrl,
          fileName: document.fileName,
          mimeType: document.mimeType
        });
      }

      changes.supportingDocuments = supportingDocuments;

      const created = await tx.hRAction.create({
        data: {
          employeeId: data.employeeId,
          actionType: normalizedActionType,
          reason: data.reason,
          effectiveDate: data.effectiveDate,
          changes,
          status: approvalStatus === HR_ACTION_CREATE_STATUS.APPROVED ? 'APPROVED' : 'PENDING',
          supportingDocumentId: firstNonEmpty(data.supportingDocumentId) || supportingDocuments[0]?.documentId || null,
          createdById: auth.userId
        }
      });

      if (approvalStatus === HR_ACTION_CREATE_STATUS.APPROVED) {
        await applyHrActionChanges({
          tx,
          action: created,
          employee,
          changes,
          actorId: auth.userId,
          req
        });
      }

      let updated = created;
      if (approvalStatus === HR_ACTION_CREATE_STATUS.PENDING_APPROVAL) {
        const approval = await approvalService.create({
          requestType: 'HR_ACTION',
          entityType: 'HR_ACTION',
          entityId: created.id,
          requestedById: auth.userId,
          currentApproverId: gm?.id,
          reason: data.reason,
          steps: gm ? [{ approverUserId: gm.id, stepOrder: 1 }] : []
        }, auth.userId, req);

        updated = await tx.hRAction.update({
          where: { id: created.id },
          data: { approvalRequestId: approval.id }
        });
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'HRAction',
        entityId: updated.id,
        oldValues: {
          status: null,
          before: changes.before
        },
        newValues: {
          status: updated.status,
          actionType: updated.actionType,
          approvalStatus,
          changes
        },
        req
      }, tx);
      return updated;
    });
  },

  async reviewHrAction(auth, id, decision, comment, req) {
    const action = await prisma.hRAction.findFirst({ where: { id, deletedAt: null } });
    if (!action) throw new AppError('HR action not found', 404);
    if (!action.approvalRequestId) throw new AppError('HR action is missing its approval workflow', 400);

    await approvalService.act(action.approvalRequestId, decision, auth.userId, comment, req);
    return prisma.hRAction.findUnique({ where: { id } });
  },

  async addHrActionComment(auth, id, data, req) {
    const action = await prisma.hRAction.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!action) throw new AppError('HR action not found', 404);

    ensureHrOrOwnerAccess(auth, action.employeeId, action.employee?.departmentId);

    const comment = await workflowSupportService.createComment({
      authorId: auth.userId,
      entityType: 'HR_ACTION',
      entityId: id,
      body: data.body,
      mentions: parseMentionIds(data.mentions),
      attachments: data.attachments
    }, req);

    return {
      hrActionId: id,
      comment
    };
  },

  async cancelHrAction(auth, id, comment, req) {
    const action = await prisma.hRAction.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!action) throw new AppError('HR action not found', 404);

    domainGuardService.cannotEditAfterFinalState(action, 'HR action', ['APPROVED', 'REJECTED', 'CANCELLED']);

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth) && action.createdById !== auth.userId) {
      throw new AppError('You do not have permission to cancel this HR action', 403);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (action.approvalRequestId) {
        await tx.approvalStep.updateMany({
          where: { approvalRequestId: action.approvalRequestId, status: 'PENDING' },
          data: { status: 'CANCELLED', comment: comment || 'Cancelled by HR', actedAt: new Date() }
        });
        await tx.approvalRequest.update({
          where: { id: action.approvalRequestId },
          data: { status: 'CANCELLED', currentApproverId: null }
        });
      }

      const result = await tx.hRAction.update({
        where: { id },
        data: { status: 'CANCELLED' }
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'HRAction',
        entityId: id,
        oldValues: { status: action.status },
        newValues: { status: 'CANCELLED', comment: comment || null },
        req
      }, tx);

      return result;
    });

    if (comment) {
      await workflowSupportService.createComment({
        authorId: auth.userId,
        entityType: 'HR_ACTION',
        entityId: id,
        body: `HR action cancelled. ${comment}`.trim()
      }, req);
    }

    await notificationService.create({
      userId: action.employeeId,
      type: 'SYSTEM',
      title: 'HR action cancelled',
      body: comment || action.reason,
      entityType: 'HRAction',
      entityId: id
    });

    return updated;
  },

  async listSeparations(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const search = normalizeSearch(query.search);
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.separationType || query.type ? { type: query.separationType || query.type } : {}),
      ...buildDateRangeFilter('exitDate', query)
    };

    if (query.departmentId || search) {
      where.employee = {
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(search ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } }
          ]
        } : {})
      };
    }

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.employee = { ...(where.employee || {}), departmentId: { in: auth.departmentIds } };
      else where.employeeId = auth.userId;
    }

    const [items, total] = await prisma.$transaction([
      prisma.separation.findMany({
        where,
        include: {
          employee: { select: safeEmployeeSelect }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.separation.count({ where })
    ]);

    const approvalRequests = await prisma.approvalRequest.findMany({
      where: { id: { in: items.map((item) => item.approvalRequestId).filter(Boolean) } },
      include: { currentApprover: { select: { id: true, fullName: true } } }
    });
    const approvalMap = new Map(approvalRequests.map((approval) => [approval.id, approval]));

    return paginated(items.map((item) => ({
      ...item,
      approvalRequest: item.approvalRequestId ? approvalMap.get(item.approvalRequestId) || null : null
    })), total, page, limit);
  },

  async getSeparation(auth, id) {
    const separation = await prisma.separation.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!separation) throw new AppError('Separation record not found', 404);

    ensureHrOrOwnerAccess(auth, separation.employeeId, separation.employee?.departmentId);

    const [timeline, approvalRequest, comments, finalDocuments] = await Promise.all([
      timelineService.getTimeline('SEPARATION', id),
      getApprovalContext(separation.approvalRequestId),
      getComments('SEPARATION', id),
      Array.isArray(separation.finalDocuments)
        ? prisma.document.findMany({
          where: { id: { in: separation.finalDocuments.filter(Boolean) }, deletedAt: null }
        })
        : Promise.resolve([])
    ]);

    return {
      ...separation,
      timeline,
      approvalRequest,
      comments,
      finalDocumentRecords: finalDocuments
    };
  },

  async createSeparation(auth, data, files = [], req) {
    const employee = await prisma.user.findUnique({ where: { id: data.employeeId } });
    if (!employee) throw new AppError('Employee not found', 404);

    const separationStatus = firstNonEmpty(data.separationStatus, data.status) || SEPARATION_CREATE_STATUS.PENDING_APPROVAL;
    if (!Object.values(SEPARATION_CREATE_STATUS).includes(separationStatus)) {
      throw new AppError('Invalid separation status', 422);
    }

    const uiSeparationType = normalizeSeparationUiType(data.uiSeparationType, data.type);
    const normalizedTypeCandidate = normalizeSeparationDbType(data.type, uiSeparationType);
    const type = ['RESIGNATION', 'RETIREMENT', 'TERMINATION', 'CONTRACT_END'].includes(normalizedTypeCandidate)
      ? normalizedTypeCandidate
      : 'TERMINATION';

    const reason = firstNonEmpty(data.reason) || '';
    const separationCategory = firstNonEmpty(data.separationCategory)
      || (['RESIGNATION', 'RETIREMENT', 'CONTRACT_ENDED'].includes(uiSeparationType) ? 'VOLUNTARY' : 'INVOLUNTARY');
    if (separationCategory === 'INVOLUNTARY' && reason.length < 3) {
      throw new AppError('Reason is required for involuntary separation', 422);
    }

    const noticeDetails = parseJsonRecord(data.noticeDetails);
    const handoverDetails = parseJsonRecord(data.handoverDetails);
    const accessRevocation = parseJsonRecord(data.accessRevocation);
    const finalSettlement = parseJsonRecord(data.finalSettlement);
    const incomingAssetReturn = parseJsonRecord(data.assetReturn);
    const baseChecklist = parseJsonRecord(data.clearanceChecklist);

    const eligibleForRehire = parseBooleanInput(data.eligibleForRehire, true);
    const rehireRestrictionReason = firstNonEmpty(data.rehireRestrictionReason) || '';
    if (!eligibleForRehire && rehireRestrictionReason.length < 3) {
      throw new AppError('Rehire restriction reason is required when employee is not eligible for rehire', 422);
    }

    const noticeServed = noticeDetails.noticeServed !== undefined
      ? parseBooleanInput(noticeDetails.noticeServed)
      : true;
    const noticeWaiverReason = firstNonEmpty(noticeDetails.noticeWaiverReason) || '';
    if (!noticeServed && noticeWaiverReason.length < 3) {
      throw new AppError('Notice waiver reason is required when notice is not served', 422);
    }

    const exitDate = new Date(data.exitDate);
    const lastWorkingDayValue = noticeDetails.lastWorkingDay ? new Date(noticeDetails.lastWorkingDay) : null;
    if (lastWorkingDayValue && startOfDayDate(lastWorkingDayValue) > startOfDayDate(exitDate)) {
      throw new AppError('Last working day cannot be after exit date', 422);
    }

    const uploadedFiles = Array.isArray(files) ? files : [];
    const documentLabels = parseStringArrayInput(data.documentLabels).map((label) => String(label || '').trim().toUpperCase());
    const hasLabel = (label) => documentLabels.includes(label);
    if (uiSeparationType === 'RESIGNATION' && !hasLabel('RESIGNATION_LETTER')) {
      throw new AppError('Resignation letter is required for resignation separations', 422);
    }
    if (uiSeparationType === 'TERMINATION' && !hasLabel('TERMINATION_LETTER')) {
      throw new AppError('Termination letter is required for termination separations', 422);
    }

    const assetReturn = {
      ...incomingAssetReturn,
      laptopReturned: parseBooleanInput(incomingAssetReturn.laptopReturned),
      phoneReturned: parseBooleanInput(incomingAssetReturn.phoneReturned),
      idCardReturned: parseBooleanInput(incomingAssetReturn.idCardReturned),
      accessCardReturned: parseBooleanInput(incomingAssetReturn.accessCardReturned),
      companyDocumentsReturned: parseBooleanInput(incomingAssetReturn.companyDocumentsReturned),
      otherAssetsReturned: parseBooleanInput(incomingAssetReturn.otherAssetsReturned)
    };

    const normalizedAccessRevocation = {
      emailDisabled: parseBooleanInput(accessRevocation.emailDisabled),
      systemAccessDisabled: parseBooleanInput(accessRevocation.systemAccessDisabled),
      payrollAccessDisabled: parseBooleanInput(accessRevocation.payrollAccessDisabled),
      buildingAccessRevoked: parseBooleanInput(accessRevocation.buildingAccessRevoked),
      sharedDriveAccessRemoved: parseBooleanInput(accessRevocation.sharedDriveAccessRemoved)
    };

    const workflowMeta = {
      separationStatus,
      approvalNotes: firstNonEmpty(data.approvalNotes) || null
    };

    const gm = await getFirstUserByRole(ROLES.GENERAL_MANAGER);
    const shouldCreateApproval = separationStatus === SEPARATION_CREATE_STATUS.PENDING_APPROVAL;
    const shouldApplyImmediately = [SEPARATION_CREATE_STATUS.APPROVED, SEPARATION_CREATE_STATUS.COMPLETED].includes(separationStatus);
    const dbStatus = separationStatus === SEPARATION_CREATE_STATUS.CANCELLED
      ? 'CANCELLED'
      : shouldApplyImmediately
        ? 'APPROVED'
        : 'PENDING';

    const checklistItems = [
      Boolean(assetReturn.laptopReturned),
      Boolean(assetReturn.phoneReturned),
      Boolean(assetReturn.idCardReturned),
      Boolean(assetReturn.accessCardReturned),
      Boolean(assetReturn.companyDocumentsReturned),
      Boolean(assetReturn.otherAssetsReturned),
      Boolean(normalizedAccessRevocation.emailDisabled),
      Boolean(normalizedAccessRevocation.systemAccessDisabled),
      Boolean(normalizedAccessRevocation.payrollAccessDisabled),
      Boolean(normalizedAccessRevocation.buildingAccessRevoked),
      Boolean(normalizedAccessRevocation.sharedDriveAccessRemoved),
      String(handoverDetails.handoverStatus || '').toUpperCase() === 'COMPLETED'
    ];
    const completedChecklistItems = checklistItems.filter(Boolean).length;

    return prisma.$transaction(async (tx) => {
      const documentIds = [];
      const documentsByLabel = {};
      for (let index = 0; index < uploadedFiles.length; index += 1) {
        const file = uploadedFiles[index];
        const label = documentLabels[index] || `SUPPORTING_DOCUMENT_${index + 1}`;
        const uploaded = await uploadService.uploadSingleFile(file, 'hr/separations');
        const document = await tx.document.create({
          data: {
            ...uploaded,
            title: `${employee.fullName} ${label.replaceAll('_', ' ').toLowerCase()}`,
            description: `Separation document (${label.replaceAll('_', ' ').toLowerCase()})`,
            category: 'HR_DOCUMENT',
            documentType: 'SEPARATION_SUPPORTING_DOCUMENT',
            ownerType: 'USER',
            ownerId: employee.id,
            uploadedById: auth.userId,
            departmentId: employee.departmentId,
            visibility: 'PRIVATE',
            status: 'DRAFT'
          }
        });
        await auditService.log({
          actorId: auth.userId,
          action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
          entityType: 'Document',
          entityId: document.id,
          newValues: document,
          req
        }, tx);

        documentIds.push(document.id);
        documentsByLabel[label] = {
          id: document.id,
          title: document.title,
          fileName: document.fileName,
          fileUrl: document.fileUrl
        };
      }

      const clearanceChecklist = {
        ...baseChecklist,
        separationDetails: {
          uiSeparationType,
          separationCategory,
          eligibleForRehire,
          rehireRestrictionReason: rehireRestrictionReason || null
        },
        noticeDetails: {
          ...noticeDetails,
          noticeServed,
          noticeWaiverReason: noticeWaiverReason || null
        },
        handoverDetails,
        accessRevocation: normalizedAccessRevocation,
        finalSettlement,
        workflowMeta,
        documents: documentsByLabel,
        checklistProgress: {
          completed: completedChecklistItems,
          total: checklistItems.length,
          percent: Math.round((completedChecklistItems / checklistItems.length) * 100)
        }
      };

      const created = await tx.separation.create({
        data: {
          employeeId: data.employeeId,
          type,
          reason: reason || null,
          exitDate: data.exitDate,
          clearanceChecklist,
          assetReturn,
          finalPaymentStatus: firstNonEmpty(finalSettlement.settlementStatus, data.finalPaymentStatus) || 'PENDING',
          exitInterviewNotes: firstNonEmpty(data.exitInterviewNotes) || null,
          finalDocuments: documentIds,
          status: dbStatus
        }
      });

      if (shouldApplyImmediately) {
        await applySeparationLifecycleToUser(tx, created, auth.userId, req, {
          trigger: 'SEPARATION_CREATE_APPROVED'
        });
      }

      let updated = created;
      if (shouldCreateApproval) {
        const approval = await approvalService.create({
          requestType: 'SEPARATION',
          entityType: 'SEPARATION',
          entityId: created.id,
          requestedById: auth.userId,
          currentApproverId: gm?.id,
          reason: reason || 'Separation request',
          steps: gm ? [{ approverUserId: gm.id, stepOrder: 1 }] : []
        }, auth.userId, req);

        updated = await tx.separation.update({
          where: { id: created.id },
          data: { approvalRequestId: approval.id }
        });
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'Separation',
        entityId: updated.id,
        oldValues: {
          status: null
        },
        newValues: {
          status: updated.status,
          type: updated.type,
          exitDate: updated.exitDate,
          separationStatus,
          changedFields: {
            reason: reason || null,
            noticeDetails: clearanceChecklist.noticeDetails,
            handoverDetails: clearanceChecklist.handoverDetails,
            assetReturn,
            accessRevocation: clearanceChecklist.accessRevocation,
            finalSettlement,
            documents: Object.keys(documentsByLabel)
          }
        },
        req
      }, tx);
      return updated;
    });
  },

  async reviewSeparation(auth, id, decision, comment, req) {
    const separation = await prisma.separation.findFirst({ where: { id, deletedAt: null } });
    if (!separation) throw new AppError('Separation record not found', 404);
    if (!separation.approvalRequestId) throw new AppError('Separation record is missing its approval workflow', 400);

    await approvalService.act(separation.approvalRequestId, decision, auth.userId, comment, req);
    return prisma.separation.findUnique({ where: { id } });
  },

  async updateSeparationClearanceChecklist(auth, id, clearanceChecklist, req) {
    return this._updateSeparationField(auth, id, 'clearanceChecklist', clearanceChecklist, req, 'Separation clearance checklist updated');
  },

  async updateSeparationAssetReturn(auth, id, assetReturn, req) {
    return this._updateSeparationField(auth, id, 'assetReturn', assetReturn, req, 'Separation asset return updated');
  },

  async updateSeparationExitInterview(auth, id, exitInterviewNotes, req) {
    return this._updateSeparationField(auth, id, 'exitInterviewNotes', exitInterviewNotes, req, 'Separation exit interview updated');
  },

  async _updateSeparationField(auth, id, field, value, req, notificationTitle) {
    const separation = await prisma.separation.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: safeEmployeeSelect }
      }
    });
    if (!separation) throw new AppError('Separation record not found', 404);

    domainGuardService.cannotEditAfterFinalState(separation, 'Separation', ['APPROVED', 'REJECTED', 'CANCELLED']);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.separation.update({
        where: { id },
        data: { [field]: value }
      });
      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'Separation',
        entityId: id,
        oldValues: { [field]: separation[field] },
        newValues: { [field]: value },
        req
      }, tx);
      return result;
    });

    if (separation.employeeId !== auth.userId) {
      await notificationService.create({
        userId: separation.employeeId,
        type: 'SYSTEM',
        title: notificationTitle,
        body: typeof value === 'string' ? value : `Updated by ${req.user?.fullName || 'HR team'}`,
        entityType: 'Separation',
        entityId: id
      });
    }

    return updated;
  }
};

module.exports = hrService;
