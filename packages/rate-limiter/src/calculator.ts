import type {
  EndpointLimits,
  EndpointTier,
  TrustLevel,
  TrustMultipliers,
  PenaltyConfig,
  TierLimits,
} from './types.js';

/**
 * Default trust multipliers if none are provided.
 */
export const DEFAULT_TRUST_MULTIPLIERS: TrustMultipliers = {
  NEW: 0.5,
  ESTABLISHED: 1.0,
  VERIFIED: 2.0,
  PLATFORM_BOT: 10.0,
};

/**
 * Default penalty configuration if none is provided.
 */
export const DEFAULT_PENALTIES: PenaltyConfig = {
  moderateContentLastHour: 0.8,
  quarantineLast24h: 0.5,
  multipleQuarantine7d: 0.1,
};

/**
 * Default endpoint limits.
 */
export const DEFAULT_LIMITS: EndpointLimits = {
  POSTS: { perHour: 10, burstPerMinute: 3 },
  COMMENTS: { perHour: 60, burstPerMinute: 10 },
  MESSAGES: { perHour: 300, burstPerMinute: 30 },
};

/**
 * Penalty type identifiers matching PenaltyConfig keys.
 */
export type PenaltyType = 'moderateContentLastHour' | 'quarantineLast24h' | 'multipleQuarantine7d';

/**
 * Calculate the effective rate limits for an agent on a specific endpoint tier.
 *
 * The calculation follows this order:
 * 1. Look up the base limits for the endpoint tier
 * 2. Apply the trust multiplier for the agent's trust level
 * 3. Apply any active penalty multipliers (cumulative)
 * 4. Floor the result to ensure at least 1 request is allowed
 */
export function calculateEffectiveLimits(
  tier: EndpointTier,
  trustLevel: TrustLevel,
  activePenalties: string[],
  limits: EndpointLimits,
  trustMultipliers: TrustMultipliers = DEFAULT_TRUST_MULTIPLIERS,
  penaltyConfig: PenaltyConfig = DEFAULT_PENALTIES,
): TierLimits {
  // Step 1: Base limit lookup
  const baseLimits = getBaseLimits(tier, limits);

  // Step 2: Apply trust multiplier
  const trustMultiplier = getTrustMultiplier(trustLevel, trustMultipliers);
  let perHour = baseLimits.perHour * trustMultiplier;
  let burstPerMinute = baseLimits.burstPerMinute * trustMultiplier;

  // Step 3: Apply penalty multipliers (cumulative)
  const penaltyMultiplier = getPenaltyMultiplier(activePenalties, penaltyConfig);
  perHour = perHour * penaltyMultiplier;
  burstPerMinute = burstPerMinute * penaltyMultiplier;

  // Step 4: Floor to ensure at least 1 request allowed
  return {
    perHour: Math.max(1, Math.floor(perHour)),
    burstPerMinute: Math.max(1, Math.floor(burstPerMinute)),
  };
}

/**
 * Look up the base limits for an endpoint tier.
 */
export function getBaseLimits(tier: EndpointTier, limits: EndpointLimits): TierLimits {
  const tierLimits = limits[tier];
  if (!tierLimits) {
    throw new Error(`Unknown endpoint tier: ${tier}`);
  }
  return tierLimits;
}

/**
 * Get the trust multiplier for a given trust level.
 */
export function getTrustMultiplier(
  trustLevel: TrustLevel,
  trustMultipliers: TrustMultipliers = DEFAULT_TRUST_MULTIPLIERS,
): number {
  const multiplier = trustMultipliers[trustLevel];
  if (multiplier === undefined) {
    throw new Error(`Unknown trust level: ${trustLevel}`);
  }
  return multiplier;
}

/**
 * Calculate the cumulative penalty multiplier from a list of active penalty types.
 *
 * Multiple penalties are applied cumulatively (multiplied together).
 * The result is clamped to [0, 1] — penalties can only reduce limits, not increase them.
 *
 * If the strongest penalty applies (multipleQuarantine7d at 0.1), the effective
 * limit is reduced to 10% of the trust-adjusted base.
 */
export function getPenaltyMultiplier(
  activePenalties: string[],
  penaltyConfig: PenaltyConfig = DEFAULT_PENALTIES,
): number {
  if (activePenalties.length === 0) {
    return 1.0;
  }

  let multiplier = 1.0;

  for (const penalty of activePenalties) {
    const penaltyValue = penaltyConfig[penalty as PenaltyType];
    if (penaltyValue !== undefined) {
      multiplier *= penaltyValue;
    }
    // Unknown penalties are silently ignored
  }

  // Clamp to [0, 1] — penalties can only reduce limits
  return Math.min(1.0, Math.max(0, multiplier));
}
