/**
 * Enhanced Auth Foundation
 *
 * Provides centralized authentication middleware factory, session management,
 * and comprehensive permission system for all modules.
 *
 * Uses existing Layer 1 & 2 utilities:
 * - Auth utilities from @/auth
 * - Database utilities from @/database
 * - Error handling from @/errors
 * - Logging from @/logging
 * - Cache utilities from @/cache
 * - Rate limiting from @/rate-limiting
 */

import { User } from '@supabase/supabase-js';
import { ApiKeyInfo, AuthResult, createSupabaseClient, UserContext } from './auth';
import { cache } from './cache';
import { database } from './database';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ErrorCode,
  ErrorContext,
} from './errors';
import { logger } from './logging';
import { rateLimiter } from './rate-limiting';

/**
 * Authentication strategy enum
 */
export enum AuthStrategy {
  JWT_REQUIRED = 'jwt_required',
  API_KEY_REQUIRED = 'api_key_required',
  JWT_OR_API_KEY = 'jwt_or_api_key',
  OPTIONAL = 'optional',
  PUBLIC = 'public',
}

/**
 * Permission requirement interface
 */
export interface PermissionRequirement {
  action: string;
  resource: string;
  condition?: (user: UserContext, request: Request) => boolean | Promise<boolean>;
  allowOwnership?: boolean; // Allow if user owns the resource
}

/**
 * Session data interface
 */
export interface SessionData {
  id: string;
  userId: string;
  userEmail: string;
  userRole: string;
  permissions: string[];
  metadata: Record<string, any>;
  createdAt: Date;
  expiresAt: Date;
  lastAccessedAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Middleware configuration interface
 */
export interface AuthMiddlewareConfig {
  strategy: AuthStrategy;
  permissions?: PermissionRequirement[];
  rateLimit?: {
    requestsPerMinute: number;
    windowMs?: number;
    keyGenerator?: (request: Request) => string;
  };
  session?: {
    required: boolean;
    extend: boolean; // Extend session on each request
  };
  audit?: {
    logAccess: boolean;
    logFailures: boolean;
    includeRequestData: boolean;
  };
  cache?: {
    enabled: boolean;
    ttl?: number;
  };
}

/**
 * Authentication result with extended context
 */
export interface AuthMiddlewareResult extends AuthResult {
  session?: SessionData;
  permissions: string[];
  hasPermission: (action: string, resource: string) => boolean;
  requirePermission: (action: string, resource: string) => void;
}

/**
 * Session manager for handling user sessions
 */
export class SessionManager {
  private static readonly SESSION_PREFIX = 'session:';
  private static readonly SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
  private static readonly CLEANUP_INTERVAL = 60 * 60; // 1 hour in seconds

  private client = database.getServiceClient();
  private cacheManager = cache;

  /**
   * Create a new session
   */
  async createSession(
    userId: string,
    userEmail: string,
    userRole: string,
    permissions: string[],
    metadata: Record<string, any> = {},
    request?: Request
  ): Promise<SessionData> {
    const sessionId = this.generateSessionId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SessionManager.SESSION_TTL * 1000);

    // Extract request metadata
    const ipAddress = this.extractIpAddress(request);
    const userAgent = request?.headers.get('User-Agent') || undefined;

    const sessionData: SessionData = {
      id: sessionId,
      userId,
      userEmail,
      userRole,
      permissions,
      metadata,
      createdAt: now,
      expiresAt,
      lastAccessedAt: now,
      ipAddress,
      userAgent,
    };

    // Store in cache
    await this.cacheManager.set(
      this.getSessionKey(sessionId),
      sessionData,
      SessionManager.SESSION_TTL
    );

    // Store in database for persistence
    const helper = database.createQueryHelper(this.client);
    await helper.insert('user_sessions', {
      id: sessionId,
      user_id: userId,
      user_email: userEmail,
      user_role: userRole,
      permissions: JSON.stringify(permissions),
      metadata: JSON.stringify(metadata),
      expires_at: expiresAt.toISOString(),
      last_accessed_at: now.toISOString(),
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: now.toISOString(),
    });

