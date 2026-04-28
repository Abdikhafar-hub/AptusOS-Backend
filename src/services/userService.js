const bcrypt = require('bcrypt');
const prisma = require('../prisma/client');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const auditService = require('./auditService');
const emailService = require('../emails/emailService');
const { generateTemporaryPassword } = require('../utils/passwordGenerator');
const accessControlService = require('./accessControlService');
const uploadService = require('../uploads/uploadService');
const notificationService = require('./notificationService');

const include = {
  role: true,
  department: true,
  manager: { select: { id: true, fullName: true, email: true } },
  departmentMemberships: { include: { department: true } }
};

const safe = (user) => {
  const { passwordHash, ...rest } = user;
  return rest;
};

const toSafeAuditUser = (user) => safe(user || {});

const trimOrUndefined = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const relationIdOrNull = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const mapUserInput = (data = {}) => ({
  firstName: trimOrUndefined(data.firstName),
  lastName: trimOrUndefined(data.lastName),
  email: data.email ? String(data.email).trim().toLowerCase() : undefined,
  phone: trimOrUndefined(data.phone),
  alternatePhone: trimOrUndefined(data.alternatePhone),
  roleId: data.roleId,
  departmentId: relationIdOrNull(data.departmentId),
  managerId: relationIdOrNull(data.managerId),
  jobTitle: trimOrUndefined(data.jobTitle),
  employmentType: data.employmentType,
  employmentStatus: data.employmentStatus,
  joinDate: data.joinDate,
  emergencyContactName: trimOrUndefined(data.emergencyContactName),
  emergencyContactPhone: trimOrUndefined(data.emergencyContactPhone),
  address: trimOrUndefined(data.address),
  notes: trimOrUndefined(data.notes)
});

const sanitizeEmailError = (error) => (error ? String(error).slice(0, 240) : 'Failed to deliver onboarding email.');

