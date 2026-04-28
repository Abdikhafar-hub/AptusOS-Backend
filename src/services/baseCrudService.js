const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');

const defaultSearchFields = ['title', 'name', 'description'];

const buildWhere = (query, searchFields, softDelete) => {
  const where = softDelete ? { deletedAt: null } : {};
  if (query.status) where.status = query.status;
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.userId) where.userId = query.userId;
  if (query.ownerId) where.ownerId = query.ownerId;
  if (query.search) {
    where.OR = searchFields.map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' } }));
  }
  return where;
};

const createCrudService = ({ model, searchable = defaultSearchFields, defaultInclude, audit, softDelete = true }) => ({
  async list(query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = buildWhere(query, searchable, softDelete);
    const [items, total] = await prisma.$transaction([
      prisma[model].findMany({ where, skip, take: limit, orderBy: { [sortBy]: sortOrder }, include: defaultInclude }),
      prisma[model].count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async getById(id) {
    const item = await prisma[model].findFirst({ where: softDelete ? { id, deletedAt: null } : { id }, include: defaultInclude });
    if (!item) throw new AppError('Record not found', 404);
    return item;
  },

  async create(data, context = {}) {
    const item = await prisma[model].create({ data, include: defaultInclude });
    if (audit) await audit({ action: 'create', item, context });
    return item;
  },

  async update(id, data, context = {}) {
    const existing = await this.getById(id);
    const item = await prisma[model].update({ where: { id }, data, include: defaultInclude });
    if (audit) await audit({ action: 'update', item, existing, context });
    return item;
  },

  async archive(id, context = {}) {
    const existing = await this.getById(id);
    const item = softDelete
      ? await prisma[model].update({ where: { id }, data: { deletedAt: new Date() }, include: defaultInclude })
      : await prisma[model].delete({ where: { id } });
    if (audit) await audit({ action: 'archive', item, existing, context });
    return item;
  }
});

module.exports = createCrudService;