    logger.info('Session created', {
      sessionId,
      userId,
      userEmail,
      expiresAt: expiresAt.toISOString(),
    });

    return sessionData;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    // Try cache first
    const cached = await this.cacheManager.get<SessionData>(this.getSessionKey(sessionId));
    if (cached) {
      // Check if expired
      if (new Date() > new Date(cached.expiresAt)) {
        await this.deleteSession(sessionId);
        return null;
      }
      return cached;
    }

    // Fall back to database
    const helper = database.createQueryHelper(this.client);
    const result = await helper.select<any>('user_sessions', {
      filters: { id: sessionId },
      limit: 1,
    });

    if (result.error || !result.data || result.data.length === 0) {
      return null;
    }

    const dbSession = result.data[0];

    // Check if expired
    if (new Date() > new Date(dbSession.expires_at)) {
      await this.deleteSession(sessionId);
      return null;
    }

    const sessionData: SessionData = {
      id: dbSession.id,
      userId: dbSession.user_id,
      userEmail: dbSession.user_email,
      userRole: dbSession.user_role,
      permissions: JSON.parse(dbSession.permissions || '[]'),
      metadata: JSON.parse(dbSession.metadata || '{}'),
      createdAt: new Date(dbSession.created_at),
      expiresAt: new Date(dbSession.expires_at),
      lastAccessedAt: new Date(dbSession.last_accessed_at),
      ipAddress: dbSession.ip_address,
      userAgent: dbSession.user_agent,
    };

    // Update cache
    await this.cacheManager.set(
      this.getSessionKey(sessionId),
      sessionData,
      SessionManager.SESSION_TTL
    );

    return sessionData;
  }

  /**
   * Update session last accessed time
   */
  async touchSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const now = new Date();
    session.lastAccessedAt = now;

    // Update cache
    await this.cacheManager.set(this.getSessionKey(sessionId), session, SessionManager.SESSION_TTL);

    // Update database (async, don't wait)
    const helper = database.createQueryHelper(this.client);
    helper
      .update(
        'user_sessions',
        { last_accessed_at: now.toISOString() },
        {
          id: sessionId,
        }
      )
      .catch(error => {
        logger.warn('Failed to update session access time', {
          sessionId,
          error: error.message,
        });
      });
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    // Remove from cache
    await this.cacheManager.delete(this.getSessionKey(sessionId));

    // Remove from database
    const helper = database.createQueryHelper(this.client);
    await helper.delete('user_sessions', { id: sessionId });

    logger.info('Session deleted', { sessionId });
  }

  /**
   * Delete all sessions for a user
   */
  async deleteUserSessions(userId: string): Promise<void> {
    const helper = database.createQueryHelper(this.client);

    // Get all session IDs for the user
    const result = await helper.select<any>('user_sessions', {
      select: 'id',
      filters: { user_id: userId },
    });

    if (result.data) {
      // Remove from cache
      for (const session of result.data) {
        await this.cacheManager.delete(this.getSessionKey(session.id));
      }
    }

    // Remove from database
    await helper.delete('user_sessions', { user_id: userId });

    logger.info('All user sessions deleted', { userId });
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const helper = database.createQueryHelper(this.client);

    // Get expired session IDs
    const expiredResult = await helper.rpc<any>('get_expired_sessions', {});

    if (expiredResult.error || !expiredResult.data) {
      return 0;
    }

    const expiredSessionIds = expiredResult.data.map((s: any) => s.id);

    // Remove from cache
    for (const sessionId of expiredSessionIds) {
      await this.cacheManager.delete(this.getSessionKey(sessionId));
    }

    // Remove from database
    const deleteResult = await helper.rpc<number>('cleanup_expired_sessions', {});
    const deletedCount = deleteResult.data || 0;

    logger.info('Expired sessions cleaned up', { deletedCount });

    return deletedCount;
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  }

  private getSessionKey(sessionId: string): string {
    return `${SessionManager.SESSION_PREFIX}${sessionId}`;
  }

  private extractIpAddress(request?: Request): string | undefined {
    if (!request) return undefined;

    // Try various headers for IP address
    const headers = ['x-forwarded-for', 'x-real-ip', 'x-client-ip', 'cf-connecting-ip'];

    for (const header of headers) {
      const value = request.headers.get(header);
      if (value) {
        // Take the first IP if there are multiple
        return value.split(',')[0].trim();
      }
    }

    return undefined;
  }
}

