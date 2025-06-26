-- Create user_video_history table for tracking user's video viewing history

-- Create user_video_history table
CREATE TABLE IF NOT EXISTS public.user_video_history (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User reference
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Video reference (using youtube_videos table)
  video_id UUID NOT NULL REFERENCES public.youtube_videos(id) ON DELETE CASCADE,
  
  -- History data
  last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress_seconds INTEGER NOT NULL DEFAULT 0 CHECK (progress_seconds >= 0),
  completed BOOLEAN NOT NULL DEFAULT false,
  watch_count INTEGER NOT NULL DEFAULT 1 CHECK (watch_count > 0),
  
  -- User preferences
  is_bookmarked BOOLEAN NOT NULL DEFAULT false,
  playback_rate DECIMAL(3,2) DEFAULT 1.0 CHECK (playback_rate BETWEEN 0.25 AND 2.0),
  
  -- Metadata
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bookmarked_at TIMESTAMPTZ,
  
  -- Ensure one record per user-video combination
  CONSTRAINT user_video_history_unique UNIQUE (user_id, video_id)
);

-- Create indexes for performance
CREATE INDEX user_video_history_user_id_idx ON public.user_video_history(user_id);
CREATE INDEX user_video_history_video_id_idx ON public.user_video_history(video_id);
CREATE INDEX user_video_history_last_watched_idx ON public.user_video_history(last_watched_at DESC);
CREATE INDEX user_video_history_bookmarked_idx ON public.user_video_history(is_bookmarked) WHERE is_bookmarked = true;
CREATE INDEX user_video_history_completed_idx ON public.user_video_history(completed) WHERE completed = true;

-- Composite indexes for common queries
CREATE INDEX user_video_history_user_watched_idx ON public.user_video_history(user_id, last_watched_at DESC);
CREATE INDEX user_video_history_user_bookmarked_idx ON public.user_video_history(user_id, bookmarked_at DESC) WHERE is_bookmarked = true;
CREATE INDEX user_video_history_user_progress_idx ON public.user_video_history(user_id, completed, progress_seconds);

-- Enable Row Level Security
ALTER TABLE public.user_video_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only view their own history
CREATE POLICY "Users can view their own history"
  ON public.user_video_history
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own history records
CREATE POLICY "Users can create their own history"
  ON public.user_video_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own history
CREATE POLICY "Users can update their own history"
  ON public.user_video_history
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own history
CREATE POLICY "Users can delete their own history"
  ON public.user_video_history
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER user_video_history_updated_at
  BEFORE UPDATE ON public.user_video_history
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Create trigger to update bookmarked_at
CREATE OR REPLACE FUNCTION public.handle_bookmark_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_bookmarked = true AND OLD.is_bookmarked = false THEN
    NEW.bookmarked_at = NOW();
  ELSIF NEW.is_bookmarked = false THEN
    NEW.bookmarked_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_video_history_bookmark_timestamp
  BEFORE UPDATE ON public.user_video_history
  FOR EACH ROW
  WHEN (NEW.is_bookmarked IS DISTINCT FROM OLD.is_bookmarked)
  EXECUTE FUNCTION public.handle_bookmark_timestamp();

-- Function to update watch progress
CREATE OR REPLACE FUNCTION public.update_watch_progress(
  p_user_id UUID,
  p_video_id UUID,
  p_progress_seconds INTEGER,
  p_video_duration INTEGER DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_completed BOOLEAN := false;
BEGIN
  -- Check if video is completed (within 95% of duration)
  IF p_video_duration IS NOT NULL AND p_progress_seconds >= (p_video_duration * 0.95) THEN
    v_completed := true;
  END IF;

  -- Update or insert history record
  INSERT INTO public.user_video_history (
    user_id,
    video_id,
    progress_seconds,
    completed,
    last_watched_at
  ) VALUES (
    p_user_id,
    p_video_id,
    p_progress_seconds,
    v_completed,
    NOW()
  )
  ON CONFLICT (user_id, video_id)
  DO UPDATE SET
    progress_seconds = GREATEST(user_video_history.progress_seconds, EXCLUDED.progress_seconds),
    completed = user_video_history.completed OR EXCLUDED.completed,
    last_watched_at = EXCLUDED.last_watched_at,
    watch_count = user_video_history.watch_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's recent videos
CREATE OR REPLACE FUNCTION public.get_user_recent_videos(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  history_id UUID,
  video_id UUID,
  video_title TEXT,
  channel_name TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  progress_seconds INTEGER,
  completed BOOLEAN,
  is_bookmarked BOOLEAN,
  last_watched_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    h.id as history_id,
    v.id as video_id,
    v.title as video_title,
    v.channel_name,
    v.thumbnail_url,
    v.duration_seconds,
    h.progress_seconds,
    h.completed,
    h.is_bookmarked,
    h.last_watched_at
  FROM public.user_video_history h
  JOIN public.youtube_videos v ON h.video_id = v.id
  WHERE h.user_id = p_user_id
  ORDER BY h.last_watched_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's bookmarked videos
CREATE OR REPLACE FUNCTION public.get_user_bookmarked_videos(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  history_id UUID,
  video_id UUID,
  video_title TEXT,
  channel_name TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  progress_seconds INTEGER,
  bookmarked_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    h.id as history_id,
    v.id as video_id,
    v.title as video_title,
    v.channel_name,
    v.thumbnail_url,
    v.duration_seconds,
    h.progress_seconds,
    h.bookmarked_at
  FROM public.user_video_history h
  JOIN public.youtube_videos v ON h.video_id = v.id
  WHERE h.user_id = p_user_id AND h.is_bookmarked = true
  ORDER BY h.bookmarked_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments for documentation
COMMENT ON TABLE public.user_video_history IS 'Tracks user video watching history and progress';
COMMENT ON COLUMN public.user_video_history.progress_seconds IS 'Last watched position in seconds';
COMMENT ON COLUMN public.user_video_history.completed IS 'Whether user completed watching (>95% of duration)';
COMMENT ON COLUMN public.user_video_history.watch_count IS 'Number of times user has watched this video';
COMMENT ON COLUMN public.user_video_history.playback_rate IS 'User preferred playback speed (0.25x to 2x)';