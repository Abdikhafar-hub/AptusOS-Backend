const express = require('express');
const controller = require('../controllers/financeController');
const { requirePermission } = require('../middleware/guards');

const router = express.Router();

router.get('/', requirePermission('accounts:manage'), controller.accountsSummary);
router.get('/payables', requirePermission('accounts:manage'), controller.accountsSummary);
router.get('/receivables', requirePermission('accounts:manage'), controller.accountsSummary);
router.get('/archives', requirePermission('accounts:manage'), controller.accountsSummary);

module.exports = router;
