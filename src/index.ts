import { createTelegramBot } from './bot/bot.js';
import { loadConfig } from './config/load-config.js';
import { createDatabase } from './db/sqlite.js';
import { createLogger } from './logger.js';
import { startVaultRegistrySync, syncVaultRegistry } from './registry/sync-vaults.js';
import {
  startSubscribedVaultMetricsPoller,
  storeMetricsAndNotify,
} from './workers/poll-subscribed-vault-metrics.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createDatabase(config);
  const bot = createTelegramBot(db, config);

  logger.info(
    {
      registryIntervalSeconds: config.morpho.registryTtlSeconds,
      metricsIntervalSeconds: config.polling.intervalSeconds,
      dbPath: config.database.path,
    },
    'app starting',
  );

  const loadedVaults = await syncVaultRegistry(db, config);
  logger.info({ vaultCount: loadedVaults }, 'initial vault sync completed');

  const loadedMetrics = await storeMetricsAndNotify(db, config, bot, logger);
  logger.info({ metricCount: loadedMetrics.length }, 'initial metrics fetch completed');

  const registryTimer = startVaultRegistrySync(db, config, logger);
  const metricsTimer = startSubscribedVaultMetricsPoller(db, config, bot, logger);

  process.once('SIGINT', async () => {
    logger.info('received SIGINT, shutting down');
    clearInterval(registryTimer);
    clearInterval(metricsTimer);
    await bot.stop();
    db.close();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    logger.info('received SIGTERM, shutting down');
    clearInterval(registryTimer);
    clearInterval(metricsTimer);
    await bot.stop();
    db.close();
    process.exit(0);
  });

  await bot.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
