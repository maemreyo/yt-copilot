/**
 * YouTube Videos Table
 * 
 * Stores metadata for YouTube videos that users interact with.
 * Central table for all YouTube-related functionality.
 * 
 * @description: Create youtube_videos table with video metadata and user associations
 * @module: youtube
 * @version: 1.0.0
 */

-- Create youtube_videos table
CREATE TABLE IF NOT EXISTS public.youtube_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Video identification
  video_id TEXT NOT NULL UNIQUE,               -- YouTube video ID (e.g., "dQw4w9WgXcQ")
  
  -- Video metadata (from YouTube Data API)
  title TEXT,                                  -- Video title
  description TEXT,                            -- Video description (truncated)
  channel_id TEXT,                            -- YouTube channel ID
  channel_name TEXT,                          -- Channel display name
  duration INTEGER,                           -- Duration in seconds
  published_at TIMESTAMPTZ,                   -- When video was published on YouTube
  
  -- Media URLs
  thumbnail_url TEXT,                         -- Default thumbnail URL
  thumbnail_high_url TEXT,                    -- High quality thumbnail URL
  
  -- Video statistics (cached from API)
  view_count BIGINT,                          -- View count at time of caching
  like_count INTEGER,                         -- Like count at time of caching
  comment_count INTEGER,                      -- Comment count at time of caching
  
  -- Content analysis metadata
  language TEXT DEFAULT 'en',                -- Primary language detected
  has_transcript BOOLEAN DEFAULT FALSE,       -- Whether transcript is available
  transcript_languages TEXT[],               -- Available transcript languages
  
  -- Categorization
  category_id INTEGER,                        -- YouTube category ID
  tags TEXT[],                               -- Video tags
  content_rating TEXT,                       -- Content rating (e.g., "family-friendly")
  
  -- System metadata
  api_quota_used INTEGER DEFAULT 1,          -- API quota units used to fetch this video
  last_updated_at TIMESTAMPTZ,               -- When metadata was last refreshed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT youtube_videos_video_id_valid CHECK (
    video_id ~ '^[a-zA-Z0-9_-]{11}$'
  ),
  CONSTRAINT youtube_videos_duration_positive CHECK (
    duration IS NULL OR duration > 0
  ),
  CONSTRAINT youtube_videos_view_count_positive CHECK (
    view_count IS NULL OR view_count >= 0
  )
);

-- Create indexes for performance
CREATE INDEX youtube_videos_video_id_idx ON public.youtube_videos(video_id);
CREATE INDEX youtube_videos_channel_id_idx ON public.youtube_videos(channel_id);
CREATE INDEX youtube_videos_published_at_idx ON public.youtube_videos(published_at DESC);
CREATE INDEX youtube_videos_created_at_idx ON public.youtube_videos(created_at DESC);
CREATE INDEX youtube_videos_language_idx ON public.youtube_videos(language);
CREATE INDEX youtube_videos_has_transcript_idx ON public.youtube_videos(has_transcript) WHERE has_transcript = TRUE;

-- Partial indexes for common queries
CREATE INDEX youtube_videos_recent_with_transcript_idx 
  ON public.youtube_videos(created_at DESC) 
  WHERE has_transcript = TRUE;

-- Full-text search index for video content
CREATE INDEX youtube_videos_search_idx ON public.youtube_videos 
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(channel_name, '')));

-- Enable Row Level Security
ALTER TABLE public.youtube_videos ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Note: youtube_videos table doesn't need user-specific RLS since it stores public video metadata
-- However, we implement policies for potential future features

-- Allow read access to all authenticated users (videos are public content)
CREATE POLICY "Authenticated users can view all youtube videos"
  ON public.youtube_videos
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow system/service role to insert new videos
CREATE POLICY "Service role can insert youtube videos"
  ON public.youtube_videos
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow system/service role to update video metadata
CREATE POLICY "Service role can update youtube videos"
  ON public.youtube_videos
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Prevent direct user modifications (videos are updated via API only)
CREATE POLICY "Users cannot modify youtube videos"
  ON public.youtube_videos
  FOR INSERT, UPDATE, DELETE
  TO authenticated
  USING (false);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_youtube_videos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER youtube_videos_updated_at
  BEFORE UPDATE ON public.youtube_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_youtube_videos_updated_at();

-- Create function to refresh video metadata
CREATE OR REPLACE FUNCTION public.refresh_youtube_video_metadata(p_video_id TEXT)
RETURNS void AS $$
BEGIN
  -- Mark video for metadata refresh
  UPDATE public.youtube_videos 
  SET last_updated_at = NULL 
  WHERE video_id = p_video_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to search videos
CREATE OR REPLACE FUNCTION public.search_youtube_videos(
  search_query TEXT,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE(
  id UUID,
  video_id TEXT,
  title TEXT,
  channel_name TEXT,
  published_at TIMESTAMPTZ,
  duration INTEGER,
  thumbnail_url TEXT,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    yv.id,
    yv.video_id,
    yv.title,
    yv.channel_name,
    yv.published_at,
    yv.duration,
    yv.thumbnail_url,
    ts_rank(
      to_tsvector('english', coalesce(yv.title, '') || ' ' || coalesce(yv.description, '') || ' ' || coalesce(yv.channel_name, '')),
      plainto_tsquery('english', search_query)
    ) as rank
  FROM public.youtube_videos yv
  WHERE to_tsvector('english', coalesce(yv.title, '') || ' ' || coalesce(yv.description, '') || ' ' || coalesce(yv.channel_name, ''))
        @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC, yv.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add table comment
COMMENT ON TABLE public.youtube_videos IS 'Stores YouTube video metadata for learning platform';
COMMENT ON COLUMN public.youtube_videos.video_id IS 'YouTube video ID (11 characters)';
COMMENT ON COLUMN public.youtube_videos.api_quota_used IS 'YouTube API quota units consumed to fetch this video';
COMMENT ON COLUMN public.youtube_videos.has_transcript IS 'Whether video has available transcript';
COMMENT ON COLUMN public.youtube_videos.transcript_languages IS 'Array of language codes for available transcripts';