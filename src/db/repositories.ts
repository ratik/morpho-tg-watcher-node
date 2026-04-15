import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { NormalizedVault } from '../registry/morpho-graphql.js';

export type MonitorType = 'deposits' | 'liquidity';

export type VaultRecord = NormalizedVault & {
  active: boolean;
  updated_at: string;
  last_seen: string;
};

export type SubscriptionRecord = {
  id: number;
  user_id: number;
  chat_id: number;
  vault_id: string;
  monitor_type: MonitorType;
  threshold_amount: string;
  decimals: number | null;
  created_at: string;
  updated_at: string;
  active: boolean;
  vault_name: string | null;
  vault_chain: string | null;
  vault_contract: string | null;
  token_symbol: string | null;
  version: 'v1' | 'v2';
};

type VaultRow = {
  vault_id: string;
  version: 'v1' | 'v2';
  chain: string | null;
  contract: string | null;
  token_addr: string | null;
  token_symbol: string | null;
  decimals: number | null;
  name: string | null;
  morpho_meta_json: string;
  last_seen: string;
  updated_at: string;
  active: number;
};

type SubscriptionRow = Omit<SubscriptionRecord, 'active'> & { active: number };

function mapVaultRow(row: VaultRow): VaultRecord {
  return {
    vault_id: row.vault_id,
    version: row.version,
    chain: row.chain,
    contract: row.contract,
    token_addr: row.token_addr,
    token_symbol: row.token_symbol,
    decimals: row.decimals,
    name: row.name,
    raw: JSON.parse(row.morpho_meta_json) as Record<string, unknown>,
    last_seen: row.last_seen,
    updated_at: row.updated_at,
    active: row.active === 1,
  };
}

function mapSubscriptionRow(row: SubscriptionRow): SubscriptionRecord {
  return {
    ...row,
    active: row.active === 1,
  };
}

export function upsertVaults(db: BetterSqliteDatabase, vaults: NormalizedVault[]): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO vaults (
      vault_id, version, chain, contract, token_addr, token_symbol, decimals, name, morpho_meta_json, last_seen, updated_at, active
    ) VALUES (
      @vault_id, @version, @chain, @contract, @token_addr, @token_symbol, @decimals, @name, @morpho_meta_json, @last_seen, @updated_at, 1
    )
    ON CONFLICT(vault_id) DO UPDATE SET
      version = excluded.version,
      chain = excluded.chain,
      contract = excluded.contract,
      token_addr = excluded.token_addr,
      token_symbol = excluded.token_symbol,
      decimals = excluded.decimals,
      name = excluded.name,
      morpho_meta_json = excluded.morpho_meta_json,
      last_seen = excluded.last_seen,
      updated_at = excluded.updated_at,
      active = 1
  `);
  const deactivateMissing = db.prepare(
    `UPDATE vaults SET active = 0, updated_at = ? WHERE vault_id NOT IN (${vaults.map(() => '?').join(', ')})`,
  );
  const deactivateAll = db.prepare('UPDATE vaults SET active = 0, updated_at = ?');

  const transaction = db.transaction((items: NormalizedVault[]) => {
    for (const vault of items) {
      upsert.run({
        ...vault,
        morpho_meta_json: JSON.stringify(vault.raw),
        last_seen: now,
        updated_at: now,
      });
    }

    if (items.length > 0) {
      deactivateMissing.run(now, ...items.map((item) => item.vault_id));
    } else {
      deactivateAll.run(now);
    }
  });

  transaction(vaults);
}

export function listAvailableChains(db: BetterSqliteDatabase): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT chain FROM vaults WHERE active = 1 AND chain IS NOT NULL AND chain != '' ORDER BY chain ASC`,
    )
    .all() as Array<{ chain: string }>;

  return rows.map((row) => row.chain);
}

export function searchVaults(
  db: BetterSqliteDatabase,
  params: { chain: string; query: string; limit: number; offset: number },
): { items: VaultRecord[]; total: number } {
  const term = `%${params.query.trim().toLowerCase()}%`;
  const whereClause = `
    active = 1
    AND chain = @chain
    AND (
      lower(COALESCE(name, '')) LIKE @term
      OR lower(COALESCE(contract, '')) LIKE @term
      OR lower(COALESCE(token_symbol, '')) LIKE @term
      OR lower(COALESCE(token_addr, '')) LIKE @term
      OR lower(COALESCE(version, '')) LIKE @term
    )
  `;

  const items = db
    .prepare(
      `SELECT vault_id, version, chain, contract, token_addr, token_symbol, decimals, name, morpho_meta_json, last_seen, updated_at, active
       FROM vaults
       WHERE ${whereClause}
       ORDER BY COALESCE(name, contract, vault_id) ASC
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      chain: params.chain,
      term,
      limit: params.limit,
      offset: params.offset,
    }) as VaultRow[];

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM vaults WHERE ${whereClause}`)
    .get({ chain: params.chain, term }) as { count: number };

  return {
    items: items.map(mapVaultRow),
    total: totalRow.count,
  };
}

