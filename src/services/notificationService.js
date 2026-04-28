const prisma = require('../prisma/client');

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

  async markRead(userId, id) {
    return prisma.notification.update({
      where: { id },
      data: { readAt: new Date() }
    });
  }
};

module.exports = notificationService;
