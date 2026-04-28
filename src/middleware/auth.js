const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/tokens');
const { normalizeRoleName } = require('../constants/roles');

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw new AppError('Authentication required', 401);

  const payload = verifyAccessToken(header.slice(7));
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      departmentMemberships: true
    }
  });

  if (!user || !user.isActive || user.deletedAt) throw new AppError('User is inactive or unavailable', 401);

  req.user = user;
  req.auth = {
    userId: user.id,
    roleName: normalizeRoleName(user.role.name),
    roleId: user.roleId,
    departmentIds: [user.departmentId, ...user.departmentMemberships.map((item) => item.departmentId)].filter(Boolean),
    permissions: user.role.permissions.map((item) => item.permission.key)
  };
  return next();
});

module.exports = { authenticate };
