// - Session management endpoints using Layer 2 auth middleware

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { createCorsResponse, createCorsSuccessResponse } from '@/cors';
import {
  AppError,
  createAppError,
  ErrorType,
  handleUnknownError,
} from '@/shared-errors';

/**
 * Login request interface
 */
interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
  deviceInfo?: {
    name?: string;
    type?: string;
    browser?: string;
    os?: string;
  };
}

/**
 * Login response interface
 */
interface LoginResponse {
  success: boolean;
  session: {
    id: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
  };
  message: string;
}

/**
 * Session info interface
 */
interface SessionInfo {
  id: string;
  userId: string;
  userEmail: string;
  userRole: string;
  createdAt: string;
  expiresAt: string;
  lastAccessedAt: string;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: {
    name?: string;
    type?: string;
    browser?: string;
    os?: string;
  };
  isActive: boolean;
  isCurrent?: boolean;
}

/**
 * Session management service
 */
class SessionManagementService {
  private supabase: any;
  private supabaseAuth: any;

  constructor() {
    // Service role client for admin operations
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      {
        auth: { persistSession: false },
        global: {
          headers: { 'x-application-name': 'session-service' },
        },
      },
    );

    // Regular client for auth operations
    this.supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      {
        auth: { persistSession: false },
      },
    );
  }

  /**
   * Create user session (login)
   */
  async createSession(
    loginRequest: LoginRequest,
    request: Request,
  ): Promise<LoginResponse> {
    try {
      // Validate login request
      const validation = this.validateLoginRequest(loginRequest);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Authenticate user with Supabase Auth
      const { data: authData, error: authError } = await this.supabaseAuth.auth
        .signInWithPassword({
          email: loginRequest.email,
          password: loginRequest.password,
        });

      if (authError) {
        console.error('Authentication failed:', authError);
        throw new Error('Invalid email or password');
      }

      if (!authData.user || !authData.session) {
        throw new Error('Authentication failed');
      }

      // Get user profile
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('name, role, permissions, metadata')
        .eq('id', authData.user.id)
        .single();

      // Extract request info
      const ipAddress = this.extractIpAddress(request);
      const userAgent = request.headers.get('User-Agent');

      // Create session in database
      const sessionData = {
        id: authData.session.access_token.substring(0, 32), // Use token prefix as session ID
        user_id: authData.user.id,
        user_email: authData.user.email,
        user_role: profile?.role || 'user',
        permissions: JSON.stringify(profile?.permissions || []),
        metadata: JSON.stringify({
          deviceInfo: loginRequest.deviceInfo,
          loginTime: new Date().toISOString(),
          rememberMe: loginRequest.rememberMe || false,
        }),
        created_at: new Date().toISOString(),
        expires_at: new Date(
          Date.now() +
            (loginRequest.rememberMe
              ? 30 * 24 * 60 * 60 * 1000
              : 24 * 60 * 60 * 1000),
        ).toISOString(),
        last_accessed_at: new Date().toISOString(),
        ip_address: ipAddress,
        user_agent: userAgent,
        is_active: true,
      };

      const { error: sessionError } = await this.supabase
        .from('user_sessions')
        .insert(sessionData);

      if (sessionError) {
        console.error('Failed to create session:', sessionError);
        // Don't throw - session creation in DB is optional
      }

      // Log successful login
      await this.logSessionEvent(authData.user.id, 'login', {
        ipAddress,
        userAgent,
        sessionId: sessionData.id,
      });

      return {
        success: true,
        session: {
          id: sessionData.id,
          accessToken: authData.session.access_token,
          refreshToken: authData.session.refresh_token,
          expiresAt: sessionData.expires_at,
          user: {
            id: authData.user.id,
            email: authData.user.email || '',
            name: profile?.name || authData.user.user_metadata?.name || '',
            role: profile?.role || 'user',
          },
        },
        message: 'Login successful',
      };
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  /**
   * Revoke current session (logout)
   */
  async revokeSession(
    sessionId: string,
    request: Request,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get session from database
      const { data: session, error: sessionError } = await this.supabase
        .from('user_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('is_active', true)
        .single();

      if (sessionError || !session) {
        throw new Error('Session not found or already revoked');
      }

      // Revoke session in database
      const { error: revokeError } = await this.supabase
        .from('user_sessions')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_reason: 'User logout',
        })
        .eq('id', sessionId);

      if (revokeError) {
        console.error('Failed to revoke session:', revokeError);
        throw new Error('Failed to revoke session');
      }

      // Log logout event
      await this.logSessionEvent(session.user_id, 'logout', {
        sessionId,
        ipAddress: this.extractIpAddress(request),
        userAgent: request.headers.get('User-Agent'),
      });

      return {
        success: true,
        message: 'Session revoked successfully',
      };
    } catch (error) {
      console.error('Error revoking session:', error);
      throw error;
    }
  }

  /**
   * List user sessions
   */
  async listUserSessions(
    userId: string,
    currentSessionId?: string,
  ): Promise<SessionInfo[]> {
    try {
      const { data: sessions, error } = await this.supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to get user sessions:', error);
        throw new Error('Failed to get user sessions');
      }

      return sessions.map((session: any) => ({
        id: session.id,
        userId: session.user_id,
        userEmail: session.user_email,
        userRole: session.user_role,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
        lastAccessedAt: session.last_accessed_at,
        ipAddress: session.ip_address,
        userAgent: session.user_agent,
        deviceInfo: session.metadata
          ? JSON.parse(session.metadata).deviceInfo
          : undefined,
        isActive: session.is_active,
        isCurrent: session.id === currentSessionId,
      }));
    } catch (error) {
      console.error('Error listing user sessions:', error);
      throw error;
    }
  }

  /**
   * Validate login request
   */
  private validateLoginRequest(request: LoginRequest): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Validate email
    if (!request.email) {
      errors.push('Email is required');
    } else if (typeof request.email !== 'string') {
      errors.push('Email must be a string');
    } else if (!this.isValidEmail(request.email)) {
      errors.push('Email must be a valid email address');
    }

    // Validate password
    if (!request.password) {
      errors.push('Password is required');
    } else if (typeof request.password !== 'string') {
      errors.push('Password must be a string');
    } else if (request.password.length < 1) {
      errors.push('Password cannot be empty');
    }

    // Validate rememberMe
    if (
      request.rememberMe !== undefined &&
      typeof request.rememberMe !== 'boolean'
    ) {
      errors.push('RememberMe must be a boolean');
    }

    // Validate deviceInfo
    if (request.deviceInfo !== undefined) {
      if (
        typeof request.deviceInfo !== 'object' || request.deviceInfo === null
      ) {
        errors.push('DeviceInfo must be an object');
      } else {
        const deviceInfo = request.deviceInfo;
        if (
          deviceInfo.name !== undefined && typeof deviceInfo.name !== 'string'
        ) {
          errors.push('DeviceInfo name must be a string');
        }
        if (
          deviceInfo.type !== undefined && typeof deviceInfo.type !== 'string'
        ) {
          errors.push('DeviceInfo type must be a string');
        }
        if (
          deviceInfo.browser !== undefined &&
          typeof deviceInfo.browser !== 'string'
        ) {
          errors.push('DeviceInfo browser must be a string');
        }
        if (deviceInfo.os !== undefined && typeof deviceInfo.os !== 'string') {
          errors.push('DeviceInfo os must be a string');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Extract IP address from request
   */
  private extractIpAddress(request: Request): string | undefined {
    const headers = [
      'x-forwarded-for',
      'x-real-ip',
      'x-client-ip',
      'cf-connecting-ip',
    ];

    for (const header of headers) {
      const value = request.headers.get(header);
      if (value) {
        return value.split(',')[0].trim();
      }
    }

    return undefined;
  }

  /**
   * Log session event for audit trail
   */
  private async logSessionEvent(
    userId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      const auditEntry = {
        user_id: userId,
        action: `session_${action}`,
        resource_type: 'session',
        resource_id: details.sessionId || 'unknown',
        details: JSON.stringify({
          ...details,
          timestamp: new Date().toISOString(),
        }),
        created_at: new Date().toISOString(),
      };

      await this.supabase
        .from('audit_logs')
        .insert(auditEntry);
    } catch (error) {
      console.error('Failed to log session event:', error);
      // Don't throw - audit logging failure shouldn't break the operation
    }
  }
}

// Security headers are now imported from @/shared-security

/**
 * Extract session ID from request
 */
function extractSessionId(request: Request): string | null {
  // Try to get session ID from various sources
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7, 39); // First 32 chars as session ID
  }

  const sessionHeader = request.headers.get('X-Session-ID');
  if (sessionHeader) {
    return sessionHeader;
  }

  return null;
}

