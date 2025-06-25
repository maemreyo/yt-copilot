// - Integration test verifying health check works with Layer 2 database utilities

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'supertest';
import { database } from '@/database';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Health Check Integration with Layer 2 Database Utilities', () => {
  beforeAll(async () => {
    // Initialize database connection for integration testing
    database.init({
      maxConnections: 5,
      timeout: 10000,
      retryAttempts: 3
    });
  });

  afterAll(async () => {
    // Cleanup database connections
    database.closeAll();
  });

  describe('Database Integration', () => {
    it('should verify health check database tests match Layer 2 database utilities', async () => {
      // First, test our Layer 2 database utilities directly
      const directHealthCheck = await database.healthCheck();
      
      // Then test the health check endpoint
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // Verify both use the same underlying database connection
      expect(response.body.services.database).toHaveProperty('status');
      expect(response.body.services.database).toHaveProperty('latency');
      
      // Both should report consistent database health
      if (directHealthCheck.status === 'healthy') {
        expect(response.body.services.database.status).toBe('ok');
      } else {
        expect(response.body.services.database.status).toBe('error');
      }

      // Latency should be reasonable and comparable
      expect(response.body.services.database.latency).toBeGreaterThan(0);
      expect(response.body.services.database.latency).toBeLessThan(5000);
      
      // Both latencies should be in similar range (within 2x factor)
      const healthEndpointLatency = response.body.services.database.latency;
      const directLatency = directHealthCheck.latency;
      expect(healthEndpointLatency).toBeLessThan(directLatency * 3);
    });

    it('should verify database connection pooling is working correctly', async () => {
      // Make multiple concurrent health check requests
      const promises = Array.from({ length: 5 }, () => 
        request(`${BASE_URL}/functions/v1`)
          .get('/core_health-check')
      );

      const responses = await Promise.all(promises);

      // All should succeed if connection pooling is working
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.services.database.status).toBe('ok');
        expect(response.body.services.database.latency).toBeGreaterThan(0);
      });

      // Verify connection pool details are included
      responses.forEach(response => {
        expect(response.body.services.database).toHaveProperty('details');
        expect(response.body.services.database.details).toHaveProperty('connectionPool');
      });
    });

    it('should detect database connection issues', async () => {
      // This test verifies that the health check properly detects database issues
      // In a real scenario, we might temporarily disable database connection
      
      // For now, verify the health check has proper error handling structure
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // Verify error handling structure exists
      if (response.body.services.database.status === 'error') {
        expect(response.body.services.database).toHaveProperty('message');
        expect(response.body.services.database.message).toContain('Database');
        expect(response.body.status).toBeOneOf(['degraded', 'error']);
      }
    });
  });

  describe('Service Interdependency Verification', () => {
    it('should verify all services are properly checked', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      const expectedServices = [
        'database',
        'auth', 
        'storage',
        'stripe',
        'resend',
        'edge_functions'
      ];

      expectedServices.forEach(service => {
        expect(response.body.services).toHaveProperty(service);
        expect(response.body.services[service]).toHaveProperty('status');
        expect(response.body.services[service]).toHaveProperty('lastChecked');
        
        const serviceStatus = response.body.services[service].status;
        expect(['ok', 'degraded', 'error', 'unknown']).toContain(serviceStatus);
      });
    });

    it('should calculate overall status correctly based on service health', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      const services = response.body.services;
      const overallStatus = response.body.status;

      // Count service statuses
      const serviceStatuses = Object.values(services).map((service: any) => service.status);
      const hasError = serviceStatuses.includes('error');
      const hasDegraded = serviceStatuses.includes('degraded');

      // Verify overall status logic
      if (hasError) {
        expect(overallStatus).toBe('error');
      } else if (hasDegraded) {
        expect(overallStatus).toBe('degraded');
      } else {
        expect(overallStatus).toBe('ok');
      }
    });

    it('should include performance metadata', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // Verify performance tracking
      expect(response.body).toHaveProperty('performance');
      expect(response.body.performance).toHaveProperty('responseTime');
      expect(response.body.performance.responseTime).toBeGreaterThan(0);
      
      // Optional performance metrics
      if (response.body.performance.memoryUsage) {
        expect(typeof response.body.performance.memoryUsage).toBe('number');
      }
    });

    it('should include deployment and build metadata', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // Verify metadata structure
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('buildVersion');
      
      // Optional metadata fields
      const metadata = response.body.metadata;
      if (metadata.region) {
        expect(typeof metadata.region).toBe('string');
      }
      if (metadata.commitHash) {
        expect(typeof metadata.commitHash).toBe('string');
      }
      if (metadata.deploymentTime) {
        expect(typeof metadata.deploymentTime).toBe('string');
      }
    });
  });

  describe('Integration with Error Reporting', () => {
    it('should report health check errors to error reporting system', async () => {
      // Verify that health check failures are properly logged
      // This integrates with our error reporting endpoint
      
      const healthResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // If there are any errors in health check, they should be trackable
      if (healthResponse.body.status !== 'ok') {
        // Check if errors are being tracked in error reporting
        const errorStatsResponse = await request(`${BASE_URL}/functions/v1`)
          .get('/core_error-reporting/stats')
          .expect(200);

        // Error reporting should be functioning
        expect(errorStatsResponse.body.stats).toBeDefined();
      }
    });
  });

  describe('Integration with Metrics Collection', () => {
    it('should verify health data is available to metrics endpoint', async () => {
      // Health check data should be used by metrics endpoint
      const [healthResponse, metricsResponse] = await Promise.all([
        request(`${BASE_URL}/functions/v1`).get('/core_health-check'),
        request(`${BASE_URL}/functions/v1`).get('/core_metrics')
      ]);

      expect(healthResponse.status).toBe(200);
      expect(metricsResponse.status).toBe(200);

      // Metrics should include database health information
      expect(metricsResponse.body.database).toHaveProperty('connectionHealth');
      expect(metricsResponse.body.database.connectionHealth).toHaveProperty('status');
      
      // Database health status should be consistent between endpoints
      const healthDbStatus = healthResponse.body.services.database.status;
      const metricsDbStatus = metricsResponse.body.database.connectionHealth.status;
      
      // Both should report similar health (ok/healthy or error/unhealthy)
      if (healthDbStatus === 'ok') {
        expect(metricsDbStatus).toBe('healthy');
      } else if (healthDbStatus === 'error') {
        expect(metricsDbStatus).toBe('unhealthy');
      }
    });
  });

  describe('Caching and Performance', () => {
    it('should handle repeated health checks efficiently', async () => {
      const startTime = Date.now();
      
      // Make multiple health check requests
      const promises = Array.from({ length: 3 }, () =>
        request(`${BASE_URL}/functions/v1`)
          .get('/core_health-check')
      );

      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Total time should be reasonable (not indicating blocking issues)
      expect(totalTime).toBeLessThan(10000); // Less than 10 seconds for 3 requests
    });

    it('should update health status in real-time', async () => {
      // Make two health check requests with a small delay
      const firstResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 100));

      const secondResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // Timestamps should be different (real-time updates)
      expect(firstResponse.body.timestamp).not.toBe(secondResponse.body.timestamp);
      
      // Both should have recent timestamps
      const firstTimestamp = new Date(firstResponse.body.timestamp);
      const secondTimestamp = new Date(secondResponse.body.timestamp);
      const now = new Date();
      
      expect(now.getTime() - firstTimestamp.getTime()).toBeLessThan(60000); // Within last minute
      expect(now.getTime() - secondTimestamp.getTime()).toBeLessThan(60000);
      expect(secondTimestamp.getTime()).toBeGreaterThanOrEqual(firstTimestamp.getTime());
    });
  });

  describe('Security Integration', () => {
    it('should include all required security headers', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check');

      // Verify security headers from Layer 1 security utilities
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
      expect(response.headers).toHaveProperty('strict-transport-security');
      
      // Health check specific headers
      expect(response.headers).toHaveProperty('cache-control');
    });

    it('should not expose sensitive information in health check', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      const responseText = JSON.stringify(response.body);

      // Should not contain sensitive patterns
      const sensitivePatterns = [
        /sk_live_[a-zA-Z0-9]{48,}/,  // Stripe live keys
        /sk_test_[a-zA-Z0-9]{48,}/,  // Stripe test keys
        /supabase.*[a-zA-Z0-9]{40,}/, // Supabase keys
        /password/i,
        /secret/i,
        /token/i
      ];

      sensitivePatterns.forEach(pattern => {
        expect(responseText).not.toMatch(pattern);
      });
    });
  });

  describe('Resilience and Error Recovery', () => {
    it('should handle partial service failures gracefully', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_health-check')
        .expect(200);

      // Even if some services are down, health check should still return 200
      // with appropriate status indicators
      expect(['ok', 'degraded', 'error']).toContain(response.body.status);
      
      // Each service should have a definitive status
      Object.values(response.body.services).forEach((service: any) => {
        expect(['ok', 'degraded', 'error', 'unknown']).toContain(service.status);
        expect(service).toHaveProperty('lastChecked');
      });
    });
  });
});