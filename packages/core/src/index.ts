// Plugin types
export type {
  DetectionPlugin,
  ContentEnvelope,
  DetectionResult,
  DetectionMatch,
} from './plugins/types.js';

// Shared types
export type {
  RiskTier,
  Verdict,
  TierThreshold,
  PluginResult,
  InspectionResult,
  QuarantineService,
  AuditLogger,
  SSGConfig,
  SSGInstance,
} from './types/index.js';

// SSG implementation
export { createSSG } from './ssg/index.js';
export { loadPlugins } from './ssg/index.js';
export { runPlugins, aggregateResults } from './ssg/index.js';
export { mapScoreToTier, DEFAULT_THRESHOLDS } from './ssg/index.js';
