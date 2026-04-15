type TelegramApi = {
  api: {
    sendMessage(chatId: number | string, text: string): Promise<unknown>;
  };
};

import type { MonitorType, VaultMetricRecord } from '../db/repositories.js';
import {
  clearSubscriptionAlertState,
  insertAlert,
  listActiveSubscriptionsForVaults,
  markSubscriptionAlerted,
} from '../db/repositories.js';
import type { SqliteDb } from '../db/sqlite.js';
import type { AppLogger } from '../logger.js';
import { formatRawAmount } from '../bot/amounts.js';

type ActiveSubscription = ReturnType<typeof listActiveSubscriptionsForVaults>[number];

function metricValue(metric: VaultMetricRecord, monitorType: MonitorType): string | null {
  return monitorType === 'deposits' ? metric.deposits : metric.available_liquidity;
}

function isBelowThreshold(value: string, threshold: string): boolean {
  return BigInt(value) < BigInt(threshold);
}

function buildAlertMessage(subscription: ActiveSubscription, metric: VaultMetricRecord): string {
  const currentRaw = metricValue(metric, subscription.monitor_type) ?? '0';
  const current = formatRawAmount(currentRaw, subscription.decimals, subscription.token_symbol);
  const threshold = formatRawAmount(
    subscription.threshold_amount,
    subscription.decimals,
    subscription.token_symbol,
  );
  const vaultLabel = subscription.vault_name || subscription.vault_contract || subscription.vault_id;
  const monitor = subscription.monitor_type === 'deposits' ? 'Deposits' : 'Liquidity';

  return [
    '⚠️ Morpho threshold alert',
    vaultLabel,
    `${subscription.vault_chain || 'Unknown chain'} · ${subscription.version.toUpperCase()}`,
    `Monitor: ${monitor}`,
    `Current: ${current}`,
    `Threshold: ${threshold}`,
  ].join('\n');
}

export async function notifyThresholdCrossings(
  db: SqliteDb,
  bot: TelegramApi,
  metrics: VaultMetricRecord[],
  logger: AppLogger,
): Promise<number> {
  if (metrics.length === 0) {
    return 0;
  }

  const subscriptions = listActiveSubscriptionsForVaults(
    db,
    metrics.map((metric) => metric.vault_id),
  );
  const metricsByVaultId = new Map(metrics.map((metric) => [metric.vault_id, metric]));
  let sentCount = 0;

  for (const subscription of subscriptions) {
    const metric = metricsByVaultId.get(subscription.vault_id);
    if (!metric) {
      continue;
    }

    const value = metricValue(metric, subscription.monitor_type);
    if (value == null) {
      continue;
    }

    const belowThreshold = isBelowThreshold(value, subscription.threshold_amount);

    if (!belowThreshold) {
      if (subscription.last_alerted) {
        clearSubscriptionAlertState(db, subscription.id);
      }
      continue;
    }

    if (subscription.last_alerted) {
      continue;
    }

    const marked = markSubscriptionAlerted(db, subscription.id);
    if (!marked) {
      continue;
    }

    const message = buildAlertMessage(subscription, metric);
    const payload = {
      metric,
      subscriptionId: subscription.id,
      monitorType: subscription.monitor_type,
    };

    try {
      await bot.api.sendMessage(subscription.chat_id, message);
      insertAlert(db, {
        userId: subscription.user_id,
        vaultId: subscription.vault_id,
        thresholdAmount: subscription.threshold_amount,
        payload,
      });
      sentCount += 1;
    } catch (error: unknown) {
      clearSubscriptionAlertState(db, subscription.id);
      logger.error({ error, subscriptionId: subscription.id }, 'failed to send threshold alert');
    }
  }

  if (sentCount > 0) {
    logger.info({ sentCount }, 'threshold alerts sent');
  }

  return sentCount;
}
