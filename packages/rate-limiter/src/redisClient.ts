import type { RedisClient, RateLimitResult } from './types.js';

/**
 * Default Redis key prefix for rate limiter keys.
 */
const DEFAULT_PREFIX = 'rl:';

/**
 * Sliding window rate limiter operations using Redis sorted sets.
 *
 * Each request is stored as a member in a sorted set with the timestamp as the score.
 * The window is defined by removing entries older than the window start time,
 * then counting remaining entries.
 */
export class RedisRateLimiter {
  private readonly redis: RedisClient;
  private readonly prefix: string;

  constructor(redis: RedisClient, prefix: string = DEFAULT_PREFIX) {
    this.redis = redis;
    this.prefix = prefix;
  }

  /**
   * Build the Redis key for a specific agent, tier, and window type.
   */
  private buildKey(agentId: string, tier: string, window: 'hour' | 'minute'): string {
    return `${this.prefix}${agentId}:${tier}:${window}`;
  }

  /**
   * Perform a sliding window rate limit check and increment.
   *
   * Uses a Redis MULTI pipeline for atomicity:
   * 1. Remove expired entries (outside the window)
   * 2. Add the current request
   * 3. Count entries in the window
   * 4. Set TTL on the key
   *
   * @returns The number of requests in the current window after this request.
   */
  async slidingWindowIncrement(
    agentId: string,
    tier: string,
    window: 'hour' | 'minute',
  ): Promise<number> {
    const key = this.buildKey(agentId, tier, window);
    const now = Date.now();
    const windowMs = window === 'hour' ? 3600_000 : 60_000;
    const windowStart = now - windowMs;
    const ttlSeconds = window === 'hour' ? 3600 : 60;

    const pipeline = this.redis.multi();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 10)}`);
    pipeline.zcard(key);
    pipeline.expire(key, ttlSeconds);

    const results = await pipeline.exec();
    if (!results) {
      throw new Error('Redis pipeline returned null');
    }

    // zcard is the 3rd command (index 2)
    const [err, count] = results[2]!;
    if (err) {
      throw err;
    }

    return count as number;
  }

  /**
   * Get the current count of requests in a sliding window WITHOUT incrementing.
   */
  async slidingWindowCount(
    agentId: string,
    tier: string,
    window: 'hour' | 'minute',
  ): Promise<number> {
    const key = this.buildKey(agentId, tier, window);
    const now = Date.now();
    const windowMs = window === 'hour' ? 3600_000 : 60_000;
    const windowStart = now - windowMs;

    // Get only entries within the current window
    const entries = await this.redis.zrangebyscore(key, windowStart, now);
    return entries.length;
  }

  /**
   * Perform a full rate limit check against both hourly and burst windows.
   *
   * Checks the burst (per-minute) limit first, then the hourly limit.
   * If either limit is exceeded, the request is denied.
   *
   * @returns RateLimitResult with allowed status and metadata.
   */
  async checkAndIncrement(
    agentId: string,
    tier: string,
    hourlyLimit: number,
    burstLimit: number,
  ): Promise<RateLimitResult> {
    // Check burst window first (more granular, likely to hit first)
    const burstCount = await this.slidingWindowIncrement(agentId, tier, 'minute');

    if (burstCount > burstLimit) {
      // Burst limit exceeded — calculate retry-after based on minute window
      const retryAfter = 60; // Max wait is 1 minute for burst window reset
      return {
        allowed: false,
        current: burstCount,
        limit: burstLimit,
        remaining: 0,
        retryAfter,
      };
    }

    // Check hourly window
    const hourlyCount = await this.slidingWindowIncrement(agentId, tier, 'hour');

    if (hourlyCount > hourlyLimit) {
      // Hourly limit exceeded — calculate retry-after
      const retryAfter = Math.ceil(3600 / hourlyLimit); // Approximate time until a slot frees
      return {
        allowed: false,
        current: hourlyCount,
        limit: hourlyLimit,
        remaining: 0,
        retryAfter,
      };
    }

    return {
      allowed: true,
      current: hourlyCount,
      limit: hourlyLimit,
      remaining: hourlyLimit - hourlyCount,
      retryAfter: null,
    };
  }
}
