const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const prisma = require('./prisma/client');

const server = app.listen(env.port, () => {
  logger.info(`AptusOS backend listening on port ${env.port}`);
});

const shutdown = async (signal) => {
  logger.info({ signal }, 'Shutting down AptusOS backend');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
