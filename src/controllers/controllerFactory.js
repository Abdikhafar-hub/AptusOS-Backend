const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

const createController = (service, label) => ({
  list: asyncHandler(async (req, res) => success(res, `${label} list`, await service.list(req.query))),
  get: asyncHandler(async (req, res) => success(res, `${label} detail`, await service.getById(req.params.id))),
  create: asyncHandler(async (req, res) => {
    const data = { ...req.body };
    if (data.createdById === '$auth') data.createdById = req.auth.userId;
    if (data.requestedById === '$auth') data.requestedById = req.auth.userId;
    if (data.employeeId === '$auth') data.employeeId = req.auth.userId;
    const item = await service.create(data, { actorId: req.auth?.userId, req });
    return success(res, `${label} created`, item, 201);
  }),
  update: asyncHandler(async (req, res) => success(res, `${label} updated`, await service.update(req.params.id, req.body, { actorId: req.auth?.userId, req }))),
  archive: asyncHandler(async (req, res) => success(res, `${label} archived`, await service.archive(req.params.id, { actorId: req.auth?.userId, req })))
});

module.exports = createController;
