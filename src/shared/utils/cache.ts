// Comprehensive cache utilities with in-memory/Redis support, TTL, invalidation, and middleware

import { logger } from './logging';

// Import environment configuration
// Using try-catch to handle both ESM and CommonJS environments
let env: any = {
  CACHE_ENABLED: true,
  CACHE_TTL: 300,
};
let environment: any = {
  isDevelopment: () => true,
  isProduction: () => false,
  isTest: () => false,
};

try {
  const envModule = require('../config/environment');
  env = envModule.env;
  environment = envModule.environment;
} catch (e) {
  try {
    // For ESM environments
    import('../config/environment')
      .then(module => {
        env = module.env;
        environment = module.environment;
      })
      .catch(() => {
        console.warn('Could not import environment config, using defaults');
      });
  } catch (e) {
    console.warn('Could not import environment config, using defaults');
  }
}

/**
 * Cache entry interface
 */
export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  ttl: number;
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Cache statistics interface
 */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  size: number;
  hitRate: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  defaultTtl: number;
  maxSize?: number;
  cleanupInterval?: number;
  enableStats: boolean;
  namespace?: string;
  serializer?: CacheSerializer;
  onHit?: (key: string) => void;
  onMiss?: (key: string) => void;
  onSet?: (key: string, value: unknown) => void;
  onDelete?: (key: string) => void;
}

/**
 * Cache serializer interface
 */
export interface CacheSerializer {
  serialize(value: unknown): string;
  deserialize<T>(value: string): T;
}

/**
 * Cache store interface
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(pattern?: string): Promise<string[]>;
  size(): Promise<number>;
  getStats(): Promise<CacheStats>;
}

/**
 * JSON cache serializer
 */
export class JsonSerializer implements CacheSerializer {
  serialize(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch (error: any) {
      logger.error('Cache serialization failed', error as Error, { value });
      throw new Error('Failed to serialize cache value');
    }
  }

  deserialize<T>(value: string): T {
    try {
      return JSON.parse(value) as T;
    } catch (error: any) {
      logger.error('Cache deserialization failed', error as Error, { value });
      throw new Error('Failed to deserialize cache value');
    }
  }
}

/**
 * In-memory cache store
 */
export class MemoryCacheStore implements CacheStore {
  private store = new Map<string, CacheEntry>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
    hitRate: 0,
  };
  private config: Required<CacheConfig>;
  private cleanupTimer?: number | ReturnType<typeof setInterval>;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      defaultTtl: config.defaultTtl ?? 300000, // 5 minutes
      maxSize: config.maxSize ?? 1000,
      cleanupInterval: config.cleanupInterval ?? 60000, // 1 minute
      enableStats: config.enableStats ?? true,
      namespace: config.namespace ?? 'memory',
      serializer: config.serializer ?? new JsonSerializer(),
      onHit: config.onHit ?? (() => {}),
      onMiss: config.onMiss ?? (() => {}),
      onSet: config.onSet ?? (() => {}),
      onDelete: config.onDelete ?? (() => {}),
    };

    // Start cleanup timer
    this.startCleanup();
  }

  async get<T>(key: string): Promise<T | null> {
    const namespacedKey = this.namespaceKey(key);
    const entry = this.store.get(namespacedKey);

    if (!entry) {
      this.updateStats('miss');
      this.config.onMiss(key);
      return null;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(namespacedKey);
      this.updateStats('miss');
      this.config.onMiss(key);
      return null;
    }

    this.updateStats('hit');
    this.config.onHit(key);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const namespacedKey = this.namespaceKey(key);
    const actualTtl = ttl ?? this.config.defaultTtl;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      key: namespacedKey,
      value,
      ttl: actualTtl,
      createdAt: now,
      expiresAt: now + actualTtl,
    };

    // Check size limit
    if (
      this.config.maxSize &&
      this.store.size >= this.config.maxSize &&
      !this.store.has(namespacedKey)
    ) {
      await this.evictOldest();
    }

    this.store.set(namespacedKey, entry);
    this.updateStats('set');
    this.config.onSet(key, value);
  }

  async delete(key: string): Promise<boolean> {
    const namespacedKey = this.namespaceKey(key);
    const deleted = this.store.delete(namespacedKey);

    if (deleted) {
      this.updateStats('delete');
      this.config.onDelete(key);
    }

    return deleted;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.resetStats();
  }

  async has(key: string): Promise<boolean> {
    const namespacedKey = this.namespaceKey(key);
    const entry = this.store.get(namespacedKey);

    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(namespacedKey);
      return false;
    }

    return true;
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());

    if (!pattern) {
      return allKeys.map(key => this.stripNamespace(key));
    }

    const regex = new RegExp(pattern);
    return allKeys.filter(key => regex.test(key)).map(key => this.stripNamespace(key));
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async getStats(): Promise<CacheStats> {
    return {
      ...this.stats,
      size: this.store.size,
      hitRate:
        this.stats.hits + this.stats.misses > 0
          ? this.stats.hits / (this.stats.hits + this.stats.misses)
          : 0,
    };
  }

  private namespaceKey(key: string): string {
    return `${this.config.namespace}:${key}`;
  }

  private stripNamespace(key: string): string {
    const prefix = `${this.config.namespace}:`;
    return key.startsWith(prefix) ? key.substring(prefix.length) : key;
  }

  private updateStats(operation: 'hit' | 'miss' | 'set' | 'delete'): void {
    if (!this.config.enableStats) return;

    this.stats[
      operation === 'hit'
        ? 'hits'
        : operation === 'miss'
          ? 'misses'
          : operation === 'set'
            ? 'sets'
            : 'deletes'
    ]++;
  }

  private resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      size: 0,
      hitRate: 0,
    };
  }

  private async evictOldest(): Promise<void> {
    let oldest: { key: string; createdAt: number } | null = null;

    for (const [key, entry] of this.store.entries()) {
      if (!oldest || entry.createdAt < oldest.createdAt) {
        oldest = { key, createdAt: entry.createdAt };
      }
    }

    if (oldest) {
      this.store.delete(oldest.key);
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.store.delete(key);
    }

    if (expiredKeys.length > 0) {
      logger.debug(`Cache cleanup: removed ${expiredKeys.length} expired entries`);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.store.clear();
  }
}

