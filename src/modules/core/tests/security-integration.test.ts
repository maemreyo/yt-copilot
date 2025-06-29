// Integration test verifying security measures using Layer 1 security utilities

import { request } from 'supertest';
import { describe, expect, it } from 'vitest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Security Headers Integration Tests', () => {
  // All core endpoints that should have security headers
  const coreEndpoints = [
    { path: '/core_health-check', method: 'GET', name: 'Health Check' },
    { path: '/core_version', method: 'GET', name: 'Version' },
    { path: '/core_error-reporting/report', method: 'POST', name: 'Error Reporting' },
    { path: '/core_metrics', method: 'GET', name: 'Metrics' },
    { path: '/core_configuration', method: 'GET', name: 'Configuration' },
  ];

  describe('Standard Security Headers Across All Endpoints', () => {
    coreEndpoints.forEach(endpoint => {
      describe(`${endpoint.name} Endpoint Security`, () => {
        it(`should include all required security headers on ${endpoint.path}`, async () => {
          const response = await request(`${BASE_URL}/functions/v1`)
            [endpoint.method.toLowerCase() as 'get' | 'post'](endpoint.path)
            .send(
              endpoint.method === 'POST'
                ? {
                    message: 'Test security headers',
                    module: 'security-test',
                  }
                : undefined
            );

          // Accept both success and access denied responses
          expect([200, 201, 403, 405]).toContain(response.status);

          // Required security headers (should be present regardless of response status)
          expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
          expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
          expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
          expect(response.headers).toHaveProperty('strict-transport-security');

          // Verify HSTS header value
          const hsts = response.headers['strict-transport-security'];
          expect(hsts).toContain('max-age=');
          expect(hsts).toContain('includeSubDomains');
          expect(hsts).toContain('preload');
        });

        it(`should include proper CORS headers on ${endpoint.path}`, async () => {
          const response = await request(`${BASE_URL}/functions/v1`)
            [endpoint.method.toLowerCase() as 'get' | 'post'](endpoint.path)
            .send(
              endpoint.method === 'POST'
                ? {
                    message: 'Test CORS headers',
                    module: 'security-test',
                  }
                : undefined
            );

          // CORS headers should be present for API endpoints
          expect(response.headers).toHaveProperty('access-control-allow-origin');

          // Most endpoints should allow all origins for API access
          if (response.status !== 403) {
            expect(response.headers['access-control-allow-origin']).toBe('*');
          }
        });

        it(`should handle OPTIONS preflight correctly on ${endpoint.path}`, async () => {
          const response = await request(`${BASE_URL}/functions/v1`)
            .options(endpoint.path)
            .expect(200);

          // CORS preflight headers
          expect(response.headers).toHaveProperty('access-control-allow-origin', '*');
          expect(response.headers).toHaveProperty('access-control-allow-methods');
          expect(response.headers).toHaveProperty('access-control-allow-headers');

          // Should include the endpoint's method in allowed methods
          const allowedMethods = response.headers['access-control-allow-methods'];
          expect(allowedMethods).toContain(endpoint.method);
          expect(allowedMethods).toContain('OPTIONS');

          // Common headers should be allowed
          const allowedHeaders = response.headers['access-control-allow-headers'];
          expect(allowedHeaders).toContain('Content-Type');
          expect(allowedHeaders).toContain('Authorization');
        });
      });
    });
  });

  describe('Content Security and Data Protection', () => {
    it('should prevent content type sniffing on all endpoints', async () => {
      const promises = coreEndpoints.map(endpoint =>
        request(`${BASE_URL}/functions/v1`)
          [endpoint.method.toLowerCase() as 'get' | 'post'](endpoint.path)
          .send(
            endpoint.method === 'POST'
              ? {
                  message: 'Test content type',
                  module: 'security-test',
                }
              : undefined
          )
      );

      const responses = await Promise.all(promises);

      responses.forEach((response, index) => {
        // Accept various response codes
        expect([200, 201, 403, 405]).toContain(response.status);

        // All should prevent content type sniffing
        expect(response.headers['x-content-type-options']).toBe('nosniff');
      });
    });

    it('should prevent clickjacking on all endpoints', async () => {
      const promises = coreEndpoints.map(endpoint =>
        request(`${BASE_URL}/functions/v1`)
          [endpoint.method.toLowerCase() as 'get' | 'post'](endpoint.path)
          .send(
            endpoint.method === 'POST'
              ? {
                  message: 'Test clickjacking protection',
                  module: 'security-test',
                }
              : undefined
          )
      );

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        // All should prevent clickjacking
        expect(response.headers['x-frame-options']).toBe('DENY');
      });
    });

    it('should have appropriate cache control headers', async () => {
      const endpointCacheRules = [
        { path: '/core_health-check', shouldCache: false },
        { path: '/core_version', shouldCache: true },
        { path: '/core_error-reporting/report', shouldCache: false },
        { path: '/core_metrics', shouldCache: false },
        { path: '/core_configuration', shouldCache: false },
      ];

      for (const rule of endpointCacheRules) {
        const response = await request(`${BASE_URL}/functions/v1`).get(rule.path);

        // Accept success or access denied
        expect([200, 403]).toContain(response.status);

        if (response.status === 200) {
          const cacheControl = response.headers['cache-control'];
          expect(cacheControl).toBeDefined();

          if (rule.shouldCache) {
            // Version endpoint should be cacheable
            expect(cacheControl).toContain('public');
            expect(cacheControl).toContain('max-age=');
          } else {
            // Sensitive endpoints should not be cached
            expect(cacheControl).toMatch(/no-cache|no-store|must-revalidate/);
          }
        }
      }
    });
  });

  describe('Request Method Security', () => {
    it('should properly reject unsupported HTTP methods', async () => {
      const testCases = [
        {
          endpoint: '/core_health-check',
          allowed: ['GET', 'OPTIONS'],
          forbidden: ['POST', 'PUT', 'DELETE', 'PATCH'],
        },
        {
          endpoint: '/core_version',
          allowed: ['GET', 'OPTIONS'],
          forbidden: ['POST', 'PUT', 'DELETE', 'PATCH'],
        },
        {
          endpoint: '/core_error-reporting/report',
          allowed: ['POST', 'OPTIONS'],
          forbidden: ['GET', 'PUT', 'DELETE', 'PATCH'],
        },
        {
          endpoint: '/core_metrics',
          allowed: ['GET', 'OPTIONS'],
          forbidden: ['POST', 'PUT', 'DELETE', 'PATCH'],
        },
        {
          endpoint: '/core_configuration',
          allowed: ['GET', 'OPTIONS'],
          forbidden: ['POST', 'PUT', 'DELETE', 'PATCH'],
        },
      ];

      for (const testCase of testCases) {
        // Test forbidden methods
        for (const method of testCase.forbidden) {
          const response = await request(`${BASE_URL}/functions/v1`)[
            method.toLowerCase() as 'post' | 'put' | 'delete' | 'patch' | 'get'
          ](testCase.endpoint);

          expect(response.status).toBe(405);
          expect(response.headers).toHaveProperty('allow');

          const allowedMethods = response.headers.allow;
          testCase.allowed.forEach(allowedMethod => {
            expect(allowedMethods).toContain(allowedMethod);
          });
        }
      }
    });

    it('should include proper Allow header in 405 responses', async () => {
      // Test POST on GET-only endpoint
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_health-check')
        .expect(405);

      expect(response.headers).toHaveProperty('allow');
      expect(response.headers.allow).toContain('GET');
      expect(response.headers.allow).toContain('OPTIONS');
      expect(response.headers.allow).not.toContain('POST');
    });
  });

  describe('Input Validation and Sanitization', () => {
    it('should validate and sanitize error reporting input', async () => {
      const maliciousInputs = [
        {
          message: '<script>alert("xss")</script>',
          module: 'test',
        },
        {
          message: 'SQL injection attempt; DROP TABLE users;',
          module: 'test',
        },
        {
          message: 'Normal message',
          module: '<img src=x onerror=alert(1)>',
        },
        {
          message: 'A'.repeat(2000), // Exceeds max length
          module: 'test',
        },
      ];

      for (const input of maliciousInputs) {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/core_error-reporting/report')
          .send(input);

        // Should either reject with validation error or sanitize
        if (response.status === 400) {
          expect(response.body.error.code).toBe('VALIDATION_ERROR');
        } else if (response.status === 201) {
          // If accepted, response should not contain malicious content
          const responseText = JSON.stringify(response.body);
          expect(responseText).not.toContain('<script>');
          expect(responseText).not.toContain('DROP TABLE');
          expect(responseText).not.toContain('onerror=');
        }
      }
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .set('Content-Type', 'application/json')
        .send('invalid json{');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');

      // Should not expose internal error details
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain('SyntaxError');
      expect(responseText).not.toContain('JSON.parse');
    });
  });

  describe('Information Disclosure Prevention', () => {
    it('should not expose sensitive information in error responses', async () => {
      // Test various endpoints with invalid requests
      const testCases = [
        { path: '/core_error-reporting/report', method: 'POST', data: { invalid: 'data' } },
        { path: '/core_metrics', method: 'POST', data: {} }, // Wrong method
        { path: '/core_configuration', method: 'PUT', data: {} }, // Wrong method
      ];

      for (const testCase of testCases) {
        const response = await request(`${BASE_URL}/functions/v1`)
          [testCase.method.toLowerCase() as 'post' | 'put'](testCase.path)
          .send(testCase.data);

        const responseText = JSON.stringify(response.body);

        // Should not contain sensitive information
        const sensitivePatterns = [
          /password/i,
          /secret/i,
          /token/i,
          /key/i,
          /api.*key/i,
          /stripe.*sk_/i,
          /supabase.*key/i,
          /database.*connection/i,
          /internal.*error/i,
          /stack.*trace/i,
        ];

        sensitivePatterns.forEach(pattern => {
          expect(responseText).not.toMatch(pattern);
        });
      }
    });

    it('should not expose server information in headers', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_health-check');

      // Should not expose server software details
      const serverHeader = response.headers.server;
      if (serverHeader) {
        expect(serverHeader).not.toMatch(/apache|nginx|iis/i);
        expect(serverHeader).not.toMatch(/\d+\.\d+\.\d+/); // Version numbers
      }

      // Should not expose PHP or other platform details
      expect(response.headers).not.toHaveProperty('x-powered-by');
    });
  });

  describe('Rate Limiting Integration', () => {
    it('should apply rate limiting to error reporting endpoint', async () => {
      // Make multiple rapid requests to error reporting
      const promises = Array.from({ length: 10 }, (_, i) =>
        request(`${BASE_URL}/functions/v1`)
          .post('/core_error-reporting/report')
          .send({
            message: `Rate limit test ${i}`,
            module: 'rate-limit-test',
          })
      );

      const responses = await Promise.all(promises);

      // Some requests might be rate limited
      const statusCodes = responses.map(r => r.status);
      const hasRateLimit = statusCodes.includes(429);

      if (hasRateLimit) {
        const rateLimitedResponse = responses.find(r => r.status === 429);
        expect(rateLimitedResponse?.headers).toHaveProperty('retry-after');
      }

      // At least some requests should succeed
      expect(statusCodes.filter(code => code === 201).length).toBeGreaterThan(0);
    });

    it('should include rate limiting headers when appropriate', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send({
          message: 'Rate limit header test',
          module: 'rate-limit-test',
        });

      if (response.status === 429) {
        // Rate limited response should include retry-after
        expect(response.headers).toHaveProperty('retry-after');
        expect(parseInt(response.headers['retry-after'])).toBeGreaterThan(0);
      }

      // Some endpoints might include rate limit info headers
      const rateLimitHeaders = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

      rateLimitHeaders.forEach(header => {
        if (response.headers[header]) {
          const value = parseInt(response.headers[header]);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      });
    });
  });

  describe('Environment-Specific Security', () => {
    it('should enforce stricter security in production-like environments', async () => {
      const isProduction = process.env.NODE_ENV === 'production';

      if (isProduction) {
        // Configuration endpoint should be completely inaccessible
        const configResponse = await request(`${BASE_URL}/functions/v1`)
          .get('/core_configuration')
          .expect(403);

        expect(configResponse.body.error.code).toBe('ACCESS_DENIED');
      } else {
        // Development environment should still have security headers
        const response = await request(`${BASE_URL}/functions/v1`)
          .get('/core_health-check')
          .expect(200);

        expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
        expect(response.headers).toHaveProperty('strict-transport-security');
      }
    });

    it('should have appropriate security headers for environment', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      const env = response.body.environment;

      // All environments should have basic security headers
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');

      // Production should have stricter HSTS
      if (env === 'production') {
        const hsts = response.headers['strict-transport-security'];
        expect(hsts).toContain('max-age=');
        // Should have longer max-age in production
        const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || '0');
        expect(maxAge).toBeGreaterThan(31536000); // > 1 year
      }
    });
  });

  describe('Security Headers Consistency', () => {
    it('should have consistent security headers across all successful responses', async () => {
      const responses = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_health-check'),
        request(`${BASE_URL}/functions/v1`).get('/core_version'),
        request(`${BASE_URL}/functions/v1`).get('/core_metrics'),
      ]);

      // Filter successful responses
      const successfulResponses = responses.filter(r => r.status === 200);
      expect(successfulResponses.length).toBeGreaterThan(0);

      // All should have same security headers
      const firstResponse = successfulResponses[0];
      const expectedHeaders = [
        'x-content-type-options',
        'x-frame-options',
        'x-xss-protection',
        'strict-transport-security',
      ];

      expectedHeaders.forEach(header => {
        const expectedValue = firstResponse.headers[header];

        successfulResponses.forEach(response => {
          expect(response.headers[header]).toBe(expectedValue);
        });
      });
    });

    it('should maintain security headers even in error responses', async () => {
      // Test error responses
      const errorResponses = await Promise.all([
        request(`${BASE_URL}/functions/v1`).post('/core_health-check'), // 405
        request(`${BASE_URL}/functions/v1`).put('/core_version'), // 405
        request(`${BASE_URL}/functions/v1`).post('/core_error-reporting/report').send({}), // 400
      ]);

      errorResponses.forEach(response => {
        expect([400, 405]).toContain(response.status);

        // Even error responses should have security headers
        expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
        expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
        expect(response.headers).toHaveProperty('strict-transport-security');
      });
    });
  });
});