export function getVaultById(db: BetterSqliteDatabase, vaultId: string): VaultRecord | null {
  const row = db
    .prepare(
      `SELECT vault_id, version, chain, contract, token_addr, token_symbol, decimals, name, morpho_meta_json, last_seen, updated_at, active
       FROM vaults WHERE vault_id = ?`,
    )
    .get(vaultId) as VaultRow | undefined;

  return row ? mapVaultRow(row) : null;
}

export function countActiveSubscriptionsForUser(
  db: BetterSqliteDatabase,
  userId: number,
  chatId: number,
): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM subscriptions WHERE user_id = ? AND chat_id = ? AND active = 1`)
    .get(userId, chatId) as { count: number };

  return row.count;
}

export function upsertSubscription(
  db: BetterSqliteDatabase,
  params: {
    userId: number;
    chatId: number;
    vaultId: string;
    monitorType: MonitorType;
    thresholdAmount: string;
    decimals: number | null;
  },
): void {
  const existing = db
    .prepare(
      `SELECT id FROM subscriptions
       WHERE user_id = ? AND chat_id = ? AND vault_id = ? AND monitor_type = ? AND active = 1`,
    )
    .get(params.userId, params.chatId, params.vaultId, params.monitorType) as { id: number } | undefined;

  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE subscriptions
       SET threshold_amount = ?, decimals = ?, updated_at = ?, last_alerted = 0
       WHERE id = ?`,
    ).run(params.thresholdAmount, params.decimals, now, existing.id);
    return;
  }

  db.prepare(
    `INSERT INTO subscriptions (
      user_id, chat_id, vault_id, monitor_type, threshold_amount, decimals, created_at, updated_at, last_alerted, active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
  ).run(
    params.userId,
    params.chatId,
    params.vaultId,
    params.monitorType,
    params.thresholdAmount,
    params.decimals,
    now,
    now,
  );
}

export function listSubscriptions(
  db: BetterSqliteDatabase,
  params: { userId: number; chatId: number },
): SubscriptionRecord[] {
  const rows = db
    .prepare(
      `SELECT
          s.id,
          s.user_id,
          s.chat_id,
          s.vault_id,
          s.monitor_type,
          s.threshold_amount,
          s.decimals,
          s.created_at,
          s.updated_at,
          s.active,
          v.name as vault_name,
          v.chain as vault_chain,
          v.contract as vault_contract,
          v.token_symbol as token_symbol,
          v.version as version
        FROM subscriptions s
        JOIN vaults v ON v.vault_id = s.vault_id
        WHERE s.user_id = ? AND s.chat_id = ? AND s.active = 1
        ORDER BY s.created_at DESC`,
    )
    .all(params.userId, params.chatId) as SubscriptionRow[];

  return rows.map(mapSubscriptionRow);
}

export function getSubscriptionById(
  db: BetterSqliteDatabase,
  params: { id: number; userId: number; chatId: number },
): SubscriptionRecord | null {
  const row = db
    .prepare(
      `SELECT
          s.id,
          s.user_id,
          s.chat_id,
          s.vault_id,
          s.monitor_type,
          s.threshold_amount,
          s.decimals,
          s.created_at,
          s.updated_at,
          s.active,
          v.name as vault_name,
          v.chain as vault_chain,
          v.contract as vault_contract,
          v.token_symbol as token_symbol,
          v.version as version
        FROM subscriptions s
        JOIN vaults v ON v.vault_id = s.vault_id
        WHERE s.id = ? AND s.user_id = ? AND s.chat_id = ? AND s.active = 1`,
    )
    .get(params.id, params.userId, params.chatId) as SubscriptionRow | undefined;

  return row ? mapSubscriptionRow(row) : null;
}

export function updateSubscriptionThreshold(
  db: BetterSqliteDatabase,
  params: { id: number; userId: number; chatId: number; thresholdAmount: string; decimals: number | null },
): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE subscriptions
       SET threshold_amount = ?, decimals = ?, updated_at = ?, last_alerted = 0
       WHERE id = ? AND user_id = ? AND chat_id = ? AND active = 1`,
    )
    .run(params.thresholdAmount, params.decimals, now, params.id, params.userId, params.chatId);

  return result.changes > 0;
}

export function deactivateSubscription(
  db: BetterSqliteDatabase,
  params: { id: number; userId: number; chatId: number },
): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE subscriptions SET active = 0, updated_at = ?
       WHERE id = ? AND user_id = ? AND chat_id = ? AND active = 1`,
    )
    .run(now, params.id, params.userId, params.chatId);

  return result.changes > 0;
}
