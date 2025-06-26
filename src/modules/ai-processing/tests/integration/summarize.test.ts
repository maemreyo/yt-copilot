import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestUser, deleteTestUser, getAuthToken } from '@/test-utils';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const FUNCTION_URL = `${BASE_URL}/functions/v1/ai_summarize`;

// Mock OpenAI responses
const mockSummaryResponse = {
  summary: "This video explains the basics of TypeScript and its benefits for JavaScript developers.",
  key_points: [
    "TypeScript adds static typing to JavaScript",
    "Helps catch errors at compile time",
    "Improves IDE support and code completion"
  ],
  topics: ["TypeScript", "JavaScript", "Static Typing", "Development Tools"],
  duration_estimate: 3,
  generated_at: new Date().toISOString()
};

describe('Summarization API Integration Tests', () => {
  let testUser: any;
  let authToken: string;
  let premiumUser: any;
  let premiumAuthToken: string;
  let testVideoId: string;
  let testTranscriptId: string;
  const supabase = createClient();

  beforeAll(async () => {
    // Create test users
    testUser = await createTestUser();
    authToken = await getAuthToken(testUser);
    
    premiumUser = await createTestUser({
      email: 'premium-summary@test.com',
      subscription_tier: 'premium'
    });
    premiumAuthToken = await getAuthToken(premiumUser);

    // Create test video
    const { data: video } = await supabase
      .from('youtube_videos')
      .insert({
        user_id: testUser.id,
        video_id: 'test123',
        title: 'Introduction to TypeScript',
        channel_name: 'Tech Channel',
        duration: 600,
        thumbnail_url: 'https://example.com/thumb.jpg'
      })
      .select()
      .single();
    
    testVideoId = video.id;

    // Create test transcript
    const { data: transcript } = await supabase
      .from('video_transcripts')
      .insert({
        video_id: testVideoId,
        language: 'en',
        segments: [
          { start: 0, duration: 5, text: "Welcome to this TypeScript tutorial." },
          { start: 5, duration: 4, text: "TypeScript is a superset of JavaScript." },
          { start: 9, duration: 3, text: "It adds static typing to the language." }
        ]
      })
      .select()
      .single();
    
    testTranscriptId = transcript.id;

    // Add video to user history for both users
    await supabase
      .from('user_video_history')
      .insert([
        { user_id: testUser.id, video_id: testVideoId },
        { user_id: premiumUser.id, video_id: testVideoId }
      ]);

    // Mock OpenAI client
    vi.mock('../utils/openai-client', () => ({
      openAIClient: {
        summarizeVideo: vi.fn().mockResolvedValue({
          summary: mockSummaryResponse,
          tokensUsed: 500
        }),
        estimateCost: vi.fn().mockReturnValue(0.0001)
      }
    }));
  });

  afterAll(async () => {
    // Cleanup test data
    await supabase.from('user_video_history').delete().eq('video_id', testVideoId);
    await supabase.from('video_transcripts').delete().eq('id', testTranscriptId);
    await supabase.from('youtube_videos').delete().eq('id', testVideoId);
    await supabase.from('video_summaries').delete().eq('video_id', testVideoId);
    
    await deleteTestUser(testUser.id);
    await deleteTestUser(premiumUser.id);
  });

  describe('POST /v1/ai/summarize', () => {
    it('should generate a brief summary successfully', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: testVideoId,
          summary_type: 'brief'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        video_id: testVideoId,
        summary_type: 'brief',
        language: 'en',
        content: expect.objectContaining({
          summary: expect.any(String),
          key_points: expect.any(Array),
          topics: expect.any(Array),
          duration_estimate: expect.any(Number)
        }),
        tokens_used: expect.any(Number),
        cached: false,
        model: expect.any(String)
      });
    });

    it('should generate a detailed summary', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: testVideoId,
          summary_type: 'detailed'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.summary_type).toBe('detailed');
    });

    it('should generate bullet points summary', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: testVideoId,
          summary_type: 'bullet_points'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.summary_type).toBe('bullet_points');
      expect(data.data.content.key_points).toBeInstanceOf(Array);
    });

    it('should return cached summary on second request', async () => {
      // First request (will be mocked but stored in cache)
      await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: testVideoId,
          summary_type: 'brief',
          language: 'en'
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
          video_id: testVideoId,
          summary_type: 'brief',
          language: 'en'
        })
      });

      const data = await response.json();
      expect(data.data.cached).toBe(true);
    });

    it('should support multiple languages', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: testVideoId,
          summary_type: 'brief',
          language: 'vi'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.language).toBe('vi');
    });

    it('should respect rate limits for free users', async () => {
      // Make multiple requests to test rate limiting
      const requests = [];
      for (let i = 0; i < 6; i++) {
        requests.push(
          fetch(FUNCTION_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              video_id: testVideoId,
              summary_type: 'brief',
              language: `test${i}` // Different language to avoid cache
            })
          })
        );
      }

      const responses = await Promise.all(requests);
      const lastResponse = responses[responses.length - 1];
      
      // Should hit rate limit
      expect(lastResponse.status).toBe(429);
      const data = await lastResponse.json();
      expect(data.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should have higher rate limits for premium users', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${premiumAuthToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: testVideoId,
          summary_type: 'detailed'
        })
      });

      expect(response.status).toBe(200);
    });

    it('should validate video exists', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: '00000000-0000-0000-0000-000000000000',
          summary_type: 'brief'
        })
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error.code).toBe('VIDEO_NOT_FOUND');
    });

    it('should require user to have analyzed the video', async () => {
      // Create a video without user history
      const { data: newVideo } = await supabase
        .from('youtube_videos')
        .insert({
          user_id: premiumUser.id,
          video_id: 'test456',
          title: 'Another Video',
          channel_name: 'Channel',
          duration: 300
        })
        .select()
        .single();

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: newVideo.id,
          summary_type: 'brief'
        })
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error.code).toBe('UNAUTHORIZED');

      // Cleanup
      await supabase.from('youtube_videos').delete().eq('id', newVideo.id);
    });

    it('should handle videos without transcripts', async () => {
      // Create video without transcript
      const { data: videoNoTranscript } = await supabase
        .from('youtube_videos')
        .insert({
          user_id: testUser.id,
          video_id: 'test789',
          title: 'No Transcript Video',
          channel_name: 'Channel',
          duration: 300
        })
        .select()
        .single();

      await supabase
        .from('user_video_history')
        .insert({ user_id: testUser.id, video_id: videoNoTranscript.id });

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: videoNoTranscript.id,
          summary_type: 'brief'
        })
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error.code).toBe('TRANSCRIPT_NOT_FOUND');

      // Cleanup
      await supabase.from('user_video_history').delete().eq('video_id', videoNoTranscript.id);
      await supabase.from('youtube_videos').delete().eq('id', videoNoTranscript.id);
    });

    it('should validate request data', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: 'not-a-uuid',
          summary_type: 'invalid-type'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle authentication errors', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_id: testVideoId,
          summary_type: 'brief'
        })
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.code).toBe('UNAUTHORIZED');
    });
  });
});