import { describe, it, expect, vi } from 'vitest';
import { createSSG } from './middleware.js';
import type { DetectionPlugin, ContentEnvelope } from '../plugins/types.js';

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

describe('createSSG', () => {
  describe('inspect()', () => {
    it('returns CLEAR for clean content', async () => {
      const ssg = createSSG({
        plugins: [makePlugin({ id: 'noop' })],
      });

      const result = await ssg.inspect({
        text: 'Hello world',
        contentType: 'POST',
      });

      expect(result.tier).toBe('CLEAR');
      expect(result.verdict).toBe('PASS');
      expect(result.labels).toEqual([]);
      expect(result.matches).toEqual([]);
      expect(result.timestamp).toBeDefined();
    });

    it('returns HIGH tier for high-scoring content', async () => {
      const dangerPlugin = makePlugin({
        id: 'danger',
        analyze: async () => ({
          score: 70,
          labels: ['DANGEROUS'],
          matches: [{ patternId: 'test', start: 0, end: 5, redacted: '***' }],
          summary: {},
        }),
      });

      const ssg = createSSG({ plugins: [dangerPlugin] });
      const result = await ssg.inspect({
        text: 'dangerous content',
        contentType: 'POST',
      });

      expect(result.tier).toBe('HIGH');
      expect(result.verdict).toBe('QUARANTINE');
      expect(result.labels).toEqual(['DANGEROUS']);
      expect(result.matches).toHaveLength(1);
    });

    it('aggregates scores from multiple plugins', async () => {
      const p1 = makePlugin({
        id: 'p1',
        analyze: async () => ({
          score: 20,
          labels: ['A'],
          matches: [],
          summary: {},
        }),
      });
      const p2 = makePlugin({
        id: 'p2',
        analyze: async () => ({
          score: 25,
          labels: ['B'],
          matches: [],
          summary: {},
        }),
      });

      const ssg = createSSG({ plugins: [p1, p2] });
      const result = await ssg.inspect({
        text: 'test',
        contentType: 'POST',
      });

      // 20 + 25 = 45 → MODERATE
      expect(result.tier).toBe('MODERATE');
      expect(result.verdict).toBe('WARN');
      expect(result.labels).toEqual(['A', 'B']);
    });

    it('uses custom tier thresholds when provided', async () => {
      const plugin = makePlugin({
        id: 'scorer',
        analyze: async () => ({
          score: 10,
          labels: ['FOUND'],
          matches: [],
          summary: {},
        }),
      });

      const ssg = createSSG({
        plugins: [plugin],
        tierThresholds: [
          { tier: 'CLEAR', minScore: 0, maxScore: 0, action: 'PASS' },
          { tier: 'CRITICAL', minScore: 1, maxScore: null, action: 'BLOCK' },
        ],
      });

      const result = await ssg.inspect({
        text: 'test',
        contentType: 'POST',
      });

      expect(result.tier).toBe('CRITICAL');
      expect(result.verdict).toBe('BLOCK');
    });

    it('includes per-plugin results', async () => {
      const p1 = makePlugin({
        id: 'plugin-a',
        analyze: async () => ({
          score: 5,
          labels: ['X'],
          matches: [],
          summary: { detail: 'found X' },
        }),
      });

      const ssg = createSSG({ plugins: [p1] });
      const result = await ssg.inspect({
        text: 'test',
        contentType: 'POST',
      });

      expect(result.pluginResults).toHaveLength(1);
      expect(result.pluginResults[0]!.pluginId).toBe('plugin-a');
      expect(result.pluginResults[0]!.result.score).toBe(5);
    });

    it('calls quarantine service when verdict is QUARANTINE', async () => {
      const storeFn = vi.fn().mockResolvedValue('qid-123');
      const plugin = makePlugin({
        id: 'high-scorer',
        analyze: async () => ({
          score: 70,
          labels: ['BAD'],
          matches: [],
          summary: {},
        }),
      });

      const ssg = createSSG({
        plugins: [plugin],
        quarantine: { store: storeFn },
      });

      await ssg.inspect({ text: 'bad content', contentType: 'POST' });
      expect(storeFn).toHaveBeenCalledOnce();
      expect(storeFn.mock.calls[0]![0]).toBe('bad content');
    });

    it('calls audit logger when configured', async () => {
      const logFn = vi.fn().mockResolvedValue(undefined);
      const plugin = makePlugin({ id: 'noop' });

      const ssg = createSSG({
        plugins: [plugin],
        audit: { log: logFn },
      });

      await ssg.inspect({ text: 'hello', contentType: 'POST' });
      expect(logFn).toHaveBeenCalledOnce();
      expect(logFn.mock.calls[0]![0]).toHaveProperty('type', 'ssg_inspection');
    });
  });

  describe('middleware()', () => {
    it('calls next for content with no text field', async () => {
      const ssg = createSSG({ plugins: [makePlugin({ id: 'noop' })] });
      const mw = ssg.middleware();

      const req: Record<string, unknown> = { body: {} };
      const res: Record<string, unknown> = {};
      const next = vi.fn();

      await mw(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(req['ssgResult']).toBeUndefined();
    });

    it('attaches ssgResult to request', async () => {
      const ssg = createSSG({ plugins: [makePlugin({ id: 'noop' })] });
      const mw = ssg.middleware();

      const req: Record<string, unknown> = {
        body: { text: 'hello world', contentType: 'POST' },
      };
      const res: Record<string, unknown> = {};
      const next = vi.fn();

      await mw(req, res, next);
      expect(req['ssgResult']).toBeDefined();
      expect((req['ssgResult'] as { tier: string }).tier).toBe('CLEAR');
      expect(next).toHaveBeenCalledOnce();
    });

    it('blocks request with 403 when verdict is BLOCK', async () => {
      const blockPlugin = makePlugin({
        id: 'blocker',
        analyze: async () => ({
          score: 100,
          labels: ['BLOCKED'],
          matches: [],
          summary: {},
        }),
      });

      const ssg = createSSG({ plugins: [blockPlugin] });
      const mw = ssg.middleware();

      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const req: Record<string, unknown> = {
        body: { text: 'evil content' },
      };
      const res: Record<string, unknown> = { status: statusFn };
      const next = vi.fn();

      await mw(req, res, next);

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'Content blocked by security policy',
        tier: 'CRITICAL',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes through when body is undefined', async () => {
      const ssg = createSSG({ plugins: [makePlugin({ id: 'noop' })] });
      const mw = ssg.middleware();

      const req: Record<string, unknown> = {};
      const res: Record<string, unknown> = {};
      const next = vi.fn();

      await mw(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
