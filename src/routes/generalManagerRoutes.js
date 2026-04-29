const express = require('express');

const controller = require('../controllers/generalManagerController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/guards');
const { ROLES } = require('../constants/roles');
const { idParam } = require('../validators/commonValidators');
const v = require('../validators/generalManagerValidators');

const router = express.Router();

router.use(authenticate);

router.get('/dashboard', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.dashboard);

router.get('/escalations', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.listEscalations);
router.patch('/escalations/:id/resolve', validate(idParam), validate(v.resolveEscalation), controller.resolveEscalation);

router.post('/reports/run', requireRoles(ROLES.GENERAL_MANAGER), validate(v.runReport), controller.runReport);

router.get('/settings', requireRoles(ROLES.GENERAL_MANAGER), controller.getSettings);
router.patch('/settings', requireRoles(ROLES.GENERAL_MANAGER), validate(v.updateSettings), controller.updateSettings);

router.get('/finance/summary', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.financeSummary);
router.get('/finance/payables', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.financePayables);
router.get('/finance/receivables', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.financeReceivables);

router.get('/audit-logs', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.auditLogs);
router.get('/key-accounts', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.keyAccounts);

router.get('/contracts', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.listContracts);
router.post('/contracts', requireRoles(ROLES.GENERAL_MANAGER), validate(v.contractCreate), controller.createContract);
router.patch('/contracts/:id', requireRoles(ROLES.GENERAL_MANAGER), validate(idParam), validate(v.contractUpdate), controller.updateContract);
router.delete('/contracts/:id', requireRoles(ROLES.GENERAL_MANAGER), validate(idParam), controller.deleteContract);

router.post('/delegations', requireRoles(ROLES.GENERAL_MANAGER), validate(v.delegationCreate), controller.createDelegation);
router.get('/delegations', requireRoles(ROLES.GENERAL_MANAGER), validate(v.listQuery), controller.listDelegations);
router.patch('/delegations/:id', requireRoles(ROLES.GENERAL_MANAGER), validate(idParam), validate(v.delegationUpdate), controller.updateDelegation);

module.exports = router;
