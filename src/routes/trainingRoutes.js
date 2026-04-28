const express = require('express');
const controller = require('../controllers/trainingController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { uploadSingle, uploadMultiple } = require('../middleware/upload');
const { idParam, listQuery, participantParam } = require('../validators/commonValidators');
const v = require('../validators/trainingValidators');

const router = express.Router();

router.get('/', validate(listQuery), controller.list);
router.get('/metrics', requirePermission('trainings:manage'), controller.metrics);
router.post('/', requirePermission('trainings:manage'), uploadMultiple('materials', 10), validate(v.create), controller.create);
router.get('/:id', validate(idParam), controller.get);
router.post('/:id/notify-participants', requirePermission('trainings:manage'), validate(idParam), validate(v.notifyParticipants), controller.notifyParticipants);
router.post('/:id/participants/:participantId/certificate', requirePermission('trainings:manage'), uploadSingle('file'), validate(participantParam), validate(v.certificateUpload), controller.uploadCertificate);
router.post('/:id/participants/:participantId', validate(participantParam), validate(v.attendance), controller.updateParticipant);

module.exports = router;
