const express = require('express');
const controller = require('../controllers/hrController');
const validate = require('../middleware/validate');
const { uploadMultiple } = require('../middleware/upload');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/hrValidators');

const router = express.Router();

router.get('/', requirePermission('hr:read'), validate(listQuery), controller.listHrActions);
router.post('/', requirePermission('hr:manage'), uploadMultiple('supportingDocuments', 10), validate(v.hrActionCreate), controller.createHrAction);
router.get('/:id', requirePermission('hr:read'), validate(idParam), controller.getHrAction);
router.post('/:id/comments', requirePermission('hr:manage'), validate(idParam), validate(v.hrWorkflowComment), controller.addHrActionComment);
router.post('/:id/cancel', requirePermission('hr:manage'), validate(idParam), validate(v.hrActionCancel), controller.cancelHrAction);
router.post('/:id/review', requirePermission('hr:manage'), validate(idParam), validate(v.reviewDecision), controller.reviewHrAction);

module.exports = router;
