import type { EndpointTier, EndpointLimits, RateLimitConfigRow } from '../types.js';

/**
 * Parse database rows into EndpointLimits configuration.
 *
 * This function converts rate_limit_configs table rows into the
 * EndpointLimits record used by the calculator.
 */
export function parseRateLimitConfigs(rows: RateLimitConfigRow[]): Partial<EndpointLimits> {
  const limits: Partial<EndpointLimits> = {};

  for (const row of rows) {
    const tier = row.endpoint_tier as EndpointTier;
    limits[tier] = {
      perHour: row.per_hour,
      burstPerMinute: row.burst_per_minute,
    };
  }

  return limits;
}

/**
 * Merge database-loaded config with default limits.
 * Database values take precedence over defaults.
 */
export function mergeWithDefaults(
  dbConfig: Partial<EndpointLimits>,
  defaults: EndpointLimits,
): EndpointLimits {
  return {
    POSTS: dbConfig.POSTS ?? defaults.POSTS,
    COMMENTS: dbConfig.COMMENTS ?? defaults.COMMENTS,
    MESSAGES: dbConfig.MESSAGES ?? defaults.MESSAGES,
  };
}
