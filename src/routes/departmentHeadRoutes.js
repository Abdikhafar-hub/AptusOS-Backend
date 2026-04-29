const express = require('express');
const controller = require('../controllers/departmentHeadController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/guards');
const { ROLES } = require('../constants/roles');
const validate = require('../middleware/validate');
const { idParam, listQuery } = require('../validators/commonValidators');
const { uploadSingle, uploadMultiple } = require('../middleware/upload');

const router = express.Router();

router.use(authenticate, requireRole(ROLES.DEPARTMENT_HEAD));

router.get('/dashboard', controller.dashboard);
router.get('/department', controller.department);

router.get('/staff', validate(listQuery), controller.listStaff);
router.get('/staff/:id', validate(idParam), controller.getStaff);

router.get('/tasks', validate(listQuery), controller.listTasks);
router.post('/tasks', controller.createTask);
router.patch('/tasks/:id', validate(idParam), controller.updateTask);
router.delete('/tasks/:id', validate(idParam), controller.deleteTask);

router.get('/leave', validate(listQuery), controller.listLeave);
router.post('/leave/:id/approve', validate(idParam), controller.approveLeave);
router.post('/leave/:id/reject', validate(idParam), controller.rejectLeave);

router.get('/attendance', validate(listQuery), controller.listAttendance);

router.get('/approvals', validate(listQuery), controller.listApprovals);
router.post('/approvals/:id/act', validate(idParam), controller.actOnApproval);

router.post('/reports/run', controller.runReport);

router.get('/documents', validate(listQuery), controller.listDocuments);
router.post('/documents', uploadSingle('file'), controller.uploadDocument);
router.delete('/documents/:id', validate(idParam), controller.deleteDocument);

router.get('/messages/inbox', validate(listQuery), controller.inbox);
router.get('/messages/sent', validate(listQuery), controller.sent);
router.get('/messages/thread/:id', validate(idParam), controller.thread);
router.post('/messages/send', uploadMultiple('attachments', 10), controller.sendMessage);

router.get('/audit-logs', validate(listQuery), controller.listAuditLogs);

module.exports = router;
