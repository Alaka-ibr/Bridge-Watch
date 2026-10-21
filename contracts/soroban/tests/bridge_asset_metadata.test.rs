//! Unit tests for bridge_asset_metadata.rs contract module
//!
//! Tests metadata management, field validation, history tracking, and access control.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};

    struct TestSetup {
        env: Env,
        admin: Address,
        contract: Address,
        asset_code: String,
    }

    fn setup() -> TestSetup {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract = Address::generate(&env);
        let asset_code = String::from_str(&env, "USDC");

        // Initialize admin in contract context
        env.as_contract(&contract, || {
            env.storage().instance().set(&keys::ADMIN, &admin);
            // Register the asset as health data
            env.storage().persistent().set(
                &crate::AssetDataKey::Health(asset_code.clone()),
                &crate::AssetHealth {
                    asset_code: asset_code.clone(),
                    health_score: 100,
                    liquidity_score: 100,
                    price_stability_score: 100,
                    bridge_uptime_score: 100,
                    paused: false,
                    active: true,
                    timestamp: 0,
                    expires_at: 0,
                },
            );
        });

        env.ledger().set_timestamp(1000);

        TestSetup {
            env,
            admin,
            contract,
            asset_code,
        }
    }

    #[test]
    fn test_update_metadata_initial() {
        let setup = setup();

        let metadata = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com/usdc"),
                String::from_str(&setup.env, "Initial metadata"),
            )
            .expect("Initial update should succeed")
        });

        assert_eq!(metadata.version, 1);
        assert_eq!(metadata.asset_code, setup.asset_code);
    }

    #[test]
    fn test_update_metadata_increments_version() {
        let setup = setup();

        setup.env.as_contract(&setup.contract, || {
            let v1 = update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com/usdc"),
                String::from_str(&setup.env, "V1"),
            )
            .expect("First update should succeed");

            assert_eq!(v1.version, 1);

            let v2 = update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin v2"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin v2"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "V2"),
            )
            .expect("Second update should succeed");

            assert_eq!(v2.version, 2);
        });
    }

    #[test]
    fn test_metadata_history_tracks_changes() {
        let setup = setup();

        setup.env.as_contract(&setup.contract, || {
            // Create first version
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "Initial"),
            )
            .expect("First update should succeed");

            // Create second version
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin v2"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Updated"),
                String::from_str(&setup.env, "https://example.com"),
                String::from_str(&setup.env, "Update 1"),
            )
            .expect("Second update should succeed");

            let history = get_metadata_history(setup.env.clone(), setup.asset_code.clone());
            assert_eq!(history.len(), 2);
            assert_eq!(history.get(0).unwrap().version, 1);
            assert_eq!(history.get(1).unwrap().version, 2);
        });
    }

    #[test]
    fn test_update_metadata_unauthorized_fails() {
        let setup = setup();
        let unauthorized = Address::generate(&setup.env);

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                unauthorized,
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "Unauthorized"),
            )
        });

        assert_eq!(result, Err(AssetMetadataError::NotAuthorized));
    }

    #[test]
    fn test_validate_field_length_name() {
        let setup = setup();

        // Name exceeds MAX_NAME_LEN (128)
        let long_name = String::from_str(&setup.env, &"a".repeat(129));

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                long_name,
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "reason"),
            )
        });

        assert_eq!(result, Err(AssetMetadataError::FieldTooLong));
    }

    #[test]
    fn test_validate_field_length_symbol() {
        let setup = setup();

        // Symbol exceeds MAX_SYMBOL_LEN (32)
        let long_symbol = String::from_str(&setup.env, &"a".repeat(33));

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                long_symbol,
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "reason"),
            )
        });

        assert_eq!(result, Err(AssetMetadataError::FieldTooLong));
    }

    #[test]
    fn test_validate_field_length_description() {
        let setup = setup();

        // Description exceeds MAX_DESCRIPTION_LEN (512)
        let long_desc = String::from_str(&setup.env, &"a".repeat(513));

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                long_desc,
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "reason"),
            )
        });

        assert_eq!(result, Err(AssetMetadataError::FieldTooLong));
    }

    #[test]
    fn test_validate_field_length_url() {
        let setup = setup();

        // URL exceeds MAX_URL_LEN (256)
        let long_url = String::from_str(&setup.env, &"https://example.com/".repeat(20));

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                long_url,
                String::from_str(&setup.env, "reason"),
            )
        });

        assert_eq!(result, Err(AssetMetadataError::FieldTooLong));
    }

    #[test]
    fn test_validate_field_length_change_reason() {
        let setup = setup();

        // Change reason exceeds MAX_REASON_LEN (256)
        let long_reason = String::from_str(&setup.env, &"a".repeat(257));

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                long_reason,
            )
        });

        assert_eq!(result, Err(AssetMetadataError::FieldTooLong));
    }

    #[test]
    fn test_empty_field_validation() {
        let setup = setup();

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, ""), // Empty name
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "reason"),
            )
        });

        assert_eq!(result, Err(AssetMetadataError::EmptyField));
    }

    #[test]
    fn test_update_nonregistered_asset_fails() {
        let setup = setup();

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                String::from_str(&setup.env, "NONEXISTENT"),
                String::from_str(&setup.env, "Fake"),
                String::from_str(&setup.env, "FAKE"),
                String::from_str(&setup.env, "Fake asset"),
                String::from_str(&setup.env, "https://example.com"),
                String::from_str(&setup.env, "reason"),
            )
        });

        assert_eq!(result, Err(AssetMetadataError::AssetNotRegistered));
    }

    #[test]
    fn test_metadata_timestamps() {
        let setup = setup();

        setup.env.as_contract(&setup.contract, || {
            setup.env.ledger().set_timestamp(50000);

            let metadata = update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "reason"),
            )
            .expect("Update should succeed");

            assert_eq!(metadata.updated_at, 50000);
        });
    }

    #[test]
    fn test_metadata_change_records_updated_by() {
        let setup = setup();

        setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                String::from_str(&setup.env, "USD Coin"),
                String::from_str(&setup.env, "USDC"),
                String::from_str(&setup.env, "Stablecoin"),
                String::from_str(&setup.env, "https://circle.com"),
                String::from_str(&setup.env, "reason"),
            )
            .expect("Update should succeed");

            let history = get_metadata_history(setup.env.clone(), setup.asset_code.clone());
            let record = history.get(0).unwrap();
            assert_eq!(record.changed_by, setup.admin);
        });
    }

    #[test]
    fn test_version_history_max_size() {
        let setup = setup();

        setup.env.as_contract(&setup.contract, || {
            // Create MAX_VERSION_HISTORY (50) + 1 versions
            for i in 0..=50 {
                update_metadata(
                    setup.env.clone(),
                    setup.admin.clone(),
                    setup.asset_code.clone(),
                    String::from_str(&setup.env, &format!("USD Coin v{}", i)),
                    String::from_str(&setup.env, "USDC"),
                    String::from_str(&setup.env, "Stablecoin"),
                    String::from_str(&setup.env, "https://circle.com"),
                    String::from_str(&setup.env, &format!("Update {}", i)),
                )
                .expect("Update should succeed");
            }

            let history = get_metadata_history(setup.env.clone(), setup.asset_code.clone());
            // History should be trimmed to MAX_VERSION_HISTORY (50)
            assert!(history.len() <= MAX_VERSION_HISTORY as usize);
        });
    }

    #[test]
    fn test_max_field_lengths_allowed() {
        let setup = setup();

        // Test that fields at exactly max length are allowed
        let max_name = String::from_str(&setup.env, &"a".repeat(MAX_NAME_LEN as usize));
        let max_symbol = String::from_str(&setup.env, &"b".repeat(MAX_SYMBOL_LEN as usize));
        let max_desc = String::from_str(&setup.env, &"c".repeat(MAX_DESCRIPTION_LEN as usize));
        let max_url = String::from_str(&setup.env, &"https://e.com".repeat(18)); // ~252 chars
        let max_reason = String::from_str(&setup.env, &"d".repeat(MAX_REASON_LEN as usize));

        let result = setup.env.as_contract(&setup.contract, || {
            update_metadata(
                setup.env.clone(),
                setup.admin.clone(),
                setup.asset_code.clone(),
                max_name,
                max_symbol,
                max_desc,
                max_url,
                max_reason,
            )
        });

        assert!(result.is_ok());
    }
}
