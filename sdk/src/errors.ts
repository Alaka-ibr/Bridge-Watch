export class BridgeWatchSdkError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly retryable: boolean;

  constructor(message: string, code = "SDK_ERROR", details?: unknown, retryable = false) {
    super(message);
    this.name = "BridgeWatchSdkError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export class BridgeWatchConnectionError extends BridgeWatchSdkError {
  constructor(message: string, details?: unknown) {
    super(message, "CONNECTION_ERROR", details, true);
    this.name = "BridgeWatchConnectionError";
  }
}

export class BridgeWatchTransactionError extends BridgeWatchSdkError {
  constructor(message: string, details?: unknown) {
    super(message, "TRANSACTION_ERROR", details, false);
    this.name = "BridgeWatchTransactionError";
  }
}

export class BridgeWatchQueryError extends BridgeWatchSdkError {
  constructor(message: string, details?: unknown) {
    super(message, "QUERY_ERROR", details, true);
    this.name = "BridgeWatchQueryError";
  }
}

export class BridgeWatchRateLimitError extends BridgeWatchSdkError {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = 1000, details?: unknown) {
    super(message, "RATE_LIMIT_ERROR", details, true);
    this.name = "BridgeWatchRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class BridgeWatchTimeoutError extends BridgeWatchSdkError {
  constructor(message: string, details?: unknown) {
    super(message, "TIMEOUT_ERROR", details, true);
    this.name = "BridgeWatchTimeoutError";
  }
}

export class BridgeWatchCircuitBreakerOpenError extends BridgeWatchSdkError {
  public readonly circuitName: string;
  public readonly resetTimeoutMs: number;

  constructor(circuitName: string, resetTimeoutMs: number, details?: unknown) {
    super(
      `Circuit breaker '${circuitName}' is OPEN. Requests temporarily halted to allow recovery.`,
      "CIRCUIT_BREAKER_OPEN",
      details,
      false
    );
    this.name = "BridgeWatchCircuitBreakerOpenError";
    this.circuitName = circuitName;
    this.resetTimeoutMs = resetTimeoutMs;
  }
}

export class BridgeWatchRpcUnavailableError extends BridgeWatchSdkError {
  constructor(message: string, details?: unknown) {
    super(message, "RPC_UNAVAILABLE", details, true);
    this.name = "BridgeWatchRpcUnavailableError";
  }
}

export class BridgeWatchSchemaValidationError extends BridgeWatchSdkError {
  constructor(message: string, details?: unknown) {
    super(message, "SCHEMA_VALIDATION_ERROR", details, false);
    this.name = "BridgeWatchSchemaValidationError";
  }
}
