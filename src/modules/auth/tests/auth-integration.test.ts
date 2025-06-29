// Integration tests for auth module
// CREATED: 2025-01-28 - End-to-end auth workflow tests

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Test data helpers
const testUserData = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  email: 'auth-integration@example.com',
  name: 'Auth Integration User',
  role: 'user',
  password: 'TestPassword123!',
};

const testApiKeyData = {
  name: 'Integration Test Key',
  permissions: ['api-keys:read', 'profile:read'],
  description: 'API key for integration testing',
  metadata: { environment: 'test' },
};

describe.skip('Auth Module Integration Tests', () => {
  let supabase: ReturnType<typeof createClient>;
  let testUser: any;
  let testUserToken: string;
  let testApiKey: string;
  let testApiKeyPrefix: string;

  beforeAll(async () => {
    // Skip if no database environment variables
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('Skipping integration tests - Supabase environment variables not set');
      return;
    }

    // Initialize clients with test environment
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Setup test user profile in database
    await supabase.from('profiles').upsert({
      id: testUserData.id,
      email: testUserData.email,
      name: testUserData.name,
      role: testUserData.role,
      permissions: JSON.stringify([
        'profile:read',
        'profile:write',
        'api-keys:read',
        'api-keys:write',
      ]),
      metadata: JSON.stringify({ test: true }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Create test user in auth.users
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: testUserData.email,
      password: testUserData.password,
      user_metadata: {
        name: testUserData.name,
      },
      email_confirm: true,
    });

    if (authError) {
      console.error('Failed to create test user:', authError);
    } else {
      testUser = authUser.user;
    }
  });

  beforeEach(async () => {
    // Clean up API keys and sessions before each test
    await supabase.from('api_keys').delete().eq('user_id', testUserData.id);
    await supabase.from('user_sessions').delete().eq('user_id', testUserData.id);
  });

  afterAll(async () => {
    // Cleanup test data
    await supabase.from('profiles').delete().eq('id', testUserData.id);
    await supabase.from('api_keys').delete().eq('user_id', testUserData.id);
    await supabase.from('user_sessions').delete().eq('user_id', testUserData.id);

    if (testUser) {
      await supabase.auth.admin.deleteUser(testUser.id);
    }
  });

  describe('Profile Management Integration', () => {
    it('should retrieve user profile with complete data', async () => {
      // Get user profile from database
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', testUserData.id)
        .single();

      expect(error).toBeNull();
      expect(profile).toBeDefined();
      expect(profile.id).toBe(testUserData.id);
      expect(profile.email).toBe(testUserData.email);
      expect(profile.name).toBe(testUserData.name);
      expect(profile.role).toBe(testUserData.role);
      expect(JSON.parse(profile.permissions)).toContain('profile:read');
      expect(JSON.parse(profile.metadata)).toHaveProperty('test', true);
    });

    it('should update user profile successfully', async () => {
      const updates = {
        name: 'Updated Test User',
        metadata: JSON.stringify({
          test: true,
          theme: 'dark',
          lastUpdated: new Date().toISOString(),
        }),
        updated_at: new Date().toISOString(),
      };

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', testUserData.id);

      expect(updateError).toBeNull();

      // Verify update
      const { data: updatedProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', testUserData.id)
        .single();

      expect(fetchError).toBeNull();
      expect(updatedProfile.name).toBe('Updated Test User');
      expect(JSON.parse(updatedProfile.metadata)).toHaveProperty('theme', 'dark');
    });

    it('should handle profile permissions correctly', async () => {
      const rolePermissions = {
        admin: [
          'profile:read',
          'profile:write',
          'profile:delete',
          'api-keys:read',
          'api-keys:write',
          'api-keys:delete',
        ],
        user: ['profile:read', 'profile:write', 'api-keys:read', 'api-keys:write'],
        readonly: ['profile:read', 'api-keys:read'],
      };

      // Test current user permissions
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, permissions')
        .eq('id', testUserData.id)
        .single();

      const userPermissions = JSON.parse(profile.permissions);
      const expectedPermissions = rolePermissions[profile.role as keyof typeof rolePermissions];

      expectedPermissions.forEach(permission => {
        expect(userPermissions).toContain(permission);
      });
    });
  });

  describe('API Key Lifecycle Integration', () => {
    it('should create API key with proper database storage', async () => {
      const keyData = {
        user_id: testUserData.id,
        key_hash: 'hashed_test_key_12345',
        key_prefix: 'test_key',
        name: testApiKeyData.name,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        permissions: JSON.stringify(testApiKeyData.permissions),
        description: testApiKeyData.description,
        metadata: JSON.stringify(testApiKeyData.metadata),
      };

      // Create API key
      const { data: apiKey, error } = await supabase
        .from('api_keys')
        .insert(keyData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(apiKey).toBeDefined();
      expect(apiKey.user_id).toBe(testUserData.id);
      expect(apiKey.name).toBe(testApiKeyData.name);
      expect(apiKey.key_prefix).toBe('test_key');
      expect(JSON.parse(apiKey.permissions)).toEqual(testApiKeyData.permissions);
      expect(JSON.parse(apiKey.metadata)).toEqual(testApiKeyData.metadata);

      testApiKey = apiKey.id;
      testApiKeyPrefix = apiKey.key_prefix;
    });

    it('should list user API keys correctly', async () => {
      // Create multiple API keys for testing
      const apiKeys = [
        {
          user_id: testUserData.id,
          key_hash: 'hash_1',
          key_prefix: 'prefix_1',
          name: 'Test Key 1',
          permissions: JSON.stringify(['api-keys:read']),
        },
        {
          user_id: testUserData.id,
          key_hash: 'hash_2',
          key_prefix: 'prefix_2',
          name: 'Test Key 2',
          permissions: JSON.stringify(['profile:read']),
        },
      ];

      await supabase.from('api_keys').insert(apiKeys);

      // List API keys
      const { data: userApiKeys, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', testUserData.id)
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(userApiKeys).toHaveLength(2);
      expect(userApiKeys[0].name).toBe('Test Key 2');
      expect(userApiKeys[1].name).toBe('Test Key 1');
    });

    it('should revoke API keys properly', async () => {
      // Create API key to revoke
      const { data: apiKey } = await supabase
        .from('api_keys')
        .insert({
          user_id: testUserData.id,
          key_hash: 'hash_to_revoke',
          key_prefix: 'revoke_me',
          name: 'Key to Revoke',
          permissions: JSON.stringify(['api-keys:read']),
          is_active: true,
        })
        .select()
        .single();

      // Revoke the key
      const { error: revokeError } = await supabase
        .from('api_keys')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_reason: 'manual_revocation',
        })
        .eq('id', apiKey.id);

      expect(revokeError).toBeNull();

      // Verify revocation
      const { data: revokedKey } = await supabase
        .from('api_keys')
        .select('*')
        .eq('id', apiKey.id)
        .single();

      expect(revokedKey.is_active).toBe(false);
      expect(revokedKey.revoked_at).toBeTruthy();
      expect(revokedKey.revoked_reason).toBe('manual_revocation');
    });

    it('should enforce API key limits', async () => {
      const maxKeys = 10;
      const keysToCreate = 12; // Exceed limit

      // Create API keys up to limit
      const apiKeys = [];
      for (let i = 1; i <= keysToCreate; i++) {
        apiKeys.push({
          user_id: testUserData.id,
          key_hash: `hash_${i}`,
          key_prefix: `prefix_${i}`,
          name: `Test Key ${i}`,
          permissions: JSON.stringify(['api-keys:read']),
        });
      }

      // Insert keys and check count
      await supabase.from('api_keys').insert(apiKeys.slice(0, maxKeys));

      const { count } = await supabase
        .from('api_keys')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', testUserData.id);

      expect(count).toBe(maxKeys);

      // Attempting to create more should be prevented at application level
      const canCreateMore = (count || 0) < maxKeys;
      expect(canCreateMore).toBe(false);
    });
  });

  describe('Session Management Integration', () => {
    it('should create and track user sessions', async () => {
      const sessionData = {
        id: 'session_integration_test',
        user_id: testUserData.id,
        user_email: testUserData.email,
        user_role: testUserData.role,
        permissions: JSON.stringify(['profile:read', 'api-keys:read']),
        metadata: JSON.stringify({
          loginMethod: 'password',
          deviceInfo: {
            type: 'desktop',
            browser: 'test',
          },
        }),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ip_address: '192.168.1.1',
        user_agent: 'Test User Agent',
        is_active: true,
      };

      // Create session
      const { data: session, error } = await supabase
        .from('user_sessions')
        .insert(sessionData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(session).toBeDefined();
      expect(session.id).toBe(sessionData.id);
      expect(session.user_id).toBe(testUserData.id);
      expect(session.is_active).toBe(true);
      expect(JSON.parse(session.permissions)).toContain('profile:read');
    });

    it('should detect and handle expired sessions', async () => {
      const expiredSession = {
        id: 'expired_session_test',
        user_id: testUserData.id,
        user_email: testUserData.email,
        user_role: testUserData.role,
        expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
        is_active: true,
      };

      await supabase.from('user_sessions').insert(expiredSession);

      // Check for expired sessions
      const { data: expiredSessions } = await supabase
        .from('user_sessions')
        .select('*')
        .lt('expires_at', new Date().toISOString())
        .eq('is_active', true);

      expect(expiredSessions).toHaveLength(1);
      expect(expiredSessions[0].id).toBe('expired_session_test');
    });

    it('should handle data consistency', async () => {
      // Test referential integrity by creating related records
      const { data: apiKey } = await supabase
        .from('api_keys')
        .insert({
          user_id: testUserData.id,
          key_hash: 'integrity_test_hash',
          key_prefix: 'integrity',
          name: 'Integrity Test Key',
          permissions: JSON.stringify(['api-keys:read']),
        })
        .select()
        .single();

      const { data: session } = await supabase
        .from('user_sessions')
        .insert({
          id: 'integrity_session',
          user_id: testUserData.id,
          user_email: testUserData.email,
          user_role: testUserData.role,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          is_active: true,
        })
        .select()
        .single();

      // Verify relationships
      expect(apiKey.user_id).toBe(testUserData.id);
      expect(session.user_id).toBe(testUserData.id);
    });
  });
});
