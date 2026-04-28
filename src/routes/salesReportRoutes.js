const express = require('express');
const controller = require('../controllers/complianceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/complianceValidators');

const router = express.Router();

router.get('/', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listSalesReports);
router.post('/', requirePermission('sales_compliance:manage'), validate(v.salesReport), controller.createSalesReport);
router.get('/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getSalesReport);
router.patch('/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.salesReportUpdate), controller.updateSalesReport);

module.exports = router;
