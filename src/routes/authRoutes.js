const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/authController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');
const v = require('../validators/authValidators');

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/login', authLimiter, validate(v.login), controller.login);
router.post('/refresh', authLimiter, validate(v.refresh), controller.refresh);
router.post('/request-password-reset', authLimiter, validate(v.requestReset), controller.requestPasswordReset);
router.post('/reset-password', authLimiter, validate(v.reset), controller.resetPassword);
router.post('/setup-password', authLimiter, validate(v.setup), controller.setupPassword);
router.post('/logout', authenticate, validate(v.logout), controller.logout);
router.post('/change-password', authenticate, validate(v.changePassword), controller.changePassword);
router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate(v.updateMe), controller.updateMe);
router.post('/me/profile-photo', authenticate, uploadSingle('file'), controller.uploadProfilePhoto);

module.exports = router;