const userService = {
  buildScopedWhere(auth, query = {}) {
    const where = { deletedAt: null };
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.roleId) where.roleId = query.roleId;
    if (query.employmentStatus) where.employmentStatus = query.employmentStatus;
    if (query.search) {
      where.OR = ['firstName', 'lastName', 'fullName', 'email', 'jobTitle'].map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' } }));
    }
    if (accessControlService.isGeneralManager(auth) || accessControlService.isHr(auth)) return where;
    if (accessControlService.isDepartmentHead(auth)) {
      where.departmentId = { in: auth.departmentIds };
      return where;
    }
    where.id = auth.userId;
    return where;
  },

  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = this.buildScopedWhere(auth, query);
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({ where, skip, take: limit, orderBy: { [sortBy]: sortOrder }, include }),
      prisma.user.count({ where })
    ]);
    return paginated(items.map(safe), total, page, limit);
  },

  async get(id, auth) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include });
    if (!user) throw new AppError('User not found', 404);
    accessControlService.assertUserViewAccess(auth, user);
    return safe(user);
  },

  async create(data, actorId, req) {
    const input = mapUserInput(data);
    if (!input.firstName || !input.lastName || !input.email || !input.roleId) {
      throw new AppError('First name, last name, email, and role are required', 422);
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true }
    });
    if (existingUser) {
      throw new AppError('Email is already in use by another account', 409);
    }

    const role = await prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new AppError('Role not found', 404);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, env.bcryptSaltRounds);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          ...input,
          fullName: `${input.firstName} ${input.lastName}`.trim(),
          passwordHash,
          mustChangePassword: true,
          isActive: true
        },
        include
      });
      if (created.departmentId) {
        await tx.departmentMember.upsert({
          where: { departmentId_userId: { departmentId: created.departmentId, userId: created.id } },
          update: {},
          create: { departmentId: created.departmentId, userId: created.id }
        });
      }
      await auditService.log({
        actorId,
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: 'User',
        entityId: created.id,
        newValues: toSafeAuditUser(created),
        req
      }, tx);
      return created;
    });

    const emailResult = await emailService.sendStaffOnboardingCredentialsEmail({
      to: user.email,
      firstName: user.firstName,
      email: user.email,
      temporaryPassword,
      loginUrl: `${env.frontendAppUrl}/login`
    });

    if (emailResult.sent) {
      await auditService.log({
        actorId,
        action: AUDIT_ACTIONS.STAFF_ONBOARDING_EMAIL_SENT,
        entityType: 'User',
        entityId: user.id,
        newValues: { emailSent: true },
        req
      });
    } else {
      await auditService.log({
        actorId,
        action: AUDIT_ACTIONS.STAFF_ONBOARDING_EMAIL_FAILED,
        entityType: 'User',
        entityId: user.id,
        newValues: { emailSent: false, emailError: sanitizeEmailError(emailResult.error) },
        req
      });
    }

    await notificationService.create({
      userId: user.id,
      type: 'SYSTEM',
      title: 'Your AptusOS account has been created',
      body: emailResult.sent
        ? 'Check your email for temporary login credentials.'
        : 'Your account is ready, but onboarding credentials email delivery failed. Contact HR.',
      entityType: 'User',
      entityId: user.id
    });
    return {
      user: safe(user),
      emailSent: Boolean(emailResult.sent),
      emailError: emailResult.sent ? null : sanitizeEmailError(emailResult.error)
    };
  },

  async update(id, data, actorId, req) {
    const existing = await prisma.user.findUnique({ where: { id }, include });
    if (!existing) throw new AppError('User not found', 404);
    accessControlService.assertUserManageAccess(req.auth, existing);
    if (data.employmentStatus === 'TERMINATED') {
      throw new AppError('Termination must be completed through the HR action workflow', 400);
    }

    const input = mapUserInput(data);
    const updateData = {
      ...input,
      fullName: data.firstName || data.lastName
        ? `${input.firstName || existing.firstName} ${input.lastName || existing.lastName}`.trim()
        : undefined
    };

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: updateData,
        include
      });

      if (input.roleId !== undefined && input.roleId !== existing.roleId) {
        await auditService.log({
          actorId,
          action: AUDIT_ACTIONS.ROLE_CHANGED,
          entityType: 'User',
          entityId: id,
          oldValues: { roleId: existing.roleId, role: existing.role?.displayName },
          newValues: { roleId: updated.roleId, role: updated.role?.displayName },
          req
        }, tx);
      }

      if (input.departmentId !== undefined && input.departmentId !== existing.departmentId) {
        await auditService.log({
          actorId,
          action: AUDIT_ACTIONS.DEPARTMENT_CHANGED,
          entityType: 'User',
          entityId: id,
          oldValues: { departmentId: existing.departmentId, department: existing.department?.name },
          newValues: { departmentId: updated.departmentId, department: updated.department?.name },
          req
        }, tx);
      }

      if (input.departmentId) {
        await tx.departmentMember.upsert({
          where: { departmentId_userId: { departmentId: input.departmentId, userId: id } },
          update: {},
          create: { departmentId: input.departmentId, userId: id }
        });
      }
      await auditService.log({
        actorId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'User',
        entityId: id,
        oldValues: toSafeAuditUser(existing),
        newValues: toSafeAuditUser(updated),
        req
      }, tx);
      return updated;
    });
    return safe(user);
  },

  async resendCredentials(id, actorId, req) {
    const existing = await prisma.user.findUnique({ where: { id }, include });
    if (!existing) throw new AppError('User not found', 404);
    accessControlService.assertUserManageAccess(req.auth, existing);

    if (!existing.isActive || ['INACTIVE', 'TERMINATED'].includes(existing.employmentStatus)) {
      throw new AppError('Cannot resend credentials to inactive or terminated users', 400);
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, env.bcryptSaltRounds);
    const updated = await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true
      },
      include
    });

    const emailResult = await emailService.sendStaffOnboardingCredentialsEmail({
      to: updated.email,
      firstName: updated.firstName,
      email: updated.email,
      temporaryPassword,
      loginUrl: `${env.frontendAppUrl}/login`
    });

    const action = emailResult.sent ? AUDIT_ACTIONS.STAFF_CREDENTIALS_RESENT : AUDIT_ACTIONS.STAFF_CREDENTIALS_RESEND_FAILED;
    await auditService.log({
      actorId,
      action,
      entityType: 'User',
      entityId: id,
      oldValues: { mustChangePassword: existing.mustChangePassword },
      newValues: {
        mustChangePassword: updated.mustChangePassword,
        emailSent: Boolean(emailResult.sent),
        emailError: emailResult.sent ? undefined : sanitizeEmailError(emailResult.error)
      },
      req
    });

    await notificationService.create({
      userId: id,
      type: 'SYSTEM',
      title: 'Your AptusOS credentials were reset',
      body: emailResult.sent
        ? 'Check your email for your new temporary password.'
        : 'Your temporary credentials were reset, but delivery email failed. Contact HR.',
      entityType: 'User',
      entityId: id
    });

    return {
      user: safe(updated),
      emailSent: Boolean(emailResult.sent),
      emailError: emailResult.sent ? null : sanitizeEmailError(emailResult.error)
    };
  },

  async deactivate(id, actorId, req) {
    const existing = await prisma.user.findUnique({ where: { id }, include });
    if (!existing) throw new AppError('User not found', 404);
    accessControlService.assertUserManageAccess(req.auth, existing);
    const user = await prisma.user.update({ where: { id }, data: { isActive: false, employmentStatus: 'INACTIVE' }, include });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.USER_DEACTIVATED, entityType: 'User', entityId: id, req });
    await notificationService.create({
      userId: id,
      type: 'SYSTEM',
      title: 'Your AptusOS account has been deactivated',
      body: 'Please contact HR or management for assistance.',
      entityType: 'User',
      entityId: id
    });
    return safe(user);
  },

  async activate(id, actorId, req) {
    const existing = await prisma.user.findUnique({ where: { id }, include });
    if (!existing) throw new AppError('User not found', 404);
    accessControlService.assertUserManageAccess(req.auth, existing);
    const user = await prisma.user.update({ where: { id }, data: { isActive: true, employmentStatus: 'ACTIVE' }, include });
    await auditService.log({
      actorId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      oldValues: toSafeAuditUser(existing),
      newValues: toSafeAuditUser(user),
      req
    });
    return safe(user);
  },

  async suspend(id, actorId, req) {
    const existing = await prisma.user.findUnique({ where: { id }, include });
    if (!existing) throw new AppError('User not found', 404);
    accessControlService.assertUserManageAccess(req.auth, existing);
    const user = await prisma.user.update({ where: { id }, data: { isActive: false, employmentStatus: 'SUSPENDED' }, include });
    await auditService.log({
      actorId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      oldValues: toSafeAuditUser(existing),
      newValues: toSafeAuditUser(user),
      req
    });
    await notificationService.create({
      userId: id,
      type: 'SYSTEM',
      title: 'Your account has been suspended',
      body: req.body?.reason || 'Please contact HR for more information.',
      entityType: 'User',
      entityId: id
    });
    return safe(user);
  },

  async uploadProfilePhoto(id, file, actorId, req) {
    const existing = await prisma.user.findUnique({ where: { id }, include });
    if (!existing) throw new AppError('User not found', 404);
    if (actorId !== id) accessControlService.assertUserManageAccess(req.auth, existing);
    const uploaded = await uploadService.uploadSingleFile(file, 'users');
    const user = await prisma.user.update({ where: { id }, data: { profilePhotoUrl: uploaded.fileUrl }, include });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'User', entityId: id, oldValues: { profilePhotoUrl: existing.profilePhotoUrl }, newValues: { profilePhotoUrl: uploaded.fileUrl }, req });
    return safe(user);
  },

  async uploadStaffDocument(id, file, data, actorId, req) {
    const existing = await prisma.user.findUnique({ where: { id }, include });
    if (!existing) throw new AppError('User not found', 404);
    accessControlService.assertUserManageAccess(req.auth, existing);
    const uploaded = await uploadService.uploadSingleFile(file, 'users');
    const document = await prisma.document.create({
      data: {
        ...uploaded,
        title: data.title,
        description: data.description,
        category: data.category,
        ownerType: 'USER',
        ownerId: id,
        uploadedById: actorId,
        departmentId: existing.departmentId,
        visibility: data.visibility || 'PRIVATE',
        status: 'DRAFT',
        expiryDate: data.expiryDate,
        reminderDate: data.reminderDate
      }
    });
    await auditService.log({ actorId, action: AUDIT_ACTIONS.DOCUMENT_UPLOADED, entityType: 'Document', entityId: document.id, newValues: document, req });
    return document;
  },

  async getFullProfile(id, auth) {
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...include,
        documentsUploaded: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 },
        assignedTasks: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' }, take: 20 },
        leaveRequests: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 },
        leaveBalances: { orderBy: [{ year: 'desc' }, { leaveType: 'asc' }], take: 20 },
        trainingParticipants: { include: { training: true }, take: 20, orderBy: { createdAt: 'desc' } },
        performanceReviews: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 },
        hrActions: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 },
        separations: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }
      }
    });
    if (!user) throw new AppError('User not found', 404);
    accessControlService.assertUserViewAccess(auth, user);
    const [attendanceSummary, auditTimeline, payrollSummary] = await Promise.all([
      prisma.attendanceRecord.groupBy({ by: ['status'], where: { employeeId: id, deletedAt: null }, _count: true }),
      prisma.auditLog.findMany({ where: { OR: [{ actorId: id }, { entityId: id }] }, orderBy: { createdAt: 'desc' }, take: 50 }),
      accessControlService.canViewPayroll(auth, id)
        ? prisma.payslip.findMany({ where: { employeeId: id, deletedAt: null }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 12 })
        : Promise.resolve([])
    ]);
    return {
      employee: safe(user),
      department: user.department,
      manager: user.manager,
      documents: user.documentsUploaded,
      leaveHistory: user.leaveRequests,
      leaveBalances: user.leaveBalances,
      attendanceSummary,
      trainingHistory: user.trainingParticipants,
      payrollSummary,
      hrActions: user.hrActions,
      separations: user.separations,
      performanceReviews: user.performanceReviews,
      tasks: user.assignedTasks,
      auditTimeline
    };
  },

  async timeline(id, auth) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('User not found', 404);
    accessControlService.assertUserViewAccess(auth, user);
    const [auditLogs, tasks, leaveRequests, trainings, reviews, hrActions, separations] = await prisma.$transaction([
      prisma.auditLog.findMany({ where: { OR: [{ actorId: id }, { entityId: id }] }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.task.findMany({ where: { assignedToId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.leaveRequest.findMany({ where: { employeeId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.trainingParticipant.findMany({ where: { employeeId: id }, include: { training: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.performanceReview.findMany({ where: { employeeId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.hRAction.findMany({ where: { employeeId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.separation.findMany({ where: { employeeId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 })
    ]);
    return { auditLogs, tasks, leaveRequests, trainings, reviews, hrActions, separations };
  }
};

module.exports = userService;
