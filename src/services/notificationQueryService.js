const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');

const sortableFields = new Set(['createdAt', 'updatedAt', 'readAt', 'title', 'type']);

const parseBoolean = (value) => value === true || value === 'true';

const notificationQueryService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const resolvedSortBy = sortableFields.has(sortBy) ? sortBy : 'createdAt';
    const where = { userId: auth.userId };
    if (parseBoolean(query.unreadOnly)) where.readAt = null;
    if (query.type) where.type = query.type;
    if (query.entityType) where.entityType = query.entityType;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { body: { contains: query.search, mode: 'insensitive' } },
        { entityType: { contains: query.search, mode: 'insensitive' } }
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({ where, skip, take: limit, orderBy: { [resolvedSortBy]: sortOrder } }),
      prisma.notification.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async markRead(userId, id) {
    const existing = await prisma.notification.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError('Notification not found', 404);
    if (existing.readAt) return existing;
    return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  },

  async markAllRead(userId) {
    const result = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updatedCount: result.count };
  }
};

module.exports = notificationQueryService;
