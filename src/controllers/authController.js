const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

const authController = {
  login: asyncHandler(async (req, res) => success(res, 'Login successful', await authService.login(req.body, req))),
  refresh: asyncHandler(async (req, res) => success(res, 'Token refreshed', await authService.refresh(req.body.refreshToken, req))),
  logout: asyncHandler(async (req, res) => success(res, 'Logout successful', await authService.logout(req.body.refreshToken, req.auth.userId, req))),
  requestPasswordReset: asyncHandler(async (req, res) => success(res, 'Password reset requested', await authService.requestPasswordReset(req.body.email, req))),
  resetPassword: asyncHandler(async (req, res) => success(res, 'Password reset completed', await authService.resetPassword(req.body, req))),
  setupPassword: asyncHandler(async (req, res) => success(res, 'Password setup completed', await authService.setupPassword(req.body, req))),
  changePassword: asyncHandler(async (req, res) => success(res, 'Password changed', await authService.changePassword(req.auth.userId, req.body, req))),
  me: asyncHandler(async (req, res) => success(res, 'Current profile', await authService.me(req.auth.userId))),
  updateMe: asyncHandler(async (req, res) => success(res, 'Profile updated', await authService.updateMe(req.auth.userId, req.body, req))),
  uploadProfilePhoto: asyncHandler(async (req, res) => success(res, 'Profile photo updated', await authService.uploadMyProfilePhoto(req.auth.userId, req.file, req)))
};

module.exports = authController;
