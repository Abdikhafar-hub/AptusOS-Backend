const express = require('express');
const controller = require('../controllers/complianceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/complianceValidators');

const router = express.Router();

router.get('/', requirePermission('compliance:manage'), validate(listQuery), controller.listPolicies);
router.get('/:id', requirePermission('compliance:manage'), validate(idParam), controller.getPolicySummary);
router.post('/', requirePermission('compliance:manage'), validate(v.policyAssign), controller.assignPolicy);
router.post('/:id/acknowledge', requirePermission('communication:use'), validate(idParam), controller.acknowledgePolicy);

module.exports = router;
