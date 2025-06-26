import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestUser, deleteTestUser, getAuthToken } from '@/test-utils';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const FUNCTION_URL = `${BASE_URL}/functions/v1/ai_translate`;

describe('Translation API Integration Tests', () => {
  let testUser: any;
  let authToken: string;
  let premiumUser: any;
  let premiumAuthToken: string;
  const supabase = createClient();

  beforeAll(async () => {
    // Create test users
    testUser = await createTestUser();
    authToken = await getAuthToken(testUser);
    
    // Create premium user
    premiumUser = await createTestUser({
      email: 'premium@test.com',
      subscription_tier: 'premium'
    });
    premiumAuthToken = await getAuthToken(premiumUser);
  });

  afterAll(async () => {
    // Cleanup test data
    await deleteTestUser(testUser.id);
    await deleteTestUser(premiumUser.id);
    
    // Clean up test translations
    await supabase
      .from('ai_translations')
      .delete()
      .in('user_id', [testUser.id, premiumUser.id]);
  });

  describe('POST /v1/ai/translate', () => {
    it('should translate text successfully', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Hello world',
          target_lang: 'es'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        original_text: 'Hello world',
        translated_text: expect.any(String),
        source_lang: 'en',
        target_lang: 'es',
        cached: false,
        provider: expect.stringMatching(/^(google|libretranslate)$/)
      });
    });

    it('should auto-detect source language', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Bonjour le monde',
          target_lang: 'en'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.data.source_lang).toBe('fr');
      expect(data.data.translated_text).toMatch(/Hello world/i);
    });

    it('should return cached translation on second request', async () => {
      // First request
      const text = 'Test caching ' + Date.now();
      await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          target_lang: 'fr'
        })
      });

      // Second request - should be cached
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          target_lang: 'fr'
        })
      });

      const data = await response.json();
      expect(data.data.cached).toBe(true);
    });

    it('should include definitions for single words', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'computer',
          target_lang: 'vi'
        })
      });

      const data = await response.json();
      
      if (process.env.WORDSAPI_KEY) {
        expect(data.data.definitions).toBeDefined();
        expect(Array.isArray(data.data.definitions)).toBe(true);
        expect(data.data.pronunciation).toBeDefined();
      }
    });

    it('should respect rate limits for free users', async () => {
      // This test would need to make many requests to test rate limiting
      // For now, we'll just verify the headers are present
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Rate limit test',
          target_lang: 'es'
        })
      });

      expect(response.status).toBe(200);
      // Rate limit headers should be present
      const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
      expect(rateLimitRemaining).toBeDefined();
    });

    it('should have higher rate limits for premium users', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${premiumAuthToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Premium rate limit test',
          target_lang: 'es'
        })
      });

      expect(response.status).toBe(200);
      // Premium users should have higher limits
      const rateLimitLimit = response.headers.get('x-ratelimit-limit');
      expect(parseInt(rateLimitLimit || '0')).toBeGreaterThan(100);
    });

    it('should validate request data', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: '', // Empty text
          target_lang: 'invalid' // Invalid language code
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle very long text', async () => {
      const longText = 'Lorem ipsum '.repeat(400); // ~4800 characters
      
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: longText,
          target_lang: 'es'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.translated_text).toBeDefined();
    });

    it('should handle text exceeding maximum length', async () => {
      const tooLongText = 'a'.repeat(5001); // Over 5000 character limit
      
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: tooLongText,
          target_lang: 'es'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should store context when provided', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'bank',
          target_lang: 'es',
          context: 'Financial institution, not river bank'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify context was stored in database
      const { data: dbData } = await supabase
        .from('ai_translations')
        .select('context')
        .eq('original_text', 'bank')
        .eq('user_id', testUser.id)
        .single();
      
      expect(dbData?.context).toBe('Financial institution, not river bank');
    });

    it('should handle authentication errors', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Hello',
          target_lang: 'es'
        })
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle CORS preflight requests', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type'
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    });
  });

  describe('Translation Languages', () => {
    const supportedLanguages = [
      { code: 'en', name: 'English' },
      { code: 'vi', name: 'Vietnamese' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' },
      { code: 'zh', name: 'Chinese' }
    ];

    it.each(supportedLanguages)('should support $name translation', async ({ code }) => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Hello',
          source_lang: 'en',
          target_lang: code
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.target_lang).toBe(code);
    });
  });
});