const payrollService = require('../services/payrollService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  createCycle: asyncHandler(async (req, res) => success(res, 'Payroll cycle created', await payrollService.createCycle(req.auth, req.body, req), 201)),
  listCycles: asyncHandler(async (req, res) => success(res, 'Payroll cycles', await payrollService.listCycles(req.auth, req.query))),
  getCycle: asyncHandler(async (req, res) => success(res, 'Payroll cycle detail', await payrollService.getCycle(req.auth, req.params.id))),
  runPayroll: asyncHandler(async (req, res) => success(res, 'Payroll run completed', await payrollService.runPayroll(req.auth, req.body, req), 201)),
  recalculateCycle: asyncHandler(async (req, res) => success(res, 'Payroll recalculated', await payrollService.recalculateCycle(req.auth, req.params.id, req))),
  resetCycle: asyncHandler(async (req, res) => success(res, 'Payroll cycle reset', await payrollService.resetCycle(req.auth, req.params.id, req))),
  approveCycle: asyncHandler(async (req, res) => success(res, 'Payroll cycle approved', await payrollService.approveCycle(req.auth, req.params.id, req))),
  markCyclePaid: asyncHandler(async (req, res) => success(res, 'Payroll cycle marked as paid', await payrollService.markCyclePaid(req.auth, req.params.id, req))),
  listRecords: asyncHandler(async (req, res) => success(res, 'Payroll records', await payrollService.listRecords(req.auth, req.query))),
  getRecord: asyncHandler(async (req, res) => success(res, 'Payroll record detail', await payrollService.getRecord(req.auth, req.params.id))),
  summary: asyncHandler(async (req, res) => success(res, 'Payroll summary', await payrollService.summary(req.auth, req.query))),
  exportCycleSummary: asyncHandler(async (req, res) => {
    const exported = await payrollService.exportCycleSummary(req.auth, req.params.id);
    res.setHeader('Content-Type', exported.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`);
    res.send(exported.content);
  }),
  exportPayslipPdf: asyncHandler(async (req, res) => {
    const exported = await payrollService.exportPayslipPdf(req.auth, req.params.id);
    res.setHeader('Content-Type', exported.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`);
    res.send(exported.content);
  }),
  // Legacy wrappers
  listPayslips: asyncHandler(async (req, res) => success(res, 'Payslips', await payrollService.listPayslips(req.auth, req.query))),
  getPayslip: asyncHandler(async (req, res) => success(res, 'Payslip detail', await payrollService.getPayslip(req.auth, req.params.id)))
};
