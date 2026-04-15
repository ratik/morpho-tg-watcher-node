import { loadConfig } from '../config/load-config.js';
import { fetchMorphoVaults } from '../registry/morpho-graphql.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const vaults = await fetchMorphoVaults(config.morpho.graphqlUrl);

  console.log(`Fetched ${vaults.length} vaults from ${config.morpho.graphqlUrl}`);
  console.log(JSON.stringify(vaults, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
