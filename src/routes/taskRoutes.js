const express = require('express');
const controller = require('../controllers/taskController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/taskValidators');

const router = express.Router();

router.get('/', requirePermission('tasks:read'), validate(listQuery), controller.list);
router.get('/board', requirePermission('tasks:read'), validate(listQuery), controller.board);
router.post('/', requirePermission('tasks:create'), validate(v.create), controller.create);
router.get('/:id', requirePermission('tasks:read'), validate(idParam), controller.get);
router.patch('/:id', requirePermission('tasks:update'), validate(idParam), validate(v.update), controller.update);
router.post('/:id/status', requirePermission('tasks:update'), validate(idParam), validate(v.status), controller.updateStatus);
router.post('/:id/attachments', requirePermission('tasks:update'), validate(idParam), validate(v.attachments), controller.addAttachments);

module.exports = router;
