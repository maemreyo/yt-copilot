// Comprehensive authentication utilities with JWT, API keys, permissions, and Supabase integration

import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { env } from '../config/environment';
import { AppError, AuthenticationError, ErrorCode, ErrorContext, errorUtils } from './errors';

/**
 * User context interface
 */
export interface UserContext {
  id: string;
  email?: string;
  role?: string;
  permissions?: string[];
  metadata?: Record<string, unknown>;
  apiKeyId?: string;
  isApiKey?: boolean;
  subscription?: {
    status: string;
    plan: string;
    expiresAt?: string;
  };
}

/**
 * Authentication result interface
 */
export interface AuthResult {
  user: UserContext;
  supabaseUser?: User;
  token?: string;
  apiKey?: ApiKeyInfo;
}

/**
 * API Key information interface
 */
export interface ApiKeyInfo {
  id: string;
  userId: string;
  prefix: string;
  name?: string;
  permissions?: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  rateLimit?: {
    requestsPerMinute: number;
    windowMs: number;
  };
}

/**
 * Permission interface
 */
export interface Permission {
  action: string;
  resource: string;
  condition?: Record<string, unknown>;
}

/**
 * Role-based permissions mapping
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],
  user: [
    'api-keys:create',
    'api-keys:read',
    'api-keys:delete',
    'profile:read',
    'profile:update',
    'billing:read',
    'billing:create-session',
    'billing:portal',
  ],
  readonly: ['profile:read', 'billing:read'],
};

/**
 * Supabase client factory
 */
export function createSupabaseClient(token?: string): SupabaseClient {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  if (token) {
    client.auth.setSession({
      access_token: token,
      refresh_token: '',
    });
  }

  return client;
}

/**
 * Service role Supabase client (for admin operations)
 */
export function createServiceClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * JWT verification utilities
 */
export class JWTVerifier {
  private static supabase = createSupabaseClient();

  /**
   * Verify JWT token with Supabase
   */
  static async verifyToken(token: string, context?: ErrorContext): Promise<User> {
    try {
      const {
        data: { user },
        error,
      } = await this.supabase.auth.getUser(token);

      if (error) {
        throw errorUtils.auth.invalidToken(context);
      }

      if (!user) {
        throw errorUtils.auth.invalidToken(context);
      }

      return user;
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AuthenticationError('Token verification failed', error, context);
    }
  }

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string | null): string {
    if (!authHeader) {
      throw errorUtils.auth.missingToken();
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw errorUtils.auth.invalidToken();
    }

    const token = authHeader.substring(7);
    if (!token) {
      throw errorUtils.auth.invalidToken();
    }

    return token;
  }

  /**
   * Verify and extract user from request
   */
  static async verifyRequest(request: Request, context?: ErrorContext): Promise<User> {
    const authHeader = request.headers.get('Authorization');
    const token = this.extractTokenFromHeader(authHeader);
    return this.verifyToken(token, context);
  }
}

/**
 * API Key verification utilities
 */
export class ApiKeyVerifier {
  private static serviceClient = createServiceClient();

  /**
   * Verify API key and get associated user
   */
  static async verifyApiKey(apiKey: string, context?: ErrorContext): Promise<ApiKeyInfo> {
    try {
      // Extract prefix (first 8 characters)
      const prefix = apiKey.substring(0, 8);

      // Get API key from database
      const { data: keyData, error } = await this.serviceClient
        .from('api_keys')
        .select('id, user_id, key_hash, name, expires_at, created_at')
        .eq('key_prefix', prefix)
        .single();

      if (error || !keyData) {
        throw new AppError(ErrorCode.INVALID_API_KEY, 'Invalid API key', {
          context,
        });
      }

      // Check if API key is expired
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        throw new AppError(ErrorCode.API_KEY_EXPIRED, 'API key expired', {
          context,
        });
      }

      // TODO: Verify hash using bcrypt
      // const isValid = await bcrypt.compare(apiKey, keyData.key_hash);
      // if (!isValid) {
      //   throw new AppError(ErrorCode.INVALID_API_KEY, 'Invalid API key', { context });
      // }

      // Update last used timestamp
      await this.serviceClient
        .from('api_keys')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', keyData.id);

      return {
        id: keyData.id,
        userId: keyData.user_id,
        prefix,
        name: keyData.name,
        expiresAt: keyData.expires_at,
        lastUsedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(ErrorCode.INVALID_API_KEY, 'API key verification failed', {
        details: error,
        context,
      });
    }
  }

  /**
   * Extract API key from request headers
   */
  static extractApiKeyFromHeader(request: Request): string {
    const apiKeyHeader =
      request.headers.get('X-API-Key') ||
      request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!apiKeyHeader) {
      throw errorUtils.auth.missingToken();
    }

