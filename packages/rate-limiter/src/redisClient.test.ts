import { describe, it, expect, vi } from 'vitest';
import { RedisRateLimiter } from './redisClient.js';
import type { RedisClient, RedisPipeline } from './types.js';

function createMockPipeline(zcardResult: number): RedisPipeline {
  return {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, zcardResult],
      [null, 1],
    ]),
  };
}

function createMockRedis(zcardResult: number = 1): RedisClient {
  const pipeline = createMockPipeline(zcardResult);
  return {
    multi: vi.fn(() => pipeline),
    zrangebyscore: vi.fn().mockResolvedValue(
      Array.from({ length: zcardResult }, (_, i) => String(Date.now() + i)),
    ),
    zcard: vi.fn().mockResolvedValue(zcardResult),
    ttl: vi.fn().mockResolvedValue(3600),
    quit: vi.fn().mockResolvedValue('OK'),
  };
}

describe('RedisRateLimiter', () => {
  describe('slidingWindowIncrement', () => {
    it('should execute pipeline with correct operations', async () => {
      const redis = createMockRedis(1);
      const limiter = new RedisRateLimiter(redis);

      const count = await limiter.slidingWindowIncrement('agent-1', 'POSTS', 'hour');

      expect(redis.multi).toHaveBeenCalled();
      expect(count).toBe(1);
    });

    it('should use correct key format', async () => {
      const redis = createMockRedis(1);
      const pipeline = createMockPipeline(1);
      (redis.multi as ReturnType<typeof vi.fn>).mockReturnValue(pipeline);
      const limiter = new RedisRateLimiter(redis);

      await limiter.slidingWindowIncrement('agent-1', 'POSTS', 'hour');

      expect(pipeline.zremrangebyscore).toHaveBeenCalledWith(
        'rl:agent-1:POSTS:hour',
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('should use custom key prefix', async () => {
      const redis = createMockRedis(1);
      const pipeline = createMockPipeline(1);
      (redis.multi as ReturnType<typeof vi.fn>).mockReturnValue(pipeline);
      const limiter = new RedisRateLimiter(redis, 'custom:');

      await limiter.slidingWindowIncrement('agent-1', 'POSTS', 'minute');

      expect(pipeline.zremrangebyscore).toHaveBeenCalledWith(
        'custom:agent-1:POSTS:minute',
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('should set TTL of 3600 for hour window', async () => {
      const redis = createMockRedis(1);
      const pipeline = createMockPipeline(1);
      (redis.multi as ReturnType<typeof vi.fn>).mockReturnValue(pipeline);
      const limiter = new RedisRateLimiter(redis);

      await limiter.slidingWindowIncrement('agent-1', 'POSTS', 'hour');

      expect(pipeline.expire).toHaveBeenCalledWith('rl:agent-1:POSTS:hour', 3600);
    });

    it('should set TTL of 60 for minute window', async () => {
      const redis = createMockRedis(1);
      const pipeline = createMockPipeline(1);
      (redis.multi as ReturnType<typeof vi.fn>).mockReturnValue(pipeline);
      const limiter = new RedisRateLimiter(redis);

      await limiter.slidingWindowIncrement('agent-1', 'POSTS', 'minute');

      expect(pipeline.expire).toHaveBeenCalledWith('rl:agent-1:POSTS:minute', 60);
    });

    it('should throw when pipeline returns null', async () => {
      const redis = createMockRedis(1);
      const pipeline = createMockPipeline(1);
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (redis.multi as ReturnType<typeof vi.fn>).mockReturnValue(pipeline);
      const limiter = new RedisRateLimiter(redis);

      await expect(
        limiter.slidingWindowIncrement('agent-1', 'POSTS', 'hour'),
      ).rejects.toThrow('Redis pipeline returned null');
    });

    it('should throw when pipeline returns error', async () => {
      const redis = createMockRedis(1);
      const pipeline = createMockPipeline(1);
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 1],
        [new Error('Redis error'), null],
        [null, 1],
      ]);
      (redis.multi as ReturnType<typeof vi.fn>).mockReturnValue(pipeline);
      const limiter = new RedisRateLimiter(redis);

      await expect(
        limiter.slidingWindowIncrement('agent-1', 'POSTS', 'hour'),
      ).rejects.toThrow('Redis error');
    });

    it('should return the count from zcard result', async () => {
      const redis = createMockRedis(42);
      const limiter = new RedisRateLimiter(redis);

      const count = await limiter.slidingWindowIncrement('agent-1', 'POSTS', 'hour');

      expect(count).toBe(42);
    });
  });

  describe('slidingWindowCount', () => {
    it('should return count without incrementing', async () => {
      const redis = createMockRedis(5);
      const limiter = new RedisRateLimiter(redis);

      const count = await limiter.slidingWindowCount('agent-1', 'POSTS', 'hour');

      expect(count).toBe(5);
      expect(redis.zrangebyscore).toHaveBeenCalled();
      // Should NOT call multi (no increment)
      expect(redis.multi).not.toHaveBeenCalled();
    });
  });

  describe('checkAndIncrement', () => {
    it('should allow when under both limits', async () => {
      const redis = createMockRedis(1);
      const limiter = new RedisRateLimiter(redis);

      const result = await limiter.checkAndIncrement('agent-1', 'POSTS', 10, 3);

      expect(result.allowed).toBe(true);
      expect(result.retryAfter).toBeNull();
    });

    it('should deny when over burst limit', async () => {
      const redis = createMockRedis(5);
      const limiter = new RedisRateLimiter(redis);

      const result = await limiter.checkAndIncrement('agent-1', 'POSTS', 10, 3);

      // First call (burst) returns 5, which is > 3
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(60);
    });

    it('should include remaining count when allowed', async () => {
      const redis = createMockRedis(3);
      const limiter = new RedisRateLimiter(redis);

      const result = await limiter.checkAndIncrement('agent-1', 'POSTS', 10, 5);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10 - 3); // hourlyLimit - hourlyCount
    });
  });
});
