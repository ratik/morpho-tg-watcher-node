import pino from 'pino';

import type { AppConfig } from './config/load-config.js';

export function createLogger(config: AppConfig) {
  const options =
    process.env.NODE_ENV !== 'production'
      ? {
          level: config.app.logLevel,
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {
          level: config.app.logLevel,
        };

  return pino(options);
}

export type AppLogger = ReturnType<typeof createLogger>;
