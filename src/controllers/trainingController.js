const trainingService = require('../services/trainingService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Trainings', await trainingService.list(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Training detail', await trainingService.get(req.auth, req.params.id))),
  create: asyncHandler(async (req, res) => success(res, 'Training created', await trainingService.create(req.auth, req.body, req.files, req), 201)),
  uploadCertificate: asyncHandler(async (req, res) => success(res, 'Training certificate uploaded', await trainingService.uploadCertificate(req.auth, req.params.id, req.params.participantId, req.file, req.body, req), 201)),
  notifyParticipants: asyncHandler(async (req, res) => success(res, 'Training participants notified', await trainingService.notifyParticipants(req.auth, req.params.id, req.body, req))),
  updateParticipant: asyncHandler(async (req, res) => success(res, 'Training attendance updated', await trainingService.updateParticipant(req.auth, req.params.id, req.params.participantId, req.body, req))),
  metrics: asyncHandler(async (req, res) => success(res, 'Training metrics', await trainingService.metrics(req.auth)))
};
