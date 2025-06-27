// Complete rate limiting implementation with sliding window, Redis support, and comprehensive middleware

import { env, environment, observabilityConfig } from '../config/environment';
import { AppError, ErrorCode } from './errors';

/**
 * Rate limit configuration interface
 */
export interface RateLimitConfig {
  requestsPerMinute: number;
  windowMs: number;
  keyGenerator?: (identifier: string) => string;
  skipSuccessful?: boolean;
  skipFailed?: boolean;
  onLimitReached?: (identifier: string, limit: RateLimitInfo) => void;
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  identifier: string;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter: number;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  info: RateLimitInfo;
}

/**
 * Rate limit store interface (supports memory and Redis)
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitRecord | null>;
  set(key: string, value: RateLimitRecord, ttlMs: number): Promise<void>;
  increment(key: string, windowMs: number): Promise<number>;
  cleanup(): Promise<void>;
}

/**
 * Rate limit record
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
  requests: number[];
}

/**
 * In-memory rate limit store
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitRecord>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(cleanupIntervalMs: number = 60000) {
    // Cleanup expired records every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: RateLimitRecord, ttlMs: number): Promise<void> {
    this.store.set(key, value);

    // Auto-expire after TTL
    setTimeout(() => {
      this.store.delete(key);
    }, ttlMs);
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const windowStart = now - windowMs;

    const record = this.store.get(key) || {
      count: 0,
      resetTime: now + windowMs,
      requests: [],
    };

    // Remove requests outside the sliding window
    record.requests = record.requests.filter((timestamp) =>
      timestamp > windowStart
    );

    // Add current request
    record.requests.push(now);
    record.count = record.requests.length;

    // Update reset time if window has shifted
    if (now > record.resetTime) {
      record.resetTime = now + windowMs;
    }

    this.store.set(key, record);
    return record.count;
  }

  async cleanup(): Promise<void> {
    const now = Date.now();

    for (const [key, record] of this.store.entries()) {
      if (record.resetTime < now) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
  }
}

/**
 * Redis rate limit store (for production use)
 */
export class RedisRateLimitStore implements RateLimitStore {
  private redis: any; // Redis client would be injected

  constructor(redisClient?: any) {
    this.redis = redisClient;

    if (!this.redis && environment.isProduction()) {
      console.warn('Redis client not provided for rate limiting in production');
    }
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    if (!this.redis) return null;

    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error: any) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  async set(key: string, value: RateLimitRecord, ttlMs: number): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.setex(
        key,
        Math.ceil(ttlMs / 1000),
        JSON.stringify(value),
      );
    } catch (error: any) {
      console.error('Redis set error:', error);
    }
  }

  async increment(key: string, windowMs: number): Promise<number> {
    if (!this.redis) {
      // Fallback to memory store
      return new MemoryRateLimitStore().increment(key, windowMs);
    }

    try {
      const lua = `
        local key = KEYS[1]
        local window = tonumber(ARGV[1])
        local now = tonumber(ARGV[2])
        local window_start = now - window
        
        -- Remove old requests
        redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
        
        -- Add current request
        redis.call('ZADD', key, now, now)
        
        -- Set expiry
        redis.call('EXPIRE', key, math.ceil(window / 1000))
        
        -- Return count
        return redis.call('ZCARD', key)
      `;

      const count = await this.redis.eval(lua, 1, key, windowMs, Date.now());
      return parseInt(count, 10);
    } catch (error: any) {
      console.error('Redis increment error:', error);
      // Fallback to simple increment
      return await this.redis.incr(key);
    }
  }

  async cleanup(): Promise<void> {
    // Redis handles TTL automatically
  }
}

/**
 * Rate limiter class
 */
export class RateLimiter {
  private store: RateLimitStore;
  private config: Required<RateLimitConfig>;

  constructor(
    config: Partial<RateLimitConfig> = {},
    store?: RateLimitStore,
  ) {
    this.config = {
      requestsPerMinute: config.requestsPerMinute ||
        observabilityConfig.rateLimiting.requestsPerMinute,
      windowMs: config.windowMs || observabilityConfig.rateLimiting.windowMs,
      keyGenerator: config.keyGenerator || ((id: string) => `rate_limit:${id}`),
      skipSuccessful: config.skipSuccessful || false,
      skipFailed: config.skipFailed || false,
      onLimitReached: config.onLimitReached || (() => {}),
    };

    this.store = store || new MemoryRateLimitStore();
  }

  /**
   * Check if request is within rate limit
   */
  async checkLimit(identifier: string): Promise<RateLimitResult> {
    const key = this.config.keyGenerator(identifier);
    const now = Date.now();

    try {
      const currentCount = await this.store.increment(
        key,
        this.config.windowMs,
      );
      const resetTime = now + this.config.windowMs;
      const remaining = Math.max(
        0,
        this.config.requestsPerMinute - currentCount,
      );
      const allowed = currentCount <= this.config.requestsPerMinute;

      const info: RateLimitInfo = {
        identifier,
        limit: this.config.requestsPerMinute,
        remaining,
        resetTime,
        retryAfter: allowed ? 0 : Math.ceil(this.config.windowMs / 1000),
      };

      if (!allowed) {
        this.config.onLimitReached(identifier, info);
      }

      return { allowed, info };
    } catch (error: any) {
      console.error('Rate limit check error:', error);

      // Fail open - allow request if rate limiting fails
      return {
        allowed: true,
        info: {
          identifier,
          limit: this.config.requestsPerMinute,
          remaining: this.config.requestsPerMinute,
          resetTime: now + this.config.windowMs,
          retryAfter: 0,
        },
      };
    }
  }

