const express = require('express');
const controller = require('../controllers/approvalController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/domainValidators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('approvals:read'), validate(listQuery), controller.list);
router.post('/', requirePermission('approvals:create'), validate(v.approvalCreate), controller.create);
router.get('/:id', requirePermission('approvals:read'), validate(idParam), controller.get);
router.post('/:id/approve', requirePermission('approvals:act'), validate(idParam), controller.approve);
router.post('/:id/reject', requirePermission('approvals:act'), validate(idParam), controller.reject);
router.post('/:id/more-info', requirePermission('approvals:act'), validate(idParam), controller.moreInfo);
router.post('/:id/cancel', requirePermission('approvals:create'), validate(idParam), controller.cancel);
router.post('/:id/resubmit', requirePermission('approvals:create'), validate(idParam), controller.resubmit);

module.exports = router;
