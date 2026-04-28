const express = require('express');
const controller = require('../controllers/payrollController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/payrollValidators');

const router = express.Router();

router.get('/remuneration', requirePermission('payroll:read'), validate(listQuery), controller.listRemunerations);
router.post('/remuneration', requirePermission('payroll:manage'), validate(v.remunerationCreate), controller.createRemuneration);
router.get('/payslips', requirePermission('payroll:read'), validate(listQuery), controller.listPayslips);
router.get('/payslips/:id', requirePermission('payroll:read'), validate(idParam), controller.getPayslip);
router.post('/payslips/generate', requirePermission('payroll:manage'), validate(v.payslipGenerate), controller.generatePayslip);
router.post('/payslips/:id/decision', requirePermission('payroll:manage'), validate(idParam), validate(v.payslipDecision), controller.decidePayslip);
router.get('/summary', requirePermission('payroll:read'), validate(listQuery), controller.summary);

module.exports = router;
