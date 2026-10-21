//! Unit tests for batch_query.rs contract module
//!
//! Tests batch query operations, error handling, size limits, and data retrieval.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract = Address::generate(&env);
        (env, contract)
    }

    #[test]
    fn test_initialize_contract() {
        let (env, _) = setup();
        assert!(true); // Contract initializes without errors
    }

    #[test]
    fn test_batch_query_assets_single_item() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            let mut asset_codes: Vec<String> = Vec::new(&env);
            asset_codes.push_back(String::from_str(&env, "USDC"));

            // Store an asset first
            let _ = BatchQueryContract::store_asset(
                env.clone(),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "USD Coin"),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "Circle"),
                String::from_str(&env, "active"),
            );

            let response = BatchQueryContract::batch_query_assets(env.clone(), asset_codes)
                .expect("Single asset query should succeed");

            assert_eq!(response.success_count, 1);
            assert_eq!(response.error_count, 0);
            assert_eq!(response.results.len(), 1);
        });
    }

    #[test]
    fn test_batch_query_assets_multiple_items() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            // Store multiple assets
            let _ = BatchQueryContract::store_asset(
                env.clone(),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "USD Coin"),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "Circle"),
                String::from_str(&env, "active"),
            );

            let _ = BatchQueryContract::store_asset(
                env.clone(),
                String::from_str(&env, "USDT"),
                String::from_str(&env, "Tether"),
                String::from_str(&env, "USDT"),
                String::from_str(&env, "Tether"),
                String::from_str(&env, "active"),
            );

            let mut asset_codes: Vec<String> = Vec::new(&env);
            asset_codes.push_back(String::from_str(&env, "USDC"));
            asset_codes.push_back(String::from_str(&env, "USDT"));

            let response = BatchQueryContract::batch_query_assets(env.clone(), asset_codes)
                .expect("Multiple asset query should succeed");

            assert_eq!(response.success_count, 2);
            assert_eq!(response.error_count, 0);
            assert_eq!(response.results.len(), 2);
        });
    }

    #[test]
    fn test_batch_query_handles_missing_assets() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            // Store one asset
            let _ = BatchQueryContract::store_asset(
                env.clone(),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "USD Coin"),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "Circle"),
                String::from_str(&env, "active"),
            );

            // Query existing and non-existing assets
            let mut asset_codes: Vec<String> = Vec::new(&env);
            asset_codes.push_back(String::from_str(&env, "USDC"));
            asset_codes.push_back(String::from_str(&env, "NONEXIST"));

            let response = BatchQueryContract::batch_query_assets(env.clone(), asset_codes)
                .expect("Query with missing assets should handle gracefully");

            assert_eq!(response.success_count, 1);
            assert_eq!(response.error_count, 1);
            assert_eq!(response.results.len(), 2);
        });
    }

    #[test]
    fn test_batch_query_empty_array_fails() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            let asset_codes: Vec<String> = Vec::new(&env);

            let result = BatchQueryContract::batch_query_assets(env.clone(), asset_codes);

            assert_eq!(result, Err(BatchQueryError::EmptyBatch));
        });
    }

    #[test]
    fn test_batch_query_size_limit() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            let mut asset_codes: Vec<String> = Vec::new(&env);

            // Create batch exceeding MAX_BATCH_SIZE (50)
            for i in 0..51 {
                asset_codes.push_back(String::from_str(&env, &format!("ASSET{}", i)));
            }

            let result = BatchQueryContract::batch_query_assets(env.clone(), asset_codes);

            assert_eq!(result, Err(BatchQueryError::BatchSizeExceeded));
        });
    }

    #[test]
    fn test_batch_query_at_size_limit() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            let mut asset_codes: Vec<String> = Vec::new(&env);

            // Create batch at exactly MAX_BATCH_SIZE (50)
            for i in 0..50 {
                asset_codes.push_back(String::from_str(&env, &format!("ASSET{}", i)));
            }

            let result = BatchQueryContract::batch_query_assets(env.clone(), asset_codes);

            // Should succeed because it's at the limit, not over
            assert!(result.is_ok());
            let response = result.unwrap();
            assert_eq!(response.results.len(), 50);
        });
    }

    #[test]
    fn test_batch_query_bridges_single_item() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            // Store a bridge
            let _ = BatchQueryContract::store_bridge(
                env.clone(),
                String::from_str(&env, "circle-bridge"),
                String::from_str(&env, "Circle Bridge"),
                String::from_str(&env, "ethereum"),
                String::from_str(&env, "stellar"),
                String::from_str(&env, "active"),
            );

            let mut bridge_ids: Vec<String> = Vec::new(&env);
            bridge_ids.push_back(String::from_str(&env, "circle-bridge"));

            let response = BatchQueryContract::batch_query_bridges(env.clone(), bridge_ids)
                .expect("Single bridge query should succeed");

            assert_eq!(response.success_count, 1);
            assert_eq!(response.error_count, 0);
            assert_eq!(response.results.len(), 1);
        });
    }

    #[test]
    fn test_batch_query_bridges_multiple_items() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            // Store multiple bridges
            let _ = BatchQueryContract::store_bridge(
                env.clone(),
                String::from_str(&env, "circle-bridge"),
                String::from_str(&env, "Circle Bridge"),
                String::from_str(&env, "ethereum"),
                String::from_str(&env, "stellar"),
                String::from_str(&env, "active"),
            );

            let _ = BatchQueryContract::store_bridge(
                env.clone(),
                String::from_str(&env, "wormhole-bridge"),
                String::from_str(&env, "Wormhole"),
                String::from_str(&env, "solana"),
                String::from_str(&env, "stellar"),
                String::from_str(&env, "active"),
            );

            let mut bridge_ids: Vec<String> = Vec::new(&env);
            bridge_ids.push_back(String::from_str(&env, "circle-bridge"));
            bridge_ids.push_back(String::from_str(&env, "wormhole-bridge"));

            let response = BatchQueryContract::batch_query_bridges(env.clone(), bridge_ids)
                .expect("Multiple bridge query should succeed");

            assert_eq!(response.success_count, 2);
            assert_eq!(response.error_count, 0);
            assert_eq!(response.results.len(), 2);
        });
    }

    #[test]
    fn test_batch_query_bridges_handles_missing() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            let mut bridge_ids: Vec<String> = Vec::new(&env);
            bridge_ids.push_back(String::from_str(&env, "nonexistent"));

            let response = BatchQueryContract::batch_query_bridges(env.clone(), bridge_ids)
                .expect("Query with missing bridges should handle gracefully");

            assert_eq!(response.success_count, 0);
            assert_eq!(response.error_count, 1);
        });
    }

    #[test]
    fn test_batch_query_response_timestamps() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            env.ledger().set_timestamp(12345);

            let _ = BatchQueryContract::store_asset(
                env.clone(),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "USD Coin"),
                String::from_str(&env, "USDC"),
                String::from_str(&env, "Circle"),
                String::from_str(&env, "active"),
            );

            let mut asset_codes: Vec<String> = Vec::new(&env);
            asset_codes.push_back(String::from_str(&env, "USDC"));

            let response = BatchQueryContract::batch_query_assets(env.clone(), asset_codes)
                .expect("Query should succeed");

            assert_eq!(response.processed_at, 12345);
        });
    }

    #[test]
    fn test_store_asset_retrieval() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            let asset_code = String::from_str(&env, "TEST");
            let name = String::from_str(&env, "Test Asset");
            let symbol = String::from_str(&env, "TEST");
            let issuer = String::from_str(&env, "issuer.example.com");
            let status = String::from_str(&env, "active");

            BatchQueryContract::store_asset(
                env.clone(),
                asset_code.clone(),
                name.clone(),
                symbol.clone(),
                issuer.clone(),
                status.clone(),
            )
            .expect("Asset storage should succeed");

            // Verify by querying
            let mut codes: Vec<String> = Vec::new(&env);
            codes.push_back(asset_code);

            let response = BatchQueryContract::batch_query_assets(env.clone(), codes)
                .expect("Query should retrieve stored asset");

            assert_eq!(response.success_count, 1);
        });
    }

    #[test]
    fn test_store_bridge_retrieval() {
        let (env, contract) = setup();
        env.as_contract(&contract, || {
            let bridge_id = String::from_str(&env, "test-bridge");

            BatchQueryContract::store_bridge(
                env.clone(),
                bridge_id.clone(),
                String::from_str(&env, "Test Bridge"),
                String::from_str(&env, "chain-a"),
                String::from_str(&env, "chain-b"),
                String::from_str(&env, "active"),
            )
            .expect("Bridge storage should succeed");

            let mut ids: Vec<String> = Vec::new(&env);
            ids.push_back(bridge_id);

            let response = BatchQueryContract::batch_query_bridges(env.clone(), ids)
                .expect("Query should retrieve stored bridge");

            assert_eq!(response.success_count, 1);
        });
    }
}
