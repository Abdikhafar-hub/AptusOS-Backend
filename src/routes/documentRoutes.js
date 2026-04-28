const express = require('express');
const controller = require('../controllers/documentController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/guards');
const { uploadSingle } = require('../middleware/upload');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/domainValidators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('documents:read'), validate(listQuery), controller.list);
router.get('/expiring', requirePermission('documents:read'), validate(listQuery), controller.expiring);
router.get('/metrics', requirePermission('documents:read'), controller.metrics);
router.post('/', requirePermission('documents:create'), uploadSingle('file'), validate(v.documentUpload), controller.upload);
router.get('/:id', requirePermission('documents:read'), validate(idParam), controller.get);
router.post('/:id/version', requirePermission('documents:create'), uploadSingle('file'), validate(idParam), controller.version);
router.post('/:id/request-approval', requirePermission('documents:create'), validate(idParam), controller.requestApproval);
router.post('/:id/approve', requirePermission('documents:approve'), validate(idParam), controller.approve);
router.post('/:id/reject', requirePermission('documents:approve'), validate(idParam), controller.reject);
router.delete('/:id', requirePermission('documents:delete'), validate(idParam), controller.archive);

module.exports = router;