/**
 * Extract user ID from JWT token
 */
async function extractUserFromRequest(
  request: Request,
): Promise<{ userId: string; sessionId?: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);

    // Create Supabase client to verify token
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return {
      userId: user.id,
      sessionId: token.substring(0, 32),
    };
  } catch (error) {
    console.error('Error extracting user from request:', error);
    return null;
  }
}

/**
 * Main serve function
 */
serve(async (req) => {
  // Generate a request ID for tracking
  const requestId = crypto.randomUUID();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

  try {
    const service = new SessionManagementService();
    const url = new URL(req.url);
    const path = url.pathname;

    // Route handling
    if (req.method === 'POST' && path.endsWith('/login')) {
      return await handleLogin(req, service);
    } else if (req.method === 'DELETE' && path.endsWith('/logout')) {
      return await handleLogout(req, service);
    } else if (req.method === 'GET' && path.endsWith('/sessions')) {
      return await handleListSessions(req, service);
    } else {
      throw createAppError(
        ErrorType.NOT_FOUND_ERROR,
        'Endpoint not found',
        {
          code: 'NOT_FOUND',
          availableEndpoints: [
            'POST /login - Create user session',
            'DELETE /logout - Revoke current session',
            'GET /sessions - List user sessions',
          ],
        },
        requestId,
      );
    }
  } catch (error) {
    console.error('Session management error:', error);

    // If it's already an AppError, return it directly
    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    // For any other unknown errors
    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});

/**
 * Handle login request
 */
async function handleLogin(
  req: Request,
  service: SessionManagementService,
): Promise<Response> {
  const requestId = crypto.randomUUID();

  try {
    const body = await req.json();
    const loginResponse = await service.createSession(body, req);

    return createCorsSuccessResponse(loginResponse, 200, requestId);
  } catch (error: any) {
    console.error('Error handling login:', error);

    // If it's already an AppError, return it directly
    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    const isValidationError = error.message.includes('Validation failed');
    const isAuthError = error.message.includes('Invalid email or password');

    if (isValidationError) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        error.message,
        { code: 'VALIDATION_ERROR' },
        requestId,
      );
    } else if (isAuthError) {
      throw createAppError(
        ErrorType.AUTHENTICATION_ERROR,
        error.message,
        { code: 'AUTHENTICATION_ERROR' },
        requestId,
      );
    } else {
      // For any other unknown errors
      const appError = handleUnknownError(error, requestId);
      return appError.toHttpResponse();
    }
  }
}

