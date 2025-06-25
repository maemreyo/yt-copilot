import { describe, it, expect } from 'vitest';
import { request } from 'supertest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Health Check API', () => {
  it('should return 200 OK with health data', async () => {
    const response = await request(`${BASE_URL}/functions/v1`)
      .get('/core_health-check')
      .expect(200)
      .expect('Content-Type', /json/);
    
    // Verify response structure
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('environment');
    expect(response.body).toHaveProperty('services');
    
    // Verify services
    expect(response.body.services).toHaveProperty('database');
    expect(response.body.services).toHaveProperty('auth');
    expect(response.body.services).toHaveProperty('storage');
    
    // Verify status is ok
    expect(response.body.status).toBe('ok');
  });
  
  it('should include security headers', async () => {
    const response = await request(`${BASE_URL}/functions/v1`)
      .get('/core_health-check');
    
    // Verify security headers
    expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
    expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
    expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
    expect(response.headers).toHaveProperty('strict-transport-security');
  });
});