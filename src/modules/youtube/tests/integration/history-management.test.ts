// Integration tests for YouTube video history management endpoints

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { TestDatabaseManager } from '@/testing/database-manager';
import { TestUserFactory } from '@/testing/factories';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const testDb = new TestDatabaseManager();
const userFactory = new TestUserFactory();

describe('YouTube History Management Integration', () => {
  let testUser: any;
  let testUserToken: string;
  let testVideoId: string;
  let testVideo2Id: string;

  beforeAll(async () => {
    await testDb.setup();
    
    // Create test user
    testUser = await userFactory.create({
      email: 'history-test@example.com',
      password: 'test-password-123',
    });
    testUserToken = testUser.token;

    // Create test videos in database
    const supabase = testDb.getServiceClient();
    
    const { data: video1 } = await supabase
      .from('youtube_videos')
      .insert({
        video_id: 'dQw4w9WgXcQ',
        title: 'Test Video 1',
        channel_id: 'test_channel_1',
        channel_name: 'Test Channel 1',
        published_at: new Date().toISOString(),
        duration_seconds: 300,
        thumbnail_url: 'https://example.com/thumb1.jpg',
      })
      .select('id')
      .single();
    
    testVideoId = 'dQw4w9WgXcQ';

    const { data: video2 } = await supabase
      .from('youtube_videos')
      .insert({
        video_id: 'JGwWNGJdvx8',
        title: 'Test Video 2',
        channel_id: 'test_channel_2',
        channel_name: 'Test Channel 2',
        published_at: new Date().toISOString(),
        duration_seconds: 240,
        thumbnail_url: 'https://example.com/thumb2.jpg',
      })
      .select('id')
      .single();
    
    testVideo2Id = 'JGwWNGJdvx8';
  });

  afterAll(async () => {
    await userFactory.cleanup();
    await testDb.teardown();
  });

  beforeEach(async () => {
    // Clean up history before each test
    const supabase = testDb.getServiceClient();
    await supabase
      .from('user_video_history')
      .delete()
      .eq('user_id', testUser.id);
  });

  describe('POST /v1/youtube/history', () => {
    it('should add video to history', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          videoId: testVideoId,
          progressSeconds: 150,
          playbackRate: 1.25,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          message: expect.stringContaining('added to history'),
          historyId: expect.any(String),
          videoId: testVideoId,
        },
      });
    });

    it('should update existing history entry', async () => {
      // First add
      await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          videoId: testVideoId,
          progressSeconds: 100,
        })
        .expect(201);

      // Second add (should update)
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          videoId: testVideoId,
          progressSeconds: 200,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          message: expect.stringContaining('updated'),
          videoId: testVideoId,
        },
      });

      // Verify progress was updated
      const history = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(history.body.data.history[0].progressSeconds).toBe(200);
    });

    it('should mark video as completed when progress >= 95%', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          videoId: testVideoId,
          progressSeconds: 290, // 96.7% of 300 seconds
        })
        .expect(201);

      expect(response.body.success).toBe(true);

      // Verify completed status
      const history = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(history.body.data.history[0].completed).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .send({
          videoId: testVideoId,
        })
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should validate request body', async () => {
      const invalidRequests = [
        { videoId: 'invalid' }, // Invalid format
        { videoId: testVideoId, progressSeconds: -1 }, // Negative progress
        { videoId: testVideoId, playbackRate: 3.0 }, // Too high
        {}, // Missing videoId
      ];

      for (const invalidData of invalidRequests) {
        const response = await request(`${BASE_URL}/functions/v1`)
          .post('/youtube_history-add')
          .set('Authorization', `Bearer ${testUserToken}`)
          .send(invalidData)
          .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should return 404 for non-existent video', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          videoId: 'nonexistent1',
        })
        .expect(404);

      expect(response.body.error.code).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /v1/youtube/history', () => {
    beforeEach(async () => {
      // Add some test history
      await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ videoId: testVideoId, progressSeconds: 150 });

      await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ videoId: testVideo2Id, progressSeconds: 200 });
    });

    it('should list user history with default parameters', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          history: expect.any(Array),
          total: 2,
          hasMore: false,
        },
      });

      expect(response.body.data.history).toHaveLength(2);
      expect(response.body.data.history[0]).toMatchObject({
        historyId: expect.any(String),
        videoId: expect.any(String),
        videoTitle: expect.any(String),
        channelName: expect.any(String),
        progressSeconds: expect.any(Number),
        completed: expect.any(Boolean),
        isBookmarked: expect.any(Boolean),
        lastWatchedAt: expect.any(String),
        watchCount: expect.any(Number),
        playbackRate: expect.any(Number),
      });
    });

    it('should support pagination', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list?limit=1&offset=0')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(response.body.data.history).toHaveLength(1);
      expect(response.body.data.total).toBe(2);
      expect(response.body.data.hasMore).toBe(true);
    });

    it('should filter bookmarked videos', async () => {
      // Bookmark one video
      await request(`${BASE_URL}/functions/v1`)
        .put(`/youtube_history-update/${testVideoId}`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ isBookmarked: true })
        .expect(200);

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list?filter=bookmarked')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(response.body.data.history).toHaveLength(1);
      expect(response.body.data.history[0].videoId).toBe(testVideoId);
      expect(response.body.data.history[0].isBookmarked).toBe(true);
    });

    it('should filter completed videos', async () => {
      // Mark one video as completed
      await request(`${BASE_URL}/functions/v1`)
        .put(`/youtube_history-update/${testVideoId}`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ completed: true })
        .expect(200);

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list?filter=completed')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(response.body.data.history).toHaveLength(1);
      expect(response.body.data.history[0].completed).toBe(true);
    });

    it('should sort by different criteria', async () => {
      // Test alphabetical sort
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list?sortBy=alphabetical')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      const titles = response.body.data.history.map((h: any) => h.videoTitle);
      expect(titles).toEqual([...titles].sort());
    });

    it('should require authentication', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('PUT /v1/youtube/history/{videoId}', () => {
    beforeEach(async () => {
      // Add video to history
      await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ videoId: testVideoId, progressSeconds: 100 });
    });

    it('should update progress', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .put(`/youtube_history-update/${testVideoId}`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          progressSeconds: 200,
          playbackRate: 1.5,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          message: expect.stringContaining('updated'),
          videoId: testVideoId,
        },
      });

      // Verify update
      const history = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(history.body.data.history[0].progressSeconds).toBe(200);
      expect(history.body.data.history[0].playbackRate).toBe(1.5);
    });

    it('should update bookmark status', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .put(`/youtube_history-update/${testVideoId}`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          isBookmarked: true,
          notes: 'Great video!',
          tags: ['educational', 'favorite'],
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify update
      const history = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      const entry = history.body.data.history[0];
      expect(entry.isBookmarked).toBe(true);
      expect(entry.notes).toBe('Great video!');
      expect(entry.tags).toEqual(['educational', 'favorite']);
    });

    it('should auto-calculate completion status', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .put(`/youtube_history-update/${testVideoId}`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          progressSeconds: 290, // 96.7% of 300 seconds
        })
        .expect(200);

      // Verify completion
      const history = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(history.body.data.history[0].completed).toBe(true);
    });

    it('should return 404 for non-existent history', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .put(`/youtube_history-update/nonexistent1`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ progressSeconds: 100 })
        .expect(404);

      expect(response.body.error.code).toBe('VIDEO_NOT_FOUND');
    });

    it('should validate update data', async () => {
      const invalidUpdates = [
        { progressSeconds: -1 },
        { playbackRate: 0.1 },
        { playbackRate: 3.0 },
        { notes: 'a'.repeat(5001) }, // Too long
        { tags: Array(21).fill('tag') }, // Too many
        {}, // No fields
      ];

      for (const invalidData of invalidUpdates) {
        const response = await request(`${BASE_URL}/functions/v1`)
          .put(`/youtube_history-update/${testVideoId}`)
          .set('Authorization', `Bearer ${testUserToken}`)
          .send(invalidData)
          .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('DELETE /v1/youtube/history/{videoId}', () => {
    beforeEach(async () => {
      // Add video to history
      await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ videoId: testVideoId });
    });

    it('should delete video from history', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .delete(`/youtube_history-delete/${testVideoId}`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          message: expect.stringContaining('removed'),
          videoId: testVideoId,
        },
      });

      // Verify deletion
      const history = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(history.body.data.history).toHaveLength(0);
    });

    it('should return 404 for non-existent history', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .delete(`/youtube_history-delete/${testVideo2Id}`)
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('HISTORY_NOT_FOUND');
    });

    it('should require authentication', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .delete(`/youtube_history-delete/${testVideoId}`)
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('Security', () => {
    it('should not allow users to access other users history', async () => {
      // Create another user
      const otherUser = await userFactory.create({
        email: 'other@example.com',
        password: 'password123',
      });

      // Add video to first user's history
      await request(`${BASE_URL}/functions/v1`)
        .post('/youtube_history-add')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ videoId: testVideoId });

      // Try to access from other user
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/youtube_history-list')
        .set('Authorization', `Bearer ${otherUser.token}`)
        .expect(200);

      expect(response.body.data.history).toHaveLength(0);

      // Cleanup
      await userFactory.cleanup(otherUser.id);
    });
  });
});