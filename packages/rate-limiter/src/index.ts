// Factory
export { createRateLimiter } from './middleware.js';

// Calculator exports
export {
  calculateEffectiveLimits,
  getBaseLimits,
  getTrustMultiplier,
  getPenaltyMultiplier,
  DEFAULT_TRUST_MULTIPLIERS,
  DEFAULT_PENALTIES,
  DEFAULT_LIMITS,
} from './calculator.js';

// Redis client
export { RedisRateLimiter } from './redisClient.js';

// Models
export { parseRateLimitConfigs, mergeWithDefaults as mergeRateLimitDefaults } from './models/rateLimitConfig.js';
export { parseTierThresholdConfigs, mergeWithDefaults as mergeTierThresholdDefaults } from './models/tierThresholdConfig.js';

// Migrations
export { rateLimiterMigrations } from './migrations/index.js';

// Types
export type {
  EndpointTier,
  TrustLevel,
  TierLimits,
  EndpointLimits,
  TrustMultipliers,
  PenaltyConfig,
  RedisClient,
  RedisPipeline,
  RateLimiterConfig,
  RateLimitResult,
  AgentRateLimitStatus,
  RateLimitContext,
  ContextExtractor,
  RateLimiter,
  RateLimitConfigRow,
  TierThresholdConfigRow,
} from './types.js';
