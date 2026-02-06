import { describe, it, expect } from 'vitest';
import { mapScoreToTier, DEFAULT_THRESHOLDS } from './tierMapper.js';

describe('tierMapper', () => {
  describe('mapScoreToTier with default thresholds', () => {
    it('maps score 0 to CLEAR/PASS', () => {
      const result = mapScoreToTier(0);
      expect(result.tier).toBe('CLEAR');
      expect(result.verdict).toBe('PASS');
    });

    it('maps score 1 to LOW/PASS', () => {
      const result = mapScoreToTier(1);
      expect(result.tier).toBe('LOW');
      expect(result.verdict).toBe('PASS');
    });

    it('maps score 15 to LOW/PASS', () => {
      const result = mapScoreToTier(15);
      expect(result.tier).toBe('LOW');
      expect(result.verdict).toBe('PASS');
    });

    it('maps score 29 to LOW/PASS', () => {
      const result = mapScoreToTier(29);
      expect(result.tier).toBe('LOW');
      expect(result.verdict).toBe('PASS');
    });

    it('maps score 30 to MODERATE/WARN', () => {
      const result = mapScoreToTier(30);
      expect(result.tier).toBe('MODERATE');
      expect(result.verdict).toBe('WARN');
    });

    it('maps score 45 to MODERATE/WARN', () => {
      const result = mapScoreToTier(45);
      expect(result.tier).toBe('MODERATE');
      expect(result.verdict).toBe('WARN');
    });

    it('maps score 59 to MODERATE/WARN', () => {
      const result = mapScoreToTier(59);
      expect(result.tier).toBe('MODERATE');
      expect(result.verdict).toBe('WARN');
    });

    it('maps score 60 to HIGH/QUARANTINE', () => {
      const result = mapScoreToTier(60);
      expect(result.tier).toBe('HIGH');
      expect(result.verdict).toBe('QUARANTINE');
    });

    it('maps score 84 to HIGH/QUARANTINE', () => {
      const result = mapScoreToTier(84);
      expect(result.tier).toBe('HIGH');
      expect(result.verdict).toBe('QUARANTINE');
    });

    it('maps score 85 to CRITICAL/BLOCK', () => {
      const result = mapScoreToTier(85);
      expect(result.tier).toBe('CRITICAL');
      expect(result.verdict).toBe('BLOCK');
    });

    it('maps score 100 to CRITICAL/BLOCK', () => {
      const result = mapScoreToTier(100);
      expect(result.tier).toBe('CRITICAL');
      expect(result.verdict).toBe('BLOCK');
    });

    it('maps score 500 to CRITICAL/BLOCK', () => {
      const result = mapScoreToTier(500);
      expect(result.tier).toBe('CRITICAL');
      expect(result.verdict).toBe('BLOCK');
    });

    it('clamps negative scores to 0 (CLEAR)', () => {
      const result = mapScoreToTier(-10);
      expect(result.tier).toBe('CLEAR');
      expect(result.verdict).toBe('PASS');
    });
  });

  describe('mapScoreToTier with custom thresholds', () => {
    const customThresholds = [
      { tier: 'CLEAR' as const, minScore: 0, maxScore: 0, action: 'PASS' as const },
      { tier: 'LOW' as const, minScore: 1, maxScore: 49, action: 'PASS' as const },
      { tier: 'HIGH' as const, minScore: 50, maxScore: null, action: 'BLOCK' as const },
    ];

    it('uses custom thresholds', () => {
      expect(mapScoreToTier(0, customThresholds).tier).toBe('CLEAR');
      expect(mapScoreToTier(25, customThresholds).tier).toBe('LOW');
      expect(mapScoreToTier(50, customThresholds).tier).toBe('HIGH');
      expect(mapScoreToTier(50, customThresholds).verdict).toBe('BLOCK');
    });
  });

  describe('DEFAULT_THRESHOLDS', () => {
    it('has 5 tiers', () => {
      expect(DEFAULT_THRESHOLDS).toHaveLength(5);
    });

    it('covers all risk tiers', () => {
      const tiers = DEFAULT_THRESHOLDS.map((t) => t.tier);
      expect(tiers).toEqual(['CLEAR', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
    });

    it('only CRITICAL has null maxScore', () => {
      const unbounded = DEFAULT_THRESHOLDS.filter((t) => t.maxScore === null);
      expect(unbounded).toHaveLength(1);
      expect(unbounded[0]!.tier).toBe('CRITICAL');
    });
  });
});
