const AppError = require('../utils/AppError');
const { ROLES, normalizeRoleName } = require('../constants/roles');

const requireRoles = (...roles) => (req, res, next) => {
  const roleName = normalizeRoleName(req.auth?.roleName);
  if (roleName === ROLES.GENERAL_MANAGER || roles.includes(roleName)) return next();
  return next(new AppError('Insufficient role access', 403));
};

const requireRole = (...roles) => requireRoles(...roles);

const requirePermission = (...permissions) => (req, res, next) => {
  if (normalizeRoleName(req.auth?.roleName) === ROLES.GENERAL_MANAGER) return next();
  if (permissions.some((permission) => req.auth?.permissions?.includes(permission))) return next();
  return next(new AppError('Insufficient permission access', 403));
};

module.exports = { requireRoles, requireRole, requirePermission };
