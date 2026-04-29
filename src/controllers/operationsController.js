const operationsService = require('../services/operationsService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  listRequisitions: asyncHandler(async (req, res) => success(res, 'Requisitions', await operationsService.listRequisitions(req.auth, req.query))),
  getRequisitionBudgetAvailability: asyncHandler(async (req, res) => success(res, 'Requisition budget availability', await operationsService.getRequisitionBudgetAvailability(req.auth, req.query))),
  getRequisition: asyncHandler(async (req, res) => success(res, 'Requisition', await operationsService.getRequisition(req.auth, req.params.id))),
  createRequisition: asyncHandler(async (req, res) => success(res, 'Requisition created', await operationsService.createRequisition(req.auth, req.body, req), 201)),
  reviewRequisition: asyncHandler(async (req, res) => success(res, 'Requisition updated', await operationsService.reviewRequisition(req.auth, req.params.id, req.body.decision, req.body.comment, req))),
  attachRequisitionDocuments: asyncHandler(async (req, res) => success(res, 'Requisition documents attached', await operationsService.attachDocuments(req.auth, req.params.id, req.body.documentIds, req))),
  listVendorDocuments: asyncHandler(async (req, res) => success(res, 'Vendor documents', await operationsService.listVendorDocuments(req.auth, req.query))),
  getVendorDocument: asyncHandler(async (req, res) => success(res, 'Vendor document', await operationsService.getVendorDocument(req.auth, req.params.id))),
  createVendorDocument: asyncHandler(async (req, res) => success(res, 'Vendor document created', await operationsService.createVendorDocument(req.auth, req.body, req), 201)),
  archiveVendorDocument: asyncHandler(async (req, res) => success(res, 'Vendor document archived', await operationsService.archiveVendorDocument(req.auth, req.params.id, req)))
};
