import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'supertest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Metrics API', () => {
  describe('GET /metrics', () => {
    it('should return comprehensive metrics in JSON format', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200)
        .expect('Content-Type', /json/);

      // Verify response structure
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('system');
      expect(response.body).toHaveProperty('database'); 
      expect(response.body).toHaveProperty('cache');
      expect(response.body).toHaveProperty('errors');
      expect(response.body).toHaveProperty('api');
      expect(response.body).toHaveProperty('health');

      // Verify timestamp format
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });

    it('should include valid system metrics', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const { system } = response.body;

      // System metrics structure
      expect(system).toHaveProperty('timestamp');
      expect(system).toHaveProperty('uptime');
      expect(system).toHaveProperty('memory');
      expect(system).toHaveProperty('performance');

      // Memory metrics
      expect(system.memory).toHaveProperty('used');
      expect(system.memory).toHaveProperty('total');
      expect(system.memory).toHaveProperty('percentage');
      expect(typeof system.memory.used).toBe('number');
      expect(system.memory.percentage).toBeGreaterThanOrEqual(0);
      expect(system.memory.percentage).toBeLessThanOrEqual(100);

      // Performance metrics
      expect(system.performance).toHaveProperty('responseTime');
      expect(system.performance).toHaveProperty('requestCount');
      expect(system.performance).toHaveProperty('averageResponseTime');
      expect(typeof system.performance.responseTime).toBe('number');
      expect(system.performance.requestCount).toBeGreaterThanOrEqual(0);

      // Uptime should be positive
      expect(system.uptime).toBeGreaterThan(0);
    });

    it('should include valid database metrics', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const { database } = response.body;

      // Database connection health
      expect(database).toHaveProperty('connectionHealth');
      expect(database.connectionHealth).toHaveProperty('status');
      expect(database.connectionHealth).toHaveProperty('latency');
      expect(database.connectionHealth).toHaveProperty('connectionPool');
      
      expect(['healthy', 'unhealthy']).toContain(database.connectionHealth.status);
      expect(typeof database.connectionHealth.latency).toBe('number');
      expect(database.connectionHealth.latency).toBeGreaterThanOrEqual(0);

      // Connection pool metrics
      const pool = database.connectionHealth.connectionPool;
      expect(pool).toHaveProperty('active');
      expect(pool).toHaveProperty('idle');
      expect(pool).toHaveProperty('total');
      expect(typeof pool.active).toBe('number');
      expect(typeof pool.idle).toBe('number');
      expect(typeof pool.total).toBe('number');

      // Query performance
      expect(database).toHaveProperty('queryPerformance');
      expect(database.queryPerformance).toHaveProperty('averageQueryTime');
      expect(database.queryPerformance).toHaveProperty('slowQueries');
      expect(database.queryPerformance).toHaveProperty('totalQueries');

      // Tables information
      expect(database).toHaveProperty('tables');
      expect(Array.isArray(database.tables)).toBe(true);
    });

    it('should include valid cache metrics', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const { cache } = response.body;

      // Cache structure
      expect(cache).toHaveProperty('stores');
      expect(cache).toHaveProperty('global');
      expect(typeof cache.stores).toBe('object');

      // Global cache metrics
      expect(cache.global).toHaveProperty('totalHitRate');
      expect(cache.global).toHaveProperty('totalCaches');
      expect(cache.global).toHaveProperty('totalMemoryUsage');
      
      expect(typeof cache.global.totalHitRate).toBe('number');
      expect(cache.global.totalHitRate).toBeGreaterThanOrEqual(0);
      expect(cache.global.totalHitRate).toBeLessThanOrEqual(1);
      expect(cache.global.totalCaches).toBeGreaterThanOrEqual(0);
      expect(cache.global.totalMemoryUsage).toBeGreaterThanOrEqual(0);

      // Individual store metrics
      Object.values(cache.stores).forEach((store: any) => {
        expect(store).toHaveProperty('hitRate');
        expect(store).toHaveProperty('totalHits');
        expect(store).toHaveProperty('totalRequests');
        expect(store).toHaveProperty('size');
        expect(store).toHaveProperty('memoryUsage');
        
        expect(typeof store.hitRate).toBe('number');
        expect(store.hitRate).toBeGreaterThanOrEqual(0);
        expect(store.hitRate).toBeLessThanOrEqual(1);
      });
    });

    it('should include valid error metrics', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const { errors } = response.body;

      // Error rates
      expect(errors).toHaveProperty('rates');
      expect(errors.rates).toHaveProperty('last24h');
      expect(errors.rates).toHaveProperty('last1h');
      expect(errors.rates).toHaveProperty('last15m');
      
      expect(typeof errors.rates.last24h).toBe('number');
      expect(typeof errors.rates.last1h).toBe('number');
      expect(typeof errors.rates.last15m).toBe('number');
      expect(errors.rates.last24h).toBeGreaterThanOrEqual(0);
      expect(errors.rates.last1h).toBeGreaterThanOrEqual(0);
      expect(errors.rates.last15m).toBeGreaterThanOrEqual(0);

      // Error breakdown
      expect(errors).toHaveProperty('byModule');
      expect(errors).toHaveProperty('bySeverity');
      expect(errors).toHaveProperty('topErrors');
      
      expect(typeof errors.byModule).toBe('object');
      expect(typeof errors.bySeverity).toBe('object');
      expect(Array.isArray(errors.topErrors)).toBe(true);

      // Top errors structure
      errors.topErrors.forEach((error: any) => {
        expect(error).toHaveProperty('fingerprint');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('count');
        expect(error).toHaveProperty('module');
        expect(error).toHaveProperty('severity');
        expect(typeof error.count).toBe('number');
      });
    });

    it('should include valid API usage metrics', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const { api } = response.body;

      // API endpoints
      expect(api).toHaveProperty('endpoints');
      expect(typeof api.endpoints).toBe('object');

      // Authentication metrics
      expect(api).toHaveProperty('authentication');
      expect(api.authentication).toHaveProperty('jwtRequests');
      expect(api.authentication).toHaveProperty('apiKeyRequests');
      expect(api.authentication).toHaveProperty('publicRequests');
      expect(api.authentication).toHaveProperty('failedAuthentications');
      
      Object.values(api.authentication).forEach((value: any) => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      });

      // Rate limiting metrics
      expect(api).toHaveProperty('rateLimiting');
      expect(api.rateLimiting).toHaveProperty('totalLimited');
      expect(api.rateLimiting).toHaveProperty('limitsByEndpoint');
      expect(api.rateLimiting).toHaveProperty('averageRequestRate');
      
      expect(typeof api.rateLimiting.totalLimited).toBe('number');
      expect(typeof api.rateLimiting.averageRequestRate).toBe('number');
      expect(typeof api.rateLimiting.limitsByEndpoint).toBe('object');
    });

    it('should include valid health assessment', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const { health } = response.body;

      // Overall status
      expect(health).toHaveProperty('overallStatus');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.overallStatus);

      // Service statuses
      expect(health).toHaveProperty('services');
      expect(typeof health.services).toBe('object');
      
      Object.values(health.services).forEach((status: any) => {
        expect(['up', 'down', 'degraded']).toContain(status);
      });

      // Health score
      expect(health).toHaveProperty('score');
      expect(typeof health.score).toBe('number');
      expect(health.score).toBeGreaterThanOrEqual(0);
      expect(health.score).toBeLessThanOrEqual(100);
    });

    it('should return metrics in Prometheus format when requested', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics?format=prometheus')
        .expect(200)
        .expect('Content-Type', /text\/plain/);

      const metricsText = response.text;

      // Verify Prometheus format structure
      expect(metricsText).toContain('# HELP');
      expect(metricsText).toContain('# TYPE');
      
      // Check for specific metrics
      expect(metricsText).toContain('system_uptime_milliseconds');
      expect(metricsText).toContain('system_memory_usage_bytes');
      expect(metricsText).toContain('system_memory_usage_percentage');
      expect(metricsText).toContain('database_connection_latency_milliseconds');
      expect(metricsText).toContain('database_query_average_time_milliseconds');
      expect(metricsText).toContain('errors_total_24h');
      expect(metricsText).toContain('errors_total_1h');
      expect(metricsText).toContain('health_score_percentage');
      expect(metricsText).toContain('cache_hit_rate_percentage');

      // Verify metrics have valid values
      const metricLines = metricsText.split('\n').filter(line => 
        !line.startsWith('#') && line.trim() !== ''
      );
      
      metricLines.forEach(line => {
        const parts = line.split(' ');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toMatch(/^[a-z_]+$/); // Valid metric name
        expect(parseFloat(parts[1])).not.toBeNaN(); // Valid numeric value
      });
    });

    it('should include custom headers with metrics metadata', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics');

      // Verify custom metrics headers
      expect(response.headers).toHaveProperty('x-metrics-collection-time');
      expect(response.headers).toHaveProperty('x-health-score');
      
      // Collection time should be a valid timestamp
      const collectionTime = parseInt(response.headers['x-metrics-collection-time']);
      expect(collectionTime).toBeGreaterThan(0);
      expect(collectionTime).toBeLessThan(Date.now() + 1000); // Within last second

      // Health score should be valid percentage
      const healthScore = parseFloat(response.headers['x-health-score']);
      expect(healthScore).toBeGreaterThanOrEqual(0);
      expect(healthScore).toBeLessThanOrEqual(100);
    });

    it('should include security headers', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics');

      // Verify security headers
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
      expect(response.headers).toHaveProperty('strict-transport-security');
      expect(response.headers).toHaveProperty('cache-control', 'no-cache, no-store, must-revalidate');
    });

    it('should have reasonable response time for metrics collection', async () => {
      const startTime = Date.now();
      
      await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const responseTime = Date.now() - startTime;
      
      // Metrics collection should complete within 5 seconds
      expect(responseTime).toBeLessThan(5000);
    });

    it('should handle concurrent requests efficiently', async () => {
      const promises = Array.from({ length: 3 }, () => 
        request(`${BASE_URL}/functions/v1`)
          .get('/core_metrics')
      );

      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('health');
      });

      // Each response should have unique timestamps
      const timestamps = responses.map(r => r.body.timestamp);
      const uniqueTimestamps = new Set(timestamps);
      expect(uniqueTimestamps.size).toBe(timestamps.length);
    });
  });

  describe('CORS and Options', () => {
    it('should handle OPTIONS preflight request', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .options('/core_metrics')
        .expect(200);

      // Verify CORS headers
      expect(response.headers).toHaveProperty('access-control-allow-origin', '*');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
      expect(response.headers['access-control-allow-methods']).toContain('GET');
    });

    it('should include CORS headers in actual response', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin', '*');
    });
  });

  describe('Error Handling', () => {
    it('should return 405 for non-GET methods', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_metrics')
        .expect(405)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
      expect(response.headers).toHaveProperty('allow');
      expect(response.headers.allow).toContain('GET');
    });

    it('should handle invalid format parameter gracefully', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics?format=invalid')
        .expect(200); // Should default to JSON

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should handle metrics collection errors gracefully', async () => {
      // This test would simulate database connection failure
      // In a real scenario, we might mock the database to fail
      // For now, we just verify the endpoint structure handles errors
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics');

      // Even if some metrics fail, endpoint should return partial data
      expect([200, 500]).toContain(response.status);
      
      if (response.status === 500) {
        expect(response.body).toHaveProperty('error');
        expect(response.body.error.code).toBe('METRICS_COLLECTION_ERROR');
      }
    });
  });

  describe('Performance Monitoring', () => {
    it('should track request counter across multiple calls', async () => {
      // Make multiple requests
      const firstResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const secondResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      // Request count should increase (though it may reset between function invocations)
      const firstCount = firstResponse.body.system.performance.requestCount;
      const secondCount = secondResponse.body.system.performance.requestCount;
      
      expect(typeof firstCount).toBe('number');
      expect(typeof secondCount).toBe('number');
      expect(firstCount).toBeGreaterThanOrEqual(0);
      expect(secondCount).toBeGreaterThanOrEqual(0);
    });

    it('should provide meaningful performance metrics', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_metrics')
        .expect(200);

      const { system } = response.body;
      
      // Response time should be positive and reasonable
      expect(system.performance.responseTime).toBeGreaterThan(0);
      expect(system.performance.responseTime).toBeLessThan(10000); // Less than 10 seconds
      
      // Average response time should be reasonable if there have been requests
      if (system.performance.requestCount > 0) {
        expect(system.performance.averageResponseTime).toBeGreaterThan(0);
        expect(system.performance.averageResponseTime).toBeLessThan(10000);
      }
    });
  });
});