/**
 * Permission checker utility
 */
export class PermissionChecker {
  private static readonly ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ['*'], // Admin has all permissions
    user: [
      'profile:read',
      'profile:update',
      'api-keys:create',
      'api-keys:read',
      'api-keys:delete',
      'billing:read',
      'billing:create-session',
      'billing:portal',
    ],
    readonly: ['profile:read', 'billing:read'],
  };

  /**
   * Check if user has permission
   */
  static hasPermission(
    user: UserContext,
    action: string,
    resource: string,
    requirement?: PermissionRequirement
  ): boolean {
    // Admin always has permission
    if (user.role === 'admin') {
      return true;
    }

    // Check explicit permissions
    const permission = `${resource}:${action}`;
    if (user.permissions?.includes(permission) || user.permissions?.includes('*')) {
      return true;
    }

    // Check role-based permissions
    const rolePermissions = this.ROLE_PERMISSIONS[user.role || 'user'] || [];
    if (rolePermissions.includes(permission) || rolePermissions.includes('*')) {
      return true;
    }

    // Check ownership if allowed
    if (requirement?.allowOwnership && this.checkOwnership(user, requirement, action, resource)) {
      return true;
    }

    return false;
  }

  /**
   * Require permission (throws error if not allowed)
   */
  static requirePermission(
    user: UserContext,
    action: string,
    resource: string,
    requirement?: PermissionRequirement
  ): void {
    if (!this.hasPermission(user, action, resource, requirement)) {
      throw new AuthorizationError(`Insufficient permissions for ${action} on ${resource}`, {
        code: ErrorCode.FORBIDDEN,
        context: {
          userId: user.id,
          userRole: user.role,
          requiredPermission: `${resource}:${action}`,
          userPermissions: user.permissions,
        },
      });
    }
  }

  /**
   * Check subscription requirement
   */
  static requireSubscription(user: UserContext, tier?: string): void {
    if (!user.subscription || user.subscription.status !== 'active') {
      throw new AuthorizationError('Active subscription required', {
        code: ErrorCode.SUBSCRIPTION_REQUIRED,
        context: {
          userId: user.id,
          subscriptionStatus: user.subscription?.status,
          requiredTier: tier,
        },
      });
    }

    if (tier && user.subscription.plan !== tier) {
      throw new AuthorizationError(`Subscription tier '${tier}' required`, {
        code: ErrorCode.SUBSCRIPTION_TIER_REQUIRED,
        context: {
          userId: user.id,
          currentTier: user.subscription.plan,
          requiredTier: tier,
        },
      });
    }
  }

  private static checkOwnership(
    user: UserContext,
    requirement: PermissionRequirement,
    action: string,
    resource: string
  ): boolean {
    // This is a simplified ownership check
    // In practice, you'd query the database to check ownership
    return false; // Default to no ownership
  }
}

/**
 * Main authentication middleware factory
 */
export class AuthMiddlewareFactory {
  private sessionManager = new SessionManager();

