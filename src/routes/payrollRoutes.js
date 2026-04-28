const express = require('express');
const controller = require('../controllers/payrollController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam } = require('../validators/commonValidators');
const v = require('../validators/payrollValidators');

const router = express.Router();

router.get('/cycles', requirePermission('payroll:read'), validate(v.cycleListQuery), controller.listCycles);
router.post('/cycles', requirePermission('payroll:manage'), validate(v.cycleCreate), controller.createCycle);
router.get('/cycles/:id', requirePermission('payroll:read'), validate(idParam), controller.getCycle);
router.post('/cycles/run', requirePermission('payroll:manage'), validate(v.cycleRun), controller.runPayroll);
router.post('/cycles/:id/recalculate', requirePermission('payroll:manage'), validate(idParam), controller.recalculateCycle);
router.post('/cycles/:id/reset', requirePermission('payroll:manage'), validate(idParam), controller.resetCycle);
router.post('/cycles/:id/approve', requirePermission('payroll:manage'), validate(idParam), controller.approveCycle);
router.post('/cycles/:id/paid', requirePermission('payroll:manage'), validate(idParam), controller.markCyclePaid);
router.get('/cycles/:id/export/summary', requirePermission('payroll:read'), validate(idParam), controller.exportCycleSummary);

router.get('/records', requirePermission('payroll:read'), validate(v.recordListQuery), controller.listRecords);
router.get('/records/:id', requirePermission('payroll:read'), validate(idParam), controller.getRecord);
router.get('/records/:id/export/payslip', requirePermission('payroll:read'), validate(idParam), controller.exportPayslipPdf);
router.get('/summary', requirePermission('payroll:read'), validate(v.summaryQuery), controller.summary);

// Legacy endpoints to keep old clients functional
router.get('/payslips', requirePermission('payroll:read'), controller.listPayslips);
router.get('/payslips/:id', requirePermission('payroll:read'), validate(idParam), controller.getPayslip);

module.exports = router;
