import type { RiskTier, Verdict, TierThreshold } from '../types/index.js';

/** Default tier thresholds used when none are provided in config */
export const DEFAULT_THRESHOLDS: TierThreshold[] = [
  { tier: 'CLEAR',    minScore: 0,  maxScore: 0,    action: 'PASS' },
  { tier: 'LOW',      minScore: 1,  maxScore: 29,   action: 'PASS' },
  { tier: 'MODERATE', minScore: 30, maxScore: 59,   action: 'WARN' },
  { tier: 'HIGH',     minScore: 60, maxScore: 84,   action: 'QUARANTINE' },
  { tier: 'CRITICAL', minScore: 85, maxScore: null,  action: 'BLOCK' },
];

/**
 * Maps an aggregate score to a risk tier and verdict using the provided thresholds.
 *
 * @param score - Aggregate score from all plugins
 * @param thresholds - Tier threshold configuration (defaults to DEFAULT_THRESHOLDS)
 * @returns Object with the matched tier and its action (verdict)
 */
export function mapScoreToTier(
  score: number,
  thresholds: TierThreshold[] = DEFAULT_THRESHOLDS,
): { tier: RiskTier; verdict: Verdict } {
  // Clamp negative scores to 0
  const clamped = Math.max(0, score);

  for (const threshold of thresholds) {
    const matchesMin = clamped >= threshold.minScore;
    const matchesMax = threshold.maxScore === null || clamped <= threshold.maxScore;
    if (matchesMin && matchesMax) {
      return { tier: threshold.tier, verdict: threshold.action };
    }
  }

  // Fallback: if no threshold matched (shouldn't happen with proper config),
  // default to CRITICAL/BLOCK for safety
  return { tier: 'CRITICAL', verdict: 'BLOCK' };
}