  /**
   * Create authentication middleware with configuration
   */
  createMiddleware(config: AuthMiddlewareConfig) {
    return async (request: Request, context: ErrorContext = {}): Promise<AuthMiddlewareResult> => {
      const startTime = Date.now();
      let user: UserContext | null = null;
      let session: SessionData | null = null;

      try {
        // Apply rate limiting if configured
        if (config.rateLimit) {
          await this.applyRateLimit(request, config.rateLimit);
        }

        // Authenticate based on strategy
        switch (config.strategy) {
          case AuthStrategy.JWT_REQUIRED:
            user = await this.authenticateJWT(request, true);
            break;
          case AuthStrategy.API_KEY_REQUIRED:
            user = await this.authenticateApiKey(request, true);
            break;
          case AuthStrategy.JWT_OR_API_KEY:
            user = await this.authenticateFlexible(request, true);
            break;
          case AuthStrategy.OPTIONAL:
            user = await this.authenticateFlexible(request, false);
            break;
          case AuthStrategy.PUBLIC:
            // No authentication required
            break;
        }

        // Get or create session if user is authenticated
        if (user && config.session?.required) {
          session = await this.getOrCreateSession(user, request, config.session.extend);
        }

        // Check permissions
        if (config.permissions && user) {
          for (const permission of config.permissions) {
            if (permission.condition) {
              const allowed = await permission.condition(user, request);
              if (!allowed) {
                throw new AuthorizationError(
                  `Custom permission check failed for ${permission.action} on ${permission.resource}`
                );
              }
            } else {
              PermissionChecker.requirePermission(
                user,
                permission.action,
                permission.resource,
                permission
              );
            }
          }
        }

        // Create result with helper functions
        const result: AuthMiddlewareResult = {
          user: user || this.createAnonymousUser(),
          session: session || undefined, // Convert null to undefined
          permissions: user?.permissions || [],
          hasPermission: (action: string, resource: string) =>
            user ? PermissionChecker.hasPermission(user, action, resource) : false,
          requirePermission: (action: string, resource: string) => {
            if (!user) {
              throw new AuthenticationError('Authentication required');
            }
            PermissionChecker.requirePermission(user, action, resource);
          },
        };

        // Log successful access
        if (config.audit?.logAccess && user) {
          this.logAccess(request, user, true, Date.now() - startTime);
        }

        return result;
      } catch (error: any) {
        // Log failed access
        if (config.audit?.logFailures) {
          this.logAccess(request, user, false, Date.now() - startTime, error);
        }

        throw error;
      }
    };
  }

  /**
   * Authenticate using JWT token
   */
  private async authenticateJWT(request: Request, required: boolean): Promise<UserContext | null> {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      if (required) {
        throw new AuthenticationError('Bearer token required');
      }
      return null;
    }

    const token = authHeader.substring(7);

    try {
      const supabase = createSupabaseClient(token);
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        throw new AuthenticationError('Invalid or expired token');
      }

