import { Bot } from 'grammy';

import { loadConfig } from '../config/load-config.js';
import { createDatabase } from '../db/sqlite.js';
import { createLogger } from '../logger.js';
import {
  pollSubscribedVaultMetrics,
  startSubscribedVaultMetricsPoller,
  storeMetricsAndNotify,
} from '../workers/poll-subscribed-vault-metrics.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createDatabase(config);
  const bot = new Bot(config.telegram.token);
  const once = process.argv.includes('--once');

  if (once) {
    const firstMetrics = await pollSubscribedVaultMetrics(db, config);
    console.log(`[poll-metrics] stored ${firstMetrics.length} subscribed vault metric snapshot(s)`);
    console.log(JSON.stringify(firstMetrics, null, 2));
    db.close();
    return;
  }

  const initialNotifiedMetrics = await storeMetricsAndNotify(db, config, bot, logger);
  logger.info(
    { metricCount: initialNotifiedMetrics.length, intervalSeconds: config.polling.intervalSeconds },
    'manual metrics poller started',
  );

  const timer = startSubscribedVaultMetricsPoller(db, config, bot, logger);

  const shutdown = (): void => {
    clearInterval(timer);
    db.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
