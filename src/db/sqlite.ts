import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import BetterSqlite3Database from 'better-sqlite3';

import type { AppConfig } from '../config/load-config.js';

export type SqliteDb = BetterSqlite3Database;

export function createDatabase(config: AppConfig): SqliteDb {
  mkdirSync(dirname(config.database.path), { recursive: true });

  const db = new BetterSqlite3Database(config.database.path);
  db.pragma(`busy_timeout = ${config.database.busyTimeoutMs}`);

  if (config.database.wal) {
    db.pragma('journal_mode = WAL');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS vaults (
      vault_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      chain TEXT,
      contract TEXT,
      token_addr TEXT,
      token_symbol TEXT,
      decimals INTEGER,
      name TEXT,
      morpho_meta_json TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_vaults_chain ON vaults(chain);
    CREATE INDEX IF NOT EXISTS idx_vaults_contract ON vaults(contract);
    CREATE INDEX IF NOT EXISTS idx_vaults_active_chain ON vaults(active, chain);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      vault_id TEXT NOT NULL,
      monitor_type TEXT NOT NULL,
      threshold_amount TEXT NOT NULL,
      decimals INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_alerted INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_active
    ON subscriptions(user_id, chat_id, vault_id, monitor_type, active);

    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_chat_active
    ON subscriptions(user_id, chat_id, active);

    CREATE TABLE IF NOT EXISTS vault_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      deposits TEXT,
      available_liquidity TEXT,
      FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      vault_id TEXT NOT NULL,
      threshold_amount TEXT NOT NULL,
      alerted_at TEXT NOT NULL,
      cleared INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
    );

    CREATE TABLE IF NOT EXISTS locks (
      job_name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  return db;
}
