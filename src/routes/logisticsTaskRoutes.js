const express = require('express');
const controller = require('../controllers/logisticsTaskController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/logisticsTaskValidators');

const router = express.Router();

router.get('/', requirePermission('operations:manage'), validate(listQuery), validate(v.list), controller.list);
router.get('/board', requirePermission('operations:manage'), validate(listQuery), validate(v.list), controller.board);
router.post('/', requirePermission('operations:manage'), validate(v.create), controller.create);
router.get('/:id', requirePermission('operations:manage'), validate(idParam), controller.get);
router.patch('/:id', requirePermission('operations:manage'), validate(idParam), validate(v.update), controller.update);
router.post('/:id/status', requirePermission('operations:manage'), validate(idParam), validate(v.status), controller.updateStatus);
router.post('/:id/documents', requirePermission('operations:manage'), validate(idParam), validate(v.addDocuments), controller.addDocuments);

module.exports = router;
