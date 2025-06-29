// Integration test verifying version endpoint accuracy and consistency

import { request } from 'supertest';
import { describe, expect, it } from 'vitest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Version Endpoint Integration Tests', () => {
  describe('Version Information Accuracy', () => {
    it('should return consistent version information across requests', async () => {
      // Make multiple requests to ensure consistency
      const promises = Array.from({ length: 3 }, () =>
        request(`${BASE_URL}/functions/v1`).get('/core_version')
      );

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('version');
        expect(response.body).toHaveProperty('buildNumber');
        expect(response.body).toHaveProperty('environment');
      });

      // Core information should be identical across requests
      const firstResponse = responses[0].body;
      responses.forEach(response => {
        expect(response.body.version).toBe(firstResponse.version);
        expect(response.body.buildNumber).toBe(firstResponse.buildNumber);
        expect(response.body.environment).toBe(firstResponse.environment);
        expect(response.body.commitHash).toBe(firstResponse.commitHash);
      });
    });

    it('should include all required version fields', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      // Required fields
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('buildNumber');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('api');
      expect(response.body).toHaveProperty('_meta');

      // API information
      expect(response.body.api).toHaveProperty('version');
      expect(response.body.api).toHaveProperty('supportedVersions');
      expect(response.body.api).toHaveProperty('deprecatedVersions');

      // Meta information
      expect(response.body._meta).toHaveProperty('timestamp');
      expect(response.body._meta).toHaveProperty('requestId');
      expect(response.body._meta).toHaveProperty('responseTime');

      // Validate data types
      expect(typeof response.body.version).toBe('string');
      expect(typeof response.body.buildNumber).toBe('string');
      expect(typeof response.body.environment).toBe('string');
      expect(typeof response.body.api.version).toBe('string');
      expect(Array.isArray(response.body.api.supportedVersions)).toBe(true);
    });

    it('should validate version format consistency', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      // Version should follow semantic versioning (X.Y.Z)
      const versionRegex = /^\d+\.\d+\.\d+(-\w+)?$/;
      expect(response.body.version).toMatch(versionRegex);

      // API version should be in format "vX"
      expect(response.body.api.version).toMatch(/^v\d+$/);

      // Environment should be valid
      expect(['development', 'test', 'staging', 'production']).toContain(response.body.environment);

      // Build number should be reasonable
      if (response.body.buildNumber && response.body.buildNumber !== 'unknown') {
        expect(response.body.buildNumber).toMatch(/^\d+$/);
      }
    });

    it('should handle minimal version parameter correctly', async () => {
      const [fullResponse, minimalResponse] = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_version'),
        request(`${BASE_URL}/functions/v1`).get('/core_version?minimal=true'),
      ]);

      expect(fullResponse.status).toBe(200);
      expect(minimalResponse.status).toBe(200);

      // Minimal response should have fewer fields
      const minimalKeys = Object.keys(minimalResponse.body);
      const fullKeys = Object.keys(fullResponse.body);

      expect(minimalKeys.length).toBeLessThan(fullKeys.length);

      // Minimal should still have essential fields
      expect(minimalResponse.body).toHaveProperty('version');
      expect(minimalResponse.body).toHaveProperty('environment');
      expect(minimalResponse.body).toHaveProperty('api');
      expect(minimalResponse.body.api).toHaveProperty('version');

      // Minimal should have shorter commit hash if present
      if (minimalResponse.body.commitHash && fullResponse.body.commitHash) {
        expect(minimalResponse.body.commitHash.length).toBeLessThanOrEqual(8);
        expect(fullResponse.body.commitHash).toContain(minimalResponse.body.commitHash);
      }
    });
  });

  describe('Build Information Integration', () => {
    it('should include build metadata when available', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      // Check for build information
      if (response.body.buildDate) {
        expect(new Date(response.body.buildDate)).toBeInstanceOf(Date);
      }

      if (response.body.commitHash) {
        expect(typeof response.body.commitHash).toBe('string');
        expect(response.body.commitHash.length).toBeGreaterThan(0);
      }

      if (response.body.commitBranch) {
        expect(typeof response.body.commitBranch).toBe('string');
      }

      // Deployment information
      if (response.body.deployment) {
        expect(response.body.deployment).toHaveProperty('platform');
        expect(response.body.deployment).toHaveProperty('region');
      }
    });

    it('should include runtime environment information', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      // Runtime information
      expect(response.body).toHaveProperty('runtime');
      expect(response.body.runtime).toHaveProperty('name');
      expect(response.body.runtime).toHaveProperty('version');

      // Should identify as Deno in Edge Functions
      expect(['deno', 'node', 'bun']).toContain(response.body.runtime.name.toLowerCase());
    });

    it('should validate timestamp and response metadata', async () => {
      const startTime = Date.now();

      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      const endTime = Date.now();

      // Response metadata
      expect(response.body._meta).toHaveProperty('timestamp');
      expect(response.body._meta).toHaveProperty('requestId');
      expect(response.body._meta).toHaveProperty('responseTime');

      // Validate timestamp
      const responseTimestamp = new Date(response.body._meta.timestamp);
      expect(responseTimestamp.getTime()).toBeGreaterThanOrEqual(startTime);
      expect(responseTimestamp.getTime()).toBeLessThanOrEqual(endTime);

      // Validate request ID format (UUID)
      expect(response.body._meta.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      // Response time should be reasonable
      expect(response.body._meta.responseTime).toBeGreaterThan(0);
      expect(response.body._meta.responseTime).toBeLessThan(endTime);
    });
  });

  describe('Integration with Other Core Services', () => {
    it('should have consistent version information across core endpoints', async () => {
      // Get version from multiple endpoints
      const [versionResponse, healthResponse, metricsResponse] = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_version'),
        request(`${BASE_URL}/functions/v1`).get('/core_health-check'),
        request(`${BASE_URL}/functions/v1`).get('/core_metrics'),
      ]);

      expect(versionResponse.status).toBe(200);
      expect(healthResponse.status).toBe(200);
      expect(metricsResponse.status).toBe(200);

      // Version should be consistent across endpoints
      const versionFromVersion = versionResponse.body.version;
      const versionFromHealth = healthResponse.body.version;
      const versionFromMetrics = metricsResponse.body.system.version;

      expect(versionFromVersion).toBe(versionFromHealth);
      expect(versionFromVersion).toBe(versionFromMetrics);

      // Environment should be consistent
      const envFromVersion = versionResponse.body.environment;
      const envFromHealth = healthResponse.body.environment;
      const envFromMetrics = metricsResponse.body.system.environment;

      expect(envFromVersion).toBe(envFromHealth);
      expect(envFromVersion).toBe(envFromMetrics);
    });

    it('should be accessible to configuration endpoint (in development)', async () => {
      // Only test in development environment
      if (process.env.NODE_ENV !== 'development') {
        console.log('Skipping configuration endpoint test in non-development environment');
        return;
      }

      const [versionResponse, configResponse] = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_version'),
        request(`${BASE_URL}/functions/v1`).get('/core_configuration'),
      ]);

      expect(versionResponse.status).toBe(200);
      expect(configResponse.status).toBe(200);

      // Configuration should include version information
      const versionFromVersion = versionResponse.body.version;
      const versionFromConfig = configResponse.body.version;

      expect(versionFromVersion).toBe(versionFromConfig);
    });

    it('should be trackable by error reporting system', async () => {
      // Version information should be available for error context
      const versionResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_version')
        .expect(200);

      // Submit a test error report with version information
      const errorReport = {
        message: 'Test error for version integration',
        module: 'core',
        function: 'version-integration-test',
        version: versionResponse.body.version,
        environment: versionResponse.body.environment,
        severity: 'low',
        category: 'backend',
      };

      const errorResponse = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(errorReport)
        .expect(201);

      expect(errorResponse.body.success).toBe(true);
      expect(errorResponse.body.fingerprint).toBeDefined();
    });
  });

  describe('API Versioning and Compatibility', () => {
    it('should properly declare API version compatibility', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      // API version information
      expect(response.body.api).toHaveProperty('version');
      expect(response.body.api).toHaveProperty('supportedVersions');
      expect(response.body.api).toHaveProperty('deprecatedVersions');

      // Current API version should be in supported versions
      const currentVersion = response.body.api.version;
      expect(response.body.api.supportedVersions).toContain(currentVersion);

      // Deprecated versions should not include current version
      expect(response.body.api.deprecatedVersions).not.toContain(currentVersion);
    });

    it('should include version information in custom headers', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version');

      // Custom headers should include version information
      expect(response.headers).toHaveProperty('x-api-version');
      expect(response.headers).toHaveProperty('x-build-number');
      expect(response.headers).toHaveProperty('x-commit-hash');

      // Values should match response body
      expect(response.headers['x-api-version']).toBe(response.body.api.version);

      if (response.body.buildNumber && response.body.buildNumber !== 'unknown') {
        expect(response.headers['x-build-number']).toBe(response.body.buildNumber);
      }

      if (response.body.commitHash) {
        expect(response.headers['x-commit-hash']).toBe(response.body.commitHash.substring(0, 8));
      }
    });
  });

  describe('Caching and Performance', () => {
    it('should include appropriate cache headers', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version');

      // Version information should be cacheable
      expect(response.headers).toHaveProperty('cache-control');
      expect(response.headers['cache-control']).toContain('max-age=300'); // 5 minutes
      expect(response.headers['cache-control']).toContain('public');
    });

    it('should respond quickly for version requests', async () => {
      const startTime = Date.now();

      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      const responseTime = Date.now() - startTime;

      // Version endpoint should be very fast
      expect(responseTime).toBeLessThan(1000); // Less than 1 second

      // Response time in metadata should be reasonable
      expect(response.body._meta.responseTime).toBeLessThan(500);
    });

    it('should handle concurrent version requests efficiently', async () => {
      // Make multiple concurrent requests
      const promises = Array.from({ length: 5 }, () =>
        request(`${BASE_URL}/functions/v1`).get('/core_version')
      );

      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('version');
      });

      // Total time should be reasonable for concurrent requests
      expect(totalTime).toBeLessThan(3000); // Less than 3 seconds for 5 requests
    });
  });

  describe('Error Handling and Fallbacks', () => {
    it('should handle missing build information gracefully', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      // Should return 200 even if some build info is missing
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('environment');

      // Missing optional fields should have reasonable defaults
      if (!response.body.buildNumber) {
        expect(['unknown', '', null, undefined]).toContain(response.body.buildNumber);
      }

      if (!response.body.commitHash) {
        expect(['unknown', '', null, undefined]).toContain(response.body.commitHash);
      }
    });

    it('should provide fallback version information on partial failures', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version');

      // Even if some version building fails, should still return basic info
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('version');
        expect(response.body).toHaveProperty('environment');
      } else {
        // Fallback response should still include basic version info
        expect(response.body).toHaveProperty('version');
        expect(response.body).toHaveProperty('environment');
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('Security Integration', () => {
    it('should include security headers', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version');

      // Standard security headers
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
      expect(response.headers).toHaveProperty('strict-transport-security');
    });

    it('should not expose sensitive build information', async () => {
      const response = await request(`${BASE_URL}/functions/v1`).get('/core_version').expect(200);

      const responseText = JSON.stringify(response.body);

      // Should not contain sensitive patterns
      const sensitivePatterns = [/password/i, /secret/i, /token/i, /key/i, /private/i];

      sensitivePatterns.forEach(pattern => {
        expect(responseText).not.toMatch(pattern);
      });
    });
  });
});
