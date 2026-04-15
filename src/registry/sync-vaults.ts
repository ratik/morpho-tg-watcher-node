import type { AppConfig } from '../config/load-config.js';
import { upsertVaults } from '../db/repositories.js';
import type { SqliteDb } from '../db/sqlite.js';
import type { AppLogger } from '../logger.js';
import { fetchMorphoVaults } from './morpho-graphql.js';

export async function syncVaultRegistry(db: SqliteDb, config: AppConfig): Promise<number> {
  const vaults = await fetchMorphoVaults(config.morpho.graphqlUrl);
  upsertVaults(db, vaults);
  return vaults.length;
}

export function startVaultRegistrySync(
  db: SqliteDb,
  config: AppConfig,
  logger: AppLogger,
): NodeJS.Timeout {
  const intervalMs = config.morpho.registryTtlSeconds * 1000;
  logger.info({ intervalSeconds: config.morpho.registryTtlSeconds }, 'vault registry sync scheduled');

  return setInterval(() => {
    void syncVaultRegistry(db, config)
      .then((count) => {
        logger.info({ vaultCount: count }, 'vault registry sync completed');
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'vault registry sync failed');
      });
  }, intervalMs);
}
