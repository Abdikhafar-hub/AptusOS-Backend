const bcrypt = require('bcrypt');
const prisma = require('../prisma/client');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { normalizeRoleName, ROLES } = require('../constants/roles');
const auditService = require('./auditService');
const emailService = require('../emails/emailService');
const { hashToken, randomToken, signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/tokens');
const userService = require('./userService');

const userInclude = {
  department: true,
  manager: { select: { id: true, fullName: true, email: true } },
  role: { include: { permissions: { include: { permission: true } } } },
  departmentMemberships: true
};
const SELF_PROFILE_FIELDS = new Set([
  'firstName',
  'lastName',
  'email',
  'phone',
  'alternatePhone',
  'address',
  'emergencyContactName',
  'emergencyContactPhone'
]);

const trimOrNull = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value).trim();
};

const publicUser = (user) => {
  const { passwordHash, ...safe } = user;
  return safe;
};

const buildAuthUser = (user) => {
  const safe = publicUser(user);
  const roleName = normalizeRoleName(user.role.name);
  const roleDisplayName = roleName === ROLES.FINANCE_ACCOUNTS_MANAGER ? 'Finance & Accounts Manager' : user.role.displayName;
  const dashboardRoute = roleName === ROLES.GENERAL_MANAGER
    ? '/dashboard/general-manager'
    : roleName === ROLES.DEPARTMENT_HEAD
      ? '/dashboard/department-head'
      : roleName === ROLES.HR_MANAGER
        ? '/dashboard/hr'
        : roleName === ROLES.FINANCE_ACCOUNTS_MANAGER
          ? '/dashboard/finance-accounts'
          : roleName === ROLES.SALES_COMPLIANCE_OFFICER
            ? '/dashboard/sales-compliance'
            : roleName === ROLES.OPERATIONS_PROCUREMENT_OFFICER
              ? '/dashboard/operations'
              : '/dashboard/employee';
  return {
    ...safe,
    mustChangePassword: Boolean(user.mustChangePassword),
    dashboardRoute,
    permissions: user.role.permissions.map((item) => item.permission.key),
    role: {
      id: user.role.id,
      name: roleName,
      displayName: roleDisplayName
    },
    departments: [...new Map(
      [user.department, ...(user.departmentMemberships || []).map((item) => item.department).filter(Boolean)]
        .filter(Boolean)
        .map((department) => [department.id, department])
    ).values()]
  };
};

const buildSession = async (user, req) => {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const decoded = verifyRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(decoded.exp * 1000),
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent']
    }
  });

  return { accessToken, refreshToken };
};

