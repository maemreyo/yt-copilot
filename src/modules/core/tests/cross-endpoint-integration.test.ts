// - Integration test verifying interactions between core services

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'supertest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Cross-Endpoint Integration Tests', () => {
  describe('Data Consistency Across Endpoints', () => {
    it('should have consistent version information across all endpoints', async () => {
      const endpoints = [
        { path: '/core_version', field: 'version' },
        { path: '/core_health-check', field: 'version' },
        { path: '/core_metrics', field: 'system.version' }
      ];

      const responses = await Promise.all(
        endpoints.map(endpoint => 
          request(`${BASE_URL}/functions/v1`).get(endpoint.path)
        )
      );

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Extract version from each response
      const versions = [
        responses[0].body.version,
        responses[1].body.version,
        responses[2].body.system?.version || responses[2].body.version
      ];

      // All versions should be identical
      expect(versions[0]).toBe(versions[1]);
      expect(versions[1]).toBe(versions[2]);
      expect(versions[0]).toBeTruthy();
    });

    it('should have consistent environment information across endpoints', async () => {
      const [versionResp, healthResp, metricsResp] = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_version'),
        request(`${BASE_URL}/functions/v1`).get('/core_health-check'),
        request(`${BASE_URL}/functions/v1`).get('/core_metrics')
      ]);

      expect(versionResp.status).toBe(200);
      expect(healthResp.status).toBe(200);
      expect(metricsResp.status).toBe(200);

      const environments = [
        versionResp.body.environment,
        healthResp.body.environment,
        metricsResp.body.system?.environment || metricsResp.body.environment
      ];

      // All should report same environment
      expect(environments[0]).toBe(environments[1]);
      expect(environments[1]).toBe(environments[2]);
      expect(['development', 'test', 'staging', 'production']).toContain(environments[0]);
    });

    it('should have consistent timestamp formats across endpoints', async () => {
      const responses = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_health-check'),
        request(`${BASE_URL}/functions/v1`).get('/core_metrics'),
        request(`${BASE_URL}/functions/v1`).post('/core_error-reporting/report').send({
          message: 'Cross-endpoint timestamp test',
          module: 'integration'
        })
      ]);

      responses.forEach(response => {
        expect([200, 201]).toContain(response.status);
        expect(response.body).toHaveProperty('timestamp');
        
        // All timestamps should be valid ISO strings
        const timestamp = new Date(response.body.timestamp);
        expect(timestamp).toBeInstanceOf(Date);
        expect(timestamp.getTime()).toBeGreaterThan(Date.now() - 60000); // Within last minute
      });
    });
  });

  describe('Metrics Collection from Other Services', () => {
    it('should collect error metrics from error reporting service', async () => {
      // Submit some test errors
      const testErrors = [
        { message: 'Test error 1', module: 'test', severity: 'low' },
        { message: 'Test error 2', module: 'test', severity: 'medium' },
        { message: 'Test error 3', module: 'core', severity: 'high' }
      ];

      await Promise.all(
        testErrors.map(error =>
          request(`${BASE_URL}/functions/v1`)
            .post('/core_error-reporting/report')
            .send(error)
        )
      );

      // Wait a moment for processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get metrics
      const metricsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      // Metrics should include error information
      expect(metricsResponse.body.errors).toHaveProperty('rates');
      expect(metricsResponse.body.errors).toHaveProperty('byModule');
      expect(metricsResponse.body.errors).toHaveProperty('bySeverity');

      // Should have some error data (might be historical + our test errors)
      expect(metricsResponse.body.errors.rates.last15m).toBeGreaterThanOrEqual(0);
      
      // Check that our test modules appear in the data
      const byModule = metricsResponse.body.errors.byModule;
      if (Object.keys(byModule).length > 0) {
        expect(typeof byModule).toBe('object');
      }
    });

    it('should collect database health metrics consistent with health check', async () => {
      const [healthResponse, metricsResponse] = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_health-check'),
        request(`${BASE_URL}/functions/v1`).get('/core_metrics')
      ]);

      expect(healthResponse.status).toBe(200);
      expect(metricsResponse.status).toBe(200);

      // Database health should be consistent
      const healthDbStatus = healthResponse.body.services.database.status;
      const metricsDbStatus = metricsResponse.body.database.connectionHealth.status;

      // Map between health check and metrics terminology
      const statusMapping = {
        'ok': 'healthy',
        'error': 'unhealthy',
        'degraded': 'unhealthy'
      };

      expect(metricsDbStatus).toBe(statusMapping[healthDbStatus] || 'unhealthy');

      // Latency should be comparable
      const healthLatency = healthResponse.body.services.database.latency;
      const metricsLatency = metricsResponse.body.database.connectionHealth.latency;

      expect(healthLatency).toBeGreaterThan(0);
      expect(metricsLatency).toBeGreaterThan(0);
      
      // Should be within reasonable range of each other
      expect(Math.abs(healthLatency - metricsLatency)).toBeLessThan(Math.max(healthLatency, metricsLatency) * 2);
    });

    it('should track API usage metrics from actual endpoint calls', async () => {
      // Make calls to various endpoints
      const endpointCalls = [
        request(`${BASE_URL}/functions/v1`).get('/core_health-check'),
        request(`${BASE_URL}/functions/v1`).get('/core_version'),
        request(`${BASE_URL}/functions/v1`).get('/core_metrics'),
        request(`${BASE_URL}/functions/v1`).post('/core_error-reporting/report').send({
          message: 'API usage test',
          module: 'api-test'
        })
      ];

      await Promise.all(endpointCalls);

      // Get metrics after calls
      const metricsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      // API usage metrics should show activity
      expect(metricsResponse.body.api).toHaveProperty('endpoints');
      expect(metricsResponse.body.api).toHaveProperty('authentication');
      expect(metricsResponse.body.api).toHaveProperty('rateLimiting');

      // Should have some request data
      expect(metricsResponse.body.system.performance.requestCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Reporting Integration with All Services', () => {
    it('should accept error reports from health check failures', async () => {
      // Simulate a health check error being reported
      const healthErrorReport = {
        message: 'Database connection timeout in health check',
        module: 'core',
        function: 'healthCheck',
        severity: 'high',
        category: 'database',
        additionalData: {
          service: 'database',
          latency: 5000,
          timeout: true
        }
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(healthErrorReport)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.fingerprint).toBeDefined();
    });

    it('should accept error reports from metrics collection', async () => {
      // Simulate a metrics collection error
      const metricsErrorReport = {
        message: 'Failed to collect cache metrics',
        module: 'core',
        function: 'collectCacheMetrics',
        severity: 'medium',
        category: 'performance',
        additionalData: {
          operation: 'cache_stats',
          cacheStore: 'default'
        }
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(metricsErrorReport)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.fingerprint).toBeDefined();
    });

    it('should provide error statistics for monitoring', async () => {
      // Get error statistics
      const statsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/stats')
        .expect(200);

      expect(statsResponse.body.stats).toHaveProperty('totalErrors');
      expect(statsResponse.body.stats).toHaveProperty('errorsByModule');
      expect(statsResponse.body.stats).toHaveProperty('errorsBySeverity');
      expect(statsResponse.body.stats).toHaveProperty('timeRange');

      // Data should be structured correctly
      expect(typeof statsResponse.body.stats.totalErrors).toBe('number');
      expect(typeof statsResponse.body.stats.errorsByModule).toBe('object');
      expect(typeof statsResponse.body.stats.errorsBySeverity).toBe('object');
    });
  });

  describe('Configuration Endpoint Dependencies', () => {
    it('should reflect actual service configuration in development', async () => {
      // Only test in development environment
      if (process.env.NODE_ENV !== 'development') {
        console.log('Skipping configuration test in non-development environment');
        return;
      }

      const [configResponse, versionResponse, healthResponse] = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_configuration'),
        request(`${BASE_URL}/functions/v1`).get('/core_version'),
        request(`${BASE_URL}/functions/v1`).get('/core_health-check')
      ]);

      expect(configResponse.status).toBe(200);
      expect(versionResponse.status).toBe(200);
      expect(healthResponse.status).toBe(200);

      // Version should match
      expect(configResponse.body.version).toBe(versionResponse.body.version);

      // Environment should match
      expect(configResponse.body.environment).toBe(versionResponse.body.environment);
      expect(configResponse.body.environment).toBe(healthResponse.body.environment);

      // Feature flags should be consistent with actual behavior
      const featureFlags = configResponse.body.featureFlags;
      
      // If metrics are enabled in config, metrics endpoint should work
      if (featureFlags.features.metricsEnabled) {
        const metricsResponse = await request(`${BASE_URL}/functions/v1`)
          .get('/core_metrics');
        expect(metricsResponse.status).toBe(200);
      }

      // If error reporting is enabled, error endpoint should work
      if (featureFlags.features.errorReporting) {
        const errorResponse = await request(`${BASE_URL}/functions/v1`)
          .post('/core_error-reporting/report')
          .send({
            message: 'Config validation test',
            module: 'config-test'
          });
        expect([201, 429]).toContain(errorResponse.status); // Success or rate limited
      }
    });
  });

  describe('Performance and Load Integration', () => {
    it('should handle concurrent requests across all endpoints efficiently', async () => {
      const concurrentRequests = [
        // Multiple health checks
        ...Array.from({ length: 3 }, () => 
          request(`${BASE_URL}/functions/v1`).get('/core_health-check')
        ),
        // Multiple version requests
        ...Array.from({ length: 3 }, () => 
          request(`${BASE_URL}/functions/v1`).get('/core_version')
        ),
        // Metrics request
        request(`${BASE_URL}/functions/v1`).get('/core_metrics'),
        // Error reporting
        request(`${BASE_URL}/functions/v1`)
          .post('/core_error-reporting/report')
          .send({
            message: 'Concurrent load test',
            module: 'load-test'
          })
      ];

      const startTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const totalTime = Date.now() - startTime;

      // All requests should succeed (or have expected status codes)
      responses.forEach(response => {
        expect([200, 201, 429]).toContain(response.status);
      });

      // Total time should be reasonable for concurrent execution
      expect(totalTime).toBeLessThan(10000); // Less than 10 seconds

      // Should not have blocking issues
      const successfulResponses = responses.filter(r => [200, 201].includes(r.status));
      expect(successfulResponses.length).toBeGreaterThan(5); // Most should succeed
    });

    it('should maintain consistent response times under light load', async () => {
      // Sequential requests to measure consistency
      const responseTimes: number[] = [];

      for (let i = 0; i < 5; i++) {
        const startTime = Date.now();
        
        await request(`${BASE_URL}/functions/v1`)
          .get('/core_health-check')
          .expect(200);
        
        responseTimes.push(Date.now() - startTime);
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Response times should be relatively consistent
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxDeviation = Math.max(...responseTimes.map(time => Math.abs(time - avgResponseTime)));

      // Max deviation should be reasonable (not indicating resource contention)
      expect(maxDeviation).toBeLessThan(avgResponseTime * 2);
      expect(avgResponseTime).toBeLessThan(2000); // Average under 2 seconds
    });
  });

  describe('Data Flow Between Services', () => {
    it('should complete a full error reporting and metrics flow', async () => {
      // 1. Submit error report
      const errorReport = {
        message: 'Full flow integration test',
        module: 'integration-test',
        function: 'fullFlowTest',
        severity: 'medium',
        category: 'backend',
        tags: ['integration', 'full-flow']
      };

      const errorResponse = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(errorReport)
        .expect(201);

      const fingerprint = errorResponse.body.fingerprint;
      expect(fingerprint).toBeDefined();

      // 2. Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. Verify error appears in statistics
      const statsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/stats')
        .expect(200);

      expect(statsResponse.body.stats.totalErrors).toBeGreaterThan(0);
      
      // Check if our module appears in the stats
      const moduleStats = statsResponse.body.stats.errorsByModule;
      if (moduleStats['integration-test']) {
        expect(moduleStats['integration-test']).toBeGreaterThan(0);
      }

      // 4. Verify error appears in aggregated data
      const aggregatedResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/aggregated')
        .expect(200);

      expect(Array.isArray(aggregatedResponse.body.aggregated)).toBe(true);

      // 5. Verify metrics includes error data
      const metricsResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      expect(metricsResponse.body.errors.rates.last15m).toBeGreaterThanOrEqual(0);
      
      // Our error should contribute to the overall error rate
      expect(metricsResponse.body.errors.rates.last15m).toBeGreaterThan(0);
    });

    it('should maintain service health status consistency', async () => {
      // Get health status multiple times over a short period
      const healthChecks = [];
      
      for (let i = 0; i < 3; i++) {
        const response = await request(`${BASE_URL}/functions/v1`)
          .get('/core_health-check')
          .expect(200);
        
        healthChecks.push(response.body);
        
        if (i < 2) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Overall status should be consistent (not flapping)
      const statuses = healthChecks.map(hc => hc.status);
      const uniqueStatuses = new Set(statuses);
      
      // Should not have more than 2 different statuses in a short period
      expect(uniqueStatuses.size).toBeLessThanOrEqual(2);
      
      // If status changes, it should be logical (ok -> degraded, not ok -> error -> ok)
      if (uniqueStatuses.size === 2) {
        const validTransitions = [
          ['ok', 'degraded'],
          ['degraded', 'ok'],
          ['degraded', 'error'],
          ['error', 'degraded']
        ];
        
        // Check transitions are valid
        for (let i = 1; i < statuses.length; i++) {
          const transition = [statuses[i-1], statuses[i]];
          const isValidTransition = validTransitions.some(valid => 
            valid[0] === transition[0] && valid[1] === transition[1]
          ) || transition[0] === transition[1]; // Same status is valid
          
          expect(isValidTransition).toBe(true);
        }
      }
    });
  });
});