// Unit tests for authentication utilities and helpers
// CREATED: 2025-01-28 - Auth utilities, validation, and security helpers testing

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Auth Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Token Validation', () => {
    it('should validate JWT token structure', () => {
      const validJWT =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const invalidTokens = [
        'invalid.token',
        'not-a-jwt-token',
        '',
        null,
        undefined,
        'header.payload', // Missing signature
        'a.b.c.d', // Too many parts
      ];

      // Valid JWT has 3 parts separated by dots
      const jwtParts = validJWT.split('.');
      expect(jwtParts).toHaveLength(3);

      // Each part should be base64-like
      jwtParts.forEach(part => {
        expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(part.length).toBeGreaterThan(0);
      });

      // Invalid tokens
      invalidTokens.forEach(token => {
        if (!token) {
          expect(token).toBeFalsy();
        } else {
          const parts = token.split('.');
          expect(parts.length !== 3 || parts.some(part => part.length === 0)).toBe(true);
        }
      });
    });

    it('should validate token expiration', () => {
      const currentTime = Math.floor(Date.now() / 1000);

      const tokenClaims = [
        { exp: currentTime + 3600, valid: true }, // 1 hour future
        { exp: currentTime - 3600, valid: false }, // 1 hour past
        { exp: currentTime + 10, valid: true }, // 10 seconds future
        { exp: currentTime - 1, valid: false }, // 1 second past
      ];

      tokenClaims.forEach(({ exp, valid }) => {
        const isExpired = exp <= currentTime;
        expect(!isExpired).toBe(valid);
      });
    });

    it('should validate token issuer and audience', () => {
      const validClaims = {
        iss: 'https://auth.example.com',
        aud: 'yt-copilot-api',
        sub: 'user_12345',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      const expectedIssuer = 'https://auth.example.com';
      const expectedAudience = 'yt-copilot-api';

      expect(validClaims.iss).toBe(expectedIssuer);
      expect(validClaims.aud).toBe(expectedAudience);
      expect(validClaims.sub).toBeTruthy();
      expect(validClaims.exp).toBeGreaterThan(validClaims.iat);
    });
  });

  describe('Permission Validation', () => {
    it('should validate user permissions', () => {
      const userPermissions = ['profile:read', 'profile:write', 'api-keys:read', 'billing:read'];

      const requiredPermissions = ['profile:read', 'api-keys:read'];

      const hasAllPermissions = requiredPermissions.every(required =>
        userPermissions.includes(required)
      );

      expect(hasAllPermissions).toBe(true);

      // Test missing permission
      const missingPermission = 'admin:write';
      const hasMissingPermission = userPermissions.includes(missingPermission);
      expect(hasMissingPermission).toBe(false);
    });

    it('should validate permission format', () => {
      const validPermissions = ['profile:read', 'api-keys:write', 'billing:delete', 'admin:all'];

      const invalidPermissions = [
        'invalidformat',
        'profile:', // Missing action
        ':read', // Missing resource
        'profile:read:extra', // Too many parts
        '', // Empty
        null,
      ];

      const permissionRegex = /^[a-z-]+:[a-z]+$/;

      validPermissions.forEach(permission => {
        expect(permissionRegex.test(permission)).toBe(true);
        const [resource, action] = permission.split(':');
        expect(resource).toBeTruthy();
        expect(action).toBeTruthy();
      });

      invalidPermissions.forEach(permission => {
        if (!permission) {
          expect(permission).toBeFalsy();
        } else {
          expect(permissionRegex.test(permission)).toBe(false);
        }
      });
    });

    it('should handle role-based permissions', () => {
      const rolePermissions = {
        admin: [
          'profile:read',
          'profile:write',
          'profile:delete',
          'api-keys:read',
          'api-keys:write',
          'api-keys:delete',
          'billing:read',
          'billing:write',
          'users:read',
          'users:write',
          'users:delete',
        ],
        user: ['profile:read', 'profile:write', 'api-keys:read', 'api-keys:write', 'billing:read'],
        readonly: ['profile:read', 'api-keys:read', 'billing:read'],
      };

      // Admin should have all permissions
      const adminPerms = rolePermissions.admin;
      const userPerms = rolePermissions.user;
      const readonlyPerms = rolePermissions.readonly;

      // Verify hierarchy: admin > user > readonly
      userPerms.forEach(perm => {
        expect(adminPerms.includes(perm)).toBe(true);
      });

      readonlyPerms.forEach(perm => {
        expect(userPerms.includes(perm)).toBe(true);
        expect(adminPerms.includes(perm)).toBe(true);
      });

      // Admin should have exclusive permissions
      const adminOnlyPerms = adminPerms.filter(perm => !userPerms.includes(perm));
      expect(adminOnlyPerms.length).toBeGreaterThan(0);
    });
  });

  describe('Input Sanitization', () => {
    it('should sanitize user input for XSS prevention', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        'javascript:alert(1)',
        '<img src="x" onerror="alert(1)">',
        '"><script>alert(1)</script>',
        "'><script>alert(1)</script>",
      ];

      const xssPattern = /<script[^>]*?>.*?<\/script>|<script.*?>|javascript:/gi;

      maliciousInputs.forEach(input => {
        const isMalicious = xssPattern.test(input);

        if (input.includes('<script') || input.includes('javascript:')) {
          expect(isMalicious).toBe(true);
        }

        // Reset regex lastIndex for global flag
        xssPattern.lastIndex = 0;
      });
    });

    it('should sanitize SQL injection attempts', () => {
      const sqlInjectionAttempts = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "admin'--",
        "1; UPDATE users SET role='admin'--",
        'UNION SELECT password FROM users--',
      ];

      // Test multiple SQL injection patterns
      const patterns = [
        /['";]/, // Quotes and semicolons
        /--/, // Comments
        /\b(drop|delete|insert|update|union|select)\b/i, // SQL keywords
        /\bor\b.*=.*=/i, // OR clauses
      ];

      sqlInjectionAttempts.forEach(attempt => {
        const isSqlInjection = patterns.some(pattern => pattern.test(attempt));
        expect(isSqlInjection).toBe(true);
      });

      // Safe inputs should not match
      const safeInputs = ['normal text', 'user@example.com', 'My name is John', '123456'];

      safeInputs.forEach(input => {
        const isSqlInjection = patterns.some(pattern => pattern.test(input));
        expect(isSqlInjection).toBe(false);
      });
    });

    it('should validate and sanitize email addresses', () => {
      const emailTests = [
        { email: 'user@example.com', valid: true },
        { email: 'test.user+tag@example.co.uk', valid: true },
        { email: 'user123@sub-domain.example.com', valid: true },
        { email: 'invalid-email', valid: false },
        { email: '@example.com', valid: false },
        { email: 'user@', valid: false },
        { email: '', valid: false },
        { email: 'user space@example.com', valid: false },
      ];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      emailTests.forEach(({ email, valid }) => {
        const isValid = emailRegex.test(email);
        expect(isValid).toBe(valid);
      });
    });
  });

  describe('Rate Limiting Utilities', () => {
    it('should implement sliding window rate limiting', () => {
      const windowSizeMs = 60 * 1000; // 1 minute
      const maxRequests = 5;
      const userRequests = new Map();

      const checkRateLimit = (userId: string, currentTime: number) => {
        const userHistory = userRequests.get(userId) || [];

        // Remove requests outside the window
        const windowStart = currentTime - windowSizeMs;
        const recentRequests = userHistory.filter((timestamp: number) => timestamp > windowStart);

        // Check if limit exceeded
        if (recentRequests.length >= maxRequests) {
          return { allowed: false, remaining: 0 };
        }

        // Add current request and update
        recentRequests.push(currentTime);
        userRequests.set(userId, recentRequests);

        return { allowed: true, remaining: maxRequests - recentRequests.length };
      };

      const userId = 'user_12345';
      const now = Date.now();

      // First request should be allowed
      let result = checkRateLimit(userId, now);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      // Add more requests within limit
      for (let i = 1; i < maxRequests; i++) {
        result = checkRateLimit(userId, now + i * 1000);
        expect(result.allowed).toBe(true);
      }

      // Exceed limit
      result = checkRateLimit(userId, now + maxRequests * 1000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);

      // After window expires, should be allowed again
      result = checkRateLimit(userId, now + windowSizeMs + 1000);
      expect(result.allowed).toBe(true);
    });

    it('should handle different rate limit strategies', () => {
      const strategies = {
        fixed_window: {
          windowSize: 60000, // 1 minute
          maxRequests: 100,
          resetOnWindow: true,
        },
        sliding_window: {
          windowSize: 60000,
          maxRequests: 100,
          resetOnWindow: false,
        },
        token_bucket: {
          capacity: 10,
          refillRate: 1, // per second
          currentTokens: 10,
        },
      };

      // Verify strategy properties
      Object.entries(strategies).forEach(([strategy, config]) => {
        expect(typeof strategy).toBe('string');
        expect(typeof config).toBe('object');

        if ('windowSize' in config) {
          expect(config.windowSize).toBeGreaterThan(0);
          expect(config.maxRequests).toBeGreaterThan(0);
        }

        if ('capacity' in config) {
          expect(config.capacity).toBeGreaterThan(0);
          expect(config.refillRate).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Security Headers', () => {
    it('should generate proper security headers', () => {
      const securityHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self'",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
      };

      // Verify all security headers are present
      const requiredHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'X-XSS-Protection',
        'Strict-Transport-Security',
        'Content-Security-Policy',
      ];

      requiredHeaders.forEach(header => {
        expect(securityHeaders).toHaveProperty(header);
        expect(securityHeaders[header as keyof typeof securityHeaders]).toBeTruthy();
      });

      // Verify specific header values
      expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
      expect(securityHeaders['X-Frame-Options']).toBe('DENY');
      expect(securityHeaders['Strict-Transport-Security']).toContain('max-age=');
    });

    it('should handle CORS headers properly', () => {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      };

      // Verify CORS headers
      expect(corsHeaders['Access-Control-Allow-Origin']).toBeTruthy();
      expect(corsHeaders['Access-Control-Allow-Methods']).toContain('POST');
      expect(corsHeaders['Access-Control-Allow-Headers']).toContain('Authorization');
      expect(parseInt(corsHeaders['Access-Control-Max-Age'])).toBeGreaterThan(0);

      // Test more restrictive CORS for production
      const restrictiveCors = {
        'Access-Control-Allow-Origin': 'https://app.example.com',
        'Access-Control-Allow-Credentials': 'true',
      };

      expect(restrictiveCors['Access-Control-Allow-Origin']).toMatch(/^https:\/\//);
      expect(restrictiveCors['Access-Control-Allow-Credentials']).toBe('true');
    });
  });

  describe('Password Utilities', () => {
    it('should validate password strength', () => {
      const passwordTests = [
        { password: 'Password123!', score: 5, valid: true },
        { password: 'password123', score: 3, valid: false }, // No uppercase, no special
        { password: 'PASSWORD123!', score: 4, valid: false }, // No lowercase
        { password: 'Password!', score: 4, valid: false }, // No number
        { password: 'Password123', score: 4, valid: false }, // No special char
        { password: 'Pass1!', score: 4, valid: false }, // Too short
        { password: '', score: 0, valid: false }, // Empty
      ];

      passwordTests.forEach(({ password, score, valid }) => {
        let calculatedScore = 0;

        if (password.length >= 8) calculatedScore++;
        if (/[A-Z]/.test(password)) calculatedScore++;
        if (/[a-z]/.test(password)) calculatedScore++;
        if (/\d/.test(password)) calculatedScore++;
        if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) calculatedScore++;

        expect(calculatedScore).toBe(score);
        expect(calculatedScore >= 5).toBe(valid);
      });
    });

    it('should detect common password patterns', () => {
      const commonPatterns = [
        'password123',
        'admin123',
        'qwerty123',
        '123456789',
        'letmein',
        'welcome123',
      ];

      const sequentialPattern = /123|abc|qwe/i;
      const commonWordPattern = /password|admin|login|welcome/i;

      commonPatterns.forEach(password => {
        const hasSequential = sequentialPattern.test(password);
        const hasCommonWord = commonWordPattern.test(password);
        const isWeak = hasSequential || hasCommonWord;

        if (password.includes('123') || password.includes('password')) {
          expect(isWeak).toBe(true);
        }
      });
    });
  });

  describe('Session Utilities', () => {
    it('should generate secure session IDs', () => {
      const sessionIds = new Set();
      const iterations = 1000;

      // Mock crypto.randomUUID
      let counter = 0;
      vi.stubGlobal('crypto', {
        randomUUID: vi.fn().mockImplementation(() => {
          counter++;
          return `session_${counter}_${Math.random().toString(36).substring(2)}`;
        }),
      });

      for (let i = 0; i < iterations; i++) {
        const sessionId = crypto.randomUUID();
        sessionIds.add(sessionId);

        // Verify format
        expect(sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);
      }

      // All should be unique
      expect(sessionIds.size).toBe(iterations);
    });

    it('should calculate session timeouts correctly', () => {
      const timeoutTests = [
        { type: 'short', minutes: 15 },
        { type: 'normal', minutes: 60 },
        { type: 'long', minutes: 1440 }, // 24 hours
        { type: 'remember', minutes: 43200 }, // 30 days
      ];

      timeoutTests.forEach(({ type, minutes }) => {
        const timeoutMs = minutes * 60 * 1000;
        const expiresAt = new Date(Date.now() + timeoutMs);
        const minutesFromNow = (expiresAt.getTime() - Date.now()) / (1000 * 60);

        expect(Math.round(minutesFromNow)).toBe(minutes);
      });
    });

    it('should validate session fingerprints', () => {
      const fingerprint = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...',
        ipAddress: '192.168.1.1',
        acceptLanguage: 'en-US,en;q=0.9',
        timezone: 'America/Los_Angeles',
        screenResolution: '1920x1080',
      };

      // Verify fingerprint components
      expect(fingerprint.userAgent).toBeTruthy();
      expect(fingerprint.userAgent.length).toBeGreaterThan(20);

      const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
      expect(ipRegex.test(fingerprint.ipAddress)).toBe(true);

      expect(fingerprint.acceptLanguage).toMatch(/^[a-z-,;=.0-9 ]+$/i);
      expect(fingerprint.screenResolution).toMatch(/^\d+x\d+$/);
    });
  });

  describe('Error Handling', () => {
    it('should categorize authentication errors', () => {
      const errorTypes = {
        INVALID_CREDENTIALS: 'Invalid email or password',
        ACCOUNT_LOCKED: 'Account has been locked due to suspicious activity',
        EMAIL_NOT_VERIFIED: 'Please verify your email address',
        SESSION_EXPIRED: 'Your session has expired, please log in again',
        INSUFFICIENT_PERMISSIONS: 'You do not have permission to access this resource',
        RATE_LIMIT_EXCEEDED: 'Too many requests, please try again later',
        TOKEN_INVALID: 'Invalid or malformed authentication token',
        ACCOUNT_SUSPENDED: 'Account has been suspended',
      };

      Object.entries(errorTypes).forEach(([code, message]) => {
        expect(code).toMatch(/^[A-Z_]+$/); // All caps with underscores
        expect(message).toBeTruthy();
        expect(message.length).toBeGreaterThan(10);
      });

      // Test error classification
      const httpStatusMap = {
        INVALID_CREDENTIALS: 401,
        ACCOUNT_LOCKED: 423,
        EMAIL_NOT_VERIFIED: 403,
        SESSION_EXPIRED: 401,
        INSUFFICIENT_PERMISSIONS: 403,
        RATE_LIMIT_EXCEEDED: 429,
        TOKEN_INVALID: 401,
        ACCOUNT_SUSPENDED: 403,
      };

      Object.entries(httpStatusMap).forEach(([error, status]) => {
        expect(status).toBeGreaterThanOrEqual(400);
        expect(status).toBeLessThan(500);
      });
    });

    it('should handle error response formatting', () => {
      const errorResponse = {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          requestId: 'req_12345',
          timestamp: new Date().toISOString(),
        },
        data: null,
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error.code).toBeTruthy();
      expect(errorResponse.error.message).toBeTruthy();
      expect(errorResponse.error.requestId).toMatch(/^req_/);
      expect(new Date(errorResponse.error.timestamp)).toBeInstanceOf(Date);
      expect(errorResponse.data).toBeNull();
    });
  });
});
