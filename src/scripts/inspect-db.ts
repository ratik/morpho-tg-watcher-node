import 'dotenv/config';

import { loadConfig } from '../config/load-config.js';
import { createDatabase } from '../db/sqlite.js';

const config = loadConfig();
const db = createDatabase(config);

const vaultCount = db.prepare('SELECT COUNT(*) as count FROM vaults').get() as { count: number };
const subCount = db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE active = 1').get() as { count: number };

console.log({ vaults: vaultCount.count, activeSubscriptions: subCount.count });
db.close();