  /**
   * Create rate limiting middleware
   */
  createMiddleware() {
    return async (request: Request, identifier?: string): Promise<void> => {
      const id = identifier || this.extractIdentifier(request);
      const result = await this.checkLimit(id);

      if (!result.allowed) {
        throw new AppError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          'Rate limit exceeded',
          {
            details: {
              limit: result.info.limit,
              remaining: result.info.remaining,
              resetTime: result.info.resetTime,
              retryAfter: result.info.retryAfter,
            },
            retryable: true,
          },
        );
      }
    };
  }

  /**
   * Extract identifier from request
   */
  private extractIdentifier(request: Request): string {
    // Try to get user ID from auth header first
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      try {
        // This would be enhanced to extract actual user ID from JWT
        const token = authHeader.replace('Bearer ', '');
        return `user:${token.substring(0, 10)}`; // Simplified for now
      } catch {
        // Fall through to IP-based limiting
      }
    }

    // Fall back to IP address
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');

    const ip = cfIp || realIp || forwarded?.split(',')[0] || 'unknown';
    return `ip:${ip}`;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.store.cleanup();
  }
}

/**
 * Global rate limiters for different use cases
 */
export class GlobalRateLimiters {
  private static limiters = new Map<string, RateLimiter>();

  /**
   * Get or create rate limiter for specific use case
   */
  static getLimiter(
    name: string,
    config?: Partial<RateLimitConfig>,
  ): RateLimiter {
    if (!this.limiters.has(name)) {
      const store = environment.isProduction()
        ? new RedisRateLimitStore() // Would inject Redis client in production
        : new MemoryRateLimitStore();

      this.limiters.set(name, new RateLimiter(config, store));
    }

    return this.limiters.get(name)!;
  }

  /**
   * Pre-configured rate limiters
   */
  static get global() {
    return this.getLimiter('global', {
      requestsPerMinute: 1000, // 1000 requests per minute globally
      windowMs: 60 * 1000,
    });
  }

  static get auth() {
    return this.getLimiter('auth', {
      requestsPerMinute: 10, // 10 auth requests per minute
      windowMs: 60 * 1000,
    });
  }

  static get apiKeys() {
    return this.getLimiter('apiKeys', {
      requestsPerMinute: 5, // 5 API key operations per minute
      windowMs: 60 * 1000,
    });
  }

  static get billing() {
    return this.getLimiter('billing', {
      requestsPerMinute: 20, // 20 billing operations per minute
      windowMs: 60 * 1000,
    });
  }

  static get uploads() {
    return this.getLimiter('uploads', {
      requestsPerMinute: 10, // 10 file uploads per minute
      windowMs: 60 * 1000,
    });
  }

  /**
   * Cleanup all limiters
   */
  static async cleanup(): Promise<void> {
    for (const limiter of this.limiters.values()) {
      await limiter.cleanup();
    }
    this.limiters.clear();
  }
}

/**
 * Rate limiting decorator for functions
 */
export function rateLimit(config: Partial<RateLimitConfig> = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const limiter = new RateLimiter(config);

    descriptor.value = async function (...args: any[]) {
      const [request] = args;

      if (request && typeof request === 'object' && 'headers' in request) {
        await limiter.createMiddleware()(request);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Helper functions
 */
export const rateLimitingUtils = {
  /**
   * Create custom rate limiter
   */
  createLimiter: (config: Partial<RateLimitConfig>, store?: RateLimitStore) => {
    return new RateLimiter(config, store);
  },

  /**
   * Create memory store
   */
  createMemoryStore: (cleanupIntervalMs?: number) => {
    return new MemoryRateLimitStore(cleanupIntervalMs);
  },

  /**
   * Create Redis store
   */
  createRedisStore: (redisClient?: any) => {
    return new RedisRateLimitStore(redisClient);
  },

  /**
   * Pre-configured limiters
   */
  limiters: GlobalRateLimiters,

  /**
   * Rate limit headers for responses
   */
  createRateLimitHeaders: (info: RateLimitInfo): Record<string, string> => {
    return {
      'X-RateLimit-Limit': info.limit.toString(),
      'X-RateLimit-Remaining': info.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(info.resetTime / 1000).toString(),
      ...(info.retryAfter > 0 && {
        'Retry-After': info.retryAfter.toString(),
      }),
    };
  },

  /**
   * Check if error is rate limit error
   */
  isRateLimitError: (error: any): boolean => {
    return error instanceof AppError &&
      error.code === ErrorCode.RATE_LIMIT_EXCEEDED;
  },
};

/**
 * Express-style middleware factory
 */
export function createRateLimitMiddleware(
  config: Partial<RateLimitConfig> = {},
) {
  const limiter = new RateLimiter(config);

  return async (req: Request): Promise<Response | void> => {
    try {
      await limiter.createMiddleware()(req);
      return; // No rate limit exceeded, continue
    } catch (error: any) {
      if (rateLimitingUtils.isRateLimitError(error)) {
        const appError = error as AppError;
        const headers = rateLimitingUtils.createRateLimitHeaders(
          appError.details as RateLimitInfo,
        );

        return new Response(
          JSON.stringify(appError.toResponse()),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
          },
        );
      }
      throw error;
    }
  };
}

/**
 * Create a rate limiter function
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const limiter = new RateLimiter(config);

  return async (req: Request): Promise<void> => {
    await limiter.createMiddleware()(req);
    // If no error is thrown, the request is allowed
  };
}

/**
 * Default export for convenience
 */
export default {
  RateLimiter,
  GlobalRateLimiters,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimitMiddleware,
  rateLimit,
  utils: rateLimitingUtils,
};
