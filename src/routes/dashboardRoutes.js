const express = require('express');
const controller = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/guards');
const { ROLES } = require('../constants/roles');

const router = express.Router();
router.use(authenticate);

router.get('/general-manager', requireRoles(ROLES.GENERAL_MANAGER), controller.generalManager);
router.get('/department-head', requireRoles(ROLES.DEPARTMENT_HEAD), controller.departmentHead);
router.get('/hr', requireRoles(ROLES.HR_MANAGER), controller.hr);
router.get('/finance-accounts', requireRoles(ROLES.FINANCE_ACCOUNTS_MANAGER), controller.financeAccounts);
router.get('/finance', requireRoles(ROLES.FINANCE_ACCOUNTS_MANAGER), controller.finance);
router.get('/accounts', requireRoles(ROLES.FINANCE_ACCOUNTS_MANAGER), controller.accounts);
router.get('/sales-compliance', requireRoles(ROLES.SALES_COMPLIANCE_OFFICER), controller.salesCompliance);
router.get('/operations', requireRoles(ROLES.OPERATIONS_PROCUREMENT_OFFICER), controller.operations);
router.get('/employee', controller.employee);

module.exports = router;
