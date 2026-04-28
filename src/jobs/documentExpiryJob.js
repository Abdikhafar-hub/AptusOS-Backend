const prisma = require('../prisma/client');
const notificationService = require('../services/notificationService');

const runDocumentExpiryReminder = async () => {
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const documents = await prisma.document.findMany({
    where: { deletedAt: null, expiryDate: { lte: soon }, status: { not: 'ARCHIVED' } },
    select: { id: true, title: true, uploadedById: true }
  });
  await Promise.all(documents.map((document) => notificationService.create({
    userId: document.uploadedById,
    type: 'DOCUMENT_EXPIRING_SOON',
    title: 'Document expiring soon',
    body: document.title,
    entityType: 'Document',
    entityId: document.id
  })));
  return documents.length;
};

module.exports = { runDocumentExpiryReminder };
