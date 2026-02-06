import { describe, it, expect } from 'vitest';
import {
  calculateEffectiveLimits,
  getBaseLimits,
  getTrustMultiplier,
  getPenaltyMultiplier,
  DEFAULT_TRUST_MULTIPLIERS,
  DEFAULT_PENALTIES,
  DEFAULT_LIMITS,
} from './calculator.js';
import type { EndpointLimits, TrustMultipliers, PenaltyConfig } from './types.js';

describe('getBaseLimits', () => {
  it('should return POSTS limits', () => {
    const result = getBaseLimits('POSTS', DEFAULT_LIMITS);
    expect(result).toEqual({ perHour: 10, burstPerMinute: 3 });
  });

  it('should return COMMENTS limits', () => {
    const result = getBaseLimits('COMMENTS', DEFAULT_LIMITS);
    expect(result).toEqual({ perHour: 60, burstPerMinute: 10 });
  });

  it('should return MESSAGES limits', () => {
    const result = getBaseLimits('MESSAGES', DEFAULT_LIMITS);
    expect(result).toEqual({ perHour: 300, burstPerMinute: 30 });
  });

  it('should throw for unknown tier', () => {
    expect(() =>
      getBaseLimits('UNKNOWN' as 'POSTS', DEFAULT_LIMITS),
    ).toThrow('Unknown endpoint tier: UNKNOWN');
  });
});

describe('getTrustMultiplier', () => {
  it('should return 0.5 for NEW agents', () => {
    expect(getTrustMultiplier('NEW')).toBe(0.5);
  });

  it('should return 1.0 for ESTABLISHED agents', () => {
    expect(getTrustMultiplier('ESTABLISHED')).toBe(1.0);
  });

  it('should return 2.0 for VERIFIED agents', () => {
    expect(getTrustMultiplier('VERIFIED')).toBe(2.0);
  });

  it('should return 10.0 for PLATFORM_BOT', () => {
    expect(getTrustMultiplier('PLATFORM_BOT')).toBe(10.0);
  });

  it('should throw for unknown trust level', () => {
    expect(() =>
      getTrustMultiplier('UNKNOWN' as 'NEW'),
    ).toThrow('Unknown trust level: UNKNOWN');
  });

  it('should use custom trust multipliers', () => {
    const custom: TrustMultipliers = {
      NEW: 0.1,
      ESTABLISHED: 0.5,
      VERIFIED: 1.0,
      PLATFORM_BOT: 5.0,
    };
    expect(getTrustMultiplier('NEW', custom)).toBe(0.1);
    expect(getTrustMultiplier('PLATFORM_BOT', custom)).toBe(5.0);
  });
});

