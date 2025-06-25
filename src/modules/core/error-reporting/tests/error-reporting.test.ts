import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'supertest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Error Reporting API', () => {
  const mockErrorReport = {
    message: 'Test error message',
    module: 'test-module',
    function: 'testFunction',
    severity: 'medium' as const,
    category: 'backend' as const,
    environment: 'test' as const,
    additionalData: {
      testData: 'sample',
      requestId: 'test-123'
    },
    tags: ['test', 'integration']
  };

  describe('POST /report', () => {
    it('should accept valid error report', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(mockErrorReport)
        .expect(201)
        .expect('Content-Type', /json/);

      // Verify response structure
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('fingerprint');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
      
      // Verify fingerprint is generated
      expect(response.body.fingerprint).toBe('string');
      expect(response.body.fingerprint).toHaveLength(32);
    });

    it('should reject error report without required fields', async () => {
      const invalidReport = {
        // Missing required 'message' and 'module'
        severity: 'low'
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(invalidReport)
        .expect(400)
        .expect('Content-Type', /json/);

      // Verify error response
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(response.body.error).toHaveProperty('details');
      expect(Array.isArray(response.body.error.details)).toBe(true);
    });

    it('should reject error report with invalid enum values', async () => {
      const invalidReport = {
        message: 'Test error',
        module: 'test-module',
        severity: 'invalid-severity', // Invalid enum value
        category: 'invalid-category'  // Invalid enum value
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(invalidReport)
        .expect(400)
        .expect('Content-Type', /json/);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContain(
        expect.stringMatching(/severity must be one of/)
      );
      expect(response.body.error.details).toContain(
        expect.stringMatching(/category must be one of/)
      );
    });

    it('should handle large error reports appropriately', async () => {
      const largeReport = {
        message: 'A'.repeat(1001), // Exceeds 1000 char limit
        module: 'B'.repeat(51),    // Exceeds 50 char limit
        function: 'C'.repeat(101), // Exceeds 100 char limit
        tags: new Array(11).fill('tag') // Exceeds 10 item limit
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(largeReport)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContain(
        expect.stringMatching(/message must be less than 1000 characters/)
      );
      expect(response.body.error.details).toContain(
        expect.stringMatching(/module must be less than 50 characters/)
      );
    });

    it('should generate consistent fingerprints for similar errors', async () => {
      const error1 = {
        message: 'Database connection failed with ID 123',
        module: 'database',
        function: 'connect',
        errorCode: 'DB_CONN_ERROR'
      };

      const error2 = {
        message: 'Database connection failed with ID 456', // Different ID
        module: 'database',
        function: 'connect',
        errorCode: 'DB_CONN_ERROR'
      };

      const response1 = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(error1)
        .expect(201);

      const response2 = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(error2)
        .expect(201);

      // Should generate same fingerprint (IDs normalized)
      expect(response1.body.fingerprint).toBe(response2.body.fingerprint);
    });

    it('should accept custom fingerprint', async () => {
      const customFingerprint = 'custom-error-group-123';
      const errorWithFingerprint = {
        ...mockErrorReport,
        fingerprint: customFingerprint
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(errorWithFingerprint)
        .expect(201);

      expect(response.body.fingerprint).toBe(customFingerprint);
    });

    it('should include security headers', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(mockErrorReport);

      // Verify security headers
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
      expect(response.headers).toHaveProperty('strict-transport-security');
    });
  });

  describe('GET /stats', () => {
    beforeAll(async () => {
      // Seed some test error data
      const testErrors = [
        { ...mockErrorReport, module: 'module-a', severity: 'high' },
        { ...mockErrorReport, module: 'module-a', severity: 'medium' },
        { ...mockErrorReport, module: 'module-b', severity: 'low' },
        { ...mockErrorReport, module: 'module-b', severity: 'critical' }
      ];

      for (const error of testErrors) {
        await request(`${BASE_URL}/functions/v1`)
          .post('/core_error-reporting/report')
          .send(error);
      }

      // Wait a bit for database writes
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    it('should return error statistics', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/stats')
        .expect(200)
        .expect('Content-Type', /json/);

      // Verify response structure
      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('timestamp');
      
      const stats = response.body.stats;
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('errorsByModule');
      expect(stats).toHaveProperty('errorsBySeverity');
      expect(stats).toHaveProperty('errorsByCategory');
      expect(stats).toHaveProperty('timeRange');

      // Verify data types
      expect(typeof stats.totalErrors).toBe('number');
      expect(typeof stats.errorsByModule).toBe('object');
      expect(typeof stats.errorsBySeverity).toBe('object');
      expect(typeof stats.errorsByCategory).toBe('object');
    });

    it('should accept time range parameters', async () => {
      const start = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      const end = new Date().toISOString();

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/stats')
        .query({ start, end })
        .expect(200);

      expect(response.body.stats.timeRange.start).toBe(start);
      expect(response.body.stats.timeRange.end).toBe(end);
    });

    it('should filter by module', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/stats')
        .query({ module: 'module-a' })
        .expect(200);

      const stats = response.body.stats;
      
      // Should only include errors from specified module
      expect(stats.errorsByModule).toHaveProperty('module-a');
      // Should not have other modules (if they exist)
      Object.keys(stats.errorsByModule).forEach(module => {
        expect(module).toBe('module-a');
      });
    });
  });

  describe('GET /aggregated', () => {
    it('should return aggregated error data', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/aggregated')
        .expect(200)
        .expect('Content-Type', /json/);

      // Verify response structure
      expect(response.body).toHaveProperty('aggregated');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('timestamp');

      // Verify aggregated data structure
      expect(Array.isArray(response.body.aggregated)).toBe(true);
      
      if (response.body.aggregated.length > 0) {
        const item = response.body.aggregated[0];
        expect(item).toHaveProperty('fingerprint');
        expect(item).toHaveProperty('count');
        expect(item).toHaveProperty('firstSeen');
        expect(item).toHaveProperty('lastSeen');
        expect(item).toHaveProperty('message');
        expect(item).toHaveProperty('module');
        expect(item).toHaveProperty('severity');
        expect(item).toHaveProperty('category');
      }
    });

    it('should respect limit parameter', async () => {
      const limit = 5;
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/aggregated')
        .query({ limit })
        .expect(200);

      expect(response.body.aggregated.length).toBeLessThanOrEqual(limit);
    });

    it('should filter by module', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/aggregated')
        .query({ module: 'test-module' })
        .expect(200);

      // All returned items should be from the specified module
      response.body.aggregated.forEach((item: any) => {
        expect(item.module).toBe('test-module');
      });
    });
  });

  describe('CORS and Options', () => {
    it('should handle OPTIONS preflight request', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .options('/core_error-reporting/report')
        .expect(200);

      // Verify CORS headers
      expect(response.headers).toHaveProperty('access-control-allow-origin', '*');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
      expect(response.headers).toHaveProperty('access-control-allow-headers');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/core_error-reporting/unknown')
        .expect(404)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error).toHaveProperty('availableEndpoints');
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .set('Content-Type', 'application/json')
        .send('invalid json{')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle missing request body', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send()
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Performance', () => {
    it('should respond within reasonable time', async () => {
      const startTime = Date.now();
      
      await request(`${BASE_URL}/functions/v1`)
        .post('/core_error-reporting/report')
        .send(mockErrorReport)
        .expect(201);

      const responseTime = Date.now() - startTime;
      
      // Should respond within 2 seconds
      expect(responseTime).toBeLessThan(2000);
    });

    it('should handle concurrent requests', async () => {
      const promises = Array.from({ length: 5 }, (_, i) => 
        request(`${BASE_URL}/functions/v1`)
          .post('/core_error-reporting/report')
          .send({
            ...mockErrorReport,
            message: `Concurrent test error ${i}`
          })
      );

      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });
    });
  });
});