      return await this.buildUserContext(user, token);
    } catch (error: any) {
      if (required) {
        throw new AuthenticationError('Token validation failed');
      }
      return null;
    }
  }

  /**
   * Authenticate using API key
   */
  private async authenticateApiKey(
    request: Request,
    required: boolean
  ): Promise<UserContext | null> {
    const apiKey = request.headers.get('X-API-Key');

    if (!apiKey) {
      if (required) {
        throw new AuthenticationError('API key required');
      }
      return null;
    }

    // Validate API key (implement your API key validation logic)
    const keyInfo = await this.validateApiKey(apiKey);

    if (!keyInfo) {
      if (required) {
        throw new AuthenticationError('Invalid API key');
      }
      return null;
    }

    return await this.buildUserContextFromApiKey(keyInfo);
  }

  /**
   * Flexible authentication (JWT or API key)
   */
  private async authenticateFlexible(
    request: Request,
    required: boolean
  ): Promise<UserContext | null> {
    // Try JWT first
    try {
      const user = await this.authenticateJWT(request, false);
      if (user) return user;
    } catch {
      // Continue to API key
    }

    // Try API key
    try {
      const user = await this.authenticateApiKey(request, false);
      if (user) return user;
    } catch {
      // Continue
    }

    if (required) {
      throw new AuthenticationError('Authentication required (JWT or API key)');
    }

    return null;
  }

  private async applyRateLimit(request: Request, config: any): Promise<void> {
    const identifier = config.keyGenerator
      ? config.keyGenerator(request)
      : this.extractIpAddress(request) || 'anonymous';

    const isAllowed = await rateLimiter.checkLimit(
      identifier,
      config.requestsPerMinute,
      config.windowMs || 60000
    );

    if (!isAllowed) {
      throw new AppError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded', {
        details: {
          limit: config.requestsPerMinute,
          windowMs: config.windowMs || 60000,
          identifier,
        },
        retryable: true,
      });
    }
  }

  private async getOrCreateSession(
    user: UserContext,
    request: Request,
    extend: boolean
  ): Promise<SessionData | null> {
    // Extract session ID from request (e.g., from cookies or headers)
    const sessionId = request.headers.get('X-Session-ID');

    if (sessionId) {
      const session = await this.sessionManager.getSession(sessionId);
      if (session && extend) {
        await this.sessionManager.touchSession(sessionId);
      }
      return session;
    }

    // Create new session if needed
    return await this.sessionManager.createSession(
      user.id,
      user.email || '',
      user.role || 'user',
      user.permissions || [],
      {},
      request
    );
  }

  private async buildUserContext(user: User, token?: string): Promise<UserContext> {
    // Get user profile with additional data
    const helper = database.createQueryHelper(database.getServiceClient());
    const profileResult = await helper.select<any>('profiles', {
      filters: { id: user.id },
      limit: 1,
    });

    const profile = profileResult.data?.[0];

    return {
      id: user.id,
      email: user.email,
      role: profile?.role || 'user',
      permissions: profile?.permissions ? JSON.parse(profile.permissions) : [],
      metadata: profile?.metadata ? JSON.parse(profile.metadata) : {},
      subscription: profile?.stripe_subscription_status
        ? {
            status: profile.stripe_subscription_status,
            plan: profile.subscription_tier || 'basic',
            expiresAt: profile.subscription_expires_at,
          }
        : undefined,
    };
  }

  private async buildUserContextFromApiKey(keyInfo: ApiKeyInfo): Promise<UserContext> {
    // Build user context from API key info
    return {
      id: keyInfo.userId,
      email: undefined,
      role: 'api',
      permissions: keyInfo.permissions || [],
      metadata: {},
      apiKeyId: keyInfo.id,
      isApiKey: true,
    };
  }

  private async validateApiKey(apiKey: string): Promise<ApiKeyInfo | null> {
    // Implement API key validation logic
    // This should hash the key and check against the database
    return null; // Placeholder
  }

  private createAnonymousUser(): UserContext {
    return {
      id: 'anonymous',
      role: 'anonymous',
      permissions: [],
    };
  }

  private extractIpAddress(request: Request): string | undefined {
    const headers = ['x-forwarded-for', 'x-real-ip', 'x-client-ip'];

    for (const header of headers) {
      const value = request.headers.get(header);
      if (value) {
        return value.split(',')[0].trim();
      }
    }

    return undefined;
  }

  private logAccess(
    request: Request,
    user: UserContext | null,
    success: boolean,
    duration: number,
    error?: any
  ): void {
    logger.info('Auth middleware access', {
      userId: user?.id,
      userRole: user?.role,
      success,
      duration,
      url: request.url,
      method: request.method,
      error: error?.message,
    });
  }
}

// Export singleton instances
export const sessionManager = new SessionManager();
export const authMiddlewareFactory = new AuthMiddlewareFactory();

// Export convenience functions
export const auth = {
  // Middleware creation
  createMiddleware: (config: AuthMiddlewareConfig) =>
    authMiddlewareFactory.createMiddleware(config),

  // Session management
  sessions: sessionManager,

  // Permission checking
  hasPermission: PermissionChecker.hasPermission,
  requirePermission: PermissionChecker.requirePermission,
  requireSubscription: PermissionChecker.requireSubscription,

  // Common middleware configurations
  requireJWT: (permissions?: PermissionRequirement[]) => ({
    strategy: AuthStrategy.JWT_REQUIRED,
    permissions,
    audit: { logAccess: true, logFailures: true },
  }),

  requireApiKey: (permissions?: PermissionRequirement[]) => ({
    strategy: AuthStrategy.API_KEY_REQUIRED,
    permissions,
    audit: { logAccess: true, logFailures: true },
  }),

  optional: () => ({
    strategy: AuthStrategy.OPTIONAL,
    audit: { logFailures: true },
  }),

  public: () => ({
    strategy: AuthStrategy.PUBLIC,
  }),
};
