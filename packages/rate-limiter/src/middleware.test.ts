import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRateLimiter } from './middleware.js';
import type {
  RedisClient,
  RedisPipeline,
  RateLimiterConfig,
  EndpointLimits,
  ContextExtractor,
  RateLimitContext,
} from './types.js';

/**
 * Create a mock Redis pipeline that simulates sliding window operations.
 */
function createMockPipeline(windowCount: number): RedisPipeline {
  return {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 0],              // zremrangebyscore result
      [null, 1],              // zadd result
      [null, windowCount],    // zcard result (current count)
      [null, 1],              // expire result
    ]),
  };
}

/**
 * Create a mock Redis client with configurable window counts.
 */
function createMockRedis(hourlyCount: number = 1, burstCount: number = 1): RedisClient {
  let callCount = 0;
  return {
    multi: vi.fn(() => {
      callCount++;
      // First call is burst (minute), second is hourly
      return createMockPipeline(callCount % 2 === 1 ? burstCount : hourlyCount);
    }),
    zrangebyscore: vi.fn().mockResolvedValue(
      Array.from({ length: hourlyCount }, (_, i) => String(i)),
    ),
    zcard: vi.fn().mockResolvedValue(hourlyCount),
    ttl: vi.fn().mockResolvedValue(3600),
    quit: vi.fn().mockResolvedValue('OK'),
  };
}

const DEFAULT_LIMITS: EndpointLimits = {
  POSTS: { perHour: 10, burstPerMinute: 3 },
  COMMENTS: { perHour: 60, burstPerMinute: 10 },
  MESSAGES: { perHour: 300, burstPerMinute: 30 },
};

function makeConfig(redis: RedisClient, overrides?: Partial<RateLimiterConfig>): RateLimiterConfig {
  return {
    redis,
    limits: DEFAULT_LIMITS,
    ...overrides,
  };
}

function makeRequest(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...overrides,
  };
}

function makeResponse(): { obj: Record<string, unknown>; headers: Record<string, string>; statusCode: number | null; body: unknown } {
  const state = {
    headers: {} as Record<string, string>,
    statusCode: null as number | null,
    body: null as unknown,
  };

  const obj: Record<string, unknown> = {
    set: vi.fn((name: string, value: string) => {
      state.headers[name] = value;
    }),
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return {
        json: vi.fn((body: unknown) => {
          state.body = body;
        }),
      };
    }),
  };

  return { obj, ...state, get headers() { return state.headers; }, get statusCode() { return state.statusCode; }, get body() { return state.body; } };
}

function makeContext(overrides?: Partial<RateLimitContext>): RateLimitContext {
  return {
    agentId: 'agent-123',
    tier: 'POSTS',
    trustLevel: 'ESTABLISHED',
    penalties: [],
    ...overrides,
  };
}

describe('createRateLimiter', () => {
  it('should create a rate limiter instance', () => {
    const redis = createMockRedis();
    const limiter = createRateLimiter(makeConfig(redis));

    expect(limiter).toBeDefined();
    expect(typeof limiter.middleware).toBe('function');
    expect(typeof limiter.check).toBe('function');
    expect(typeof limiter.getStatus).toBe('function');
    expect(typeof limiter.close).toBe('function');
  });
});

