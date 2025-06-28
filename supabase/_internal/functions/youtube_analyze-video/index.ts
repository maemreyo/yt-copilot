// YouTube video analysis endpoint with metadata extraction and caching

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import {
  corsHeaders,
  createCorsErrorResponse,
  createCorsResponse,
  createCorsSuccessResponse,
} from '@/cors';
import { createSecureResponse, securityHeaders } from '@/shared-security';
import { validateRequestBody, ValidationSchema } from '@/shared-validation';
import {
  AppError,
  createAppError,
  ErrorType,
  handleUnknownError,
} from '@/shared-errors';

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
  } catch (error: any) {
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
  } catch (error: any) {
    console.error('Failed to parse duration:', error);
    return 0;
  }
}

/**
 * Validate YouTube URL
 */
function validateYoutubeUrl(
  value: unknown,
): { isValid: boolean; errors: string[] } {
  if (typeof value !== 'string') {
    return { isValid: false, errors: ['Must be a string'] };
  }

  if (!extractVideoId(value)) {
    return { isValid: false, errors: ['Invalid YouTube URL format'] };
  }

  return { isValid: true, errors: [] };
}

/**
 * Request validation schema
 */
const analyzeVideoSchema: ValidationSchema<AnalyzeVideoRequest> = {
  videoUrl: {
    required: true,
    type: 'string',
    validate: validateYoutubeUrl,
    sanitize: (value) => typeof value === 'string' ? value.trim() : value,
  },
  options: {
    required: false,
    type: 'object',
  },
};

/**
 * Request validation using shared validation utility
 */
function validateRequest(data: any): { isValid: boolean; errors: string[] } {
  const result = validateRequestBody<AnalyzeVideoRequest>(
    data,
    analyzeVideoSchema,
  );
  return {
    isValid: result.isValid,
    errors: result.errors,
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
  videoId: string,
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
    const hoursSinceRefresh = (now.getTime() - lastRefreshed.getTime()) /
      (1000 * 60 * 60);

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
  } catch (error: any) {
    console.error('Cache lookup failed:', error);
    return null;
  }
}

/**
 * Save video to cache
 */
async function cacheVideo(
  supabase: any,
  metadata: VideoMetadata,
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
  } catch (error: any) {
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
    },
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
    thumbnailUrl: snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.default?.url,
    viewCount: statistics?.viewCount
      ? parseInt(statistics.viewCount, 10)
      : undefined,
    likeCount: statistics?.likeCount
      ? parseInt(statistics.likeCount, 10)
      : undefined,
    tags: snippet.tags,
  };
}

/**
 * Main serve function
 */
serve(async (req) => {
  // Generate a request ID for tracking
  const requestId = crypto.randomUUID();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return createCorsErrorResponse(
      'Only POST method is allowed',
      405,
      requestId,
      { allowedMethods: ['POST'] },
    );
  }

  try {
    // Parse request body
    let requestData: AnalyzeVideoRequest;
    try {
      requestData = await req.json();
    } catch (error: any) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'Invalid JSON in request body',
        undefined,
        requestId,
      );
    }

    // Validate request
    const validation = validateRequest(requestData);
    if (!validation.isValid) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'Invalid request parameters',
        { errors: validation.errors },
        requestId,
      );
    }

    // Extract video ID
    const videoId = extractVideoId(requestData.videoUrl)!;

    // Check rate limit
    const rateLimitKey = req.headers.get('CF-Connecting-IP') || 'anonymous';
    const isAllowed = await checkRateLimit(rateLimitKey);
    if (!isAllowed) {
      throw createAppError(
        ErrorType.RATE_LIMIT_ERROR,
        'Too many requests. Please try again later.',
        { retryAfter: 60 },
        requestId,
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw createAppError(
        ErrorType.INTERNAL_ERROR,
        'Supabase configuration missing',
        undefined,
        requestId,
      );
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
    return createCorsSuccessResponse(
      {
        success: true,
        data: {
          video: metadata,
          cached,
          processedAt: new Date().toISOString(),
        },
      },
      200,
      requestId,
    );
  } catch (error: any) {
    // Log the error
    console.error('Request failed:', error);

    // Handle known error types
    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    // Map specific error messages to appropriate error types
    if (error instanceof Error) {
      if (error.message.includes('Video not found')) {
        const appError = createAppError(
          ErrorType.NOT_FOUND_ERROR,
          'The requested video was not found',
          { videoId: extractVideoId(requestData?.videoUrl || '') },
          requestId,
        );
        return appError.toHttpResponse();
      }

      if (error.message.includes('quota exceeded')) {
        const appError = createAppError(
          ErrorType.EXTERNAL_SERVICE_ERROR,
          'YouTube API quota exceeded. Please try again later.',
          undefined,
          requestId,
        );
        return appError.toHttpResponse();
      }

      if (error.message.includes('API key not configured')) {
        const appError = createAppError(
          ErrorType.INTERNAL_ERROR,
          'Service configuration error',
          undefined,
          requestId,
        );
        return appError.toHttpResponse();
      }
    }

    // For any other unknown errors
    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});
