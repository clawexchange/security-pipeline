import type { ContentEnvelope } from '../plugins/types.js';
import type { InspectionResult, SSGConfig, SSGInstance } from '../types/index.js';
import { loadPlugins } from './pluginLoader.js';
import { runPlugins, aggregateResults } from './pluginRunner.js';
import { mapScoreToTier, DEFAULT_THRESHOLDS } from './tierMapper.js';

/**
 * Creates an SSG (Synchronous Safety Gate) instance from the given configuration.
 * The instance provides Express middleware and a standalone inspect function.
 *
 * @param config - SSG configuration with plugins and optional overrides
 * @returns SSGInstance with middleware() and inspect() methods
 */
export function createSSG(config: SSGConfig): SSGInstance {
  const plugins = loadPlugins(config.plugins);
  const thresholds = config.tierThresholds ?? DEFAULT_THRESHOLDS;
  const quarantine = config.quarantine;
  const audit = config.audit;

  async function inspect(content: ContentEnvelope): Promise<InspectionResult> {
    const pluginResults = await runPlugins(plugins, content);
    const { totalScore, labels, matches } = aggregateResults(pluginResults);
    const { tier, verdict } = mapScoreToTier(totalScore, thresholds);

    const result: InspectionResult = {
      tier,
      verdict,
      labels,
      matches,
      pluginResults,
      timestamp: new Date().toISOString(),
    };

    // If quarantine service is configured and verdict is QUARANTINE, store content
    if (quarantine && verdict === 'QUARANTINE') {
      try {
        await quarantine.store(content.text, {
          tier,
          labels,
          pluginResults: pluginResults.map((pr) => ({
            pluginId: pr.pluginId,
            score: pr.result.score,
            labels: pr.result.labels,
          })),
        });
      } catch {
        // Quarantine failure should not block the request
      }
    }

    // If audit logger is configured, log the inspection
    if (audit) {
      try {
        await audit.log({
          type: 'ssg_inspection',
          tier,
          verdict,
          labels,
          pluginResults: pluginResults.map((pr) => ({
            pluginId: pr.pluginId,
            score: pr.result.score,
            labels: pr.result.labels,
          })),
          timestamp: result.timestamp,
        });
      } catch {
        // Audit failure should not block the request
      }
    }

    return result;
  }

  function middleware() {
    return async (req: unknown, res: unknown, next: unknown) => {
      const reqObj = req as Record<string, unknown>;
      const resObj = res as Record<string, unknown>;
      const nextFn = next as Function;

      const body = reqObj['body'] as Record<string, unknown> | undefined;
      if (!body || typeof body['text'] !== 'string') {
        // No content to inspect — pass through
        nextFn();
        return;
      }

      const envelope: ContentEnvelope = {
        text: body['text'] as string,
        contentType: (body['contentType'] as ContentEnvelope['contentType']) ?? 'POST',
        category: body['category'] as ContentEnvelope['category'],
        metadata: body['metadata'] as ContentEnvelope['metadata'],
      };

      const result = await inspect(envelope);

      // Attach inspection result to the request
      reqObj['ssgResult'] = result;

      // If verdict is BLOCK, reject the request
      if (result.verdict === 'BLOCK') {
        const resFn = resObj['status'] as ((code: number) => { json: (body: unknown) => void }) | undefined;
        if (typeof resFn === 'function') {
          resFn(403).json({
            error: 'Content blocked by security policy',
            tier: result.tier,
          });
          return;
        }
      }

      nextFn();
    };
  }

  return { middleware, inspect };
}
