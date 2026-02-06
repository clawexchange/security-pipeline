import type { DetectionPlugin, ContentEnvelope, DetectionResult } from '../plugins/types.js';
import type { PluginResult } from '../types/index.js';

/**
 * Runs all plugins in parallel against the given content envelope.
 * Each plugin's result is wrapped with its plugin ID for traceability.
 * If a plugin throws, it is caught and recorded as a zero-score result
 * with an error label, ensuring one failing plugin doesn't block others.
 *
 * @param plugins - Sorted, enabled plugins to run
 * @param content - Content envelope to analyze
 * @returns Array of per-plugin results
 */
export async function runPlugins(
  plugins: DetectionPlugin[],
  content: ContentEnvelope,
): Promise<PluginResult[]> {
  const tasks = plugins.map(async (plugin): Promise<PluginResult> => {
    try {
      const result = await plugin.analyze(content);
      return { pluginId: plugin.id, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failResult: DetectionResult = {
        score: 0,
        labels: [`PLUGIN_ERROR:${plugin.id}`],
        matches: [],
        summary: { error: message },
      };
      return { pluginId: plugin.id, result: failResult };
    }
  });

  return Promise.all(tasks);
}

/**
 * Aggregates plugin results into a total score and combined labels/matches.
 *
 * @param pluginResults - Array of per-plugin results
 * @returns Aggregated score, labels, and matches
 */
export function aggregateResults(pluginResults: PluginResult[]) {
  let totalScore = 0;
  const labels: string[] = [];
  const matches: Array<{ patternId: string; start: number; end: number; redacted: string }> = [];

  for (const { result } of pluginResults) {
    totalScore += result.score;
    labels.push(...result.labels);
    matches.push(...result.matches);
  }

  return { totalScore, labels, matches };
}
