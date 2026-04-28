const express = require('express');
const controller = require('../controllers/financeController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { listQuery } = require('../validators/commonValidators');
const v = require('../validators/financeValidators');

const router = express.Router();

router.get('/', requirePermission('finance:read'), validate(listQuery), controller.listBudgets);
router.post('/', requirePermission('finance:manage'), validate(v.budget), controller.createBudget);
router.get('/summary/monthly', requirePermission('finance:read'), validate(listQuery), controller.monthlySummary);

module.exports = router;
