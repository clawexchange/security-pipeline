import { describe, it, expect } from 'vitest';
import { loadPlugins } from './pluginLoader.js';
import type { DetectionPlugin } from '../plugins/types.js';

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

describe('pluginLoader', () => {
  describe('loadPlugins', () => {
    it('returns enabled plugins sorted by priority', () => {
      const plugins = [
        makePlugin({ id: 'high', priority: 100 }),
        makePlugin({ id: 'low', priority: 1 }),
        makePlugin({ id: 'mid', priority: 50 }),
      ];
      const loaded = loadPlugins(plugins);
      expect(loaded.map((p) => p.id)).toEqual(['low', 'mid', 'high']);
    });

    it('filters out disabled plugins', () => {
      const plugins = [
        makePlugin({ id: 'enabled', enabled: true }),
        makePlugin({ id: 'disabled', enabled: false }),
      ];
      const loaded = loadPlugins(plugins);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe('enabled');
    });

    it('throws on duplicate plugin ids', () => {
      const plugins = [
        makePlugin({ id: 'dup' }),
        makePlugin({ id: 'dup' }),
      ];
      expect(() => loadPlugins(plugins)).toThrow('Duplicate plugin id: "dup"');
    });

    it('throws on empty plugin id', () => {
      const plugins = [makePlugin({ id: '' })];
      expect(() => loadPlugins(plugins)).toThrow('non-empty string id');
    });

    it('throws on plugin without analyze function', () => {
      const plugins = [{ id: 'bad', priority: 1, enabled: true } as DetectionPlugin];
      expect(() => loadPlugins(plugins)).toThrow('must implement analyze()');
    });

    it('returns empty array for no plugins', () => {
      expect(loadPlugins([])).toEqual([]);
    });

    it('returns empty array when all plugins are disabled', () => {
      const plugins = [
        makePlugin({ id: 'a', enabled: false }),
        makePlugin({ id: 'b', enabled: false }),
      ];
      expect(loadPlugins(plugins)).toEqual([]);
    });
  });
});