/**
 * Handle logout request
 */
async function handleLogout(
  req: Request,
  service: SessionManagementService,
): Promise<Response> {
  const requestId = crypto.randomUUID();

  try {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'Session ID required for logout',
        { code: 'SESSION_ID_REQUIRED' },
        requestId,
      );
    }

    const result = await service.revokeSession(sessionId, req);

    return createCorsSuccessResponse(result, 200, requestId);
  } catch (error) {
    console.error('Error handling logout:', error);

    // If it's already an AppError, return it directly
    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    // For any other unknown errors
    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
}

/**
 * Handle list sessions request
 */
async function handleListSessions(
  req: Request,
  service: SessionManagementService,
): Promise<Response> {
  const requestId = crypto.randomUUID();

  try {
    const userInfo = await extractUserFromRequest(req);
    if (!userInfo) {
      throw createAppError(
        ErrorType.AUTHENTICATION_ERROR,
        'Valid authentication token required',
        { code: 'AUTHENTICATION_REQUIRED' },
        requestId,
      );
    }

    const sessions = await service.listUserSessions(
      userInfo.userId,
      userInfo.sessionId,
    );

    return createCorsSuccessResponse(
      {
        sessions,
        count: sessions.length,
      },
      200,
      requestId,
    );
  } catch (error) {
    console.error('Error handling list sessions:', error);

    // If it's already an AppError, return it directly
    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    // For any other unknown errors
    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
}
