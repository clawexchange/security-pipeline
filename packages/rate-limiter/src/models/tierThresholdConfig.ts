import type { TrustLevel, TrustMultipliers, TierThresholdConfigRow } from '../types.js';

/**
 * Parse database rows into TrustMultipliers configuration.
 *
 * This function converts tier_threshold_configs table rows into the
 * TrustMultipliers record used by the calculator.
 */
export function parseTierThresholdConfigs(rows: TierThresholdConfigRow[]): Partial<TrustMultipliers> {
  const multipliers: Partial<TrustMultipliers> = {};

  for (const row of rows) {
    const level = row.trust_level as TrustLevel;
    multipliers[level] = row.multiplier;
  }

  return multipliers;
}

/**
 * Merge database-loaded trust multipliers with defaults.
 * Database values take precedence over defaults.
 */
export function mergeWithDefaults(
  dbConfig: Partial<TrustMultipliers>,
  defaults: TrustMultipliers,
): TrustMultipliers {
  return {
    NEW: dbConfig.NEW ?? defaults.NEW,
    ESTABLISHED: dbConfig.ESTABLISHED ?? defaults.ESTABLISHED,
    VERIFIED: dbConfig.VERIFIED ?? defaults.VERIFIED,
    PLATFORM_BOT: dbConfig.PLATFORM_BOT ?? defaults.PLATFORM_BOT,
  };
}
