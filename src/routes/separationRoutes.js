const express = require('express');
const controller = require('../controllers/hrController');
const validate = require('../middleware/validate');
const { uploadMultiple } = require('../middleware/upload');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/hrValidators');

const router = express.Router();

router.get('/', requirePermission('hr:read'), validate(listQuery), controller.listSeparations);
router.post('/', requirePermission('hr:manage'), uploadMultiple('documents', 10), validate(v.separationCreate), controller.createSeparation);
router.get('/:id', requirePermission('hr:read'), validate(idParam), controller.getSeparation);
router.post('/:id/clearance-checklist', requirePermission('hr:manage'), validate(idParam), validate(v.separationClearanceUpdate), controller.updateSeparationClearanceChecklist);
router.post('/:id/asset-return', requirePermission('hr:manage'), validate(idParam), validate(v.separationAssetReturnUpdate), controller.updateSeparationAssetReturn);
router.post('/:id/exit-interview', requirePermission('hr:manage'), validate(idParam), validate(v.separationExitInterviewUpdate), controller.updateSeparationExitInterview);
router.post('/:id/review', requirePermission('hr:manage'), validate(idParam), validate(v.reviewDecision), controller.reviewSeparation);

module.exports = router;
