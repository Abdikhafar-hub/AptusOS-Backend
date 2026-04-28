const express = require('express');
const controller = require('../controllers/hrController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/hrValidators');

const router = express.Router();

router.get('/', requirePermission('hr:read'), validate(listQuery), controller.listAttendance);
router.get('/summary', requirePermission('hr:read'), validate(listQuery), controller.attendanceSummary);
router.get('/:id/history', requirePermission('hr:read'), validate(idParam), controller.attendanceHistory);
router.post('/manual', requirePermission('hr:manage'), validate(v.attendanceManual), controller.createManualAttendance);
router.post('/check-in', requirePermission('hr:read'), controller.checkIn);
router.post('/check-out', requirePermission('hr:read'), controller.checkOut);

module.exports = router;
