// YouTube video analysis endpoint with metadata extraction and caching

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '_shared/cors.ts';

/**
 * Request interface for video analysis
 */
interface AnalyzeVideoRequest {
  videoUrl: string;
  options?: {
    includeStatistics?: boolean;
    includeTags?: boolean;
    cacheResult?: boolean;
  };
}

/**
 * Video metadata response interface
 */
interface VideoMetadata {
  videoId: string;
  title: string;
  description?: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  durationSeconds: number;
  thumbnailUrl?: string;
  viewCount?: number;
  likeCount?: number;
  tags?: string[];
}

/**
 * Response interface
 */
interface AnalyzeVideoResponse {
  success: boolean;
  data?: {
    video: VideoMetadata;
    cached: boolean;
    processedAt: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Security headers
 */
const securityHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

/**
 * YouTube URL validation patterns
 */
const YOUTUBE_URL_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

/**
 * Extract video ID from YouTube URL
 */
function extractVideoId(url: string): string | null {
  try {
    const cleanUrl = url.trim();
    
    for (const pattern of YOUTUBE_URL_PATTERNS) {
      const match = cleanUrl.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Check if it's already just a video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
      return cleanUrl;
    }

    return null;
  } catch (error) {
    console.error('Failed to extract video ID:', error);
    return null;
  }
}

/**
 * Parse ISO 8601 duration to seconds
 */
function parseDuration(duration: string): number {
  try {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    return hours * 3600 + minutes * 60 + seconds;
  } catch (error) {
    console.error('Failed to parse duration:', error);
    return 0;
  }
}

/**
 * Request validation
 */
function validateRequest(data: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Request body must be an object');
    return { isValid: false, errors };
  }

  if (!data.videoUrl || typeof data.videoUrl !== 'string') {
    errors.push('videoUrl is required and must be a string');
  } else if (!extractVideoId(data.videoUrl)) {
    errors.push('Invalid YouTube URL format');
  }

  if (data.options && typeof data.options !== 'object') {
    errors.push('options must be an object');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check rate limit
 */
async function checkRateLimit(identifier: string): Promise<boolean> {
  // Simple in-memory rate limiting
  // In production, use Redis or database-based rate limiting
  const limit = 20; // 20 requests per minute
  const window = 60 * 1000; // 1 minute

  // Placeholder - always allow for now
  return true;
}

/**
 * Get video from cache
 */
async function getCachedVideo(
  supabase: any,
  videoId: string
): Promise<VideoMetadata | null> {
  try {
    const { data, error } = await supabase
      .from('youtube_videos')
      .select('*')
      .eq('video_id', videoId)
      .single();

    if (error || !data) return null;

    // Check if cache is still valid (24 hours)
    const lastRefreshed = new Date(data.last_refreshed_at || data.created_at);
    const now = new Date();
    const hoursSinceRefresh = (now.getTime() - lastRefreshed.getTime()) / (1000 * 60 * 60);

    if (hoursSinceRefresh > 24) {
      return null; // Cache expired
    }

    return {
      videoId: data.video_id,
      title: data.title,
      description: data.description,
      channelId: data.channel_id,
      channelName: data.channel_name,
      publishedAt: data.published_at,
      durationSeconds: data.duration_seconds,
      thumbnailUrl: data.thumbnail_url,
      viewCount: data.view_count,
      likeCount: data.like_count,
      tags: data.metadata?.tags,
    };
  } catch (error) {
    console.error('Cache lookup failed:', error);
    return null;
  }
}

/**
 * Save video to cache
 */
async function cacheVideo(
  supabase: any,
  metadata: VideoMetadata
): Promise<void> {
  try {
    const { error } = await supabase
      .from('youtube_videos')
      .upsert({
        video_id: metadata.videoId,
        title: metadata.title,
        description: metadata.description,
        channel_id: metadata.channelId,
        channel_name: metadata.channelName,
        published_at: metadata.publishedAt,
        duration_seconds: metadata.durationSeconds,
        thumbnail_url: metadata.thumbnailUrl,
        view_count: metadata.viewCount,
        like_count: metadata.likeCount,
        metadata: {
          tags: metadata.tags,
        },
        last_refreshed_at: new Date().toISOString(),
      }, {
        onConflict: 'video_id',
      });

    if (error) {
      console.error('Failed to cache video:', error);
    }
  } catch (error) {
    console.error('Cache save failed:', error);
  }
}

/**
 * Fetch video metadata from YouTube API
 */
async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  if (!apiKey) {
    throw new Error('YouTube API key not configured');
  }

  const params = new URLSearchParams({
    part: 'snippet,contentDetails,statistics',
    id: videoId,
    key: apiKey,
  });

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params}`,
    {
      headers: {
        'Accept': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('YouTube API error:', error);
    
    if (response.status === 403) {
      throw new Error('YouTube API quota exceeded');
    }
    throw new Error(`YouTube API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.items || data.items.length === 0) {
    throw new Error('Video not found');
  }

