const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { normalizeRoleName } = require('../constants/roles');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const randomToken = () => crypto.randomBytes(48).toString('hex');

const signAccessToken = (user) => jwt.sign({
  userId: user.id,
  roleId: user.roleId,
  roleName: normalizeRoleName(user.role.name),
  departmentIds: [
    user.departmentId,
    ...(user.departmentMemberships || []).map((membership) => membership.departmentId)
  ].filter(Boolean)
}, env.jwtAccessSecret, { expiresIn: env.jwtAccessExpiresIn });

const signRefreshToken = (user) => jwt.sign({ userId: user.id }, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshExpiresIn });

const verifyAccessToken = (token) => jwt.verify(token, env.jwtAccessSecret);
const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);

module.exports = { hashToken, randomToken, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