    return apiKeyHeader;
  }

  /**
   * Verify API key from request
   */
  static async verifyRequest(request: Request, context?: ErrorContext): Promise<ApiKeyInfo> {
    const apiKey = this.extractApiKeyFromHeader(request);
    return this.verifyApiKey(apiKey, context);
  }
}

/**
 * User context builder
 */
export class UserContextBuilder {
  private static serviceClient = createServiceClient();

  /**
   * Build user context from Supabase user
   */
  static async fromSupabaseUser(user: User, context?: ErrorContext): Promise<UserContext> {
    try {
      // Get user profile
      const { data: profile, error } = await this.serviceClient
        .from('profiles')
        .select('stripe_customer_id, stripe_subscription_id, stripe_subscription_status')
        .eq('id', user.id)
        .single();

      if (error) {
        console.warn('Failed to fetch user profile:', error);
      }

      // Extract role from user metadata
      const role = user.user_metadata?.role || user.app_metadata?.role || 'user';

      return {
        id: user.id,
        email: user.email,
        role,
        permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.user,
        metadata: {
          ...user.user_metadata,
          ...user.app_metadata,
        },
        subscription: profile
          ? {
              status: profile.stripe_subscription_status || 'none',
              plan: 'basic', // TODO: Extract from Stripe
            }
          : undefined,
      };
    } catch (error: any) {
      throw new AuthenticationError('Failed to build user context', error, context);
    }
  }

  /**
   * Build user context from API key
   */
  static async fromApiKey(apiKeyInfo: ApiKeyInfo, context?: ErrorContext): Promise<UserContext> {
    try {
      // Get user from API key
      const { data: user, error } = await this.serviceClient.auth.admin.getUserById(
        apiKeyInfo.userId
      );

      if (error || !user) {
        throw new AuthenticationError('User not found for API key', error, context);
      }

      const userContext = await this.fromSupabaseUser(user.user, context);

      return {
        ...userContext,
        apiKeyId: apiKeyInfo.id,
        isApiKey: true,
        permissions: apiKeyInfo.permissions || userContext.permissions,
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AuthenticationError('Failed to build user context from API key', error, context);
    }
  }
}

/**
 * Permission checking utilities
 */
export class PermissionChecker {
  /**
   * Check if user has specific permission
   */
  static hasPermission(userContext: UserContext, permission: string): boolean {
    if (!userContext.permissions) {
      return false;
    }

    // Admin has all permissions
    if (userContext.permissions.includes('*')) {
      return true;
    }

    return userContext.permissions.includes(permission);
  }

  /**
   * Check multiple permissions (all required)
   */
  static hasAllPermissions(userContext: UserContext, permissions: string[]): boolean {
    return permissions.every(permission => this.hasPermission(userContext, permission));
  }

  /**
   * Check multiple permissions (any required)
   */
  static hasAnyPermission(userContext: UserContext, permissions: string[]): boolean {
    return permissions.some(permission => this.hasPermission(userContext, permission));
  }

  /**
   * Check resource-specific permission
   */
  static hasResourcePermission(
    userContext: UserContext,
    action: string,
    resource: string,
    resourceOwnerId?: string
  ): boolean {
    const permission = `${resource}:${action}`;

    // Check direct permission
    if (this.hasPermission(userContext, permission)) {
      return true;
    }

    // Check if user owns the resource
    if (resourceOwnerId && userContext.id === resourceOwnerId) {
      const ownerPermission = `${resource}:${action}:own`;
      return this.hasPermission(userContext, ownerPermission);
    }

    return false;
  }

  /**
   * Require permission (throws error if not authorized)
   */
  static requirePermission(
    userContext: UserContext,
    permission: string,
    context?: ErrorContext
  ): void {
    if (!this.hasPermission(userContext, permission)) {
      throw errorUtils.authz.insufficient(
        'resource',
        permission.split(':')[1] || 'access',
        context
      );
    }
  }

  /**
   * Require subscription
   */
  static requireSubscription(userContext: UserContext, context?: ErrorContext): void {
    if (!userContext.subscription || userContext.subscription.status !== 'active') {
      throw errorUtils.payment.subscriptionRequired(context);
    }
  }
}

/**
 * Authentication middleware factory
 */
export class AuthMiddleware {
  /**
   * Create JWT authentication middleware
   */
  static createJWTMiddleware() {
    return async (request: Request, context?: ErrorContext): Promise<UserContext> => {
      const user = await JWTVerifier.verifyRequest(request, context);
      return UserContextBuilder.fromSupabaseUser(user, context);
    };
  }

