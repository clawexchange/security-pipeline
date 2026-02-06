import type { DetectionPlugin, DetectionResult, DetectionMatch } from '../plugins/types.js';

/** Risk tier assigned based on aggregate detection score */
export type RiskTier = 'CLEAR' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

/** Action the SSG should take for a given risk tier */
export type Verdict = 'PASS' | 'WARN' | 'QUARANTINE' | 'BLOCK';

/**
 * Maps a score range to a risk tier and associated action.
 * Used by the tier mapper to convert raw scores into tiers.
 */
export interface TierThreshold {
  /** The risk tier label */
  tier: RiskTier;
  /** Minimum aggregate score for this tier (inclusive) */
  minScore: number;
  /** Maximum aggregate score for this tier (inclusive), or null for unbounded */
  maxScore: number | null;
  /** Action to take when content falls in this tier */
  action: Verdict;
}

/**
 * Per-plugin result bundled with the plugin ID for traceability.
 */
export interface PluginResult {
  /** ID of the plugin that produced this result */
  pluginId: string;
  /** The detection result from this plugin */
  result: DetectionResult;
}

/**
 * Full inspection result returned by the SSG after running all plugins.
 * Exposes the risk tier and verdict but NOT the raw aggregate score.
 */
export interface InspectionResult {
  /** The assigned risk tier */
  tier: RiskTier;
  /** The action to take based on the tier */
  verdict: Verdict;
  /** Labels aggregated from all plugin results */
  labels: string[];
  /** All detection matches aggregated from all plugins */
  matches: DetectionMatch[];
  /** Per-plugin results for audit purposes */
  pluginResults: PluginResult[];
  /** Timestamp of the inspection */
  timestamp: string;
}

/**
 * Optional quarantine service interface.
 * Implemented by @clawexchange/quarantine package.
 */
export interface QuarantineService {
  /** Store flagged content in quarantine storage */
  store(content: string, metadata: Record<string, unknown>): Promise<string>;
}

/**
 * Optional audit logger interface.
 * Implemented by @clawexchange/audit package.
 */
export interface AuditLogger {
  /** Log an inspection result to the append-only audit trail */
  log(event: Record<string, unknown>): Promise<void>;
}

/**
 * Configuration for creating an SSG instance.
 */
export interface SSGConfig {
  /** Detection plugins to run against incoming content */
  plugins: DetectionPlugin[];
  /** Custom tier thresholds (overrides defaults) */
  tierThresholds?: TierThreshold[];
  /** Optional quarantine service for storing flagged content */
  quarantine?: QuarantineService;
  /** Optional audit logger for recording inspection results */
  audit?: AuditLogger;
}

/**
 * SSG instance returned by createSSG().
 * Provides Express middleware and a standalone inspect function.
 */
export interface SSGInstance {
  /** Returns Express middleware that inspects request bodies */
  middleware(): (req: unknown, res: unknown, next: unknown) => void;
  /**
   * Inspect content directly without Express context.
   * Useful for testing or non-HTTP use cases.
   */
  inspect(content: import('../plugins/types.js').ContentEnvelope): Promise<InspectionResult>;
}
