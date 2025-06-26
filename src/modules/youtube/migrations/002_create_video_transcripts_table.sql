-- Create video_transcripts table for storing video transcripts/captions

-- Create video_transcripts table
CREATE TABLE IF NOT EXISTS public.video_transcripts (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to youtube_videos
  video_id UUID NOT NULL REFERENCES public.youtube_videos(id) ON DELETE CASCADE,
  
  -- Transcript information
  language_code TEXT NOT NULL, -- ISO 639-1 language code (e.g., 'en', 'vi')
  language_name TEXT NOT NULL, -- Human-readable language name
  is_auto_generated BOOLEAN NOT NULL DEFAULT false,
  is_translatable BOOLEAN NOT NULL DEFAULT true,
  
  -- Transcript segments stored as JSONB array
  -- Each segment: { start: number, duration: number, text: string }
  segments JSONB NOT NULL DEFAULT '[]',
  
  -- Metadata
  total_duration_seconds INTEGER NOT NULL CHECK (total_duration_seconds >= 0),
  segment_count INTEGER NOT NULL CHECK (segment_count >= 0),
  character_count INTEGER NOT NULL CHECK (character_count >= 0),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT video_transcripts_language_check CHECK (language_code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT video_transcripts_segments_check CHECK (jsonb_typeof(segments) = 'array'),
  CONSTRAINT video_transcripts_unique_video_language UNIQUE (video_id, language_code)
);

-- Create indexes for performance
CREATE INDEX video_transcripts_video_id_idx ON public.video_transcripts(video_id);
CREATE INDEX video_transcripts_language_idx ON public.video_transcripts(language_code);
CREATE INDEX video_transcripts_created_at_idx ON public.video_transcripts(created_at DESC);

-- Create composite indexes
CREATE INDEX video_transcripts_video_language_idx ON public.video_transcripts(video_id, language_code);

-- Create GIN index for segment text search
CREATE INDEX video_transcripts_segments_gin_idx ON public.video_transcripts USING gin(segments);

-- Enable Row Level Security
ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow read access to all authenticated users
CREATE POLICY "Authenticated users can view all transcripts"
  ON public.video_transcripts
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to manage transcripts
CREATE POLICY "Service role can manage transcripts"
  ON public.video_transcripts
  FOR ALL
  TO service_role
  USING (true);

-- Prevent direct user modifications
CREATE POLICY "Users cannot modify transcripts"
  ON public.video_transcripts
  FOR INSERT, UPDATE, DELETE
  TO authenticated
  USING (false);

-- Create trigger for updated_at
CREATE TRIGGER video_transcripts_updated_at
  BEFORE UPDATE ON public.video_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Function to search transcript segments
CREATE OR REPLACE FUNCTION public.search_transcript_segments(
  p_video_id UUID,
  p_search_term TEXT,
  p_language_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  segment_index INTEGER,
  start_time NUMERIC,
  duration NUMERIC,
  text TEXT,
  language_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH numbered_segments AS (
    SELECT 
      vt.language_code,
      jsonb_array_elements(vt.segments) AS segment,
      row_number() OVER (PARTITION BY vt.id ORDER BY (jsonb_array_elements(vt.segments)->>'start')::numeric) - 1 AS idx
    FROM public.video_transcripts vt
    WHERE vt.video_id = p_video_id
      AND (p_language_code IS NULL OR vt.language_code = p_language_code)
  )
  SELECT 
    idx::INTEGER AS segment_index,
    (segment->>'start')::NUMERIC AS start_time,
    (segment->>'duration')::NUMERIC AS duration,
    segment->>'text' AS text,
    ns.language_code
  FROM numbered_segments ns
  WHERE lower(segment->>'text') LIKE '%' || lower(p_search_term) || '%'
  ORDER BY ns.language_code, start_time;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get transcript at specific timestamp
CREATE OR REPLACE FUNCTION public.get_transcript_at_timestamp(
  p_video_id UUID,
  p_timestamp NUMERIC,
  p_language_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  segment_index INTEGER,
  start_time NUMERIC,
  duration NUMERIC,
  text TEXT,
  language_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH numbered_segments AS (
    SELECT 
      vt.language_code,
      jsonb_array_elements(vt.segments) AS segment,
      row_number() OVER (PARTITION BY vt.id ORDER BY (jsonb_array_elements(vt.segments)->>'start')::numeric) - 1 AS idx
    FROM public.video_transcripts vt
    WHERE vt.video_id = p_video_id
      AND (p_language_code IS NULL OR vt.language_code = p_language_code)
  )
  SELECT 
    idx::INTEGER AS segment_index,
    (segment->>'start')::NUMERIC AS start_time,
    (segment->>'duration')::NUMERIC AS duration,
    segment->>'text' AS text,
    ns.language_code
  FROM numbered_segments ns
  WHERE p_timestamp >= (segment->>'start')::NUMERIC 
    AND p_timestamp < ((segment->>'start')::NUMERIC + (segment->>'duration')::NUMERIC)
  ORDER BY ns.language_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments for documentation
COMMENT ON TABLE public.video_transcripts IS 'Stores transcripts/captions for YouTube videos';
COMMENT ON COLUMN public.video_transcripts.language_code IS 'ISO 639-1 language code (e.g., en, vi, es)';
COMMENT ON COLUMN public.video_transcripts.segments IS 'Array of transcript segments with start time, duration, and text';
COMMENT ON COLUMN public.video_transcripts.is_auto_generated IS 'Whether the transcript was auto-generated by YouTube';