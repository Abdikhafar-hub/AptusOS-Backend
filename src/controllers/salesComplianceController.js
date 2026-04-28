const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

const salesComplianceService = require('../services/salesComplianceService');
const territoryService = require('../services/territoryService');
const visitRouteService = require('../services/visitRouteService');
const salesOpportunityService = require('../services/salesOpportunityService');
const productFeedbackService = require('../services/productFeedbackService');
const customerIssueService = require('../services/customerIssueService');
const discountRequestService = require('../services/discountRequestService');
const customerAlertService = require('../services/customerAlertService');

module.exports = {
  listCustomers: asyncHandler(async (req, res) => success(res, 'Sales compliance customers', await salesComplianceService.listCustomers(req.auth, req.query))),
  getCustomer: asyncHandler(async (req, res) => success(res, 'Sales compliance customer', await salesComplianceService.getCustomer(req.auth, req.params.id))),
  updateCustomer: asyncHandler(async (req, res) => success(res, 'Sales compliance customer updated', await salesComplianceService.updateCustomer(req.auth, req.params.id, req.body, req))),

  listCustomerNotes: asyncHandler(async (req, res) => success(res, 'Customer account notes', await salesComplianceService.listCustomerNotes(req.auth, req.params.id))),
  createCustomerNote: asyncHandler(async (req, res) => success(res, 'Customer account note created', await salesComplianceService.createCustomerNote(req.auth, req.params.id, req.body, req), 201)),

  listTerritories: asyncHandler(async (req, res) => success(res, 'Sales territories', await territoryService.list(req.auth, req.query))),
  createTerritory: asyncHandler(async (req, res) => success(res, 'Sales territory created', await territoryService.create(req.auth, req.body, req), 201)),
  getTerritory: asyncHandler(async (req, res) => success(res, 'Sales territory', await territoryService.get(req.auth, req.params.id))),
  updateTerritory: asyncHandler(async (req, res) => success(res, 'Sales territory updated', await territoryService.update(req.auth, req.params.id, req.body, req))),
  archiveTerritory: asyncHandler(async (req, res) => success(res, 'Sales territory archived', await territoryService.archive(req.auth, req.params.id, req))),

  listRoutes: asyncHandler(async (req, res) => success(res, 'Visit routes', await visitRouteService.list(req.auth, req.query))),
  createRoute: asyncHandler(async (req, res) => success(res, 'Visit route created', await visitRouteService.create(req.auth, req.body, req), 201)),
  getRoute: asyncHandler(async (req, res) => success(res, 'Visit route', await visitRouteService.get(req.auth, req.params.id))),
  updateRoute: asyncHandler(async (req, res) => success(res, 'Visit route updated', await visitRouteService.update(req.auth, req.params.id, req.body, req))),
  addRouteStop: asyncHandler(async (req, res) => success(res, 'Route stop added', await visitRouteService.addStop(req.auth, req.params.id, req.body, req), 201)),
  updateRouteStop: asyncHandler(async (req, res) => success(res, 'Route stop updated', await visitRouteService.updateStop(req.auth, req.params.id, req.params.stopId, req.body, req))),
  completeRoute: asyncHandler(async (req, res) => success(res, 'Route completed', await visitRouteService.complete(req.auth, req.params.id, req.body.notes, req))),

  listOpportunities: asyncHandler(async (req, res) => success(res, 'Sales opportunities', await salesOpportunityService.list(req.auth, req.query))),
  createOpportunity: asyncHandler(async (req, res) => success(res, 'Sales opportunity created', await salesOpportunityService.create(req.auth, req.body, req), 201)),
  getOpportunity: asyncHandler(async (req, res) => success(res, 'Sales opportunity', await salesOpportunityService.get(req.auth, req.params.id))),
  updateOpportunity: asyncHandler(async (req, res) => success(res, 'Sales opportunity updated', await salesOpportunityService.update(req.auth, req.params.id, req.body, req))),
  closeOpportunityWon: asyncHandler(async (req, res) => success(res, 'Sales opportunity closed as won', await salesOpportunityService.closeWon(req.auth, req.params.id, req))),
  closeOpportunityLost: asyncHandler(async (req, res) => success(res, 'Sales opportunity closed as lost', await salesOpportunityService.closeLost(req.auth, req.params.id, req.body, req))),

  listProductFeedback: asyncHandler(async (req, res) => success(res, 'Product feedback', await productFeedbackService.list(req.auth, req.query))),
  createProductFeedback: asyncHandler(async (req, res) => success(res, 'Product feedback created', await productFeedbackService.create(req.auth, req.body, req), 201)),
  getProductFeedback: asyncHandler(async (req, res) => success(res, 'Product feedback detail', await productFeedbackService.get(req.auth, req.params.id))),
  updateProductFeedback: asyncHandler(async (req, res) => success(res, 'Product feedback updated', await productFeedbackService.update(req.auth, req.params.id, req.body, req))),
  resolveProductFeedback: asyncHandler(async (req, res) => success(res, 'Product feedback resolved', await productFeedbackService.resolve(req.auth, req.params.id, req.body.resolutionNotes, req))),

  listIssues: asyncHandler(async (req, res) => success(res, 'Customer issues', await customerIssueService.list(req.auth, req.query))),
  createIssue: asyncHandler(async (req, res) => success(res, 'Customer issue created', await customerIssueService.create(req.auth, req.body, req), 201)),
  getIssue: asyncHandler(async (req, res) => success(res, 'Customer issue detail', await customerIssueService.get(req.auth, req.params.id))),
  updateIssue: asyncHandler(async (req, res) => success(res, 'Customer issue updated', await customerIssueService.update(req.auth, req.params.id, req.body, req))),
  escalateIssue: asyncHandler(async (req, res) => success(res, 'Customer issue escalated', await customerIssueService.escalate(req.auth, req.params.id, req.body, req))),
  resolveIssue: asyncHandler(async (req, res) => success(res, 'Customer issue resolved', await customerIssueService.resolve(req.auth, req.params.id, req.body, req))),
  closeIssue: asyncHandler(async (req, res) => success(res, 'Customer issue closure submitted', await customerIssueService.close(req.auth, req.params.id, req.body, req))),

  listDiscountRequests: asyncHandler(async (req, res) => success(res, 'Discount requests', await discountRequestService.list(req.auth, req.query))),
  createDiscountRequest: asyncHandler(async (req, res) => success(res, 'Discount request created', await discountRequestService.create(req.auth, req.body, req), 201)),
  getDiscountRequest: asyncHandler(async (req, res) => success(res, 'Discount request detail', await discountRequestService.get(req.auth, req.params.id))),
  updateDiscountRequest: asyncHandler(async (req, res) => success(res, 'Discount request updated', await discountRequestService.update(req.auth, req.params.id, req.body, req))),
  submitDiscountRequest: asyncHandler(async (req, res) => success(res, 'Discount request submitted', await discountRequestService.submit(req.auth, req.params.id, req.body.note, req))),

  listAlerts: asyncHandler(async (req, res) => success(res, 'Customer alerts', await customerAlertService.list(req.auth, req.query))),
  acknowledgeAlert: asyncHandler(async (req, res) => success(res, 'Alert acknowledged', await customerAlertService.updateStatus(req.params.id, 'ACKNOWLEDGED', req.auth, req))),
  resolveAlert: asyncHandler(async (req, res) => success(res, 'Alert resolved', await customerAlertService.updateStatus(req.params.id, 'RESOLVED', req.auth, req))),
  dismissAlert: asyncHandler(async (req, res) => success(res, 'Alert dismissed', await customerAlertService.updateStatus(req.params.id, 'DISMISSED', req.auth, req)))
};
