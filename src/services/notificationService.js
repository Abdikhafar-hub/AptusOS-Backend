const prisma = require('../prisma/client');
const { ROLES } = require('../constants/roles');

const notificationService = {
  async create(data, tx = prisma) {
    return tx.notification.create({ data });
  },

  async createMany(users, payload, tx = prisma) {
    if (!users.length) return { count: 0 };
    return tx.notification.createMany({
      data: users.map((userId) => ({ userId, ...payload }))
    });
  },

  async notifyGeneralManagers(payload, tx = prisma) {
    const users = await tx.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { name: ROLES.GENERAL_MANAGER }
      },
      select: { id: true }
    });
    return this.createMany(users.map((item) => item.id), payload, tx);
  },

  async markRead(userId, id) {
    return prisma.notification.update({
      where: { id },
      data: { readAt: new Date() }
    });
  }
};

module.exports = notificationService;
