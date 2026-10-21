//! Unit tests for asset_deprecation.rs contract module
//!
//! Tests asset deprecation workflows, grace periods, and access control.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract = Address::generate(&env);
        (env, admin, contract)
    }

    #[test]
    fn test_initialize_contract() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            let result = AssetDeprecationContract::initialize(env.clone(), admin);
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_initialize_twice_fails() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            let _ = AssetDeprecationContract::initialize(env.clone(), admin.clone());
            let result = AssetDeprecationContract::initialize(env.clone(), admin);
            assert_eq!(result, Err(DeprecationError::AlreadyInitialized));
        });
    }

    #[test]
    fn test_deprecate_asset_with_admin() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let asset_code = String::from_str(&env, "USDC");
            let result = AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin.clone(),
                asset_code.clone(),
                None,
                None,
                String::from_str(&env, "Sunsetting USDC"),
            );

            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_deprecate_asset_with_replacement() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let asset_code = String::from_str(&env, "USDC");
            let replacement = String::from_str(&env, "USDC.v2");
            let result = AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin.clone(),
                asset_code.clone(),
                Some(replacement),
                None,
                String::from_str(&env, "Upgrading to v2"),
            );

            assert!(result.is_ok());

            // Verify replacement is registered
            let replacement_result = AssetDeprecationContract::get_replacement(env.clone(), asset_code);
            assert!(replacement_result.is_some());
        });
    }

    #[test]
    fn test_deprecate_same_asset_twice_fails() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let asset_code = String::from_str(&env, "USDC");

            AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin.clone(),
                asset_code.clone(),
                None,
                None,
                String::from_str(&env, "First deprecation"),
            )
            .expect("First deprecation should succeed");

            let result = AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin,
                asset_code,
                None,
                None,
                String::from_str(&env, "Second deprecation"),
            );

            assert_eq!(result, Err(DeprecationError::AlreadyDeprecated));
        });
    }

    #[test]
    fn test_is_deprecated() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let asset_code = String::from_str(&env, "USDC");

            // Before deprecation
            assert!(!AssetDeprecationContract::is_deprecated(env.clone(), asset_code.clone()));

            AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin,
                asset_code.clone(),
                None,
                None,
                String::from_str(&env, "Deprecating"),
            )
            .expect("Deprecation should succeed");

            // After deprecation
            assert!(AssetDeprecationContract::is_deprecated(env.clone(), asset_code));
        });
    }

    #[test]
    fn test_enable_read_only_mode() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let asset_code = String::from_str(&env, "USDC");

            AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin.clone(),
                asset_code.clone(),
                None,
                None,
                String::from_str(&env, "Deprecating"),
            )
            .expect("Deprecation should succeed");

            let result = AssetDeprecationContract::enable_read_only(
                env.clone(),
                admin,
                asset_code,
            );

            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_enable_read_only_nonexistent_asset_fails() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let asset_code = String::from_str(&env, "NONEXISTENT");

            let result = AssetDeprecationContract::enable_read_only(
                env.clone(),
                admin,
                asset_code,
            );

            assert_eq!(result, Err(DeprecationError::AssetNotFound));
        });
    }

    #[test]
    fn test_deprecate_unauthorized_fails() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let unauthorized = Address::generate(&env);
            let asset_code = String::from_str(&env, "USDC");

            let result = AssetDeprecationContract::deprecate_asset(
                env.clone(),
                unauthorized,
                asset_code,
                None,
                None,
                String::from_str(&env, "Unauthorized deprecation"),
            );

            assert_eq!(result, Err(DeprecationError::NotAuthorized));
        });
    }

    #[test]
    fn test_custom_migration_period() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            env.ledger().set_timestamp(1000);

            let asset_code = String::from_str(&env, "USDC");
            let custom_period = Some(86400u64); // 1 day

            AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin,
                asset_code.clone(),
                None,
                custom_period,
                String::from_str(&env, "With custom period"),
            )
            .expect("Deprecation with custom period should succeed");

            // Verify migration not expired yet
            let result = AssetDeprecationContract::is_migration_expired(env.clone(), asset_code.clone());
            assert_eq!(result, Ok(false));

            // Fast forward past the period
            env.ledger().set_timestamp(1000 + 86401);

            // Verify migration is now expired
            let result = AssetDeprecationContract::is_migration_expired(env.clone(), asset_code);
            assert_eq!(result, Ok(true));
        });
    }

    #[test]
    fn test_is_migration_expired_nonexistent_asset() {
        let (env, _, contract) = setup();
        env.as_contract(&contract, || {
            let asset_code = String::from_str(&env, "NONEXISTENT");
            let result = AssetDeprecationContract::is_migration_expired(env.clone(), asset_code);
            assert_eq!(result, Err(DeprecationError::AssetNotFound));
        });
    }

    #[test]
    fn test_get_replacement_none() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let asset_code = String::from_str(&env, "USDC");

            // Deprecate without replacement
            AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin,
                asset_code.clone(),
                None,
                None,
                String::from_str(&env, "No replacement"),
            )
            .expect("Deprecation should succeed");

            let result = AssetDeprecationContract::get_replacement(env.clone(), asset_code);
            assert!(result.is_none());
        });
    }

    #[test]
    fn test_deprecate_multiple_assets() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            let assets = vec!["USDC", "USDT", "DAI"];

            for asset_name in assets {
                let asset_code = String::from_str(&env, asset_name);
                AssetDeprecationContract::deprecate_asset(
                    env.clone(),
                    admin.clone(),
                    asset_code,
                    None,
                    None,
                    String::from_str(&env, &format!("Deprecating {}", asset_name)),
                )
                .expect("Deprecation should succeed");
            }

            // Verify all are deprecated
            for asset_name in assets {
                let asset_code = String::from_str(&env, asset_name);
                assert!(AssetDeprecationContract::is_deprecated(env.clone(), asset_code));
            }
        });
    }

    #[test]
    fn test_default_migration_period() {
        let (env, admin, contract) = setup();
        env.as_contract(&contract, || {
            AssetDeprecationContract::initialize(env.clone(), admin.clone())
                .expect("Initialization should succeed");

            env.ledger().set_timestamp(1000);

            let asset_code = String::from_str(&env, "USDC");

            // Use default period (None)
            AssetDeprecationContract::deprecate_asset(
                env.clone(),
                admin,
                asset_code.clone(),
                None,
                None, // Use default
                String::from_str(&env, "Using default period"),
            )
            .expect("Deprecation should succeed");

            // Default is 30 days = 2592000 seconds
            // Should not be expired yet
            let result = AssetDeprecationContract::is_migration_expired(env.clone(), asset_code.clone());
            assert_eq!(result, Ok(false));

            // Fast forward to just after default period
            env.ledger().set_timestamp(1000 + DEFAULT_MIGRATION_PERIOD + 1);

            let result = AssetDeprecationContract::is_migration_expired(env.clone(), asset_code);
            assert_eq!(result, Ok(true));
        });
    }
}