describe('check', () => {
  it('should allow requests within limits', async () => {
    const redis = createMockRedis(1, 1);
    const limiter = createRateLimiter(makeConfig(redis));

    const result = await limiter.check('agent-123', 'POSTS', 'ESTABLISHED');

    expect(result.allowed).toBe(true);
    expect(result.current).toBeLessThanOrEqual(result.limit);
  });

  it('should deny requests over burst limit', async () => {
    const redis = createMockRedis(1, 5); // 5 burst > 3 limit for POSTS
    const limiter = createRateLimiter(makeConfig(redis));

    const result = await limiter.check('agent-123', 'POSTS', 'ESTABLISHED');

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(60);
  });

  it('should deny requests over hourly limit', async () => {
    const redis = createMockRedis(15, 1); // 15 hourly > 10 limit for POSTS
    const limiter = createRateLimiter(makeConfig(redis));

    const result = await limiter.check('agent-123', 'POSTS', 'ESTABLISHED');

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('should apply trust multiplier to limits', async () => {
    const redis = createMockRedis(1, 1);
    const limiter = createRateLimiter(makeConfig(redis));

    // VERIFIED agents get 2x limits on POSTS → 20/hour, 6/burst
    const result = await limiter.check('agent-123', 'POSTS', 'VERIFIED');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(20); // 10 * 2.0
  });

  it('should apply penalty multiplier to limits', async () => {
    const redis = createMockRedis(1, 1);
    const limiter = createRateLimiter(makeConfig(redis));

    const result = await limiter.check(
      'agent-123', 'POSTS', 'ESTABLISHED', ['quarantineLast24h'],
    );

    // ESTABLISHED on POSTS: 10/hour * 0.5 penalty = 5
    expect(result.limit).toBe(5);
  });

  it('should use default trust level NEW when not specified', async () => {
    const redis = createMockRedis(1, 1);
    const limiter = createRateLimiter(makeConfig(redis));

    const result = await limiter.check('agent-123', 'POSTS');

    // NEW on POSTS: 10/hour * 0.5 = 5
    expect(result.limit).toBe(5);
  });
});

describe('getStatus', () => {
  it('should return status for all tiers', async () => {
    const redis = createMockRedis(5, 2);
    const limiter = createRateLimiter(makeConfig(redis));

    const status = await limiter.getStatus('agent-123', 'ESTABLISHED');

    expect(status.agentId).toBe('agent-123');
    expect(status.tiers).toHaveProperty('POSTS');
    expect(status.tiers).toHaveProperty('COMMENTS');
    expect(status.tiers).toHaveProperty('MESSAGES');
  });

  it('should include hourly and burst info for each tier', async () => {
    const redis = createMockRedis(3, 1);
    const limiter = createRateLimiter(makeConfig(redis));

    const status = await limiter.getStatus('agent-123', 'ESTABLISHED');

    const posts = status.tiers.POSTS;
    expect(posts.hourly).toBeDefined();
    expect(posts.hourly.limit).toBe(10);
    expect(posts.burst).toBeDefined();
    expect(posts.burst.limit).toBe(3);
  });

  it('should calculate remaining correctly', async () => {
    const redis = createMockRedis(3, 1);
    const limiter = createRateLimiter(makeConfig(redis));

    const status = await limiter.getStatus('agent-123', 'ESTABLISHED');

    const posts = status.tiers.POSTS;
    expect(posts.hourly.remaining).toBe(posts.hourly.limit - posts.hourly.current);
  });

  it('should floor remaining to 0', async () => {
    // More requests than the limit
    const redis = createMockRedis(15, 5);
    const limiter = createRateLimiter(makeConfig(redis));

    const status = await limiter.getStatus('agent-123', 'ESTABLISHED');

    const posts = status.tiers.POSTS;
    expect(posts.hourly.remaining).toBe(0);
  });
});

describe('middleware', () => {
  let redis: RedisClient;
  let limiter: ReturnType<typeof createRateLimiter>;
  let extractContext: ContextExtractor;

  beforeEach(() => {
    redis = createMockRedis(1, 1);
    limiter = createRateLimiter(makeConfig(redis));
    extractContext = (_req: unknown) => makeContext();
  });

  it('should pass through when context extractor returns null', async () => {
    const mw = limiter.middleware(() => null);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    expect(next).toHaveBeenCalled();
  });

  it('should allow requests within limits', async () => {
    const mw = limiter.middleware(extractContext);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    expect(next).toHaveBeenCalled();
  });

  it('should set rate limit headers', async () => {
    const mw = limiter.middleware(extractContext);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    expect(res.headers['X-RateLimit-Limit']).toBeDefined();
    expect(res.headers['X-RateLimit-Remaining']).toBeDefined();
    expect(res.headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('should return 429 when rate limited', async () => {
    const overLimitRedis = createMockRedis(15, 5); // Over both limits
    const overLimiter = createRateLimiter(makeConfig(overLimitRedis));
    const mw = overLimiter.middleware(extractContext);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
  });

  it('should include Retry-After header when rate limited', async () => {
    const overLimitRedis = createMockRedis(1, 5); // Over burst limit
    const overLimiter = createRateLimiter(makeConfig(overLimitRedis));
    const mw = overLimiter.middleware(extractContext);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    expect(res.headers['Retry-After']).toBeDefined();
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('should include rate limit info in 429 response body', async () => {
    const overLimitRedis = createMockRedis(1, 5);
    const overLimiter = createRateLimiter(makeConfig(overLimitRedis));
    const mw = overLimiter.middleware(extractContext);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('Rate limit exceeded');
    expect(body.retryAfter).toBeDefined();
    expect(body.limit).toBeDefined();
    expect(body.current).toBeDefined();
  });

  it('should attach rateLimitResult to request', async () => {
    const mw = limiter.middleware(extractContext);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    expect(req['rateLimitResult']).toBeDefined();
    expect((req['rateLimitResult'] as Record<string, unknown>).allowed).toBe(true);
  });

  it('should use context from extractor', async () => {
    const customExtract: ContextExtractor = () => makeContext({
      agentId: 'agent-456',
      tier: 'MESSAGES',
      trustLevel: 'VERIFIED',
    });
    const mw = limiter.middleware(customExtract);
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await mw(req, res.obj, next);

    // Should succeed since MESSAGES has high limits and VERIFIED gets 2x
    expect(next).toHaveBeenCalled();
  });
});

describe('close', () => {
  it('should resolve without error', async () => {
    const redis = createMockRedis();
    const limiter = createRateLimiter(makeConfig(redis));

    await expect(limiter.close()).resolves.toBeUndefined();
  });
});
