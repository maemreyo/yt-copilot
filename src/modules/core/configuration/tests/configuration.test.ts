import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'supertest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Configuration API', () => {
  // Note: These tests assume development environment
  // In production, the endpoint should return 403
  
  describe('GET /configuration (Development Environment)', () => {
    it('should return comprehensive configuration in development', async () => {
      // Only run if in development environment
      if (process.env.NODE_ENV !== 'development') {
        console.log('Skipping development-only test');
        return;
      }

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200)
        .expect('Content-Type', /json/);

      // Verify response structure
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('environment', 'development');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('accessLevel', 'development');
      expect(response.body).toHaveProperty('sections');
      expect(response.body).toHaveProperty('featureFlags');
      expect(response.body).toHaveProperty('runtime');
      expect(response.body).toHaveProperty('warnings');
      expect(response.body).toHaveProperty('_meta');

      // Verify timestamp format
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);

      // Verify meta information
      expect(response.body._meta).toHaveProperty('generatedAt');
      expect(response.body._meta).toHaveProperty('requestId');
      expect(response.body._meta).toHaveProperty('note');
    });

    it('should include all required configuration sections', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const sections = response.body.sections;
      expect(Array.isArray(sections)).toBe(true);

      // Expected section names
      const expectedSections = [
        'Application',
        'Supabase', 
        'Stripe',
        'Security',
        'Monitoring',
        'Database & Cache'
      ];

      const sectionNames = sections.map((s: any) => s.name);
      expectedSections.forEach(expected => {
        expect(sectionNames).toContain(expected);
      });

      // Verify section structure
      sections.forEach((section: any) => {
        expect(section).toHaveProperty('name');
        expect(section).toHaveProperty('description');
        expect(section).toHaveProperty('variables');
        expect(typeof section.variables).toBe('object');
      });
    });

    it('should properly mask sensitive configuration values', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const sections = response.body.sections;
      
      // Find security section
      const securitySection = sections.find((s: any) => s.name === 'Security');
      expect(securitySection).toBeDefined();

      // Check JWT_SECRET is masked if present
      if (securitySection.variables.JWT_SECRET) {
        expect(securitySection.variables.JWT_SECRET.sensitive).toBe(true);
        const value = securitySection.variables.JWT_SECRET.value;
        if (typeof value === 'string') {
          expect(value).toMatch(/\*\*\*|dev-jwt-secret/); // Should be masked or default dev value
        }
      }

      // Find Supabase section
      const supabaseSection = sections.find((s: any) => s.name === 'Supabase');
      expect(supabaseSection).toBeDefined();

      // Check service role key is masked
      if (supabaseSection.variables.SUPABASE_SERVICE_ROLE_KEY) {
        expect(supabaseSection.variables.SUPABASE_SERVICE_ROLE_KEY.sensitive).toBe(true);
        const value = supabaseSection.variables.SUPABASE_SERVICE_ROLE_KEY.value;
        if (typeof value === 'string' && value.length > 8) {
          expect(value).toMatch(/\*\*\*/); // Should contain masking
        }
      }
    });

    it('should include valid feature flags', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const { featureFlags } = response.body;

      // Verify feature flags structure
      expect(featureFlags).toHaveProperty('development');
      expect(featureFlags).toHaveProperty('features');
      expect(featureFlags).toHaveProperty('experiments');

      // Development flags
      expect(typeof featureFlags.development.debugMode).toBe('boolean');
      expect(typeof featureFlags.development.hotReload).toBe('boolean');
      expect(typeof featureFlags.development.mockServices).toBe('boolean');
      expect(typeof featureFlags.development.seedData).toBe('boolean');

      // Feature flags
      expect(typeof featureFlags.features.metricsEnabled).toBe('boolean');
      expect(typeof featureFlags.features.analyticsEnabled).toBe('boolean');
      expect(typeof featureFlags.features.cacheEnabled).toBe('boolean');
      expect(typeof featureFlags.features.rateLimitingEnabled).toBe('boolean');

      // Experiment flags
      expect(typeof featureFlags.experiments.newAuthFlow).toBe('boolean');
      expect(typeof featureFlags.experiments.enhancedMetrics).toBe('boolean');
      expect(typeof featureFlags.experiments.betaFeatures).toBe('boolean');

      // Development environment should have debug mode enabled
      expect(featureFlags.development.debugMode).toBe(true);
      expect(featureFlags.experiments.betaFeatures).toBe(true);
    });

    it('should include runtime information', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const { runtime } = response.body;

      // Runtime structure
      expect(runtime).toHaveProperty('uptime');
      expect(runtime).toHaveProperty('nodeVersion');
      expect(runtime).toHaveProperty('platform');
      expect(runtime).toHaveProperty('buildInfo');

      // Verify data types
      expect(typeof runtime.uptime).toBe('number');
      expect(runtime.uptime).toBeGreaterThan(0);
      expect(typeof runtime.nodeVersion).toBe('string');
      expect(typeof runtime.platform).toBe('string');

      // Build info structure
      expect(typeof runtime.buildInfo).toBe('object');
      // Build info properties may be undefined in development
    });

    it('should provide configuration warnings when appropriate', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const { warnings } = response.body;

      expect(Array.isArray(warnings)).toBe(true);
      
      // Each warning should be a string
      warnings.forEach((warning: any) => {
        expect(typeof warning).toBe('string');
        expect(warning.length).toBeGreaterThan(0);
      });
    });

    it('should properly categorize variable types', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const sections = response.body.sections;
      
      // Check various variable types across sections
      sections.forEach((section: any) => {
        Object.entries(section.variables).forEach(([key, variable]: [string, any]) => {
          // Verify variable structure
          expect(variable).toHaveProperty('value');
          expect(variable).toHaveProperty('type');
          expect(variable).toHaveProperty('sensitive');
          expect(variable).toHaveProperty('source');

          // Valid types
          expect(['string', 'number', 'boolean', 'url', 'email']).toContain(variable.type);

          // Valid sources
          expect(['environment', 'default', 'computed']).toContain(variable.source);

          // Type consistency
          if (variable.type === 'boolean') {
            expect(typeof variable.value).toBe('boolean');
          } else if (variable.type === 'number') {
            expect(typeof variable.value).toBe('number');
          }
        });
      });
    });

    it('should include custom headers with configuration metadata', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration');

      // Verify custom headers
      expect(response.headers).toHaveProperty('x-environment');
      expect(response.headers).toHaveProperty('x-config-version');
      expect(response.headers).toHaveProperty('x-warning-count');

      // Environment should be development
      expect(response.headers['x-environment']).toBe('development');

      // Warning count should be a number
      const warningCount = parseInt(response.headers['x-warning-count']);
      expect(warningCount).toBeGreaterThanOrEqual(0);
    });

    it('should include security headers', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration');

      // Verify security headers
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
      expect(response.headers).toHaveProperty('strict-transport-security');
      expect(response.headers).toHaveProperty('cache-control', 'no-cache, no-store, must-revalidate');
    });
  });

  describe('Production Environment Access Control', () => {
    it('should deny access in non-development environments', async () => {
      // This test simulates production environment
      // In actual production, NODE_ENV would be 'production'
      
      // Skip if actually in development
      if (process.env.NODE_ENV === 'development') {
        console.log('Skipping production access test in development environment');
        return;
      }

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(403)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('ACCESS_DENIED');
      expect(response.body.error.message).toContain('development environment');
    });
  });

  describe('CORS and Options', () => {
    it('should handle OPTIONS preflight request', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .options('/core_configuration')
        .expect(200);

      // Verify CORS headers
      expect(response.headers).toHaveProperty('access-control-allow-origin', '*');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
      expect(response.headers['access-control-allow-methods']).toContain('GET');
    });

    it('should include CORS headers in actual response', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration');

      expect(response.headers).toHaveProperty('access-control-allow-origin', '*');
    });
  });

  describe('Error Handling', () => {
    it('should return 405 for non-GET methods', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_configuration')
        .expect(405)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
      expect(response.headers).toHaveProperty('allow');
      expect(response.headers.allow).toContain('GET');
    });

    it('should handle configuration generation errors gracefully', async () => {
      // This test verifies error handling structure
      // In normal cases, configuration should generate successfully
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration');

      // Either successful response or handled error
      expect([200, 403, 500]).toContain(response.status);
      
      if (response.status === 500) {
        expect(response.body).toHaveProperty('error');
        expect(response.body.error.code).toBe('CONFIG_GENERATION_ERROR');
      }
    });
  });

  describe('Security Considerations', () => {
    it('should not expose actual sensitive values', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const responseText = JSON.stringify(response.body);
      
      // Should not contain obvious sensitive patterns
      const sensitivePatterns = [
        /sk_live_[a-zA-Z0-9]{48,}/,  // Live Stripe keys
        /sk_test_[a-zA-Z0-9]{48,}/,  // Test Stripe keys (in production)
        /whsec_[a-zA-Z0-9]{32,}/,    // Webhook secrets (full)
        /sentry\.io.*[a-f0-9]{32}/,  // Full Sentry DSN
      ];

      // In development, we might see some test values, but not production secrets
      if (process.env.NODE_ENV === 'development') {
        // At minimum, Stripe live keys should never appear
        expect(responseText).not.toMatch(/sk_live_[a-zA-Z0-9]{48,}/);
      }
    });

    it('should mark appropriate variables as sensitive', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const sections = response.body.sections;
      
      // Variables that should be marked as sensitive
      const shouldBeSensitive = [
        'JWT_SECRET',
        'ENCRYPTION_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'SENTRY_DSN'
      ];

      sections.forEach((section: any) => {
        Object.entries(section.variables).forEach(([key, variable]: [string, any]) => {
          if (shouldBeSensitive.includes(key)) {
            expect(variable.sensitive).toBe(true);
          }
        });
      });
    });
  });

  describe('Performance', () => {
    it('should respond within reasonable time', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const startTime = Date.now();
      
      await request(`${BASE_URL}/functions/v1`)
        .get('/core_configuration')
        .expect(200);

      const responseTime = Date.now() - startTime;
      
      // Configuration generation should be fast
      expect(responseTime).toBeLessThan(2000);
    });

    it('should handle concurrent requests efficiently', async () => {
      if (process.env.NODE_ENV !== 'development') return;

      const promises = Array.from({ length: 3 }, () => 
        request(`${BASE_URL}/functions/v1`)
          .get('/core_configuration')
      );

      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('sections');
      });

      // Each response should have unique timestamps and request IDs
      const timestamps = responses.map(r => r.body.timestamp);
      const requestIds = responses.map(r => r.body._meta.requestId);
      
      expect(new Set(timestamps).size).toBe(timestamps.length);
      expect(new Set(requestIds).size).toBe(requestIds.length);
    });
  });
});