import { createTelegramBot } from './bot/bot.js';
import { loadConfig } from './config/load-config.js';
import { createDatabase } from './db/sqlite.js';
import { startVaultRegistrySync, syncVaultRegistry } from './registry/sync-vaults.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config);

  const loadedVaults = await syncVaultRegistry(db, config);
  console.log(`[startup] loaded ${loadedVaults} vaults into sqlite`);

  const registryTimer = startVaultRegistrySync(db, config);
  const bot = createTelegramBot(db, config);

  process.once('SIGINT', async () => {
    clearInterval(registryTimer);
    await bot.stop();
    db.close();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    clearInterval(registryTimer);
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
