import type { SubscribedVaultRecord, VaultMetricRecord } from '../db/repositories.js';

export type NormalizedVault = {
  vault_id: string;
  version: 'v1' | 'v2';
  chain: string | null;
  contract: string | null;
  token_addr: string | null;
  token_symbol: string | null;
  decimals: number | null;
  name: string | null;
  raw: Record<string, unknown>;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type VaultChain = {
  id?: number;
  network?: string;
};

type VaultRow = {
  id: string;
  address?: string;
  name?: string;
  symbol?: string;
  chain?: VaultChain;
  asset?: {
    address?: string;
    symbol?: string;
    decimals?: number;
  };
};

type V1MetricRow = {
  id: string;
  state?: {
    totalAssets?: string | null;
  } | null;
  liquidity?: {
    underlying?: string | null;
  } | null;
};

type V2MetricRow = {
  id: string;
  totalAssets?: string | null;
  liquidity?: string | null;
};

type VaultRegistryQueryData = {
  vaults: {
    items: VaultRow[];
  };
  vaultV2s: {
    items: VaultRow[];
  };
};

type VaultMetricsQueryData = {
  vaults: {
    items: V1MetricRow[];
  };
  vaultV2s: {
    items: V2MetricRow[];
  };
};

const GET_VAULTS_QUERY = `
  query GetVaults {
    vaults(first: 1000, where: { whitelisted: true, listed: true }) {
      items {
        id
        address
        name
        symbol
        chain {
          id
          network
        }
        asset {
          address
          symbol
          decimals
        }
      }
    }
    vaultV2s(first: 1000, where: { listed: true }) {
      items {
        id
        address
        name
        symbol
        chain {
          id
          network
        }
        asset {
          address
          symbol
          decimals
        }
      }
    }
  }
`;

const GET_SUBSCRIBED_VAULT_METRICS_QUERY = `
  query GetSubscribedVaultMetrics(
    $v1ChainIds: [Int!]
    $v1Addresses: [String!]
    $v2ChainIds: [Int!]
    $v2Addresses: [String!]
  ) {
    vaults(first: 1000, where: { chainId_in: $v1ChainIds, address_in: $v1Addresses }) {
      items {
        id
        state {
          totalAssets
        }
        liquidity {
          underlying
        }
      }
    }
    vaultV2s(first: 1000, where: { chainId_in: $v2ChainIds, address_in: $v2Addresses }) {
      items {
        id
        totalAssets
        liquidity
      }
    }
  }
`;

async function postGraphQL<T>(url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`GraphQL request failed with HTTP ${response.status}: ${responseText}`);
  }

  const payload = JSON.parse(responseText) as GraphQLResponse<T>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  if (!payload.data) {
    throw new Error('GraphQL response did not include data');
  }

  return payload.data;
}

function normalizeVault(rawVault: VaultRow, version: 'v1' | 'v2'): NormalizedVault {
  return {
    vault_id: rawVault.id,
    version,
    chain: rawVault.chain?.network ?? null,
    contract: rawVault.address ?? null,
    token_addr: rawVault.asset?.address ?? null,
    token_symbol: rawVault.asset?.symbol ?? rawVault.symbol ?? null,
    decimals: rawVault.asset?.decimals ?? null,
    name: rawVault.name ?? null,
    raw: rawVault as unknown as Record<string, unknown>,
  };
}

function extractChainId(vault: SubscribedVaultRecord): number | null {
  const chain = vault.raw.chain;
  if (!chain || typeof chain !== 'object') {
    return null;
  }

  const id = (chain as Record<string, unknown>).id;
  return typeof id === 'number' ? id : null;
}

function buildMetricVariables(subscribedVaults: SubscribedVaultRecord[]): Record<string, unknown> {
  const v1ChainIds = new Set<number>();
  const v1Addresses = new Set<string>();
  const v2ChainIds = new Set<number>();
  const v2Addresses = new Set<string>();

  for (const vault of subscribedVaults) {
    if (!vault.contract) {
      continue;
    }

    const chainId = extractChainId(vault);
    if (chainId == null) {
      continue;
    }

    if (vault.version === 'v1') {
      v1ChainIds.add(chainId);
      v1Addresses.add(vault.contract);
      continue;
    }

    v2ChainIds.add(chainId);
    v2Addresses.add(vault.contract);
  }

  return {
    v1ChainIds: v1ChainIds.size > 0 ? [...v1ChainIds] : undefined,
    v1Addresses: v1Addresses.size > 0 ? [...v1Addresses] : undefined,
    v2ChainIds: v2ChainIds.size > 0 ? [...v2ChainIds] : undefined,
    v2Addresses: v2Addresses.size > 0 ? [...v2Addresses] : undefined,
  };
}

export async function fetchMorphoVaults(graphqlUrl: string): Promise<NormalizedVault[]> {
  const payload = await postGraphQL<VaultRegistryQueryData>(graphqlUrl, GET_VAULTS_QUERY);

  return [
    ...(payload.vaults.items ?? []).map((item) => normalizeVault(item, 'v1')),
    ...(payload.vaultV2s.items ?? []).map((item) => normalizeVault(item, 'v2')),
  ];
}

export async function fetchSubscribedVaultMetrics(
  graphqlUrl: string,
  subscribedVaults: SubscribedVaultRecord[],
): Promise<VaultMetricRecord[]> {
  if (subscribedVaults.length === 0) {
    return [];
  }

  const payload = await postGraphQL<VaultMetricsQueryData>(
    graphqlUrl,
    GET_SUBSCRIBED_VAULT_METRICS_QUERY,
    buildMetricVariables(subscribedVaults),
  );

  const timestamp = new Date().toISOString();
  const metricsById = new Map<string, VaultMetricRecord>();

  for (const item of payload.vaults.items ?? []) {
    metricsById.set(item.id, {
      vault_id: item.id,
      timestamp,
      deposits: item.state?.totalAssets ?? null,
      available_liquidity: item.liquidity?.underlying ?? null,
    });
  }

  for (const item of payload.vaultV2s.items ?? []) {
    metricsById.set(item.id, {
      vault_id: item.id,
      timestamp,
      deposits: item.totalAssets ?? null,
      available_liquidity: item.liquidity ?? null,
    });
  }

  return subscribedVaults
    .map((vault) => metricsById.get(vault.vault_id))
    .filter((metric): metric is VaultMetricRecord => Boolean(metric));
}