/**
 * Redis cache store
 */
export class RedisCacheStore implements CacheStore {
  private redis: any; // Redis client
  private config: Required<CacheConfig>;
  private localStats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
    hitRate: 0,
  };

  constructor(redisClient: any, config: Partial<CacheConfig> = {}) {
    this.redis = redisClient;
    this.config = {
      defaultTtl: config.defaultTtl ?? 300000, // 5 minutes
      maxSize: config.maxSize ?? 1000,
      cleanupInterval: config.cleanupInterval ?? 60000,
      enableStats: config.enableStats ?? true,
      namespace: config.namespace ?? 'cache',
      serializer: config.serializer ?? new JsonSerializer(),
      onHit: config.onHit ?? (() => {}),
      onMiss: config.onMiss ?? (() => {}),
      onSet: config.onSet ?? (() => {}),
      onDelete: config.onDelete ?? (() => {}),
    };
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const namespacedKey = this.namespaceKey(key);
      const value = await this.redis.get(namespacedKey);

      if (value === null) {
        this.updateStats('miss');
        this.config.onMiss(key);
        return null;
      }

      this.updateStats('hit');
      this.config.onHit(key);
      return this.config.serializer.deserialize<T>(value);
    } catch (error: any) {
      logger.error('Redis cache get error', error as Error, { key });
      this.updateStats('miss');
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const namespacedKey = this.namespaceKey(key);
      const serialized = this.config.serializer.serialize(value);
      const actualTtl = ttl ?? this.config.defaultTtl;

      // Convert TTL from milliseconds to seconds for Redis
      const ttlSeconds = Math.ceil(actualTtl / 1000);

      await this.redis.setex(namespacedKey, ttlSeconds, serialized);
      this.updateStats('set');
      this.config.onSet(key, value);
    } catch (error: any) {
      logger.error('Redis cache set error', error as Error, { key, value });
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const namespacedKey = this.namespaceKey(key);
      const result = await this.redis.del(namespacedKey);
      const deleted = result > 0;

      if (deleted) {
        this.updateStats('delete');
        this.config.onDelete(key);
      }

      return deleted;
    } catch (error: any) {
      logger.error('Redis cache delete error', error as Error, { key });
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      const pattern = `${this.config.namespace}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      this.resetStats();
    } catch (error: any) {
      logger.error('Redis cache clear error', error as Error);
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const namespacedKey = this.namespaceKey(key);
      const exists = await this.redis.exists(namespacedKey);
      return exists === 1;
    } catch (error: any) {
      logger.error('Redis cache has error', error as Error, { key });
      return false;
    }
  }

  async keys(pattern?: string): Promise<string[]> {
    try {
      const searchPattern = pattern
        ? `${this.config.namespace}:${pattern}`
        : `${this.config.namespace}:*`;

      const keys = await this.redis.keys(searchPattern);
      return keys.map((key: string) => this.stripNamespace(key));
    } catch (error: any) {
      logger.error('Redis cache keys error', error as Error, { pattern });
      return [];
    }
  }

  async size(): Promise<number> {
    try {
      const keys = await this.keys();
      return keys.length;
    } catch (error: any) {
      logger.error('Redis cache size error', error as Error);
      return 0;
    }
  }

  async getStats(): Promise<CacheStats> {
    const size = await this.size();
    return {
      ...this.localStats,
      size,
      hitRate:
        this.localStats.hits + this.localStats.misses > 0
          ? this.localStats.hits / (this.localStats.hits + this.localStats.misses)
          : 0,
    };
  }

  private namespaceKey(key: string): string {
    return `${this.config.namespace}:${key}`;
  }

  private stripNamespace(key: string): string {
    const prefix = `${this.config.namespace}:`;
    return key.startsWith(prefix) ? key.substring(prefix.length) : key;
  }

  private updateStats(operation: 'hit' | 'miss' | 'set' | 'delete'): void {
    if (!this.config.enableStats) return;

    this.localStats[
      operation === 'hit'
        ? 'hits'
        : operation === 'miss'
          ? 'misses'
          : operation === 'set'
            ? 'sets'
            : 'deletes'
    ]++;
  }

  private resetStats(): void {
    this.localStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      size: 0,
      hitRate: 0,
    };
  }
}

/**
 * Cache manager with fallback support
 */
export class CacheManager {
  private primary: CacheStore;
  private fallback?: CacheStore;
  private config: {
    enableFallback: boolean;
    syncWrites: boolean;
  };

  constructor(
    primary: CacheStore,
    fallback?: CacheStore,
    config: { enableFallback?: boolean; syncWrites?: boolean } = {}
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.config = {
      enableFallback: config.enableFallback ?? true,
      syncWrites: config.syncWrites ?? false,
    };
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.primary.get<T>(key);
      if (value !== null) {
        return value;
      }
    } catch (error: any) {
      logger.warn('Primary cache get failed, trying fallback', error as Error, {
        key,
      });
    }

    // Try fallback if enabled and available
    if (this.config.enableFallback && this.fallback) {
      try {
        const value = await this.fallback.get<T>(key);

        // Populate primary cache with fallback value
        if (value !== null) {
          this.primary.set(key, value).catch(err => {
            logger.warn('Failed to populate primary cache from fallback', err, {
              key,
            });
          });
        }

        return value;
      } catch (error: any) {
        logger.warn('Fallback cache get failed', error as Error, { key });
      }
    }

    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const promises: Promise<void>[] = [];

    // Set in primary cache
    promises.push(this.primary.set(key, value, ttl));

    // Set in fallback cache if sync writes enabled
    if (this.config.syncWrites && this.fallback) {
      promises.push(this.fallback.set(key, value, ttl));
    }

    try {
      await Promise.all(promises);
    } catch (error: any) {
      logger.error('Cache set failed', error as Error, { key });
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    const promises: Promise<boolean>[] = [];

    promises.push(this.primary.delete(key));

    if (this.fallback) {
      promises.push(this.fallback.delete(key));
    }

    try {
      const results = await Promise.all(promises);
      return results.some(result => result);
    } catch (error: any) {
      logger.error('Cache delete failed', error as Error, { key });
      return false;
    }
  }

  async clear(): Promise<void> {
    const promises: Promise<void>[] = [];

    promises.push(this.primary.clear());

    if (this.fallback) {
      promises.push(this.fallback.clear());
    }

    await Promise.all(promises);
  }

  async getStats(): Promise<{ primary: CacheStats; fallback?: CacheStats }> {
    const primary = await this.primary.getStats();
    const fallback = this.fallback ? await this.fallback.getStats() : undefined;

    return { primary, fallback };
  }
}

/**
 * Cache middleware for API responses
 */
export class CacheMiddleware {
  private cache: CacheStore;
  private defaultTtl: number;

  constructor(cache: CacheStore, defaultTtl: number = 300000) {
    this.cache = cache;
    this.defaultTtl = defaultTtl;
  }

  /**
   * Create caching middleware
   */
  createMiddleware(ttl?: number) {
    return async (request: Request): Promise<Response | null> => {
      // Only cache GET requests
      if (request.method !== 'GET') {
        return null;
      }

      const cacheKey = this.generateCacheKey(request);

      try {
        // Try to get cached response
        const cached = await this.cache.get<{
          status: number;
          headers: Record<string, string>;
          body: string;
        }>(cacheKey);

        if (cached) {
          logger.debug('Cache hit', { cacheKey });

          return new Response(cached.body, {
            status: cached.status,
            headers: {
              ...cached.headers,
              'X-Cache': 'HIT',
              'X-Cache-Key': cacheKey,
            },
          });
        }

        logger.debug('Cache miss', { cacheKey });
        return null; // Continue to actual handler
      } catch (error: any) {
        logger.warn('Cache middleware error', error as Error, { cacheKey });
        return null; // Continue to actual handler
      }
    };
  }

  /**
   * Cache response
   */
  async cacheResponse(request: Request, response: Response, ttl?: number): Promise<Response> {
    // Only cache successful GET responses
    if (request.method !== 'GET' || response.status >= 400) {
      return response;
    }

    const cacheKey = this.generateCacheKey(request);

    try {
      // Clone response to read body
      const responseClone = response.clone();
      const body = await responseClone.text();

      // Extract headers
      const headers: Record<string, string> = {};
      for (const [key, value] of response.headers.entries()) {
        headers[key] = value;
      }

      // Cache the response data
      await this.cache.set(
        cacheKey,
        {
          status: response.status,
          headers,
          body,
        },
        ttl ?? this.defaultTtl
      );

      logger.debug('Response cached', {
        cacheKey,
        ttl: ttl ?? this.defaultTtl,
      });

      // Return response with cache headers
      const newHeaders = new Headers(response.headers);
      newHeaders.set('X-Cache', 'MISS');
      newHeaders.set('X-Cache-Key', cacheKey);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (error: any) {
      logger.warn('Failed to cache response', error as Error, { cacheKey });
      return response;
    }
  }

  private generateCacheKey(request: Request): string {
    const url = new URL(request.url);
    const path = url.pathname;
    const query = url.search;
    const auth = request.headers.get('Authorization');

    // Include user context in cache key
    const userContext = auth ? auth.substring(0, 20) : 'anonymous';

    return `api:${path}${query}:${userContext}`;
  }
}

/**
 * Global cache instances
 */
export class GlobalCaches {
  private static instances = new Map<string, CacheStore>();

  static getCache(name: string = 'default'): CacheStore {
    if (!this.instances.has(name)) {
      const store =
        environment.isProduction() && env.CACHE_ENABLED
          ? new MemoryCacheStore() // Would use Redis in production with actual Redis client
          : new MemoryCacheStore();

      this.instances.set(name, store);
    }

    return this.instances.get(name)!;
  }

  static createManager(primaryName: string = 'default', fallbackName?: string): CacheManager {
    const primary = this.getCache(primaryName);
    const fallback = fallbackName ? this.getCache(fallbackName) : undefined;

    return new CacheManager(primary, fallback);
  }

  static async clearAll(): Promise<void> {
    const promises = Array.from(this.instances.values()).map(cache => cache.clear());
    await Promise.all(promises);
  }

  static async getGlobalStats(): Promise<Record<string, CacheStats>> {
    const stats: Record<string, CacheStats> = {};

    for (const [name, cache] of this.instances.entries()) {
      stats[name] = await cache.getStats();
    }

    return stats;
  }
}

/**
 * Cache utilities
 */
export const cacheUtils = {
  /**
   * Create memory cache store
   */
  createMemoryStore: (config?: Partial<CacheConfig>) => new MemoryCacheStore(config),

  /**
   * Create Redis cache store
   */
  createRedisStore: (redisClient: any, config?: Partial<CacheConfig>) =>
    new RedisCacheStore(redisClient, config),

  /**
   * Create cache manager
   */
  createManager: (primary: CacheStore, fallback?: CacheStore) =>
    new CacheManager(primary, fallback),

  /**
   * Create cache middleware
   */
  createMiddleware: (cache: CacheStore, defaultTtl?: number) =>
    new CacheMiddleware(cache, defaultTtl),

  /**
   * Global caches
   */
  global: GlobalCaches,

  /**
   * Serializers
   */
  serializers: {
    json: JsonSerializer,
  },

  /**
   * Generate cache key
   */
  generateKey: (...parts: (string | number)[]): string => {
    return parts.map(part => String(part)).join(':');
  },

  /**
   * Parse TTL string to milliseconds
   */
  parseTtl: (ttl: string | number): number => {
    if (typeof ttl === 'number') {
      return ttl;
    }

    const match = ttl.match(/^(\d+)(ms|s|m|h|d)?$/);
    if (!match) {
      throw new Error(`Invalid TTL format: ${ttl}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] || 'ms';

    const multipliers = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit as keyof typeof multipliers];
  },
};

/**
 * Global cache instance for direct use
 */
export const cache = new CacheManager(
  new MemoryCacheStore() // Default to memory cache
);

/**
 * Default export
 */
export default {
  MemoryCacheStore,
  RedisCacheStore,
  CacheManager,
  CacheMiddleware,
  GlobalCaches,
  utils: cacheUtils,
  cache,
};
