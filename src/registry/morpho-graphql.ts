type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

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

type VaultsQueryData = {
  vaults: {
    items: VaultRow[];
  };
  vaultV2s: {
    items: VaultRow[];
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

export async function fetchMorphoVaults(url: string): Promise<NormalizedVault[]> {
  const payload = await postGraphQL<VaultsQueryData>(url, GET_VAULTS_QUERY);

  return [
    ...(payload.vaults.items ?? []).map((item) => normalizeVault(item, 'v1')),
    ...(payload.vaultV2s.items ?? []).map((item) => normalizeVault(item, 'v2')),
  ];
}