  const video = data.items[0];
  const snippet = video.snippet;
  const contentDetails = video.contentDetails;
  const statistics = video.statistics;

  return {
    videoId: video.id,
    title: snippet.title,
    description: snippet.description,
    channelId: snippet.channelId,
    channelName: snippet.channelTitle,
    publishedAt: snippet.publishedAt,
    durationSeconds: parseDuration(contentDetails.duration),
    thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
    viewCount: statistics?.viewCount ? parseInt(statistics.viewCount, 10) : undefined,
    likeCount: statistics?.likeCount ? parseInt(statistics.likeCount, 10) : undefined,
    tags: snippet.tags,
  };
}

/**
 * Main serve function
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        ...securityHeaders,
        ...corsHeaders,
      },
    });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only POST method is allowed',
        },
      }),
      {
        status: 405,
        headers: {
          ...securityHeaders,
          ...corsHeaders,
          'Allow': 'POST, OPTIONS',
        },
      }
    );
  }

  try {
    // Parse request body
    let requestData: AnalyzeVideoRequest;
    try {
      requestData = await req.json();
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid JSON in request body',
          },
        }),
        {
          status: 400,
          headers: { ...securityHeaders, ...corsHeaders },
        }
      );
    }

    // Validate request
    const validation = validateRequest(requestData);
    if (!validation.isValid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: validation.errors,
          },
        }),
        {
          status: 400,
          headers: { ...securityHeaders, ...corsHeaders },
        }
      );
    }

    // Extract video ID
    const videoId = extractVideoId(requestData.videoUrl)!;

    // Check rate limit
    const rateLimitKey = req.headers.get('CF-Connecting-IP') || 'anonymous';
    const isAllowed = await checkRateLimit(rateLimitKey);
    if (!isAllowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please try again later.',
          },
        }),
        {
          status: 429,
          headers: {
            ...securityHeaders,
            ...corsHeaders,
            'Retry-After': '60',
          },
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check cache first
    const shouldCache = requestData.options?.cacheResult !== false;
    let cached = false;
    let metadata: VideoMetadata | null = null;

    if (shouldCache) {
      metadata = await getCachedVideo(supabase, videoId);
      if (metadata) {
        cached = true;
      }
    }

    // Fetch from YouTube if not cached
    if (!metadata) {
      metadata = await fetchVideoMetadata(videoId);
      
      // Cache the result
      if (shouldCache) {
        await cacheVideo(supabase, metadata);
      }
    }

    // Filter response based on options
    if (!requestData.options?.includeStatistics) {
      delete metadata.viewCount;
      delete metadata.likeCount;
    }
    if (!requestData.options?.includeTags) {
      delete metadata.tags;
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          video: metadata,
          cached,
          processedAt: new Date().toISOString(),
        },
      } as AnalyzeVideoResponse),
      {
        status: 200,
        headers: {
          ...securityHeaders,
          ...corsHeaders,
        },
      }
    );

  } catch (error) {
    console.error('Request failed:', error);

    // Determine error code and message
    let errorCode = 'INTERNAL_ERROR';
    let errorMessage = 'An unexpected error occurred';

    if (error instanceof Error) {
      if (error.message.includes('Video not found')) {
        errorCode = 'VIDEO_NOT_FOUND';
        errorMessage = 'The requested video was not found';
      } else if (error.message.includes('quota exceeded')) {
        errorCode = 'API_QUOTA_EXCEEDED';
        errorMessage = 'YouTube API quota exceeded. Please try again later.';
      } else if (error.message.includes('API key not configured')) {
        errorCode = 'CONFIGURATION_ERROR';
        errorMessage = 'Service configuration error';
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      } as AnalyzeVideoResponse),
      {
        status: errorCode === 'VIDEO_NOT_FOUND' ? 404 : 500,
        headers: {
          ...securityHeaders,
          ...corsHeaders,
        },
      }
    );
  }
});