describe('getPenaltyMultiplier', () => {
  it('should return 1.0 when no penalties are active', () => {
    expect(getPenaltyMultiplier([])).toBe(1.0);
  });

  it('should apply moderateContentLastHour penalty', () => {
    expect(getPenaltyMultiplier(['moderateContentLastHour'])).toBe(0.8);
  });

  it('should apply quarantineLast24h penalty', () => {
    expect(getPenaltyMultiplier(['quarantineLast24h'])).toBe(0.5);
  });

  it('should apply multipleQuarantine7d penalty', () => {
    expect(getPenaltyMultiplier(['multipleQuarantine7d'])).toBe(0.1);
  });

  it('should apply cumulative penalties', () => {
    const result = getPenaltyMultiplier([
      'moderateContentLastHour',
      'quarantineLast24h',
    ]);
    expect(result).toBeCloseTo(0.4); // 0.8 * 0.5
  });

  it('should apply all penalties cumulatively', () => {
    const result = getPenaltyMultiplier([
      'moderateContentLastHour',
      'quarantineLast24h',
      'multipleQuarantine7d',
    ]);
    expect(result).toBeCloseTo(0.04); // 0.8 * 0.5 * 0.1
  });

  it('should ignore unknown penalty types', () => {
    expect(getPenaltyMultiplier(['unknownPenalty'])).toBe(1.0);
  });

  it('should clamp to [0, 1]', () => {
    // Result of cumulative penalties should never exceed 1.0
    const result = getPenaltyMultiplier(['moderateContentLastHour']);
    expect(result).toBeLessThanOrEqual(1.0);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('should use custom penalty config', () => {
    const custom: PenaltyConfig = {
      moderateContentLastHour: 0.9,
      quarantineLast24h: 0.7,
      multipleQuarantine7d: 0.3,
    };
    expect(getPenaltyMultiplier(['moderateContentLastHour'], custom)).toBe(0.9);
    expect(getPenaltyMultiplier(['quarantineLast24h'], custom)).toBe(0.7);
  });
});

describe('calculateEffectiveLimits', () => {
  it('should calculate limits for NEW agent on POSTS', () => {
    const result = calculateEffectiveLimits(
      'POSTS', 'NEW', [], DEFAULT_LIMITS,
    );
    // Base: 10/hour, 3/min. Trust: 0.5x → 5/hour, 1/min (floored)
    expect(result).toEqual({ perHour: 5, burstPerMinute: 1 });
  });

  it('should calculate limits for ESTABLISHED agent on POSTS', () => {
    const result = calculateEffectiveLimits(
      'POSTS', 'ESTABLISHED', [], DEFAULT_LIMITS,
    );
    // Base: 10/hour, 3/min. Trust: 1.0x → 10/hour, 3/min
    expect(result).toEqual({ perHour: 10, burstPerMinute: 3 });
  });

  it('should calculate limits for VERIFIED agent on COMMENTS', () => {
    const result = calculateEffectiveLimits(
      'COMMENTS', 'VERIFIED', [], DEFAULT_LIMITS,
    );
    // Base: 60/hour, 10/min. Trust: 2.0x → 120/hour, 20/min
    expect(result).toEqual({ perHour: 120, burstPerMinute: 20 });
  });

  it('should calculate limits for PLATFORM_BOT on MESSAGES', () => {
    const result = calculateEffectiveLimits(
      'MESSAGES', 'PLATFORM_BOT', [], DEFAULT_LIMITS,
    );
    // Base: 300/hour, 30/min. Trust: 10.0x → 3000/hour, 300/min
    expect(result).toEqual({ perHour: 3000, burstPerMinute: 300 });
  });

  it('should apply trust and penalty together', () => {
    const result = calculateEffectiveLimits(
      'POSTS', 'VERIFIED', ['quarantineLast24h'], DEFAULT_LIMITS,
    );
    // Base: 10/hour, 3/min. Trust: 2.0x → 20, 6. Penalty: 0.5x → 10, 3
    expect(result).toEqual({ perHour: 10, burstPerMinute: 3 });
  });

  it('should floor limits to minimum of 1', () => {
    const result = calculateEffectiveLimits(
      'POSTS', 'NEW', ['multipleQuarantine7d'], DEFAULT_LIMITS,
    );
    // Base: 10/hour, 3/min. Trust: 0.5x → 5, 1.5. Penalty: 0.1x → 0.5, 0.15 → floored to 1, 1
    expect(result.perHour).toBeGreaterThanOrEqual(1);
    expect(result.burstPerMinute).toBeGreaterThanOrEqual(1);
  });

  it('should handle multiple cumulative penalties', () => {
    const result = calculateEffectiveLimits(
      'COMMENTS', 'ESTABLISHED',
      ['moderateContentLastHour', 'quarantineLast24h'],
      DEFAULT_LIMITS,
    );
    // Base: 60/hour, 10/min. Trust: 1.0x → 60, 10. Penalty: 0.8 * 0.5 = 0.4x → 24, 4
    expect(result).toEqual({ perHour: 24, burstPerMinute: 4 });
  });

  it('should use custom limits', () => {
    const customLimits: EndpointLimits = {
      POSTS: { perHour: 20, burstPerMinute: 5 },
      COMMENTS: { perHour: 100, burstPerMinute: 20 },
      MESSAGES: { perHour: 500, burstPerMinute: 50 },
    };
    const result = calculateEffectiveLimits(
      'POSTS', 'ESTABLISHED', [], customLimits,
    );
    expect(result).toEqual({ perHour: 20, burstPerMinute: 5 });
  });

  it('should use custom trust multipliers', () => {
    const customTrust: TrustMultipliers = {
      NEW: 0.25,
      ESTABLISHED: 1.0,
      VERIFIED: 3.0,
      PLATFORM_BOT: 20.0,
    };
    const result = calculateEffectiveLimits(
      'POSTS', 'NEW', [], DEFAULT_LIMITS, customTrust,
    );
    // Base: 10/hour, 3/min. Trust: 0.25x → 2, 0.75 → floored to 2, 1
    expect(result).toEqual({ perHour: 2, burstPerMinute: 1 });
  });
});

describe('DEFAULT_TRUST_MULTIPLIERS', () => {
  it('should have all trust levels defined', () => {
    expect(DEFAULT_TRUST_MULTIPLIERS).toHaveProperty('NEW');
    expect(DEFAULT_TRUST_MULTIPLIERS).toHaveProperty('ESTABLISHED');
    expect(DEFAULT_TRUST_MULTIPLIERS).toHaveProperty('VERIFIED');
    expect(DEFAULT_TRUST_MULTIPLIERS).toHaveProperty('PLATFORM_BOT');
  });

  it('should have increasing multipliers', () => {
    expect(DEFAULT_TRUST_MULTIPLIERS.NEW).toBeLessThan(DEFAULT_TRUST_MULTIPLIERS.ESTABLISHED);
    expect(DEFAULT_TRUST_MULTIPLIERS.ESTABLISHED).toBeLessThan(DEFAULT_TRUST_MULTIPLIERS.VERIFIED);
    expect(DEFAULT_TRUST_MULTIPLIERS.VERIFIED).toBeLessThan(DEFAULT_TRUST_MULTIPLIERS.PLATFORM_BOT);
  });
});

describe('DEFAULT_PENALTIES', () => {
  it('should have all penalty types defined', () => {
    expect(DEFAULT_PENALTIES).toHaveProperty('moderateContentLastHour');
    expect(DEFAULT_PENALTIES).toHaveProperty('quarantineLast24h');
    expect(DEFAULT_PENALTIES).toHaveProperty('multipleQuarantine7d');
  });

  it('should have penalties in (0, 1] range', () => {
    expect(DEFAULT_PENALTIES.moderateContentLastHour).toBeGreaterThan(0);
    expect(DEFAULT_PENALTIES.moderateContentLastHour).toBeLessThanOrEqual(1);
    expect(DEFAULT_PENALTIES.quarantineLast24h).toBeGreaterThan(0);
    expect(DEFAULT_PENALTIES.quarantineLast24h).toBeLessThanOrEqual(1);
    expect(DEFAULT_PENALTIES.multipleQuarantine7d).toBeGreaterThan(0);
    expect(DEFAULT_PENALTIES.multipleQuarantine7d).toBeLessThanOrEqual(1);
  });

  it('should have increasing severity', () => {
    expect(DEFAULT_PENALTIES.moderateContentLastHour).toBeGreaterThan(DEFAULT_PENALTIES.quarantineLast24h);
    expect(DEFAULT_PENALTIES.quarantineLast24h).toBeGreaterThan(DEFAULT_PENALTIES.multipleQuarantine7d);
  });
});

describe('DEFAULT_LIMITS', () => {
  it('should have all endpoint tiers defined', () => {
    expect(DEFAULT_LIMITS).toHaveProperty('POSTS');
    expect(DEFAULT_LIMITS).toHaveProperty('COMMENTS');
    expect(DEFAULT_LIMITS).toHaveProperty('MESSAGES');
  });

  it('should have POSTS as most restrictive', () => {
    expect(DEFAULT_LIMITS.POSTS.perHour).toBeLessThan(DEFAULT_LIMITS.COMMENTS.perHour);
    expect(DEFAULT_LIMITS.COMMENTS.perHour).toBeLessThan(DEFAULT_LIMITS.MESSAGES.perHour);
  });
});
