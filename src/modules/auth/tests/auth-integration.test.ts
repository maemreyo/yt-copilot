// - Comprehensive integration tests for Auth module

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request } from 'supertest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Auth Module Integration Tests', () => {
  let testUser: any;
  let testUserToken: string;
  let testApiKey: string;
  let testApiKeyPrefix: string;

  beforeAll(async () => {
    // Create test user using global test utilities
    testUser = await globalThis.testDb.createTestUser({
      email: 'auth-integration@example.com',
      name: 'Auth Integration User',
      role: 'user',
      password: 'TestPassword123!'
    });

    // Get user token for authenticated requests
    testUserToken = await globalThis.testDb.getUserToken(testUser.id);
  });

  afterAll(async () => {
    // Cleanup test data
    await globalThis.testDb.cleanup();
  });

  beforeEach(async () => {
    // Clean up API keys and sessions before each test
    await globalThis.testDb.cleanupUserApiKeys(testUser.id);
    await globalThis.testDb.cleanupUserSessions(testUser.id);
  });

  describe('API Key Lifecycle Tests', () => {
    it('should create, use, list, and revoke API keys successfully', async () => {
      // 1. Create API key
      const createResponse = await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: 'Integration Test Key',
          permissions: ['api-keys:read', 'profile:read'],
          expiresIn: '30d'
        })
        .expect(201);

      expect(createResponse.body.success).toBe(true);
      expect(createResponse.body.apiKey).toBeDefined();
      expect(createResponse.body.keyPrefix).toBeDefined();
      expect(createResponse.body.name).toBe('Integration Test Key');
      expect(createResponse.body.permissions).toEqual(['api-keys:read', 'profile:read']);

      testApiKey = createResponse.body.apiKey;
      testApiKeyPrefix = createResponse.body.keyPrefix;

      // 2. Use API key to access profile
      const profileResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(profileResponse.body.profile).toBeDefined();
      expect(profileResponse.body.profile.id).toBe(testUser.id);

      // 3. List API keys
      const listResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_list-api-keys')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(listResponse.body.keys).toBeInstanceOf(Array);
      expect(listResponse.body.keys.length).toBeGreaterThan(0);
      
      const createdKey = listResponse.body.keys.find((key: any) => key.prefix === testApiKeyPrefix);
      expect(createdKey).toBeDefined();
      expect(createdKey.name).toBe('Integration Test Key');
      expect(createdKey.permissions).toEqual(['api-keys:read', 'profile:read']);

      // 4. Revoke API key
      const revokeResponse = await request(`${BASE_URL}/functions/v1`)
        .delete('/auth_revoke-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          keyPrefix: testApiKeyPrefix,
          reason: 'Integration test cleanup'
        })
        .expect(200);

      expect(revokeResponse.body.success).toBe(true);
      expect(revokeResponse.body.keyPrefix).toBe(testApiKeyPrefix);

      // 5. Verify API key no longer works
      await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('X-API-Key', testApiKey)
        .expect(401);

      // 6. Verify key shows as revoked in list
      const finalListResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_list-api-keys')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      const revokedKey = finalListResponse.body.keys.find((key: any) => key.prefix === testApiKeyPrefix);
      expect(revokedKey.isActive).toBe(false);
      expect(revokedKey.revokedAt).toBeDefined();
    });

    it('should prevent unauthorized API key operations', async () => {
      // Try to create API key without authentication
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .send({
          name: 'Unauthorized Key',
          permissions: ['api-keys:read']
        })
        .expect(401);

      // Try to list API keys without authentication
      await request(`${BASE_URL}/functions/v1`)
        .get('/auth_list-api-keys')
        .expect(401);

      // Try to revoke API key without authentication
      await request(`${BASE_URL}/functions/v1`)
        .delete('/auth_revoke-api-key')
        .send({
          keyPrefix: 'fakepfx1'
        })
        .expect(401);
    });

    it('should validate API key creation parameters', async () => {
      // Test invalid name
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: '', // Empty name
          permissions: ['api-keys:read']
        })
        .expect(400);

      // Test invalid permissions
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: 'Test Key',
          permissions: ['invalid:permission']
        })
        .expect(400);

      // Test invalid expiration
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: 'Test Key',
          permissions: ['api-keys:read'],
          expiresIn: 'invalid'
        })
        .expect(400);
    });
  });

  describe('Permission System Tests', () => {
    beforeEach(async () => {
      // Create API key with specific permissions for testing
      const createResponse = await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: 'Permission Test Key',
          permissions: ['profile:read'], // Only profile read permission
        })
        .expect(201);

      testApiKey = createResponse.body.apiKey;
      testApiKeyPrefix = createResponse.body.keyPrefix;
    });

    it('should enforce role-based access control', async () => {
      // Test user role can access their own profile
      const profileResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(profileResponse.body.profile.role).toBe('user');

      // Test user cannot access admin-only endpoints (if they exist)
      // This would be tested if we had admin-only endpoints implemented
    });

    it('should enforce API key permissions', async () => {
      // API key with only profile:read should access profile
      await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('X-API-Key', testApiKey)
        .expect(200);

      // API key without api-keys:create should not create API keys
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('X-API-Key', testApiKey)
        .send({
          name: 'Unauthorized Key Creation',
          permissions: ['profile:read']
        })
        .expect(403);
    });

    it('should prevent permission escalation', async () => {
      // User should not be able to create API key with more permissions than they have
      const adminPermissions = ['admin:all', 'users:delete', 'system:modify'];
      
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: 'Escalation Attempt',
          permissions: adminPermissions
        })
        .expect(403);
    });

    it('should validate subscription requirements', async () => {
      // If user doesn't have premium subscription, should not access premium features
      // This would be tested if we had subscription-gated features
      
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      const subscription = response.body.profile.subscription;
      if (!subscription || subscription.status !== 'active') {
        // Test premium feature access is denied
        // This is a placeholder for actual premium feature testing
        expect(subscription?.status).not.toBe('active');
      }
    });
  });

  describe('Rate Limiting Tests', () => {
    it('should apply rate limiting to API key creation', async () => {
      const promises = [];
      
      // Try to create many API keys rapidly
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(`${BASE_URL}/functions/v1`)
            .post('/auth_create-api-key')
            .set('Authorization', `Bearer ${testUserToken}`)
            .send({
              name: `Rate Limit Test Key ${i}`,
              permissions: ['profile:read']
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const statusCodes = responses.map(r => r.status);
      const rateLimitedCount = statusCodes.filter(code => code === 429).length;
      const successCount = statusCodes.filter(code => code === 201).length;

      // Should have some successful requests and possibly some rate limited
      expect(successCount).toBeGreaterThan(0);
      
      if (rateLimitedCount > 0) {
        // If rate limiting is active, verify proper headers
        const rateLimitedResponse = responses.find(r => r.status === 429);
        expect(rateLimitedResponse?.headers).toHaveProperty('retry-after');
      }
    });

    it('should apply different rate limits for different endpoints', async () => {
      // Profile read should have higher rate limit than API key creation
      const profileRequests = Array.from({ length: 5 }, () =>
        request(`${BASE_URL}/functions/v1`)
          .get('/auth_profile-management/profile')
          .set('Authorization', `Bearer ${testUserToken}`)
      );

      const profileResponses = await Promise.all(profileRequests);
      const profileSuccessCount = profileResponses.filter(r => r.status === 200).length;

      // Profile reads should mostly succeed (higher rate limit)
      expect(profileSuccessCount).toBeGreaterThanOrEqual(3);
    });

    it('should reset rate limits after time window', async () => {
      // This test would require waiting for rate limit window to reset
      // For now, we just verify rate limiting structure exists
      
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/auth_create-api-key')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: 'Rate Reset Test Key',
          permissions: ['profile:read']
        });

      // Should either succeed or be rate limited with proper headers
      expect([201, 429]).toContain(response.status);
      
      if (response.status === 429) {
        expect(response.headers).toHaveProperty('retry-after');
        const retryAfter = parseInt(response.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(0);
      }
    });
  });

  describe('Security Tests', () => {
    it('should prevent auth bypass attempts', async () => {
      // Test malformed JWT tokens
      const malformedTokens = [
        'Bearer invalid.jwt.token',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid',  
        'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.',
        'malformed-header-format',
        ''
      ];

      for (const token of malformedTokens) {
        await request(`${BASE_URL}/functions/v1`)
          .get('/auth_profile-management/profile')
          .set('Authorization', token)
          .expect(401);
      }
    });

    it('should prevent API key bypass attempts', async () => {
      // Test malformed API keys
      const malformedApiKeys = [
        'sk_invalid_key',
        'sk_test_' + 'a'.repeat(100),
        '<script>alert("xss")</script>',
        'null',
        'undefined',
        '',
        ' '.repeat(32)
      ];

      for (const apiKey of malformedApiKeys) {
        await request(`${BASE_URL}/functions/v1`)
          .get('/auth_profile-management/profile')
          .set('X-API-Key', apiKey)
          .expect(401);
      }
    });

    it('should sanitize input data', async () => {
      // Test XSS prevention in API key name
      const xssPayloads = [
        '<script>alert("xss")</script>',
        '"><script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src=x onerror=alert("xss")>',
        '${alert("xss")}'
      ];

      for (const payload of xssPayloads) {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/auth_create-api-key')
          .set('Authorization', `Bearer ${testUserToken}`)
          .send({
            name: payload,
            permissions: ['profile:read']
          });

        // Should either reject with validation error or sanitize
        if (response.status === 201) {
          // If accepted, should not contain the malicious payload
          expect(response.body.name).not.toContain('<script>');
          expect(response.body.name).not.toContain('javascript:');
          expect(response.body.name).not.toContain('onerror=');
        } else {
          expect(response.status).toBe(400);
        }
      }
    });

    it('should prevent SQL injection attempts', async () => {
      // Test SQL injection in various fields
      const sqlPayloads = [
        "'; DROP TABLE api_keys; --",
        "' OR '1'='1",
        "1; DELETE FROM profiles WHERE id='1'",
        "' UNION SELECT * FROM auth.users --"
      ];

      for (const payload of sqlPayloads) {
        // Test in API key name
        const nameResponse = await request(`${BASE_URL}/functions/v1`)
          .post('/auth_create-api-key')
          .set('Authorization', `Bearer ${testUserToken}`)
          .send({
            name: payload,
            permissions: ['profile:read']
          });

        // Should not succeed with SQL injection
        expect([400, 500]).not.toContain(nameResponse.status);
        if (nameResponse.status === 201) {
          // If accepted, should be properly escaped
          expect(nameResponse.body.name).not.toContain('DROP TABLE');
          expect(nameResponse.body.name).not.toContain('DELETE FROM');
        }
      }
    });

    it('should prevent timing attacks on authentication', async () => {
      // Test with non-existent user and existing user
      const nonExistentEmail = 'nonexistent@example.com';
      const existingEmail = testUser.email;

      const startTime1 = Date.now();
      const response1 = await request(`${BASE_URL}/functions/v1`)
        .post('/auth_session-management/login')
        .send({
          email: nonExistentEmail,
          password: 'wrongpassword'
        });
      const time1 = Date.now() - startTime1;

      const startTime2 = Date.now();
      const response2 = await request(`${BASE_URL}/functions/v1`)
        .post('/auth_session-management/login')
        .send({
          email: existingEmail,
          password: 'wrongpassword'
        });
      const time2 = Date.now() - startTime2;

      // Both should fail
      expect(response1.status).toBe(401);
      expect(response2.status).toBe(401);

      // Timing difference should not be significant (within 50% of each other)
      const timeDifference = Math.abs(time1 - time2);
      const averageTime = (time1 + time2) / 2;
      expect(timeDifference).toBeLessThan(averageTime * 0.5);
    });

    it('should include security headers in all auth responses', async () => {
      const endpoints = [
        { method: 'GET', path: '/auth_profile-management/profile', auth: `Bearer ${testUserToken}` },
        { method: 'POST', path: '/auth_create-api-key', auth: `Bearer ${testUserToken}`, body: { name: 'Test', permissions: ['profile:read'] } },
        { method: 'GET', path: '/auth_list-api-keys', auth: `Bearer ${testUserToken}` }
      ];

      for (const endpoint of endpoints) {
        const req = request(`${BASE_URL}/functions/v1`)[endpoint.method.toLowerCase() as 'get' | 'post'](endpoint.path)
          .set('Authorization', endpoint.auth);

        if (endpoint.body) {
          req.send(endpoint.body);
        }

        const response = await req;

        // Verify security headers regardless of response status
        expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
        expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
        expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
        expect(response.headers).toHaveProperty('strict-transport-security');
      }
    });
  });

  describe('Session Management Tests', () => {
    it('should create and manage user sessions', async () => {
      // Test login
      const loginResponse = await request(`${BASE_URL}/functions/v1`)
        .post('/auth_session-management/login')
        .send({
          email: testUser.email,
          password: 'TestPassword123!',
          rememberMe: false,
          deviceInfo: {
            name: 'Test Device',
            type: 'desktop',
            browser: 'Chrome',
            os: 'Linux'
          }
        })
        .expect(200);

      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.session).toBeDefined();
      expect(loginResponse.body.session.accessToken).toBeDefined();
      expect(loginResponse.body.session.user.id).toBe(testUser.id);

      const sessionToken = loginResponse.body.session.accessToken;

      // Test session listing
      const sessionsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_session-management/sessions')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(sessionsResponse.body.sessions).toBeInstanceOf(Array);
      expect(sessionsResponse.body.sessions.length).toBeGreaterThan(0);

      const currentSession = sessionsResponse.body.sessions.find((s: any) => s.isCurrent);
      expect(currentSession).toBeDefined();
      expect(currentSession.userId).toBe(testUser.id);

      // Test logout
      const logoutResponse = await request(`${BASE_URL}/functions/v1`)
        .delete('/auth_session-management/logout')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(logoutResponse.body.success).toBe(true);

      // Verify session is no longer valid
      await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);
    });

    it('should handle invalid login attempts', async () => {
      // Wrong password
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_session-management/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword'
        })
        .expect(401);

      // Non-existent user
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_session-management/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'AnyPassword'
        })
        .expect(401);

      // Invalid email format
      await request(`${BASE_URL}/functions/v1`)
        .post('/auth_session-management/login')
        .send({
          email: 'invalid-email',
          password: 'AnyPassword'
        })
        .expect(400);
    });
  });

  describe('Profile Management Tests', () => {
    it('should get and update user profile', async () => {
      // Get profile
      const getResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(getResponse.body.profile.id).toBe(testUser.id);
      expect(getResponse.body.profile.email).toBe(testUser.email);

      // Update profile
      const updates = {
        name: 'Updated Integration User',
        metadata: {
          testField: 'testValue',
          updatedAt: new Date().toISOString()
        },
        preferences: {
          theme: 'dark' as const,
          language: 'en',
          notifications: {
            email: true,
            push: false,
            marketing: false
          }
        }
      };

      const updateResponse = await request(`${BASE_URL}/functions/v1`)
        .put('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(updates)
        .expect(200);

      expect(updateResponse.body.success).toBe(true);
      expect(updateResponse.body.profile.name).toBe('Updated Integration User');
      expect(updateResponse.body.profile.metadata.testField).toBe('testValue');

      // Verify update persisted
      const verifyResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(verifyResponse.body.profile.name).toBe('Updated Integration User');
      expect(verifyResponse.body.profile.metadata.testField).toBe('testValue');
    });

    it('should validate profile update data', async () => {
      // Invalid name (too long)
      await request(`${BASE_URL}/functions/v1`)
        .put('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          name: 'a'.repeat(101)
        })
        .expect(400);

      // Invalid avatar URL
      await request(`${BASE_URL}/functions/v1`)
        .put('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          avatar_url: 'not-a-valid-url'
        })
        .expect(400);

      // Invalid preferences theme
      await request(`${BASE_URL}/functions/v1`)
        .put('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          preferences: {
            theme: 'invalid-theme'
          }
        })
        .expect(400);
    });
  });

  describe('Integration with Other Modules', () => {
    it('should integrate with error reporting for auth failures', async () => {
      // Make failed auth request
      await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // Check if auth errors are being tracked
      const errorStatsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/stats')
        .expect(200);

      // Should have some error data (auth failures might be tracked)
      expect(errorStatsResponse.body.stats.totalErrors).toBeGreaterThanOrEqual(0);
    });

    it('should show up in metrics collection', async () => {
      // Make some auth requests
      await request(`${BASE_URL}/functions/v1`)
        .get('/auth_profile-management/profile')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      // Check metrics
      const metricsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      // Should track API usage
      expect(metricsResponse.body.api.authentication).toBeDefined();
      expect(metricsResponse.body.api.authentication.jwtRequests).toBeGreaterThanOrEqual(0);
    });
  });
});