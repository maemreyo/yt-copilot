// Integration tests for YouTube video analysis endpoint

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { TestDatabaseManager } from '@/testing/database-manager';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const testDb = new TestDatabaseManager();

describe('YouTube Video Analysis Integration', () => {
  // Test video IDs (use popular, stable videos)
  const TEST_VIDEOS = {
    rickroll: {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      id: 'dQw4w9WgXcQ',
      expectedTitle: 'Rick Astley - Never Gonna Give You Up',
    },
    shortUrl: {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      id: 'dQw4w9WgXcQ',
    },
    invalidId: {
      url: 'https://www.youtube.com/watch?v=invalid12345',
      id: 'invalid12345',
    },
  };

  beforeAll(async () => {
    await testDb.setup();
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  describe('POST /v1/youtube/video/analyze', () => {
    describe('Successful video analysis', () => {
      it('should analyze a valid YouTube video URL', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
          })
          .expect(200);

        expect(response.body).toMatchObject({
          success: true,
          data: {
            video: {
              videoId: TEST_VIDEOS.rickroll.id,
              title: expect.any(String),
              channelId: expect.any(String),
              channelName: expect.any(String),
              publishedAt: expect.any(String),
              durationSeconds: expect.any(Number),
            },
            cached: expect.any(Boolean),
            processedAt: expect.any(String),
          },
        });

        // Verify required fields
        const { video } = response.body.data;
        expect(video.videoId).toBe(TEST_VIDEOS.rickroll.id);
        expect(video.title).toContain('Rick Astley');
        expect(video.durationSeconds).toBeGreaterThan(0);
      });

      it('should handle short YouTube URLs', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.shortUrl.url,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.video.videoId).toBe(TEST_VIDEOS.shortUrl.id);
      });

      it('should handle direct video IDs', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.id,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.video.videoId).toBe(TEST_VIDEOS.rickroll.id);
      });

      it('should include statistics when requested', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
            options: {
              includeStatistics: true,
            },
          })
          .expect(200);

        const { video } = response.body.data;
        expect(video).toHaveProperty('viewCount');
        expect(video).toHaveProperty('likeCount');
        expect(video.viewCount).toBeGreaterThan(0);
      });

      it('should include tags when requested', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
            options: {
              includeTags: true,
            },
          })
          .expect(200);

        const { video } = response.body.data;
        expect(video).toHaveProperty('tags');
        expect(Array.isArray(video.tags)).toBe(true);
      });

      it('should use cache for repeated requests', async () => {
        // First request
        const response1 = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
          })
          .expect(200);

        expect(response1.body.data.cached).toBe(false);

        // Second request (should be cached)
        const response2 = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
          })
          .expect(200);

        expect(response2.body.data.cached).toBe(true);
        expect(response2.body.data.video).toEqual(response1.body.data.video);
      });

      it('should bypass cache when requested', async () => {
        // Ensure video is cached
        await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
          })
          .expect(200);

        // Request without cache
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
            options: {
              cacheResult: false,
            },
          })
          .expect(200);

        expect(response.body.data.cached).toBe(false);
      });
    });

    describe('Error handling', () => {
      it('should return 400 for missing videoUrl', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({})
          .expect(400);

        expect(response.body).toMatchObject({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: expect.any(String),
            details: expect.arrayContaining([
              'videoUrl is required and must be a string',
            ]),
          },
        });
      });

      it('should return 400 for invalid YouTube URL', async () => {
        const invalidUrls = [
          'not-a-url',
          'https://vimeo.com/123456',
          'https://youtube.com/',
          'https://www.youtube.com/channel/UCtest',
        ];

        for (const url of invalidUrls) {
          const response = await request(`${BASE_URL}/functions/v1`)
            .post('/youtube_analyze-video')
            .send({ videoUrl: url })
            .expect(400);

          expect(response.body.error.code).toBe('VALIDATION_ERROR');
          expect(response.body.error.details).toContain(
            'Invalid YouTube URL format',
          );
        }
      });

      it('should return 404 for non-existent video', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.invalidId.url,
          })
          .expect(404);

        expect(response.body).toMatchObject({
          success: false,
          error: {
            code: 'VIDEO_NOT_FOUND',
            message: expect.stringContaining('not found'),
          },
        });
      });

      it('should handle malformed JSON', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .set('Content-Type', 'application/json')
          .send('{"invalid json')
          .expect(400);

        expect(response.body.error.code).toBe('INVALID_REQUEST');
      });

      it('should return 405 for non-POST methods', async () => {
        const methods = ['GET', 'PUT', 'DELETE', 'PATCH'];

        for (const method of methods) {
          const response = await request(`${BASE_URL}/functions/v1`)
            [method.toLowerCase()]('/youtube_analyze-video')
            .expect(405);

          expect(response.headers['allow']).toBe('POST, OPTIONS');
        }
      });
    });

    describe('Security', () => {
      it('should include security headers', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
          })
          .expect(200);

        expect(response.headers).toMatchObject({
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'x-xss-protection': '1; mode=block',
          'strict-transport-security': expect.stringContaining('max-age='),
          'cache-control': 'no-cache, no-store, must-revalidate',
        });
      });

      it('should handle CORS preflight requests', async () => {
        const response = await request(`${BASE_URL}/functions/v1`)
          .options('/youtube_analyze-video')
          .set('Origin', 'http://localhost:3000')
          .set('Access-Control-Request-Method', 'POST')
          .expect(200);

        expect(response.headers).toHaveProperty('access-control-allow-origin');
        expect(response.headers).toHaveProperty('access-control-allow-methods');
      });
    });

    describe('Rate limiting', () => {
      it.skip('should rate limit excessive requests', async () => {
        // Note: This test is skipped by default as it requires
        // actual rate limiting implementation with Redis/memory store

        const requests = Array(25).fill(null).map(() =>
          request(`${BASE_URL}/functions/v1`)
            .post('/youtube_analyze-video')
            .send({ videoUrl: TEST_VIDEOS.rickroll.url })
        );

        const responses = await Promise.all(requests);
        const rateLimited = responses.filter((r) => r.status === 429);

        expect(rateLimited.length).toBeGreaterThan(0);
        expect(rateLimited[0].body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(rateLimited[0].headers['retry-after']).toBe('60');
      });
    });

    describe('Performance', () => {
      it('should respond within acceptable time', async () => {
        const startTime = Date.now();

        await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({
            videoUrl: TEST_VIDEOS.rickroll.url,
          })
          .expect(200);

        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(5000); // 5 seconds max
      });

      it('cached responses should be fast', async () => {
        // Ensure video is cached
        await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({ videoUrl: TEST_VIDEOS.rickroll.url });

        // Measure cached response time
        const startTime = Date.now();

        await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_analyze-video')
          .send({ videoUrl: TEST_VIDEOS.rickroll.url })
          .expect(200);

        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(500); // 500ms for cached response
      });
    });
  });
});
