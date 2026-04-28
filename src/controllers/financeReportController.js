const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');
const financeReportService = require('../services/financeReportService');

const attachActor = (req) => ({
  ...req.auth,
  fullName: req.user?.fullName,
  email: req.user?.email
});

module.exports = {
  summary: asyncHandler(async (req, res) => {
    const data = await financeReportService.summary(attachActor(req), req.query);
    return success(res, 'Finance reporting summary', data);
  }),

  run: asyncHandler(async (req, res) => {
    const data = await financeReportService.run(attachActor(req), req.params.reportType, req.query);
    return success(res, `${req.params.reportType} report`, data);
  }),

  export: asyncHandler(async (req, res) => {
    const result = await financeReportService.export(attachActor(req), req.params.reportType, req.query);
    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `${req.params.reportType}-${datePart}.${result.extension}`;

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(result.content);
  }),

  listSavedViews: asyncHandler(async (req, res) => {
    const data = await financeReportService.listSavedViews(attachActor(req));
    return success(res, 'Finance report saved views', data);
  }),

  saveView: asyncHandler(async (req, res) => {
    const data = await financeReportService.saveView(attachActor(req), req.body);
    return success(res, 'Finance report view saved', data, 201);
  }),

  deleteView: asyncHandler(async (req, res) => {
    const data = await financeReportService.deleteView(attachActor(req), req.params.id);
    return success(res, 'Finance report view deleted', data);
  })
};
