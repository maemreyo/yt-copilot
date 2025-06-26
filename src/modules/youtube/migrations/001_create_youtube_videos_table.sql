-- Create youtube_videos table for storing video metadata

-- Create youtube_videos table
CREATE TABLE IF NOT EXISTS public.youtube_videos (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- YouTube video information
  video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  
  -- Video metadata
  published_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  thumbnail_url TEXT,
  
  -- Statistics (nullable as they might not always be available)
  view_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  
  -- Additional metadata stored as JSONB
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT youtube_videos_video_id_check CHECK (video_id ~ '^[a-zA-Z0-9_-]{11}$'),
  CONSTRAINT youtube_videos_duration_check CHECK (duration_seconds >= 0),
  CONSTRAINT youtube_videos_stats_check CHECK (
    (view_count IS NULL OR view_count >= 0) AND
    (like_count IS NULL OR like_count >= 0) AND
    (comment_count IS NULL OR comment_count >= 0)
  )
);

-- Create indexes for performance
CREATE INDEX youtube_videos_video_id_idx ON public.youtube_videos(video_id);
CREATE INDEX youtube_videos_channel_id_idx ON public.youtube_videos(channel_id);
CREATE INDEX youtube_videos_published_at_idx ON public.youtube_videos(published_at DESC);
CREATE INDEX youtube_videos_created_at_idx ON public.youtube_videos(created_at DESC);
CREATE INDEX youtube_videos_last_refreshed_idx ON public.youtube_videos(last_refreshed_at);

-- Create composite indexes for common queries
CREATE INDEX youtube_videos_channel_published_idx ON public.youtube_videos(channel_id, published_at DESC);

-- Create text search indexes for title and channel name
CREATE INDEX youtube_videos_title_search_idx ON public.youtube_videos USING gin(to_tsvector('english', title));
CREATE INDEX youtube_videos_search_idx ON public.youtube_videos USING gin(to_tsvector('english', title || ' ' || coalesce(description, '') || ' ' || coalesce(channel_name, '')));

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
  SET last_refreshed_at = NOW()
  WHERE video_id = p_video_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get videos needing refresh (older than 24 hours)
CREATE OR REPLACE FUNCTION public.get_stale_youtube_videos(p_limit INTEGER DEFAULT 10)
RETURNS TABLE(video_id TEXT, last_refreshed_at TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  SELECT yv.video_id, yv.last_refreshed_at
  FROM public.youtube_videos yv
  WHERE yv.last_refreshed_at IS NULL 
     OR yv.last_refreshed_at < NOW() - INTERVAL '24 hours'
  ORDER BY yv.last_refreshed_at NULLS FIRST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments for documentation
COMMENT ON TABLE public.youtube_videos IS 'Stores metadata for YouTube videos accessed through the extension';
COMMENT ON COLUMN public.youtube_videos.video_id IS 'YouTube video ID (11 characters)';
COMMENT ON COLUMN public.youtube_videos.metadata IS 'Additional metadata like tags, category, language etc.';
COMMENT ON COLUMN public.youtube_videos.last_refreshed_at IS 'Last time the video metadata was refreshed from YouTube API';