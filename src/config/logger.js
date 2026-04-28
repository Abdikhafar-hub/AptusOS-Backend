const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.nodeEnv === 'production' ? 'info' : 'debug',
  transport: env.nodeEnv === 'production' ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  redact: ['req.headers.authorization', 'password', 'passwordHash', 'token', 'refreshToken']
});

module.exports = logger;
