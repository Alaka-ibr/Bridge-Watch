import type { Knex } from "knex";
import type { ChainId } from "../../services/ethereum/types.js";
import { config } from "../../config/index.js";

/**
 * Seed: Wormhole multi-chain bridge registration.
 *
 * Lock contract addresses are intentionally NOT hardcoded here — an incorrect
 * address would silently monitor the wrong contract. Operators supply verified
 * addresses (see https://docs.wormhole.com/wormhole/reference/contracts) via
 * the WORMHOLE_* environment variables documented in .env.example; only chains
 * with both a lock contract and watched token address configured are seeded.
 *
 * Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING.
 */
export async function seed(knex: Knex): Promise<void> {
  const BRIDGE_NAME = "Wormhole Bridge";
  const assetSymbol = config.WORMHOLE_WATCHED_ASSET_SYMBOL || "wETH";

  await knex("bridges")
    .insert({
      name: BRIDGE_NAME,
      source_chain: "Multi-chain (EVM)",
      status: "unknown",
      total_value_locked: 0,
      supply_on_stellar: 0,
      supply_on_source: 0,
      is_active: true,
    })
    .onConflict("name")
    .ignore();

  const stellarIssuer = config.WORMHOLE_WATCHED_ASSET_STELLAR_ISSUER;
  await knex("assets")
    .insert({
      symbol: assetSymbol,
      name: `Wormhole Wrapped ${assetSymbol.replace(/^w/i, "")}`,
      issuer: stellarIssuer || null,
      asset_type: "credit_alphanum4",
      bridge_provider: "Wormhole",
      source_chain: "Ethereum",
      is_active: Boolean(stellarIssuer),
    })
    .onConflict("symbol")
    .ignore();

  const chainEnvMap: Array<{ chainId: ChainId; bridgeEnv: string; tokenEnv: string }> = [
    { chainId: "ethereum", bridgeEnv: "WORMHOLE_TOKEN_BRIDGE_ETHEREUM_ADDRESS", tokenEnv: "WORMHOLE_WATCHED_TOKEN_ETHEREUM_ADDRESS" },
    { chainId: "polygon", bridgeEnv: "WORMHOLE_TOKEN_BRIDGE_POLYGON_ADDRESS", tokenEnv: "WORMHOLE_WATCHED_TOKEN_POLYGON_ADDRESS" },
    { chainId: "base", bridgeEnv: "WORMHOLE_TOKEN_BRIDGE_BASE_ADDRESS", tokenEnv: "WORMHOLE_WATCHED_TOKEN_BASE_ADDRESS" },
  ];

  const rows = chainEnvMap
    .map(({ chainId, bridgeEnv, tokenEnv }) => ({
      chainId,
      contractAddress: (config as any)[bridgeEnv],
      tokenAddress: (config as any)[tokenEnv],
    }))
    .filter(
      (row): row is { chainId: ChainId; contractAddress: string; tokenAddress: string } =>
        Boolean(row.contractAddress && row.tokenAddress)
    )
    .map((row) => ({
      bridge_name: BRIDGE_NAME,
      chain_id: row.chainId,
      contract_address: row.contractAddress,
      token_address: row.tokenAddress,
      asset_symbol: assetSymbol,
      is_active: true,
    }));

  if (rows.length) {
    await knex("evm_lock_contracts")
      .insert(rows)
      .onConflict(["chain_id", "contract_address", "token_address"])
      .ignore();
  }
}
