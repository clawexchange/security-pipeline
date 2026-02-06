import { describe, it, expect } from 'vitest';
import { runPlugins, aggregateResults } from './pluginRunner.js';
import type { DetectionPlugin, ContentEnvelope, DetectionResult } from '../plugins/types.js';

function makePlugin(overrides: Partial<DetectionPlugin> & { id: string }): DetectionPlugin {
  return {
    priority: 10,
    enabled: true,
    analyze: async () => ({
      score: 0,
      labels: [],
      matches: [],
      summary: {},
    }),
    ...overrides,
  };
}

const sampleEnvelope: ContentEnvelope = {
  text: 'Hello world',
  contentType: 'POST',
  category: 'SUPPLY',
};

describe('pluginRunner', () => {
  describe('runPlugins', () => {
    it('runs all plugins and returns results', async () => {
      const plugin1 = makePlugin({
        id: 'p1',
        analyze: async () => ({
          score: 10,
          labels: ['LABEL_A'],
          matches: [],
          summary: {},
        }),
      });
      const plugin2 = makePlugin({
        id: 'p2',
        analyze: async () => ({
          score: 20,
          labels: ['LABEL_B'],
          matches: [],
          summary: {},
        }),
      });

      const results = await runPlugins([plugin1, plugin2], sampleEnvelope);
      expect(results).toHaveLength(2);
      expect(results[0]!.pluginId).toBe('p1');
      expect(results[0]!.result.score).toBe(10);
      expect(results[1]!.pluginId).toBe('p2');
      expect(results[1]!.result.score).toBe(20);
    });

    it('runs plugins in parallel', async () => {
      const order: string[] = [];
      const plugin1 = makePlugin({
        id: 'slow',
        analyze: async () => {
          await new Promise((r) => setTimeout(r, 50));
          order.push('slow');
          return { score: 0, labels: [], matches: [], summary: {} };
        },
      });
      const plugin2 = makePlugin({
        id: 'fast',
        analyze: async () => {
          order.push('fast');
          return { score: 0, labels: [], matches: [], summary: {} };
        },
      });

      await runPlugins([plugin1, plugin2], sampleEnvelope);
      // Fast should finish before slow since they run in parallel
      expect(order[0]).toBe('fast');
      expect(order[1]).toBe('slow');
    });

    it('handles plugin errors gracefully', async () => {
      const failingPlugin = makePlugin({
        id: 'failing',
        analyze: async () => {
          throw new Error('Plugin crashed');
        },
      });

      const results = await runPlugins([failingPlugin], sampleEnvelope);
      expect(results).toHaveLength(1);
      expect(results[0]!.pluginId).toBe('failing');
      expect(results[0]!.result.score).toBe(0);
      expect(results[0]!.result.labels).toContain('PLUGIN_ERROR:failing');
      expect(results[0]!.result.summary).toHaveProperty('error', 'Plugin crashed');
    });

    it('returns empty array for no plugins', async () => {
      const results = await runPlugins([], sampleEnvelope);
      expect(results).toEqual([]);
    });

    it('passes content envelope to each plugin', async () => {
      const receivedEnvelopes: ContentEnvelope[] = [];
      const plugin = makePlugin({
        id: 'inspector',
        analyze: async (content) => {
          receivedEnvelopes.push(content);
          return { score: 0, labels: [], matches: [], summary: {} };
        },
      });

      await runPlugins([plugin], sampleEnvelope);
      expect(receivedEnvelopes).toHaveLength(1);
      expect(receivedEnvelopes[0]).toBe(sampleEnvelope);
    });
  });

  describe('aggregateResults', () => {
    it('sums scores from all plugins', () => {
      const pluginResults = [
        { pluginId: 'p1', result: { score: 10, labels: [], matches: [], summary: {} } },
        { pluginId: 'p2', result: { score: 25, labels: [], matches: [], summary: {} } },
      ];
      const { totalScore } = aggregateResults(pluginResults);
      expect(totalScore).toBe(35);
    });

    it('combines labels from all plugins', () => {
      const pluginResults = [
        { pluginId: 'p1', result: { score: 0, labels: ['A', 'B'], matches: [], summary: {} } },
        { pluginId: 'p2', result: { score: 0, labels: ['C'], matches: [], summary: {} } },
      ];
      const { labels } = aggregateResults(pluginResults);
      expect(labels).toEqual(['A', 'B', 'C']);
    });

    it('combines matches from all plugins', () => {
      const match1 = { patternId: 'p1', start: 0, end: 5, redacted: '***' };
      const match2 = { patternId: 'p2', start: 10, end: 15, redacted: '***' };
      const pluginResults = [
        { pluginId: 'p1', result: { score: 0, labels: [], matches: [match1], summary: {} } },
        { pluginId: 'p2', result: { score: 0, labels: [], matches: [match2], summary: {} } },
      ];
      const { matches } = aggregateResults(pluginResults);
      expect(matches).toHaveLength(2);
      expect(matches).toEqual([match1, match2]);
    });

    it('returns zero score for empty results', () => {
      const { totalScore, labels, matches } = aggregateResults([]);
      expect(totalScore).toBe(0);
      expect(labels).toEqual([]);
      expect(matches).toEqual([]);
    });
  });
});
