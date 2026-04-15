import type { AppConfig } from '../config/load-config.js';
import { upsertVaults } from '../db/repositories.js';
import type { SqliteDb } from '../db/sqlite.js';
import { fetchMorphoVaults } from './morpho-graphql.js';

export async function syncVaultRegistry(db: SqliteDb, config: AppConfig): Promise<number> {
  const vaults = await fetchMorphoVaults(config.morpho.graphqlUrl);
  upsertVaults(db, vaults);
  return vaults.length;
}

export function startVaultRegistrySync(db: SqliteDb, config: AppConfig): NodeJS.Timeout {
  const intervalMs = config.morpho.registryTtlSeconds * 1000;

  return setInterval(() => {
    void syncVaultRegistry(db, config).catch((error: unknown) => {
      console.error('[registry-sync] failed', error);
    });
  }, intervalMs);
}
