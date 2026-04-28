const express = require('express');
const controller = require('../controllers/complianceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/complianceValidators');

const router = express.Router();

router.get('/', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listClientVisits);
router.post('/', requirePermission('sales_compliance:manage'), validate(v.clientVisit), controller.createClientVisit);
router.get('/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getClientVisit);
router.patch('/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.clientVisitUpdate), controller.updateClientVisit);

module.exports = router;
