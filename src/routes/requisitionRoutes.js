const express = require('express');
const controller = require('../controllers/operationsController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/operationsValidators');

const router = express.Router();

router.get('/', requirePermission('operations:manage'), validate(listQuery), controller.listRequisitions);
router.get('/budget-availability', requirePermission('operations:manage'), validate(v.requisitionBudgetAvailability), controller.getRequisitionBudgetAvailability);
router.post('/', requirePermission('operations:manage'), validate(v.requisition), controller.createRequisition);
router.get('/:id', requirePermission('operations:manage'), validate(idParam), controller.getRequisition);
router.post('/:id/review', requirePermission('operations:manage'), validate(idParam), validate(v.requisitionReview), controller.reviewRequisition);
router.post('/:id/attachments', requirePermission('operations:manage'), validate(idParam), validate(v.requisitionAttachments), controller.attachRequisitionDocuments);

module.exports = router;
