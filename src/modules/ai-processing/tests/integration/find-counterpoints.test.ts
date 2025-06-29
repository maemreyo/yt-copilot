import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiCacheManager } from '../../utils/cache-manager';
import { openAIClient } from '../../utils/openai-client';

// Mock the OpenAI client
vi.mock('../../utils/openai-client', () => ({
  openAIClient: {
    findCounterPerspectives: vi.fn().mockResolvedValue({
      counterPerspectives: [
        {
          source: 'Academic Journal',
          title: 'Alternative Viewpoint on Topic',
          url: 'https://example.com/article',
          relevance_score: 0.95,
          credibility_score: 0.9,
          reasoning: 'This source provides a well-researched counter-argument',
        },
      ],
      searchKeywords: ['alternative viewpoint', 'opposing argument'],
      tokensUsed: 1500,
    }),
    estimateCost: vi.fn().mockReturnValue(0.0015),
  },
}));

// Mock the cache manager
vi.mock('../../utils/cache-manager', () => ({
  aiCacheManager: {
    getCachedCounterPerspectives: vi.fn().mockResolvedValue(null),
    cacheCounterPerspectives: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Find Counterpoints API', () => {
  const supabase = createClient();
  let testVideoId: string;
  let testUserId: string;

  // Setup test data
  beforeAll(async () => {
    // Create a test user
    const { data: user } = await supabase.auth.signUp({
      email: `test-${Date.now()}@example.com`,
      password: 'password123',
    });

    testUserId = user.user?.id as string;

    // Set user as premium
    await supabase.from('users').update({ subscription_tier: 'premium' }).eq('id', testUserId);

    // Create a test video
    const { data: video } = await supabase
      .from('youtube_videos')
      .insert({
        user_id: testUserId,
        video_id: 'test-video-id',
        title: 'Test Video',
        channel_name: 'Test Channel',
        duration: 300,
      })
      .select()
      .single();

    testVideoId = video.id;

    // Create video history entry
    await supabase.from('user_video_history').insert({
      user_id: testUserId,
      video_id: testVideoId,
      progress_seconds: 0,
    });

    // Create transcript
    await supabase.from('video_transcripts').insert({
      video_id: testVideoId,
      language: 'en',
      segments: [
        { start: 0, duration: 5, text: 'This is a test transcript.' },
        { start: 5, duration: 5, text: 'It contains some content for testing.' },
      ],
    });
  });

  // Clean up test data
  afterAll(async () => {
    // Delete transcript
    await supabase.from('video_transcripts').delete().eq('video_id', testVideoId);

    // Delete video history
    await supabase.from('user_video_history').delete().eq('video_id', testVideoId);

    // Delete video
    await supabase.from('youtube_videos').delete().eq('id', testVideoId);

    // Delete user
    await supabase.auth.admin.deleteUser(testUserId);
  });

  it('should return counter-perspectives for a video', async () => {
    // Get auth token
    const { data: authData } = await supabase.auth.signInWithPassword({
      email: `test-${Date.now()}@example.com`,
      password: 'password123',
    });

    const token = authData.session?.access_token;

    // Make request to find-counterpoints endpoint
    const response = await fetch(
      `${denoEnv.get('SUPABASE_URL')}/functions/v1/ai_find-counterpoints`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          video_id: testVideoId,
        }),
      }
    );

    const data = await response.json();

    // Verify response
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('counter_perspectives');
    expect(data.data).toHaveProperty('search_keywords');
    expect(data.data).toHaveProperty('tokens_used');
    expect(data.data).toHaveProperty('model');
    expect(data.data.cached).toBe(false);

    // Verify OpenAI client was called
    expect(openAIClient.findCounterPerspectives).toHaveBeenCalledWith(
      'Test Video',
      expect.any(String),
      undefined,
      undefined
    );

    // Verify cache was checked and updated
    expect(aiCacheManager.getCachedCounterPerspectives).toHaveBeenCalledWith(testVideoId);
    expect(aiCacheManager.cacheCounterPerspectives).toHaveBeenCalled();
  });

  it('should return cached counter-perspectives if available', async () => {
    // Mock cached data
    vi.mocked(aiCacheManager.getCachedCounterPerspectives).mockResolvedValueOnce({
      id: 'cached-id',
      video_id: testVideoId,
      user_id: testUserId,
      main_topics: ['test topic'],
      original_perspective: 'test perspective',
      counter_perspectives: [
        {
          source: 'Cached Source',
          title: 'Cached Title',
          url: 'https://example.com/cached',
          relevance_score: 0.8,
          credibility_score: 0.7,
          reasoning: 'Cached reasoning',
        },
      ],
      search_keywords: ['cached keyword'],
      model: 'gpt-4o-mini',
      tokens_used: 1000,
      created_at: new Date().toISOString(),
    });

    // Get auth token
    const { data: authData } = await supabase.auth.signInWithPassword({
      email: `test-${Date.now()}@example.com`,
      password: 'password123',
    });

    const token = authData.session?.access_token;

    // Make request to find-counterpoints endpoint
    const response = await fetch(
      `${denoEnv.get('SUPABASE_URL')}/functions/v1/ai_find-counterpoints`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          video_id: testVideoId,
        }),
      }
    );

    const data = await response.json();

    // Verify response
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.cached).toBe(true);
    expect(data.data.counter_perspectives[0].source).toBe('Cached Source');

    // Verify OpenAI client was not called
    expect(openAIClient.findCounterPerspectives).not.toHaveBeenCalled();
  });

  it('should require premium subscription', async () => {
    // Set user as free tier
    await supabase.from('users').update({ subscription_tier: 'free' }).eq('id', testUserId);

    // Get auth token
    const { data: authData } = await supabase.auth.signInWithPassword({
      email: `test-${Date.now()}@example.com`,
      password: 'password123',
    });

    const token = authData.session?.access_token;

    // Make request to find-counterpoints endpoint
    const response = await fetch(
      `${denoEnv.get('SUPABASE_URL')}/functions/v1/ai_find-counterpoints`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          video_id: testVideoId,
        }),
      }
    );

    const data = await response.json();

    // Verify response
    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('PREMIUM_REQUIRED');

    // Reset user to premium for other tests
    await supabase.from('users').update({ subscription_tier: 'premium' }).eq('id', testUserId);
  });
});
