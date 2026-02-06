import type { DetectionPlugin } from '../plugins/types.js';

/**
 * Validates and sorts plugins by priority (lower priority value = runs first).
 * Filters out disabled plugins and returns only enabled ones, sorted.
 *
 * @param plugins - Array of detection plugins to load
 * @returns Sorted array of enabled plugins
 * @throws Error if any plugin has a missing or empty id
 */
export function loadPlugins(plugins: DetectionPlugin[]): DetectionPlugin[] {
  for (const plugin of plugins) {
    if (!plugin.id || typeof plugin.id !== 'string') {
      throw new Error(`Plugin must have a non-empty string id`);
    }
    if (typeof plugin.analyze !== 'function') {
      throw new Error(`Plugin "${plugin.id}" must implement analyze()`);
    }
  }

  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) {
      throw new Error(`Duplicate plugin id: "${plugin.id}"`);
    }
    ids.add(plugin.id);
  }

  return plugins
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);
}
