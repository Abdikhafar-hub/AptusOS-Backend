const express = require('express');
const controller = require('../controllers/complianceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/complianceValidators');

const router = express.Router();

router.get('/', requirePermission('compliance:manage'), validate(listQuery), controller.listRisks);
router.post('/', requirePermission('compliance:manage'), validate(v.risk), controller.createRisk);
router.get('/:id', requirePermission('compliance:manage'), validate(idParam), controller.getRisk);
router.patch('/:id', requirePermission('compliance:manage'), validate(idParam), validate(v.riskUpdate), controller.updateRisk);

module.exports = router;
