export type SecretProviderType =
  | "vault"
  | "aws_secrets_manager"
  | "gcp_secret_manager"
  | "azure_key_vault"
  | "kubernetes_secrets"
  | "environment";

export type SecretProviderStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface SecretProviderConfig {
  region?: string;
  vaultNamespace?: string;
  keyVaultName?: string;
  projectId?: string;
  k8sNamespace?: string;
  secretPrefix?: string;
  timeoutMs?: number;
  tlsVerify?: boolean;
}

export interface SecretProvider {
  id: string;
  provider_type: SecretProviderType;
  name: string;
  description?: string | null;
  endpoint: string;
  status: SecretProviderStatus;
  is_primary: boolean;
  fallback_provider_id?: string | null;
  token_ttl_seconds?: number | null;
  consecutive_failures: number;
  last_latency_ms?: number | null;
  last_error?: string | null;
  tls_expiry_date?: string | null;
  last_checked_at?: string | null;
  config: SecretProviderConfig;
  created_at: string;
  updated_at: string;
}

export interface SecretProviderCheckDetail {
  checkName: string;
  passed: boolean;
  latencyMs: number;
  message?: string;
}

export interface SecretProviderHealthLog {
  id: string;
  provider_id: string;
  status: SecretProviderStatus;
  latency_ms: number;
  error_code?: string | null;
  error_message?: string | null;
  checks: Record<string, SecretProviderCheckDetail>;
  timestamp: string;
}

export interface RegisterSecretProviderInput {
  provider_type: SecretProviderType;
  name: string;
  description?: string;
  endpoint: string;
  is_primary?: boolean;
  fallback_provider_id?: string;
  config?: SecretProviderConfig;
}

export interface UpdateSecretProviderInput {
  name?: string;
  description?: string;
  endpoint?: string;
  is_primary?: boolean;
  fallback_provider_id?: string | null;
  config?: SecretProviderConfig;
  status?: SecretProviderStatus;
}

export interface SecretProviderHealthSummary {
  totalProviders: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  primaryProviderHealthy: boolean;
  primaryProviderId?: string;
  activeFailover: boolean;
  averageLatencyMs: number;
  lastCheckTimestamp: string;
}
