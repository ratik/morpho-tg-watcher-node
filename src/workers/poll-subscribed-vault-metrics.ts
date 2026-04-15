type TelegramApi = {
  api: {
    sendMessage(chatId: number | string, text: string): Promise<unknown>;
  };
};

import type { AppConfig } from '../config/load-config.js';
import {
  insertVaultMetrics,
  listSubscribedVaults,
  type VaultMetricRecord,
} from '../db/repositories.js';
import type { SqliteDb } from '../db/sqlite.js';
import type { AppLogger } from '../logger.js';
import { notifyThresholdCrossings } from '../notifier/notify-threshold-crossings.js';
import { fetchSubscribedVaultMetrics } from '../onchain/graphql-metrics.js';

export async function pollSubscribedVaultMetrics(
  db: SqliteDb,
  config: AppConfig,
): Promise<VaultMetricRecord[]> {
  const subscribedVaults = listSubscribedVaults(db);
  if (subscribedVaults.length === 0) {
    return [];
  }

  const metrics = await fetchSubscribedVaultMetrics(config.morpho.graphqlUrl, subscribedVaults);
  insertVaultMetrics(db, metrics);
  return metrics;
}

export async function storeMetricsAndNotify(
  db: SqliteDb,
  config: AppConfig,
  bot: TelegramApi,
  logger: AppLogger,
  subscribedVaults = listSubscribedVaults(db),
): Promise<VaultMetricRecord[]> {
  if (subscribedVaults.length === 0) {
    logger.info({ subscribedVaultCount: 0 }, 'vault metrics poll cycle skipped');
    return [];
  }

  const metrics = await fetchSubscribedVaultMetrics(config.morpho.graphqlUrl, subscribedVaults);
  insertVaultMetrics(db, metrics);
  await notifyThresholdCrossings(db, bot, metrics, logger);
  return metrics;
}

export function startSubscribedVaultMetricsPoller(
  db: SqliteDb,
  config: AppConfig,
  bot: TelegramApi,
  logger: AppLogger,
): NodeJS.Timeout {
  const intervalMs = config.polling.intervalSeconds * 1000;
  logger.info({ intervalSeconds: config.polling.intervalSeconds }, 'vault metrics poller scheduled');

  return setInterval(() => {
    const subscribedVaults = listSubscribedVaults(db);
    logger.info({ subscribedVaultCount: subscribedVaults.length }, 'vault metrics poll cycle started');

    void storeMetricsAndNotify(db, config, bot, logger, subscribedVaults)
      .then((metrics) => {
        logger.info(
          { subscribedVaultCount: subscribedVaults.length, metricCount: metrics.length },
          'vault metrics poll cycle completed',
        );
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'vault metrics poller failed');
      });
  }, intervalMs);
}
