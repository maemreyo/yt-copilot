// YouTube Data API v3 integration utilities

import { environment } from '@/environment';
import { Logger } from '@/logging';
import { createAppError } from '@/shared-errors';
import { cacheUtils } from '@/cache';
import {
  YouTubeAPIVideoItem,
  YouTubeAPIVideoListResponse,
  YouTubeErrorCode,
  YouTubeVideoMetadata,
} from '../types/youtube.ts';

const logger = new Logger({ service: 'youtube-api' });

/**
 * YouTube API client configuration
 */
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_VIDEO_URL_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

/**
 * YouTube API client class
 */
export class YouTubeAPIClient {
  private apiKey: string;
  private cache = cacheUtils.createMemoryStore({
    maxSize: 100,
    ttl: environment.getYouTubeConfig().cacheTtlSeconds * 1000,
  });

  constructor(apiKey?: string) {
    this.apiKey = apiKey || environment.getYouTubeConfig().apiKey;
    if (!this.apiKey) {
      throw new Error('YouTube API key is not configured');
    }
  }

  /**
   * Extract video ID from YouTube URL
   */
  static extractVideoId(url: string): string | null {
    try {
      // Clean the URL
      const cleanUrl = url.trim();

      // Try each pattern
      for (const pattern of YOUTUBE_VIDEO_URL_PATTERNS) {
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
      logger.error('Failed to extract video ID', error as Error, { url });
      return null;
    }
  }

  /**
   * Parse ISO 8601 duration to seconds
   */
  static parseDuration(duration: string): number {
    try {
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;

      const hours = parseInt(match[1] || '0', 10);
      const minutes = parseInt(match[2] || '0', 10);
      const seconds = parseInt(match[3] || '0', 10);

      return hours * 3600 + minutes * 60 + seconds;
    } catch (error: any) {
      logger.error('Failed to parse duration', error as Error, { duration });
      return 0;
    }
  }

  /**
   * Get video metadata from YouTube Data API
   */
  async getVideoMetadata(videoId: string): Promise<YouTubeVideoMetadata> {
    const startTime = Date.now();
    const cacheKey = `youtube:video:${videoId}`;

    try {
      // Check cache first
      const cached = await this.cache.get<YouTubeVideoMetadata>(cacheKey);
      if (cached) {
        logger.debug('YouTube video metadata cache hit', { videoId });
        return cached;
      }

      // Build API request
      const params = new URLSearchParams({
        part: 'snippet,contentDetails,statistics,status',
        id: videoId,
        key: this.apiKey,
      });

      const url = `${YOUTUBE_API_BASE_URL}/videos?${params}`;

      logger.info('Fetching YouTube video metadata', { videoId });

      // Make API request
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Referer': environment.getSupabaseConfig().url,
        },
      });

      if (!response.ok) {
        await this.handleAPIError(response, videoId);
      }

      const data: YouTubeAPIVideoListResponse = await response.json();

      // Check if video exists
      if (!data.items || data.items.length === 0) {
        throw createAppError(
          YouTubeErrorCode.VIDEO_NOT_FOUND,
          `Video with ID ${videoId} not found`,
          { videoId },
        );
      }

      const video = data.items[0];

      // Check video status
      if (video.status?.privacyStatus === 'private') {
        throw createAppError(
          YouTubeErrorCode.VIDEO_PRIVATE,
          'This video is private',
          { videoId },
        );
      }

      // Transform to our format
      const metadata = this.transformVideoData(video);

      // Cache the result
      await this.cache.set(cacheKey, metadata);

      const duration = Date.now() - startTime;
      logger.info('YouTube video metadata fetched successfully', {
        videoId,
        duration,
        title: metadata.title,
      });

      return metadata;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error('Failed to fetch YouTube video metadata', error as Error, {
        videoId,
        duration,
      });
      throw error;
    }
  }

  /**
   * Transform YouTube API response to our format
   */
  private transformVideoData(video: YouTubeAPIVideoItem): YouTubeVideoMetadata {
    const snippet = video.snippet!;
    const contentDetails = video.contentDetails!;
    const statistics = video.statistics;

    return {
      videoId: video.id,
      title: snippet.title,
      description: snippet.description,
      channelId: snippet.channelId,
      channelName: snippet.channelTitle,
      publishedAt: snippet.publishedAt,
      duration: contentDetails.duration,
      durationSeconds: YouTubeAPIClient.parseDuration(contentDetails.duration),
      thumbnails: snippet.thumbnails,
      statistics: statistics
        ? {
          viewCount: parseInt(statistics.viewCount, 10),
          likeCount: statistics.likeCount
            ? parseInt(statistics.likeCount, 10)
            : undefined,
          commentCount: statistics.commentCount
            ? parseInt(statistics.commentCount, 10)
            : undefined,
        }
        : undefined,
      tags: snippet.tags,
      categoryId: snippet.categoryId,
      defaultLanguage: snippet.defaultLanguage,
      defaultAudioLanguage: snippet.defaultAudioLanguage,
    };
  }

  /**
   * Handle YouTube API errors
   */
  private async handleAPIError(
    response: Response,
    videoId: string,
  ): Promise<never> {
    const errorBody = await response.text();
    let errorData: any;

    try {
      errorData = JSON.parse(errorBody);
    } catch {
      errorData = { message: errorBody };
    }

    logger.error('YouTube API error', {
      status: response.status,
      videoId,
      error: errorData,
    });

    // Handle specific error cases
    if (response.status === 403) {
      if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
        throw createAppError(
          YouTubeErrorCode.API_QUOTA_EXCEEDED,
          'YouTube API quota exceeded. Please try again later.',
          { videoId, quotaError: errorData },
        );
      }
      throw createAppError(
        YouTubeErrorCode.API_ERROR,
        'Access denied to YouTube API',
        { videoId, status: 403 },
      );
    }

    if (response.status === 404) {
      throw createAppError(
        YouTubeErrorCode.VIDEO_NOT_FOUND,
        `Video ${videoId} not found`,
        { videoId },
      );
    }

    // Generic API error
    throw createAppError(
      YouTubeErrorCode.API_ERROR,
      `YouTube API error: ${errorData.error?.message || 'Unknown error'}`,
      { videoId, status: response.status, error: errorData },
    );
  }

  /**
   * Batch get video metadata (for future use)
   */
  async getVideosMetadata(videoIds: string[]): Promise<YouTubeVideoMetadata[]> {
    if (videoIds.length === 0) return [];
    if (videoIds.length > 50) {
      throw new Error('Cannot fetch more than 50 videos at once');
    }

    const params = new URLSearchParams({
      part: 'snippet,contentDetails,statistics,status',
      id: videoIds.join(','),
      key: this.apiKey,
    });

    const url = `${YOUTUBE_API_BASE_URL}/videos?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      await this.handleAPIError(response, videoIds.join(','));
    }

    const data: YouTubeAPIVideoListResponse = await response.json();
    return data.items.map((video) => this.transformVideoData(video));
  }
}

// Export singleton instance
export const youtubeAPI = new YouTubeAPIClient();
