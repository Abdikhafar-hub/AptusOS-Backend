const express = require('express');
const controller = require('../controllers/userController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requirePermission, requireRoles } = require('../middleware/guards');
const { ROLES } = require('../constants/roles');
const { uploadSingle } = require('../middleware/upload');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/userValidators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('users:read'), validate(listQuery), controller.list);
router.post('/', requirePermission('users:create'), validate(v.create), controller.create);
router.get('/:id', requirePermission('users:read'), validate(idParam), controller.get);
router.get('/:id/full-profile', requirePermission('users:read'), validate(idParam), controller.fullProfile);
router.patch('/:id', requirePermission('users:update'), validate(idParam), validate(v.update), controller.update);
router.post('/:id/resend-credentials', requireRoles(ROLES.HR_MANAGER), validate(idParam), controller.resendCredentials);
router.patch('/:id/deactivate', requirePermission('users:deactivate'), validate(idParam), controller.deactivate);
router.patch('/:id/activate', requirePermission('users:update'), validate(idParam), controller.activate);
router.patch('/:id/suspend', requirePermission('users:update'), validate(idParam), validate(v.status), controller.suspend);
router.post('/:id/profile-photo', requirePermission('users:update'), validate(idParam), uploadSingle('file'), controller.uploadProfilePhoto);
router.post('/:id/documents', requirePermission('users:update'), validate(idParam), uploadSingle('file'), validate(v.document), controller.uploadDocument);
router.get('/:id/timeline', requirePermission('users:read'), validate(idParam), controller.timeline);

module.exports = router;
