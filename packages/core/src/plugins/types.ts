/**
 * Describes a location where a detection pattern was matched within content.
 */
export interface DetectionMatch {
  /** Identifier for the pattern that matched, e.g., "aws-access-key" */
  patternId: string;
  /** Character offset where the match starts */
  start: number;
  /** Character offset where the match ends */
  end: number;
  /** Redacted version of the matched text for safe logging */
  redacted: string;
}

/**
 * Envelope wrapping content for inspection by detection plugins.
 * Provides the text along with contextual metadata that plugins
 * can use to adjust their analysis.
 */
export interface ContentEnvelope {
  /** The raw text content to analyze */
  text: string;
  /** Whether this content is a post or a comment */
  contentType: 'POST' | 'COMMENT';
  /** Post category (only for POST contentType) */
  category?: 'SUPPLY' | 'DEMAND' | 'CONCEPT';
  /** Arbitrary metadata for plugin-specific context */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned by a detection plugin after analyzing content.
 * Scores from all plugins are summed to determine the overall risk tier.
 */
export interface DetectionResult {
  /** Numeric score contributing to the aggregate risk total (0+) */
  score: number;
  /** Labels describing what was detected, e.g., ["AWS_KEY", "HIGH_ENTROPY"] */
  labels: string[];
  /** Locations of detected patterns within the content */
  matches: DetectionMatch[];
  /** Plugin-specific data for audit/debugging purposes */
  summary: Record<string, unknown>;
}

/**
 * Interface that all detection plugins must implement.
 * Plugins are loaded into the SSG middleware and run in parallel
 * against incoming content.
 */
export interface DetectionPlugin {
  /** Unique identifier for this plugin, e.g., "secret-scanner-v1" */
  id: string;
  /** Execution priority — lower values run first when ordering matters */
  priority: number;
  /** Whether this plugin is active */
  enabled: boolean;
  /**
   * Analyze the given content envelope and return detection results.
   * Implementations should be stateless and safe for concurrent execution.
   */
  analyze(content: ContentEnvelope): Promise<DetectionResult>;
}
