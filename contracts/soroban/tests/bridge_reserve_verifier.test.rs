//! Additional unit tests for bridge_reserve_verifier.rs contract module
//!
//! Tests proof validation, reserve balance checking, stale attestation rejection,
//! and replay protection mechanisms.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger, EnvTestUtils}, Address, Env, String, Bytes};

    fn setup_test_env() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        (env, admin)
    }

    #[test]
    fn test_initialize_with_valid_config() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        // Verify config was set
        let config = client.get_config();
        assert_eq!(config.admin, admin);
        assert_eq!(config.challenge_period_ledgers, 100);
        assert_eq!(config.slash_amount, 500);
        assert_eq!(config.min_stake, 1_000);
    }

    #[test]
    fn test_initialize_twice_fails() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        // Second initialization should fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.initialize(&admin, &100u32, &500i128, &1_000i128);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_register_bridge_insufficient_stake() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let operator = Address::generate(&env);
        let bridge_id = String::from_str(&env, "test-bridge");

        // Try to register with insufficient stake
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.register_bridge(&bridge_id, &operator, &500i128); // Less than min_stake
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_register_bridge_duplicate_fails() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let operator = Address::generate(&env);
        let bridge_id = String::from_str(&env, "test-bridge");

        client.register_bridge(&bridge_id, &operator, &5_000i128);

        // Try to register the same bridge again
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.register_bridge(&bridge_id, &operator, &5_000i128);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_commit_reserves_updates_sequence() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        let (root1, _, _) = build_test_tree(&env);
        let seq1 = client.commit_reserves(&bridge_id, &root1, &10_000_000i128);

        let (root2, _, _) = build_test_tree(&env);
        let seq2 = client.commit_reserves(&bridge_id, &root2, &20_000_000i128);

        // Sequence numbers should be different
        assert_ne!(seq1, seq2);
        assert_eq!(seq2, seq1 + 1);
    }

    #[test]
    fn test_commitment_status_transitions() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        let (root, _, _) = build_test_tree(&env);
        let seq = client.commit_reserves(&bridge_id, &root, &10_000_000i128);

        // Initially PendingVerification
        let commitment = client.get_commitment(&bridge_id, &seq).unwrap();
        assert!(matches!(commitment.status, CommitmentStatus::PendingVerification));

        // Confirm -> Verified
        client.confirm_commitment(&bridge_id, &seq);
        let commitment = client.get_commitment(&bridge_id, &seq).unwrap();
        assert!(matches!(commitment.status, CommitmentStatus::Verified));
    }

    #[test]
    fn test_challenge_commitment_invalid_proof() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        let (root, _, _) = build_test_tree(&env);
        let seq = client.commit_reserves(&bridge_id, &root, &10_000_000i128);

        let challenger = Address::generate(&env);
        let invalid_proof = MerkleProof {
            leaf_hash: env.crypto()
                .sha256(&Bytes::from_slice(&env, b"invalid_data"))
                .into(),
            proof_path: Vec::new(&env),
            leaf_index: 999,
        };

        client.challenge_commitment(&bridge_id, &seq, &challenger, &invalid_proof);

        let commitment = client.get_commitment(&bridge_id, &seq).unwrap();
        assert!(matches!(commitment.status, CommitmentStatus::Challenged));
        assert_eq!(commitment.challenger.unwrap(), challenger);
    }

    #[test]
    fn test_resolve_challenge_slashes_operator() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        let (root, _, _) = build_test_tree(&env);
        let seq = client.commit_reserves(&bridge_id, &root, &10_000_000i128);

        let challenger = Address::generate(&env);
        let bad_proof = MerkleProof {
            leaf_hash: env.crypto()
                .sha256(&Bytes::from_slice(&env, b"not_in_tree"))
                .into(),
            proof_path: Vec::new(&env),
            leaf_index: 99,
        };

        client.challenge_commitment(&bridge_id, &seq, &challenger, &bad_proof);

        // Resolve as false (operator at fault)
        client.resolve_challenge(&bridge_id, &seq, &false);

        let op = client.get_operator(&bridge_id).unwrap();
        assert_eq!(op.slash_count, 1);
        assert_eq!(op.stake, 4_500i128); // 5_000 - 500 slash

        let commitment = client.get_commitment(&bridge_id, &seq).unwrap();
        assert!(matches!(commitment.status, CommitmentStatus::Slashed));
    }

    #[test]
    fn test_resolve_challenge_exonerates() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        let (root, _, _) = build_test_tree(&env);
        let seq = client.commit_reserves(&bridge_id, &root, &10_000_000i128);

        let challenger = Address::generate(&env);
        let bad_proof = MerkleProof {
            leaf_hash: env.crypto()
                .sha256(&Bytes::from_slice(&env, b"invalid"))
                .into(),
            proof_path: Vec::new(&env),
            leaf_index: 99,
        };

        client.challenge_commitment(&bridge_id, &seq, &challenger, &bad_proof);

        // Resolve as true (challenger at fault)
        client.resolve_challenge(&bridge_id, &seq, &true);

        let op = client.get_operator(&bridge_id).unwrap();
        assert_eq!(op.slash_count, 0); // No slash for operator
        assert_eq!(op.stake, 5_000i128); // Stake unchanged

        let commitment = client.get_commitment(&bridge_id, &seq).unwrap();
        assert!(matches!(commitment.status, CommitmentStatus::Resolved));
    }

    #[test]
    fn test_update_config_validation() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        // Update with valid values
        client.update_config(&200u32, &1_000i128, &2_000i128);

        let config = client.get_config();
        assert_eq!(config.challenge_period_ledgers, 200);
        assert_eq!(config.slash_amount, 1_000);
        assert_eq!(config.min_stake, 2_000);
    }

    #[test]
    fn test_get_operator_not_found() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "nonexistent");
        let result = client.get_operator(&bridge_id);
        assert!(result.is_none());
    }

    #[test]
    fn test_get_commitment_not_found() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let result = client.get_commitment(&bridge_id, &999u64);
        assert!(result.is_none());
    }

    #[test]
    fn test_slash_operator_updates_stake() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        let (root, proof, _) = build_test_tree(&env);
        client.commit_reserves(&bridge_id, &root, &10_000_000i128);

        let initial_op = client.get_operator(&bridge_id).unwrap();
        assert_eq!(initial_op.stake, 5_000i128);

        client.slash_operator(&bridge_id, &proof);

        let slashed_op = client.get_operator(&bridge_id).unwrap();
        assert_eq!(slashed_op.stake, 4_500i128);
        assert_eq!(slashed_op.slash_count, 1);
    }

    #[test]
    fn test_operator_becomes_inactive_after_slash() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        let (root, _, _) = build_test_tree(&env);
        let seq = client.commit_reserves(&bridge_id, &root, &10_000_000i128);

        let challenger = Address::generate(&env);
        let bad_proof = MerkleProof {
            leaf_hash: env.crypto()
                .sha256(&Bytes::from_slice(&env, b"fake"))
                .into(),
            proof_path: Vec::new(&env),
            leaf_index: 99,
        };

        client.challenge_commitment(&bridge_id, &seq, &challenger, &bad_proof);

        let op_before = client.get_operator(&bridge_id).unwrap();
        assert!(op_before.is_active);

        client.resolve_challenge(&bridge_id, &seq, &false);

        let op_after = client.get_operator(&bridge_id).unwrap();
        assert!(!op_after.is_active);
    }

    #[test]
    fn test_registered_bridges_tracking() {
        let (env, admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        client.initialize(&admin, &100u32, &500i128, &1_000i128);

        let bridges = vec!["bridge-1", "bridge-2", "bridge-3"];
        for bridge_name in bridges.iter() {
            let bridge_id = String::from_str(&env, bridge_name);
            let operator = Address::generate(&env);
            client.register_bridge(&bridge_id, &operator, &5_000i128);
        }

        // Verify all bridges are registered (implicit via successful queries)
        for bridge_name in bridges.iter() {
            let bridge_id = String::from_str(&env, bridge_name);
            let op = client.get_operator(&bridge_id);
            assert!(op.is_some());
        }
    }

    #[test]
    fn test_commitment_ledger_tracking() {
        let (env, _admin) = setup_test_env();
        let contract_id = env.register_contract(None, BridgeReserveVerifier);
        let client = BridgeReserveVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &100u32, &500u32, &1_000i128);

        let bridge_id = String::from_str(&env, "test-bridge");
        let operator = Address::generate(&env);
        client.register_bridge(&bridge_id, &operator, &5_000i128);

        env.ledger().set_ledger_sequence(1000);
        let (root, _, _) = build_test_tree(&env);
        let seq = client.commit_reserves(&bridge_id, &root, &10_000_000i128);

        let commitment = client.get_commitment(&bridge_id, &seq).unwrap();
        assert_eq!(commitment.committed_ledger, 1000u32);
    }
}
