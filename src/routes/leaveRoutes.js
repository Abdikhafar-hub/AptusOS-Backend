const express = require('express');
const controller = require('../controllers/hrController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { uploadSingle } = require('../middleware/upload');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/hrValidators');

const router = express.Router();

router.get('/', requirePermission('hr:read'), validate(listQuery), controller.listLeave);
router.get('/calendar', requirePermission('hr:read'), validate(listQuery), controller.leaveCalendar);
router.post('/', requirePermission('hr:read'), validate(v.leaveCreate), controller.requestLeave);
router.post('/staff', requirePermission('hr:manage'), uploadSingle('attachment'), validate(v.leaveStaffCreate), controller.createStaffLeave);
router.get('/:id', requirePermission('hr:read'), validate(idParam), controller.getLeave);
router.post('/:id/forward', requirePermission('hr:manage'), validate(idParam), validate(v.leaveRouting), controller.forwardLeave);
router.post('/:id/reassign-approver', requirePermission('hr:manage'), validate(idParam), validate(v.leaveRouting), controller.reassignLeaveApprover);
router.post('/:id/review', requirePermission('hr:manage'), validate(idParam), validate(v.reviewDecision), controller.reviewLeave);

module.exports = router;
