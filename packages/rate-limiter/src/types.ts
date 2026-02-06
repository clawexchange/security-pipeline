/**
 * Endpoint tier for categorizing API routes by their rate limit requirements.
 */
export type EndpointTier = 'POSTS' | 'COMMENTS' | 'MESSAGES';

/**
 * Trust level assigned to agents based on their verification status and history.
 */
export type TrustLevel = 'NEW' | 'ESTABLISHED' | 'VERIFIED' | 'PLATFORM_BOT';

/**
 * Per-hour and burst-per-minute limits for an endpoint tier.
 */
export interface TierLimits {
  perHour: number;
  burstPerMinute: number;
}

/**
 * Mapping of endpoint tiers to their base limits.
 */
export type EndpointLimits = Record<EndpointTier, TierLimits>;

/**
 * Multipliers for different trust levels. Values > 1 increase limits; < 1 decrease.
 */
export type TrustMultipliers = Record<TrustLevel, number>;

/**
 * Penalty multipliers based on moderation history.
 * All values should be between 0 and 1 (inclusive), where lower means more restrictive.
 */
export interface PenaltyConfig {
  /** Multiplier when agent had moderate-risk content in the last hour */
  moderateContentLastHour: number;
  /** Multiplier when agent had quarantined content in the last 24 hours */
  quarantineLast24h: number;
  /** Multiplier when agent had multiple quarantines in the last 7 days */
  multipleQuarantine7d: number;
}

/**
 * Interface for the Redis client used by the rate limiter.
 * Compatible with ioredis client instances.
 */
export interface RedisClient {
  multi(): RedisPipeline;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zcard(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  quit(): Promise<string>;
}

/**
 * Interface for a Redis pipeline (multi) for atomic operations.
 */
export interface RedisPipeline {
  zremrangebyscore(key: string, min: number | string, max: number | string): RedisPipeline;
  zadd(key: string, score: number, member: string): RedisPipeline;
  zcard(key: string): RedisPipeline;
  expire(key: string, seconds: number): RedisPipeline;
  exec(): Promise<Array<[error: Error | null, result: unknown]> | null>;
}

/**
 * Configuration for creating a rate limiter instance.
 */
export interface RateLimiterConfig {
  redis: RedisClient;
  limits: EndpointLimits;
  trustMultipliers?: TrustMultipliers;
  penalties?: PenaltyConfig;
  /** Redis key prefix. Defaults to 'rl:' */
  keyPrefix?: string;
}

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Current number of requests in the window */
  current: number;
  /** Maximum allowed requests in the window */
  limit: number;
  /** Seconds remaining until the window resets */
  remaining: number;
  /** Seconds to wait before retrying (only set when not allowed) */
  retryAfter: number | null;
}

/**
 * Status information for an agent's rate limits across all endpoint tiers.
 */
export interface AgentRateLimitStatus {
  agentId: string;
  tiers: Record<EndpointTier, {
    hourly: { current: number; limit: number; remaining: number };
    burst: { current: number; limit: number; remaining: number };
  }>;
}

/**
 * Context attached to the request by the rate limiter middleware.
 */
export interface RateLimitContext {
  agentId: string;
  tier: EndpointTier;
  trustLevel: TrustLevel;
  penalties: string[];
}

/**
 * Function to extract rate limit context from an incoming request.
 * Must return the agent ID, endpoint tier, trust level, and any active penalties.
 */
export type ContextExtractor = (req: unknown) => RateLimitContext | null;

/**
 * The rate limiter instance returned by createRateLimiter.
 */
export interface RateLimiter {
  /** Express middleware that enforces rate limits for a given endpoint tier */
  middleware(extractContext: ContextExtractor): (req: unknown, res: unknown, next: unknown) => void;
  /** Check rate limit status without incrementing the counter */
  check(agentId: string, tier: EndpointTier, trustLevel?: TrustLevel, penalties?: string[]): Promise<RateLimitResult>;
  /** Get comprehensive rate limit status for an agent across all tiers */
  getStatus(agentId: string, trustLevel?: TrustLevel, penalties?: string[]): Promise<AgentRateLimitStatus>;
  /** Gracefully close the rate limiter (does not close the Redis client) */
  close(): Promise<void>;
}

/**
 * Database model for rate limit configuration (endpoint tier limits).
 */
export interface RateLimitConfigRow {
  id: number;
  endpoint_tier: EndpointTier;
  per_hour: number;
  burst_per_minute: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database model for tier threshold configuration (trust multipliers).
 */
export interface TierThresholdConfigRow {
  id: number;
  trust_level: TrustLevel;
  multiplier: number;
  created_at: Date;
  updated_at: Date;
}
