const express = require('express');
const { z } = require('zod');

const controller = require('../controllers/salesComplianceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/salesComplianceValidators');

const router = express.Router();

const routeStopIdParam = {
  params: z.object({
    id: z.string().min(1),
    stopId: z.string().min(1)
  })
};

router.get('/customers', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listCustomers);
router.get('/customers/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getCustomer);
router.patch('/customers/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.customerUpdate), controller.updateCustomer);
router.get('/customers/:id/notes', requirePermission('sales_compliance:manage'), validate(idParam), controller.listCustomerNotes);
router.post('/customers/:id/notes', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.accountNote), controller.createCustomerNote);

router.get('/territories', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listTerritories);
router.post('/territories', requirePermission('sales_compliance:manage'), validate(v.territory), controller.createTerritory);
router.get('/territories/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getTerritory);
router.patch('/territories/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.territoryPatch), controller.updateTerritory);
router.delete('/territories/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.archiveTerritory);

router.get('/routes', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listRoutes);
router.post('/routes', requirePermission('sales_compliance:manage'), validate(v.route), controller.createRoute);
router.get('/routes/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getRoute);
router.patch('/routes/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.routePatch), controller.updateRoute);
router.post('/routes/:id/stops', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.routeStop), controller.addRouteStop);
router.patch('/routes/:id/stops/:stopId', requirePermission('sales_compliance:manage'), validate(routeStopIdParam), validate(v.routeStopPatch), controller.updateRouteStop);
router.post('/routes/:id/complete', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.completeRoute), controller.completeRoute);

router.get('/opportunities', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listOpportunities);
router.post('/opportunities', requirePermission('sales_compliance:manage'), validate(v.opportunity), controller.createOpportunity);
router.get('/opportunities/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getOpportunity);
router.patch('/opportunities/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.opportunityPatch), controller.updateOpportunity);
router.post('/opportunities/:id/close-won', requirePermission('sales_compliance:manage'), validate(idParam), controller.closeOpportunityWon);
router.post('/opportunities/:id/close-lost', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.opportunityCloseLost), controller.closeOpportunityLost);

router.get('/product-feedback', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listProductFeedback);
router.post('/product-feedback', requirePermission('sales_compliance:manage'), validate(v.productFeedback), controller.createProductFeedback);
router.get('/product-feedback/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getProductFeedback);
router.patch('/product-feedback/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.productFeedbackPatch), controller.updateProductFeedback);
router.post('/product-feedback/:id/resolve', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.productFeedbackResolve), controller.resolveProductFeedback);

router.get('/issues', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listIssues);
router.post('/issues', requirePermission('sales_compliance:manage'), validate(v.customerIssue), controller.createIssue);
router.get('/issues/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getIssue);
router.patch('/issues/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.customerIssuePatch), controller.updateIssue);
router.post('/issues/:id/escalate', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.customerIssueEscalate), controller.escalateIssue);
router.post('/issues/:id/resolve', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.customerIssueResolve), controller.resolveIssue);
router.post('/issues/:id/close', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.customerIssueClose), controller.closeIssue);

router.get('/discount-requests', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listDiscountRequests);
router.post('/discount-requests', requirePermission('sales_compliance:manage'), validate(v.discountRequest), controller.createDiscountRequest);
router.get('/discount-requests/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getDiscountRequest);
router.patch('/discount-requests/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.discountRequestPatch), controller.updateDiscountRequest);
router.post('/discount-requests/:id/submit', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.discountRequestSubmit), controller.submitDiscountRequest);

router.get('/alerts', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listAlerts);
router.patch('/alerts/:id/acknowledge', requirePermission('sales_compliance:manage'), validate(idParam), controller.acknowledgeAlert);
router.patch('/alerts/:id/resolve', requirePermission('sales_compliance:manage'), validate(idParam), controller.resolveAlert);
router.patch('/alerts/:id/dismiss', requirePermission('sales_compliance:manage'), validate(idParam), controller.dismissAlert);

module.exports = router;
