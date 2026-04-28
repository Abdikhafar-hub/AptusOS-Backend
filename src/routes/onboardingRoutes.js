const express = require('express');
const controller = require('../controllers/hrController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { uploadSingle } = require('../middleware/upload');
const { idParam, itemParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/hrValidators');

const router = express.Router();

router.get('/', requirePermission('hr:read'), validate(listQuery), controller.listOnboarding);
router.post('/', requirePermission('hr:manage'), validate(v.onboardingCreate), controller.createOnboarding);
router.get('/:id', requirePermission('hr:read'), validate(idParam), controller.getOnboarding);
router.post('/:id/items/:itemId/complete', validate(itemParam), validate(v.onboardingComplete), controller.completeOnboardingItem);
router.post('/:id/items/:itemId/comments', requirePermission('hr:manage'), validate(itemParam), validate(v.onboardingItemComment), controller.addOnboardingItemComment);
router.post('/:id/items/:itemId/document', requirePermission('hr:manage'), uploadSingle('file'), validate(itemParam), validate(v.onboardingItemDocumentUpload), controller.uploadOnboardingItemDocument);
router.post('/:id/approve', requirePermission('hr:manage'), validate(idParam), controller.approveOnboarding);

module.exports = router;
