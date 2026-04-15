import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import 'dotenv/config';
import TOML from 'toml';
import { z } from 'zod';

const fileConfigSchema = z.object({
  telegram: z
    .object({
      token: z.string().optional(),
      max_subscriptions_per_user: z.number().int().positive().optional(),
    })
    .optional(),
  morpho: z
    .object({
      graphql_url: z.string().optional(),
      registry_ttl_seconds: z.number().int().positive().optional(),
    })
    .optional(),
  database: z
    .object({
      path: z.string().optional(),
      busy_timeout_ms: z.number().int().nonnegative().optional(),
      wal: z.boolean().optional(),
    })
    .optional(),
});

export type AppConfig = {
  telegram: {
    token: string;
    maxSubscriptionsPerUser: number;
  };
  morpho: {
    graphqlUrl: string;
    registryTtlSeconds: number;
  };
  database: {
    path: string;
    busyTimeoutMs: number;
    wal: boolean;
  };
};

function readTomlConfig(configPath: string): z.infer<typeof fileConfigSchema> {
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, 'utf8');
  return fileConfigSchema.parse(TOML.parse(raw));
}

function requireString(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

export function loadConfig(): AppConfig {
  const configPath = resolve(process.cwd(), process.env.CONFIG_PATH ?? 'config.toml');
  const fileConfig = readTomlConfig(configPath);

  const graphqlUrl = process.env.MORPHO_GQL_URL ?? fileConfig.morpho?.graphql_url;
  const telegramToken = process.env.TELEGRAM_TOKEN ?? fileConfig.telegram?.token;
  const registryTtlSeconds = Number(
    process.env.REGISTRY_TTL_SECONDS ?? fileConfig.morpho?.registry_ttl_seconds ?? 1800,
  );
  const maxSubscriptionsPerUser = Number(
    process.env.MAX_SUBSCRIPTIONS_PER_USER ??
      fileConfig.telegram?.max_subscriptions_per_user ??
      50,
  );
  const dbPath = process.env.DB_PATH ?? fileConfig.database?.path ?? 'data/db.sqlite';
  const busyTimeoutMs = Number(
    process.env.DB_BUSY_TIMEOUT_MS ?? fileConfig.database?.busy_timeout_ms ?? 5000,
  );
  const wal =
    (process.env.DB_WAL ? process.env.DB_WAL === 'true' : undefined) ??
    fileConfig.database?.wal ??
    true;

  return {
    telegram: {
      token: requireString(
        telegramToken,
        `Missing Telegram token. Set TELEGRAM_TOKEN or provide telegram.token in ${configPath}`,
      ),
      maxSubscriptionsPerUser,
    },
    morpho: {
      graphqlUrl: requireString(
        graphqlUrl,
        `Missing Morpho GraphQL URL. Set MORPHO_GQL_URL or provide morpho.graphql_url in ${configPath}`,
      ),
      registryTtlSeconds,
    },
    database: {
      path: dbPath,
      busyTimeoutMs,
      wal,
    },
  };
}
