const express = require('express');
const controller = require('../controllers/complianceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/complianceValidators');

const router = express.Router();

router.get('/', requirePermission('sales_compliance:manage'), validate(listQuery), controller.listComplaints);
router.post('/', requirePermission('sales_compliance:manage'), validate(v.complaint), controller.createComplaint);
router.get('/:id', requirePermission('sales_compliance:manage'), validate(idParam), controller.getComplaint);
router.patch('/:id', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.complaintUpdate), controller.updateComplaint);
router.post('/:id/status', requirePermission('sales_compliance:manage'), validate(idParam), validate(v.complaintStatus), controller.updateComplaintStatus);

module.exports = router;