const authService = {
  async login({ email, password }, req) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        ...userInclude,
        departmentMemberships: { include: { department: true } }
      }
    });
    if (!user || !user.passwordHash) {
      await auditService.log({ action: AUDIT_ACTIONS.USER_FAILED_LOGIN, entityType: 'User', newValues: { email }, req });
      throw new AppError('Invalid email or password', 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await auditService.log({ actorId: user.id, action: AUDIT_ACTIONS.USER_FAILED_LOGIN, entityType: 'User', entityId: user.id, req });
      throw new AppError('Invalid email or password', 401);
    }
    if (!user.isActive || user.deletedAt || user.employmentStatus === 'SUSPENDED' || user.employmentStatus === 'TERMINATED') {
      await auditService.log({ actorId: user.id, action: AUDIT_ACTIONS.USER_FAILED_LOGIN, entityType: 'User', entityId: user.id, newValues: { reason: 'inactive_or_blocked' }, req });
      throw new AppError('Your account is inactive. Please contact your administrator.', 401);
    }

    const tokens = await buildSession(user, req);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await auditService.log({ actorId: user.id, action: AUDIT_ACTIONS.USER_LOGIN, entityType: 'User', entityId: user.id, req });
    return { user: buildAuthUser(user), ...tokens };
  },

  async refresh(refreshToken, req) {
    const payload = verifyRefreshToken(refreshToken);
    const session = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new AppError('Invalid refresh token', 401);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        ...userInclude,
        departmentMemberships: { include: { department: true } }
      }
    });
    if (!user || !user.isActive || user.deletedAt) throw new AppError('User unavailable', 401);

    await prisma.refreshToken.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const tokens = await buildSession(user, req);
    return { user: buildAuthUser(user), ...tokens };
  },

  async logout(refreshToken, userId, req) {
    if (refreshToken) {
      await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken), userId }, data: { revokedAt: new Date() } });
    }
    await auditService.log({ actorId: userId, action: AUDIT_ACTIONS.USER_LOGOUT, entityType: 'User', entityId: userId, req });
    return true;
  },

  async requestPasswordReset(email, req) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return true;
    const token = randomToken();
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) }
      })
    ]);
    await emailService.sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetToken: token
    });
    await auditService.log({
      actorId: user.id,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: user.id,
      newValues: { auditKind: 'PASSWORD_RESET_REQUESTED' },
      req
    });
    return true;
  },

  async resetPassword({ token, password }, req) {
    const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw new AppError('Invalid or expired reset token', 400);
    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash, mustChangePassword: false } }),
      prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      prisma.refreshToken.updateMany({ where: { userId: reset.userId }, data: { revokedAt: new Date() } })
    ]);
    await auditService.log({
      actorId: reset.userId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: reset.userId,
      newValues: { auditKind: 'PASSWORD_RESET_COMPLETED' },
      req
    });
    return true;
  },

  async setupPassword({ token, password }, req) {
    const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw new AppError('Invalid or expired setup token', 400);
    const user = await prisma.user.findUnique({ where: { id: reset.userId } });
    if (!user) throw new AppError('User not found', 404);
    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, isActive: true } }),
      prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } })
    ]);
    await auditService.log({
      actorId: user.id,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: user.id,
      newValues: { setupCompleted: true, auditKind: 'PASSWORD_SETUP_COMPLETED' },
      req
    });
    return true;
  },

  async changePassword(userId, { currentPassword, newPassword }, req) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new AppError('Current password is incorrect', 400);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, env.bcryptSaltRounds), mustChangePassword: false } });
    await auditService.log({
      actorId: userId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: userId,
      newValues: { auditKind: 'PASSWORD_CHANGED' },
      req
    });
    return true;
  },

  async me(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        ...userInclude,
        departmentMemberships: { include: { department: true } }
      }
    });
    if (!user) throw new AppError('User not found', 404);
    return buildAuthUser(user);
  },

  async updateMe(userId, payload, req) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) throw new AppError('User not found', 404);

    const incomingEntries = Object.entries(payload || {});
    const safeUpdates = Object.fromEntries(
      incomingEntries
        .filter(([key]) => SELF_PROFILE_FIELDS.has(key))
        .map(([key, value]) => [key, trimOrNull(value)])
    );

    if (safeUpdates.email !== undefined) {
      const email = safeUpdates.email?.toLowerCase();
      if (!email) throw new AppError('Email is required', 422);
      const emailOwner = await prisma.user.findFirst({
        where: {
          email,
          id: { not: userId }
        },
        select: { id: true }
      });
      if (emailOwner) throw new AppError('Email is already in use by another account', 409);
      safeUpdates.email = email;
    }

    if (safeUpdates.firstName !== undefined && !safeUpdates.firstName) {
      throw new AppError('First name is required', 422);
    }

    if (safeUpdates.lastName !== undefined && !safeUpdates.lastName) {
      throw new AppError('Last name is required', 422);
    }

    const nextFirstName = safeUpdates.firstName === undefined ? existing.firstName : safeUpdates.firstName;
    const nextLastName = safeUpdates.lastName === undefined ? existing.lastName : safeUpdates.lastName;

    if (!nextFirstName || !nextLastName) {
      throw new AppError('First and last name are required', 422);
    }

    safeUpdates.fullName = `${nextFirstName} ${nextLastName}`.trim();

    const updated = await prisma.user.update({
      where: { id: userId },
      data: safeUpdates,
      include: {
        ...userInclude,
        departmentMemberships: { include: { department: true } }
      }
    });

    await auditService.log({
      actorId: userId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: userId,
      oldValues: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        fullName: existing.fullName,
        email: existing.email,
        phone: existing.phone,
        alternatePhone: existing.alternatePhone,
        address: existing.address,
        emergencyContactName: existing.emergencyContactName,
        emergencyContactPhone: existing.emergencyContactPhone
      },
      newValues: {
        firstName: updated.firstName,
        lastName: updated.lastName,
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        alternatePhone: updated.alternatePhone,
        address: updated.address,
        emergencyContactName: updated.emergencyContactName,
        emergencyContactPhone: updated.emergencyContactPhone
      },
      req
    });

    return buildAuthUser(updated);
  },

  async uploadMyProfilePhoto(userId, file, req) {
    if (!file) throw new AppError('Please select an image to upload', 422);
    const uploaded = await userService.uploadProfilePhoto(userId, file, userId, req);
    return this.me(uploaded.id);
  }
};

module.exports = authService;
