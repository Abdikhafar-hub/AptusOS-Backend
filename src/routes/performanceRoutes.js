const express = require('express');
const controller = require('../controllers/performanceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { uploadSingle } = require('../middleware/upload');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/performanceValidators');

const router = express.Router();

router.get('/', validate(listQuery), controller.list);
router.post('/', requirePermission('performance:manage'), validate(v.create), controller.create);
router.get('/:id', validate(idParam), controller.get);
router.post('/:id/comments', validate(idParam), validate(v.comment), controller.addComment);
router.post('/:id/supporting-documents', uploadSingle('file'), validate(idParam), validate(v.supportingDocumentUpload), controller.uploadSupportingDocument);
router.post('/:id/self-review', validate(idParam), validate(v.selfReview), controller.selfReview);
router.post('/:id/manager-review', validate(idParam), validate(v.managerReview), controller.managerReview);
router.post('/:id/hr-review', validate(idParam), validate(v.hrReview), controller.hrReview);

module.exports = router;