  /**
   * Create API key authentication middleware
   */
  static createApiKeyMiddleware() {
    return async (request: Request, context?: ErrorContext): Promise<UserContext> => {
      const apiKeyInfo = await ApiKeyVerifier.verifyRequest(request, context);
      return UserContextBuilder.fromApiKey(apiKeyInfo, context);
    };
  }

  /**
   * Create flexible authentication middleware (JWT or API key)
   */
  static createFlexibleMiddleware() {
    return async (request: Request, context?: ErrorContext): Promise<UserContext> => {
      const authHeader = request.headers.get('Authorization');
      const apiKeyHeader = request.headers.get('X-API-Key');

      // Try API key first if present
      if (apiKeyHeader || (authHeader && !authHeader.startsWith('Bearer '))) {
        try {
          const apiKeyInfo = await ApiKeyVerifier.verifyRequest(request, context);
          return UserContextBuilder.fromApiKey(apiKeyInfo, context);
        } catch (error: any) {
          // Fall through to JWT if API key fails
        }
      }

      // Try JWT authentication
      if (authHeader?.startsWith('Bearer ')) {
        const user = await JWTVerifier.verifyRequest(request, context);
        return UserContextBuilder.fromSupabaseUser(user, context);
      }

      throw errorUtils.auth.missingToken(context);
    };
  }

  /**
   * Create permission-based middleware
   */
  static createPermissionMiddleware(requiredPermissions: string | string[]) {
    const permissions = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];

    return async (userContext: UserContext, context?: ErrorContext): Promise<void> => {
      if (!PermissionChecker.hasAllPermissions(userContext, permissions)) {
        throw errorUtils.authz.insufficient('resource', 'access', context);
      }
    };
  }

  /**
   * Create subscription requirement middleware
   */
  static createSubscriptionMiddleware() {
    return async (userContext: UserContext, context?: ErrorContext): Promise<void> => {
      PermissionChecker.requireSubscription(userContext, context);
    };
  }

  /**
   * Create rate limiting middleware for authenticated users
   */
  static createUserRateLimitMiddleware(requestsPerMinute: number = 60) {
    const userRequests = new Map<string, { count: number; resetTime: number }>();

    return async (userContext: UserContext, context?: ErrorContext): Promise<void> => {
      const userId = userContext.isApiKey
        ? `api:${userContext.apiKeyId}`
        : `user:${userContext.id}`;
      const now = Date.now();
      const windowMs = 60 * 1000; // 1 minute

      const userLimit = userRequests.get(userId);

      if (!userLimit || now > userLimit.resetTime) {
        userRequests.set(userId, { count: 1, resetTime: now + windowMs });
        return;
      }

      if (userLimit.count >= requestsPerMinute) {
        throw new AppError(ErrorCode.RATE_LIMIT_EXCEEDED, 'User rate limit exceeded', {
          details: { limit: requestsPerMinute, windowMs },
          context,
          retryable: true,
        });
      }

      userLimit.count++;
    };
  }
}

/**
 * Session management utilities
 */
export class SessionManager {
  private static serviceClient = createServiceClient();

  /**
   * Create user session
   */
  static async createSession(userId: string, metadata?: Record<string, unknown>): Promise<string> {
    // TODO: Implement session creation with Redis or database
    // For now, return a simple session token
    return `session_${userId}_${Date.now()}`;
  }

  /**
   * Validate session
   */
  static async validateSession(sessionToken: string): Promise<UserContext | null> {
    // TODO: Implement session validation
    return null;
  }

  /**
   * Revoke session
   */
  static async revokeSession(sessionToken: string): Promise<void> {
    // TODO: Implement session revocation
  }

  /**
   * Revoke all user sessions
   */
  static async revokeAllUserSessions(userId: string): Promise<void> {
    // TODO: Implement all sessions revocation for user
  }
}

/**
 * Authentication utilities export
 */
export const authUtils = {
  jwt: JWTVerifier,
  apiKey: ApiKeyVerifier,
  context: UserContextBuilder,
  permissions: PermissionChecker,
  middleware: AuthMiddleware,
  session: SessionManager,

  /**
   * Quick user authentication from request
   */
  async authenticateRequest(request: Request, context?: ErrorContext): Promise<UserContext> {
    return AuthMiddleware.createFlexibleMiddleware()(request, context);
  },

  /**
   * Quick permission check
   */
  hasPermission: PermissionChecker.hasPermission,
  requirePermission: PermissionChecker.requirePermission,
  requireSubscription: PermissionChecker.requireSubscription,

  /**
   * Create Supabase client with authentication
   */
  createAuthenticatedClient: (token: string) => createSupabaseClient(token),
  createServiceClient,
};
