use soroban_sdk::{contracterror, contracttype, symbol_short, Address, Env, String, Vec};

use crate::keys;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SourceBlessingError {
    NotInitialized = 1,
    Unauthorized = 2,
    EmptySourceName = 3,
    EmptyAssetCode = 4,
    SourceNotBlessed = 5,
    AlreadyUnblessed = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlessedSource {
    pub source_address: Address,
    pub asset_code: String,
    pub name: String,
    pub blessed_by: Address,
    pub blessed_at: u64,
    pub is_active: bool,
    pub unblessed_by: Option<Address>,
    pub unblessed_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlessedSourceEntry {
    pub source_address: Address,
    pub asset_code: String,
    pub name: String,
    pub is_active: bool,
    pub blessed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceBlessingKey {
    Blessing(Address, String),
    AllBlessings,
    AssetBlessings(String),
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), SourceBlessingError> {
    caller.require_auth();
    let admin: Address = env
        .storage()
        .instance()
        .get(&keys::ADMIN)
        .ok_or(SourceBlessingError::NotInitialized)?;
    if *caller != admin {
        return Err(SourceBlessingError::Unauthorized);
    }
    Ok(())
}

pub fn bless_source(
    env: &Env,
    caller: &Address,
    source_address: &Address,
    asset_code: String,
    name: String,
) -> Result<(), SourceBlessingError> {
    require_admin(env, caller)?;

    if name.is_empty() {
        return Err(SourceBlessingError::EmptySourceName);
    }
    if asset_code.is_empty() {
        return Err(SourceBlessingError::EmptyAssetCode);
    }

    let now = env.ledger().timestamp();
    let key = SourceBlessingKey::Blessing(source_address.clone(), asset_code.clone());
    let existing: Option<BlessedSource> = env.storage().persistent().get(&key);

    let blessing = match existing {
        Some(mut existing_blessing) => {
            existing_blessing.is_active = true;
            existing_blessing.name = name.clone();
            existing_blessing.blessed_by = caller.clone();
            existing_blessing.blessed_at = now;
            existing_blessing.unblessed_by = None;
            existing_blessing.unblessed_at = None;
            existing_blessing
        }
        None => BlessedSource {
            source_address: source_address.clone(),
            asset_code: asset_code.clone(),
            name: name.clone(),
            blessed_by: caller.clone(),
            blessed_at: now,
            is_active: true,
            unblessed_by: None,
            unblessed_at: None,
        },
    };

    env.storage().persistent().set(&key, &blessing);

    let all_key = SourceBlessingKey::AllBlessings;
    let mut all: Vec<(Address, String)> = env
        .storage()
        .persistent()
        .get(&all_key)
        .unwrap_or_else(|| Vec::new(env));

    let mut found = false;
    for (addr, code) in all.iter() {
        if &addr == source_address && code == asset_code {
            found = true;
            break;
        }
    }

    if !found {
        all.push_back((source_address.clone(), asset_code.clone()));
        env.storage().persistent().set(&all_key, &all);
    }

    let asset_key = SourceBlessingKey::AssetBlessings(asset_code.clone());
    let mut asset_sources: Vec<Address> = env
        .storage()
        .persistent()
        .get(&asset_key)
        .unwrap_or_else(|| Vec::new(env));

    let mut asset_found = false;
    for addr in asset_sources.iter() {
        if &addr == source_address {
            asset_found = true;
            break;
        }
    }

    if !asset_found {
        asset_sources.push_back(source_address.clone());
        env.storage().persistent().set(&asset_key, &asset_sources);
    }

    env.events().publish(
        (symbol_short!("src_bls"),),
        (
            source_address.clone(),
            asset_code,
            name,
            caller.clone(),
            now,
        ),
    );

    Ok(())
}

pub fn unbless_source(
    env: &Env,
    caller: &Address,
    source_address: &Address,
    asset_code: String,
) -> Result<(), SourceBlessingError> {
    require_admin(env, caller)?;

    let key = SourceBlessingKey::Blessing(source_address.clone(), asset_code.clone());
    let mut blessing: BlessedSource = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(SourceBlessingError::SourceNotBlessed)?;

    if !blessing.is_active {
        return Err(SourceBlessingError::AlreadyUnblessed);
    }

    let now = env.ledger().timestamp();
    blessing.is_active = false;
    blessing.unblessed_by = Some(caller.clone());
    blessing.unblessed_at = Some(now);

    env.storage().persistent().set(&key, &blessing);

    env.events().publish(
        (symbol_short!("src_unb"),),
        (source_address.clone(), asset_code, caller.clone(), now),
    );

    Ok(())
}

pub fn is_source_blessed(env: &Env, source_address: &Address, asset_code: &String) -> bool {
    let key = SourceBlessingKey::Blessing(source_address.clone(), asset_code.clone());
    let blessing: Option<BlessedSource> = env.storage().persistent().get(&key);
    match blessing {
        Some(b) => b.is_active,
        None => false,
    }
}

pub fn get_blessing(
    env: &Env,
    source_address: &Address,
    asset_code: &String,
) -> Option<BlessedSource> {
    let key = SourceBlessingKey::Blessing(source_address.clone(), asset_code.clone());
    env.storage().persistent().get(&key)
}

pub fn get_blessed_sources_for_asset(env: &Env, asset_code: &String) -> Vec<BlessedSourceEntry> {
    let asset_key = SourceBlessingKey::AssetBlessings(asset_code.clone());
    let asset_sources: Vec<Address> = env
        .storage()
        .persistent()
        .get(&asset_key)
        .unwrap_or_else(|| Vec::new(env));

    let mut result: Vec<BlessedSourceEntry> = Vec::new(env);
    for addr in asset_sources.iter() {
        let key = SourceBlessingKey::Blessing(addr.clone(), asset_code.clone());
        if let Some(b) = env.storage().persistent().get::<_, BlessedSource>(&key) {
            result.push_back(BlessedSourceEntry {
                source_address: b.source_address,
                asset_code: b.asset_code,
                name: b.name,
                is_active: b.is_active,
                blessed_at: b.blessed_at,
            });
        }
    }
    result
}

pub fn get_all_blessings(env: &Env) -> Vec<BlessedSourceEntry> {
    let all_key = SourceBlessingKey::AllBlessings;
    let all: Vec<(Address, String)> = env
        .storage()
        .persistent()
        .get(&all_key)
        .unwrap_or_else(|| Vec::new(env));

    let mut result: Vec<BlessedSourceEntry> = Vec::new(env);
    for (addr, code) in all.iter() {
        let key = SourceBlessingKey::Blessing(addr.clone(), code.clone());
        if let Some(b) = env.storage().persistent().get::<_, BlessedSource>(&key) {
            result.push_back(BlessedSourceEntry {
                source_address: b.source_address,
                asset_code: b.asset_code,
                name: b.name,
                is_active: b.is_active,
                blessed_at: b.blessed_at,
            });
        }
    }
    result
}

pub fn get_preferred_source_for_asset(env: &Env, asset_code: &String) -> Option<Address> {
    let blessed = get_blessed_sources_for_asset(env, asset_code);
    if blessed.is_empty() {
        return None;
    }

    let mut active_sources: Vec<BlessedSourceEntry> = Vec::new(env);
    for b in blessed.iter() {
        if b.is_active {
            active_sources.push_back(b);
        }
    }

    if active_sources.is_empty() {
        return None;
    }

    active_sources
        .get(0)
        .map(|preferred| preferred.source_address)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::Env;

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract = env.register(crate::BridgeWatchContract, ());
        env.as_contract(&contract, || {
            env.storage().instance().set(&keys::ADMIN, &admin);
        });
        env.ledger().set_timestamp(1_000_000);
        (env, admin, contract)
    }

    fn s(env: &Env, value: &str) -> String {
        String::from_str(env, value)
    }

    #[test]
    fn test_bless_source() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);

        env.as_contract(&contract, || {
            bless_source(&env, &admin, &source, s(&env, "USDC"), s(&env, "CoinGecko")).unwrap();
            assert!(is_source_blessed(&env, &source, &s(&env, "USDC")));
        });
    }

    #[test]
    fn test_unbless_source() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);

        env.as_contract(&contract, || {
            bless_source(&env, &admin, &source, s(&env, "USDC"), s(&env, "CoinGecko")).unwrap();
            assert!(is_source_blessed(&env, &source, &s(&env, "USDC")));

            unbless_source(&env, &admin, &source, s(&env, "USDC")).unwrap();
            assert!(!is_source_blessed(&env, &source, &s(&env, "USDC")));
        });
    }

    #[test]
    fn test_blessing_is_per_asset() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);

        env.as_contract(&contract, || {
            bless_source(&env, &admin, &source, s(&env, "USDC"), s(&env, "CoinGecko")).unwrap();
            assert!(is_source_blessed(&env, &source, &s(&env, "USDC")));
            assert!(!is_source_blessed(&env, &source, &s(&env, "EURC")));
        });
    }

    #[test]
    fn test_get_blessed_sources_for_asset() {
        let (env, admin, contract) = setup();
        let source1 = Address::generate(&env);
        let source2 = Address::generate(&env);

        env.as_contract(&contract, || {
            bless_source(&env, &admin, &source1, s(&env, "USDC"), s(&env, "Oracle 1")).unwrap();
            bless_source(&env, &admin, &source2, s(&env, "USDC"), s(&env, "Oracle 2")).unwrap();

            let blessed = get_blessed_sources_for_asset(&env, &s(&env, "USDC"));
            assert_eq!(blessed.len(), 2);
        });
    }

    #[test]
    fn test_get_all_blessings() {
        let (env, admin, contract) = setup();
        let source1 = Address::generate(&env);
        let source2 = Address::generate(&env);

        env.as_contract(&contract, || {
            bless_source(&env, &admin, &source1, s(&env, "USDC"), s(&env, "Oracle 1")).unwrap();
            bless_source(&env, &admin, &source2, s(&env, "EURC"), s(&env, "Oracle 2")).unwrap();

            let all = get_all_blessings(&env);
            assert_eq!(all.len(), 2);
        });
    }

    #[test]
    fn test_unblessed_source_not_preferred() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);

        env.as_contract(&contract, || {
            bless_source(&env, &admin, &source, s(&env, "USDC"), s(&env, "Oracle")).unwrap();
            unbless_source(&env, &admin, &source, s(&env, "USDC")).unwrap();

            let preferred = get_preferred_source_for_asset(&env, &s(&env, "USDC"));
            assert!(preferred.is_none());
        });
    }

    #[test]
    fn test_preferred_source_for_asset() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);

        env.as_contract(&contract, || {
            bless_source(
                &env,
                &admin,
                &source,
                s(&env, "USDC"),
                s(&env, "Primary Oracle"),
            )
            .unwrap();

            let preferred = get_preferred_source_for_asset(&env, &s(&env, "USDC"));
            assert_eq!(preferred, Some(source.clone()));
        });
    }

    #[test]
    fn test_no_blessed_sources_returns_none() {
        let (env, _admin, contract) = setup();
        env.as_contract(&contract, || {
            let preferred = get_preferred_source_for_asset(&env, &s(&env, "USDC"));
            assert!(preferred.is_none());
        });
    }

    #[test]
    fn test_bless_source_empty_name() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);
        env.as_contract(&contract, || {
            let result = bless_source(&env, &admin, &source, s(&env, "USDC"), s(&env, ""));
            assert_eq!(result, Err(SourceBlessingError::EmptySourceName));
        });
    }

    #[test]
    fn test_bless_source_empty_asset() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);
        env.as_contract(&contract, || {
            let result = bless_source(&env, &admin, &source, s(&env, ""), s(&env, "Oracle"));
            assert_eq!(result, Err(SourceBlessingError::EmptyAssetCode));
        });
    }

    #[test]
    fn test_bless_source_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register(crate::BridgeWatchContract, ());
        let caller = Address::generate(&env);
        let source = Address::generate(&env);
        env.as_contract(&contract, || {
            let result = bless_source(&env, &caller, &source, s(&env, "USDC"), s(&env, "Oracle"));
            assert_eq!(result, Err(SourceBlessingError::NotInitialized));
        });
    }

    #[test]
    fn test_bless_source_non_admin() {
        let (env, _admin, contract) = setup();
        let intruder = Address::generate(&env);
        let source = Address::generate(&env);
        env.as_contract(&contract, || {
            let result = bless_source(&env, &intruder, &source, s(&env, "USDC"), s(&env, "Oracle"));
            assert_eq!(result, Err(SourceBlessingError::Unauthorized));
        });
    }

    #[test]
    fn test_unbless_source_not_blessed() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);
        env.as_contract(&contract, || {
            let result = unbless_source(&env, &admin, &source, s(&env, "USDC"));
            assert_eq!(result, Err(SourceBlessingError::SourceNotBlessed));
        });
    }

    #[test]
    fn test_unbless_source_already_unblessed() {
        let (env, admin, contract) = setup();
        let source = Address::generate(&env);
        env.as_contract(&contract, || {
            bless_source(&env, &admin, &source, s(&env, "USDC"), s(&env, "Oracle")).unwrap();
            unbless_source(&env, &admin, &source, s(&env, "USDC")).unwrap();

            let result = unbless_source(&env, &admin, &source, s(&env, "USDC"));
            assert_eq!(result, Err(SourceBlessingError::AlreadyUnblessed));
        });
    }
}
