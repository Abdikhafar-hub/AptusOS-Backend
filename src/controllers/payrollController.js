const payrollService = require('../services/payrollService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  listRemunerations: asyncHandler(async (req, res) => success(res, 'Remuneration profiles', await payrollService.listRemunerations(req.auth, req.query))),
  createRemuneration: asyncHandler(async (req, res) => success(res, 'Remuneration profile created', await payrollService.createRemuneration(req.auth, req.body, req), 201)),
  listPayslips: asyncHandler(async (req, res) => success(res, 'Payslips', await payrollService.listPayslips(req.auth, req.query))),
  getPayslip: asyncHandler(async (req, res) => success(res, 'Payslip detail', await payrollService.getPayslip(req.auth, req.params.id))),
  generatePayslip: asyncHandler(async (req, res) => success(res, 'Payslip generated', await payrollService.generatePayslip(req.auth, req.body, req), 201)),
  decidePayslip: asyncHandler(async (req, res) => success(res, 'Payslip approval updated', await payrollService.decidePayslip(req.auth, req.params.id, req.body.decision, req.body.comment, req))),
  summary: asyncHandler(async (req, res) => success(res, 'Payroll summary', await payrollService.summary(req.auth, req.query)))
};
