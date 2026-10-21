/**
 * Startup Configuration Validation
 * Issue: #377
 * 
 * Validates that all required configurations are present before starting the application.
 * This prevents runtime crashes due to missing critical configuration.
 */

import { getDatabase } from "../database/connection.js";
import { createRedisClient } from "../config/redis.js";
import { config } from "../config/index.js";
import { ConfigService } from "../services/config-service/ConfigService.js";
import { ConfigKey } from "../services/config-service/validators.js";
import { logger } from "../utils/logger.js";
import type Redis from "ioredis";

/**
 * Required configuration keys that must be present for the application to start
 */
const REQUIRED_CONFIGS: ConfigKey[] = [
  // Database
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",

  // Redis
  "REDIS_HOST",
  "REDIS_PORT",

  // Stellar
  "STELLAR_NETWORK",
  "STELLAR_HORIZON_URL",
  "SOROBAN_RPC_URL",

  // Security
  "JWT_SECRET",
  "CONFIG_ENCRYPTION_KEY",

  // Application
  "NODE_ENV",
  "PORT",
  "LOG_LEVEL",
];

/**
 * Validate startup configuration
 * 
 * Checks that all required configurations are present and valid.
 * Throws an error if any required configuration is missing.
 */
export async function validateStartupConfig(): Promise<void> {
  const environment = config.NODE_ENV || "development";
  
  logger.info({ environment }, "Validating startup configuration...");

  try {
    const db = getDatabase();
    const redis = createRedisClient() as Redis;
    const configService = new ConfigService(db, redis);

    const missing: string[] = [];
    const invalid: Array<{ key: string; error: string }> = [];

    for (const key of REQUIRED_CONFIGS) {
      try {
        const value = await configService.get(key, environment);
        
        if (value === null || value === undefined) {
          missing.push(key);
        }
      } catch (error: any) {
        if (error.message.includes("No configuration found")) {
          missing.push(key);
        } else {
          invalid.push({ key, error: error.message });
        }
      }
    }

    if (missing.length > 0) {
      logger.error(
        { missing, environment },
        "Missing required configurations"
      );
      throw new Error(
        `Missing required configurations: ${missing.join(", ")}\n` +
        `Environment: ${environment}\n` +
        `Please ensure all required configurations are set in the database or environment variables.`
      );
    }

    if (invalid.length > 0) {
      logger.error(
        { invalid, environment },
        "Invalid configurations"
      );
      throw new Error(
        `Invalid configurations:\n` +
        invalid.map(({ key, error }) => `  - ${key}: ${error}`).join("\n")
      );
    }

    // Additional type-specific checks (non-blocking schema validations)
    try {
      const slowThreshold = await configService.get("REQUEST_SLOW_THRESHOLD_MS", environment);
      if (slowThreshold !== null && slowThreshold !== undefined) {
        const val = Number(slowThreshold);
        if (!Number.isFinite(val) || val <= 0) {
          throw new Error("REQUEST_SLOW_THRESHOLD_MS must be a positive integer");
        }
      }
    } catch (err) {
      invalid.push({ key: "REQUEST_SLOW_THRESHOLD_MS", error: (err as Error).message });
    }

    try {
      const discordToken = await configService.get("DISCORD_BOT_TOKEN", environment);
      if (discordToken !== null && discordToken !== undefined && String(discordToken).trim() === "") {
        throw new Error("DISCORD_BOT_TOKEN is set but empty");
      }
    } catch (err) {
      invalid.push({ key: "DISCORD_BOT_TOKEN", error: (err as Error).message });
    }

    if (invalid.length > 0) {
      logger.error({ invalid, environment }, "Invalid configurations (post-schema checks)");
      throw new Error(invalid.map(({ key, error }) => `${key}: ${error}`).join("; "));
    }

    logger.info(
      { environment, validated: REQUIRED_CONFIGS.length },
      "✅ Startup configuration validated successfully"
    );
  } catch (error) {
    logger.error({ error, environment }, "Startup configuration validation failed");
    throw error;
  }
}

/**
 * Validate configuration with warnings (non-blocking)
 * 
 * Checks optional configurations and logs warnings if they are missing.
 * Does not throw errors, allowing the application to start with defaults.
 */
export async function validateOptionalConfig(): Promise<void> {
  const environment = config.NODE_ENV || "development";

  const OPTIONAL_CONFIGS: ConfigKey[] = [
    "CIRCLE_API_KEY",
    "COINBASE_API_KEY",
    "DISCORD_BOT_TOKEN",
    "SMTP_HOST",
    "WS_AUTH_SECRET",
  ];

  try {
    const db = getDatabase();
    const redis = createRedisClient() as Redis;
    const configService = new ConfigService(db, redis);

    const missing: string[] = [];

    for (const key of OPTIONAL_CONFIGS) {
      try {
        const value = await configService.get(key, environment);
        
        if (value === null || value === undefined) {
          missing.push(key);
        }
      } catch (error: any) {
        if (error.message.includes("No configuration found")) {
          missing.push(key);
        }
      }
    }

    if (missing.length > 0) {
      logger.warn(
        { missing, environment },
        "Optional configurations missing (using defaults)"
      );
    }
  } catch (error) {
    logger.warn({ error, environment }, "Optional configuration validation failed");
  }
}
