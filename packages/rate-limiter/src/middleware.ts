import type {
  RateLimiterConfig,
  RateLimiter,
  RateLimitResult,
  AgentRateLimitStatus,
  ContextExtractor,
  EndpointTier,
  TrustLevel,
} from './types.js';
import { RedisRateLimiter } from './redisClient.js';
import {
  calculateEffectiveLimits,
  DEFAULT_TRUST_MULTIPLIERS,
  DEFAULT_PENALTIES,
} from './calculator.js';

const ENDPOINT_TIERS: EndpointTier[] = ['POSTS', 'COMMENTS', 'MESSAGES'];

/**
 * Create a rate limiter instance with the given configuration.
 *
 * The rate limiter provides:
 * - Express middleware that enforces per-agent, per-tier rate limits
 * - A check() method for programmatic rate limit queries
 * - A getStatus() handler for returning agent rate limit status
 *
 * @example
 * ```typescript
 * const limiter = createRateLimiter({
 *   redis: redisClient,
 *   limits: {
 *     POSTS: { perHour: 10, burstPerMinute: 3 },
 *     COMMENTS: { perHour: 60, burstPerMinute: 10 },
 *     MESSAGES: { perHour: 300, burstPerMinute: 30 },
 *   },
 *   trustMultipliers: {
 *     NEW: 0.5,
 *     ESTABLISHED: 1.0,
 *     VERIFIED: 2.0,
 *     PLATFORM_BOT: 10.0,
 *   },
 * });
 *
 * app.use('/api/posts', limiter.middleware(extractContext));
 * ```
 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const redisLimiter = new RedisRateLimiter(config.redis, config.keyPrefix);
  const trustMultipliers = config.trustMultipliers ?? DEFAULT_TRUST_MULTIPLIERS;
  const penaltyConfig = config.penalties ?? DEFAULT_PENALTIES;

  async function check(
    agentId: string,
    tier: EndpointTier,
    trustLevel: TrustLevel = 'NEW',
    penalties: string[] = [],
  ): Promise<RateLimitResult> {
    const effective = calculateEffectiveLimits(
      tier,
      trustLevel,
      penalties,
      config.limits,
      trustMultipliers,
      penaltyConfig,
    );

    return redisLimiter.checkAndIncrement(
      agentId,
      tier,
      effective.perHour,
      effective.burstPerMinute,
    );
  }

  async function getStatus(
    agentId: string,
    trustLevel: TrustLevel = 'NEW',
    penalties: string[] = [],
  ): Promise<AgentRateLimitStatus> {
    const tiers = {} as AgentRateLimitStatus['tiers'];

    for (const tier of ENDPOINT_TIERS) {
      const effective = calculateEffectiveLimits(
        tier,
        trustLevel,
        penalties,
        config.limits,
        trustMultipliers,
        penaltyConfig,
      );

      // Read current counts without incrementing
      const hourlyCount = await redisLimiter.slidingWindowCount(agentId, tier, 'hour');
      const burstCount = await redisLimiter.slidingWindowCount(agentId, tier, 'minute');

      tiers[tier] = {
        hourly: {
          current: hourlyCount,
          limit: effective.perHour,
          remaining: Math.max(0, effective.perHour - hourlyCount),
        },
        burst: {
          current: burstCount,
          limit: effective.burstPerMinute,
          remaining: Math.max(0, effective.burstPerMinute - burstCount),
        },
      };
    }

    return { agentId, tiers };
  }

  function middleware(extractContext: ContextExtractor) {
    return async (req: unknown, res: unknown, next: unknown) => {
      const resObj = res as Record<string, unknown>;
      const nextFn = next as () => void;

      const context = extractContext(req);

      // If no context can be extracted, pass through
      if (!context) {
        nextFn();
        return;
      }

      const { agentId, tier, trustLevel, penalties: activePenalties } = context;

      const result = await check(agentId, tier, trustLevel, activePenalties);

      // Set rate limit headers on every response
      const setHeader = resObj['set'] as ((name: string, value: string) => void) | undefined;
      if (typeof setHeader === 'function') {
        setHeader('X-RateLimit-Limit', String(result.limit));
        setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
        setHeader('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + (result.retryAfter ?? 3600)));
      }

      if (!result.allowed) {
        // Set Retry-After header
        if (typeof setHeader === 'function' && result.retryAfter !== null) {
          setHeader('Retry-After', String(result.retryAfter));
        }

        const statusFn = resObj['status'] as ((code: number) => { json: (body: unknown) => void }) | undefined;
        if (typeof statusFn === 'function') {
          statusFn(429).json({
            error: 'Rate limit exceeded',
            retryAfter: result.retryAfter,
            limit: result.limit,
            current: result.current,
          });
          return;
        }
      }

      // Attach rate limit info to request for downstream use
      const reqObj = req as Record<string, unknown>;
      reqObj['rateLimitResult'] = result;

      nextFn();
    };
  }

  async function close(): Promise<void> {
    // No cleanup needed — we don't own the Redis client
  }

  return { middleware, check, getStatus, close };
}
