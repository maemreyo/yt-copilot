// - User profile management endpoints using Layer 1 & 2 utilities

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import {
  corsHeaders,
  createCorsErrorResponse,
  createCorsResponse,
  createCorsSuccessResponse,
} from '@/cors';
import { createSecureResponse, securityHeaders } from '@/shared-security';
import {
  AppError,
  createAppError,
  ErrorType,
  handleUnknownError,
} from '@/shared-errors';

/**
 * User profile interface
 */
interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: 'admin' | 'user' | 'readonly';
  permissions: string[];
  metadata: Record<string, unknown>;
  subscription?: {
    status: string;
    plan: string;
    expiresAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Profile update request interface
 */
interface ProfileUpdateRequest {
  name?: string;
  avatar_url?: string;
  metadata?: Record<string, unknown>;
  preferences?: {
    theme?: 'light' | 'dark' | 'system';
    language?: string;
    timezone?: string;
    notifications?: {
      email: boolean;
      push: boolean;
      marketing: boolean;
    };
  };
}

/**
 * Account deletion request interface
 */
interface AccountDeletionRequest {
  confirmEmail: string;
  reason?: string;
  deleteData?: boolean;
}

/**
 * Profile service for user management operations
 */
class ProfileService {
  private supabase: any;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      {
        auth: { persistSession: false },
        global: {
          headers: { 'x-application-name': 'profile-service' },
        },
      },
    );
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      // Get user from auth.users
      const { data: user, error: userError } = await this.supabase.auth.admin
        .getUserById(userId);

      if (userError) {
        console.error('Failed to get user:', userError);
        throw new Error(`Failed to get user: ${userError.message}`);
      }

      if (!user) {
        return null;
      }

      // Get profile data
      const { data: profile, error: profileError } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError && profileError.code !== 'PGRST116') { // PGRST116 = no rows
        console.error('Failed to get profile:', profileError);
        throw new Error(`Failed to get profile: ${profileError.message}`);
      }

      // Build complete profile
      const userProfile: UserProfile = {
        id: user.id,
        email: user.email || '',
        name: profile?.name || user.user_metadata?.name || '',
        avatar_url: profile?.avatar_url || user.user_metadata?.avatar_url,
        role: profile?.role || 'user',
        permissions: profile?.permissions
          ? JSON.parse(profile.permissions)
          : [],
        metadata: profile?.metadata ? JSON.parse(profile.metadata) : {},
        subscription: profile?.stripe_subscription_status
          ? {
            status: profile.stripe_subscription_status,
            plan: profile.subscription_tier || 'basic',
            expiresAt: profile.subscription_expires_at,
          }
          : undefined,
        createdAt: user.created_at,
        updatedAt: profile?.updated_at || user.created_at,
      };

      return userProfile;
    } catch (error: any) {
      console.error('Error getting user profile:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(
    userId: string,
    updates: ProfileUpdateRequest,
  ): Promise<UserProfile> {
    try {
      // Validate updates
      const validation = this.validateProfileUpdate(updates);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const sanitizedUpdates = validation.sanitized;

      // Update auth.users metadata if needed
      if (sanitizedUpdates.name || sanitizedUpdates.avatar_url) {
        const userMetadataUpdates: any = {};
        if (sanitizedUpdates.name) {
          userMetadataUpdates.name = sanitizedUpdates.name;
        }
        if (sanitizedUpdates.avatar_url) {
          userMetadataUpdates.avatar_url = sanitizedUpdates.avatar_url;
        }

        const { error: authError } = await this.supabase.auth.admin
          .updateUserById(
            userId,
            { user_metadata: userMetadataUpdates },
          );

        if (authError) {
          console.error('Failed to update user metadata:', authError);
          throw new Error(
            `Failed to update user metadata: ${authError.message}`,
          );
        }
      }

      // Update profiles table
      const profileUpdates: any = {
        updated_at: new Date().toISOString(),
      };

      if (sanitizedUpdates.name) profileUpdates.name = sanitizedUpdates.name;
      if (sanitizedUpdates.avatar_url) {
        profileUpdates.avatar_url = sanitizedUpdates.avatar_url;
      }
      if (sanitizedUpdates.metadata) {
        profileUpdates.metadata = JSON.stringify(sanitizedUpdates.metadata);
      }

      const { error: profileError } = await this.supabase
        .from('profiles')
        .upsert(
          { id: userId, ...profileUpdates },
          { onConflict: 'id' },
        );

      if (profileError) {
        console.error('Failed to update profile:', profileError);
        throw new Error(`Failed to update profile: ${profileError.message}`);
      }

      // Log profile update
      await this.logProfileUpdate(userId, sanitizedUpdates);

      // Return updated profile
      const updatedProfile = await this.getUserProfile(userId);
      if (!updatedProfile) {
        throw new Error('Failed to retrieve updated profile');
      }

      return updatedProfile;
    } catch (error: any) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  }

  /**
   * Delete user account
   */
  async deleteUserAccount(
    userId: string,
    request: AccountDeletionRequest,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get user profile for validation
      const profile = await this.getUserProfile(userId);
      if (!profile) {
        throw new Error('User profile not found');
      }

      // Validate deletion request
      if (request.confirmEmail !== profile.email) {
        throw new Error('Confirmation email does not match user email');
      }

      // Check if user has active subscription
      if (profile.subscription && profile.subscription.status === 'active') {
        throw new Error(
          'Cannot delete account with active subscription. Please cancel subscription first.',
        );
      }

      // Begin account deletion process
      await this.performAccountDeletion(userId, request);

      // Log account deletion
      await this.logAccountDeletion(userId, request);

      return {
        success: true,
        message: 'Account deletion completed successfully',
      };
    } catch (error: any) {
      console.error('Error deleting user account:', error);
      throw error;
    }
  }

  /**
   * Validate profile update request
   */
  private validateProfileUpdate(updates: ProfileUpdateRequest): {
    isValid: boolean;
    errors: string[];
    sanitized: ProfileUpdateRequest;
  } {
    const errors: string[] = [];
    const sanitized: ProfileUpdateRequest = {};

    // Validate name
    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string') {
        errors.push('Name must be a string');
      } else if (updates.name.length < 1 || updates.name.length > 100) {
        errors.push('Name must be between 1 and 100 characters');
      } else {
        sanitized.name = updates.name.trim();
      }
    }

    // Validate avatar_url
    if (updates.avatar_url !== undefined) {
      if (typeof updates.avatar_url !== 'string') {
        errors.push('Avatar URL must be a string');
      } else if (updates.avatar_url && !this.isValidUrl(updates.avatar_url)) {
        errors.push('Avatar URL must be a valid URL');
      } else {
        sanitized.avatar_url = updates.avatar_url.trim();
      }
    }

    // Validate metadata
    if (updates.metadata !== undefined) {
      if (typeof updates.metadata !== 'object' || updates.metadata === null) {
        errors.push('Metadata must be an object');
      } else {
        try {
          // Test JSON serialization
          JSON.stringify(updates.metadata);
          sanitized.metadata = updates.metadata;
        } catch {
          errors.push('Metadata must be JSON serializable');
        }
      }
    }

    // Validate preferences
    if (updates.preferences !== undefined) {
      const prefErrors = this.validatePreferences(updates.preferences);
      errors.push(...prefErrors);
      if (prefErrors.length === 0) {
        sanitized.preferences = updates.preferences;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  /**
   * Validate user preferences
   */
  private validatePreferences(preferences: any): string[] {
    const errors: string[] = [];

    if (typeof preferences !== 'object' || preferences === null) {
      errors.push('Preferences must be an object');
      return errors;
    }

    // Validate theme
    if (preferences.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(preferences.theme)) {
        errors.push('Theme must be light, dark, or system');
      }
    }

    // Validate language
    if (preferences.language !== undefined) {
      if (
        typeof preferences.language !== 'string' ||
        preferences.language.length !== 2
      ) {
        errors.push('Language must be a 2-character language code');
      }
    }

    // Validate timezone
    if (preferences.timezone !== undefined) {
      if (typeof preferences.timezone !== 'string') {
        errors.push('Timezone must be a string');
      }
    }

    // Validate notifications
    if (preferences.notifications !== undefined) {
      const notif = preferences.notifications;
      if (typeof notif !== 'object' || notif === null) {
        errors.push('Notifications must be an object');
      } else {
        if (notif.email !== undefined && typeof notif.email !== 'boolean') {
          errors.push('Email notifications must be a boolean');
        }
        if (notif.push !== undefined && typeof notif.push !== 'boolean') {
          errors.push('Push notifications must be a boolean');
        }
        if (
          notif.marketing !== undefined && typeof notif.marketing !== 'boolean'
        ) {
          errors.push('Marketing notifications must be a boolean');
        }
      }
    }

    return errors;
  }

  /**
   * Check if string is valid URL
   */
  private isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform account deletion
   */
  private async performAccountDeletion(
    userId: string,
    request: AccountDeletionRequest,
  ): Promise<void> {
    try {
      // Delete related data based on request
      if (request.deleteData) {
        // Delete user sessions
        await this.supabase
          .from('user_sessions')
          .delete()
          .eq('user_id', userId);

        // Delete API keys
        await this.supabase
          .from('api_keys')
          .delete()
          .eq('user_id', userId);

        // Delete profile
        await this.supabase
          .from('profiles')
          .delete()
          .eq('id', userId);
      } else {
        // Anonymize data instead of deletion
        await this.supabase
          .from('profiles')
          .update({
            name: 'Deleted User',
            avatar_url: null,
            metadata: JSON.stringify({}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        // Revoke all sessions and API keys
        await this.supabase
          .from('user_sessions')
          .update({
            is_active: false,
            revoked_at: new Date().toISOString(),
            revoked_reason: 'Account deleted',
          })
          .eq('user_id', userId);

        await this.supabase
          .from('api_keys')
          .update({
            is_active: false,
            revoked_at: new Date().toISOString(),
            revoked_reason: 'Account deleted',
          })
          .eq('user_id', userId);
      }

      // Delete user from auth.users
      const { error: deleteError } = await this.supabase.auth.admin.deleteUser(
        userId,
      );
      if (deleteError) {
        console.error('Failed to delete user from auth:', deleteError);
        throw new Error(`Failed to delete user: ${deleteError.message}`);
      }
    } catch (error: any) {
      console.error('Error performing account deletion:', error);
      throw error;
    }
  }

  /**
   * Log profile update for audit trail
   */
  private async logProfileUpdate(
    userId: string,
    updates: ProfileUpdateRequest,
  ): Promise<void> {
    try {
      const auditEntry = {
        user_id: userId,
        action: 'profile_update',
        resource_type: 'profile',
        resource_id: userId,
        details: JSON.stringify({
          updatedFields: Object.keys(updates),
          timestamp: new Date().toISOString(),
        }),
        created_at: new Date().toISOString(),
      };

      await this.supabase
        .from('audit_logs')
        .insert(auditEntry);
    } catch (error: any) {
      console.error('Failed to log profile update:', error);
      // Don't throw - audit logging failure shouldn't break the operation
    }
  }

  /**
   * Log account deletion for audit trail
   */
  private async logAccountDeletion(
    userId: string,
    request: AccountDeletionRequest,
  ): Promise<void> {
    try {
      const auditEntry = {
        user_id: userId,
        action: 'account_deletion',
        resource_type: 'user',
        resource_id: userId,
        details: JSON.stringify({
          reason: request.reason,
          deleteData: request.deleteData,
          timestamp: new Date().toISOString(),
        }),
        created_at: new Date().toISOString(),
      };

      await this.supabase
        .from('audit_logs')
        .insert(auditEntry);
    } catch (error: any) {
      console.error('Failed to log account deletion:', error);
      // Don't throw - audit logging failure shouldn't break the operation
    }
  }
}

// Security headers are now imported from @/shared-security

/**
 * Extract user ID from JWT token
 */
async function extractUserFromRequest(
  request: Request,
): Promise<{ userId: string; email: string } | null> {
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
      email: user.email || '',
    };
  } catch (error: any) {
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
    const service = new ProfileService();
    const url = new URL(req.url);
    const path = url.pathname;

    // Extract authenticated user
    const userInfo = await extractUserFromRequest(req);
    if (!userInfo) {
      throw createAppError(
        ErrorType.AUTHENTICATION_ERROR,
        'Valid authentication token required',
        { code: 'AUTHENTICATION_REQUIRED' },
        requestId,
      );
    }

    // Route handling
    if (req.method === 'GET' && path.endsWith('/profile')) {
      return await handleGetProfile(service, userInfo.userId);
    } else if (req.method === 'PUT' && path.endsWith('/profile')) {
      return await handleUpdateProfile(req, service, userInfo.userId);
    } else if (req.method === 'DELETE' && path.endsWith('/profile')) {
      return await handleDeleteAccount(
        req,
        service,
        userInfo.userId,
        userInfo.email,
      );
    } else {
      throw createAppError(
        ErrorType.NOT_FOUND_ERROR,
        'Endpoint not found',
        {
          code: 'NOT_FOUND',
          availableEndpoints: [
            'GET /profile - Get user profile',
            'PUT /profile - Update user profile',
            'DELETE /profile - Delete user account',
          ],
        },
        requestId,
      );
    }
  } catch (error: any) {
    console.error('Profile management error:', error);

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
 * Handle get profile request
 */
async function handleGetProfile(
  service: ProfileService,
  userId: string,
): Promise<Response> {
  try {
    const profile = await service.getUserProfile(userId);
    if (!profile) {
      throw createAppError(
        ErrorType.NOT_FOUND_ERROR,
        'User profile not found',
        { code: 'PROFILE_NOT_FOUND' },
        crypto.randomUUID(),
      );
    }

    return createCorsSuccessResponse(
      {
        profile,
      },
      200,
      crypto.randomUUID(),
    );
  } catch (error: any) {
    console.error('Error getting profile:', error);

    // If it's already an AppError, return it directly
    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    // For any other unknown errors
    const appError = handleUnknownError(error, crypto.randomUUID());
    return appError.toHttpResponse();
  }
}

/**
 * Handle update profile request
 */
async function handleUpdateProfile(
  req: Request,
  service: ProfileService,
  userId: string,
): Promise<Response> {
  try {
    const body = await req.json();
    const updatedProfile = await service.updateUserProfile(userId, body);

    return new Response(
      JSON.stringify({
        success: true,
        profile: updatedProfile,
        message: 'Profile updated successfully',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...securityHeaders,
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error: any) {
    console.error('Error updating profile:', error);

    const isValidationError = error.message.includes('Validation failed');

    return new Response(
      JSON.stringify({
        error: {
          code: isValidationError ? 'VALIDATION_ERROR' : 'PROFILE_UPDATE_ERROR',
          message: isValidationError
            ? error.message
            : 'Failed to update user profile',
          details: error.message,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: isValidationError ? 400 : 500,
        headers: securityHeaders,
      },
    );
  }
}

/**
 * Handle delete account request
 */
async function handleDeleteAccount(
  req: Request,
  service: ProfileService,
  userId: string,
  userEmail: string,
): Promise<Response> {
  try {
    const body = await req.json();

    // Add user email for validation if not provided
    if (!body.confirmEmail) {
      body.confirmEmail = userEmail;
    }

    const result = await service.deleteUserAccount(userId, body);

    return new Response(
      JSON.stringify({
        success: result.success,
        message: result.message,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...securityHeaders,
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error: any) {
    console.error('Error deleting account:', error);

    const isValidationError = error.message.includes('Confirmation email') ||
      error.message.includes('active subscription');

    return new Response(
      JSON.stringify({
        error: {
          code: isValidationError
            ? 'ACCOUNT_DELETE_VALIDATION_ERROR'
            : 'ACCOUNT_DELETE_ERROR',
          message: isValidationError
            ? error.message
            : 'Failed to delete user account',
          details: error.message,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: isValidationError ? 400 : 500,
        headers: securityHeaders,
      },
    );
  }
}
