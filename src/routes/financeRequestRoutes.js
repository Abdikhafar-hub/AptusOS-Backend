const express = require('express');
const controller = require('../controllers/financeController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/financeValidators');

const router = express.Router();

router.get('/', requirePermission('finance:read'), validate(listQuery), controller.listRequests);
router.post('/', requirePermission('finance:read'), validate(v.financeRequestCreate), controller.createRequest);
router.get('/:id', requirePermission('finance:read'), validate(idParam), controller.getRequest);
router.patch('/:id', requirePermission('finance:read'), validate(idParam), validate(v.financeRequestUpdate), controller.updateRequest);
router.post('/:id/review', requirePermission('finance:manage'), validate(idParam), validate(v.financeReview), controller.reviewRequest);
router.post('/:id/pay', requirePermission('finance:manage'), validate(idParam), validate(v.financePay), controller.markPaid);
router.post('/:id/payment-proof', requirePermission('finance:manage'), validate(idParam), validate(v.paymentProofAttach), controller.attachPaymentProof);

module.exports = router;
