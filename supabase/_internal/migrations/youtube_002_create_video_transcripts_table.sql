/**
 * Video Transcripts Table
 * 
 * Stores transcript segments for YouTube videos with precise timestamps.
 * Supports multiple languages and enables word-level interaction.
 * 
 * @description: Create video_transcripts table for storing timestamped transcript data
 * @depends: youtube_001_create_youtube_videos_table
 * @module: youtube
 * @version: 1.0.0
 */

-- Create video_transcripts table
CREATE TABLE IF NOT EXISTS public.video_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Video reference
  video_id UUID NOT NULL REFERENCES public.youtube_videos(id) ON DELETE CASCADE,
  
  -- Language information
  language TEXT NOT NULL DEFAULT 'en',        -- Language code (ISO 639-1)
  is_auto_generated BOOLEAN DEFAULT FALSE,    -- Whether transcript is auto-generated
  is_manual BOOLEAN DEFAULT FALSE,            -- Whether transcript is manually created
  
  -- Transcript data structure
  segments JSONB NOT NULL,                    -- Array of transcript segments
  /*
  Example segments structure:
  [
    {
      "start": 0.0,
      "duration": 3.5,
      "text": "Never gonna give you up",
      "words": [
        {"start": 0.0, "duration": 0.5, "text": "Never"},
        {"start": 0.5, "duration": 0.4, "text": "gonna"},
        {"start": 0.9, "duration": 0.3, "text": "give"},
        {"start": 1.2, "duration": 0.3, "text": "you"},
        {"start": 1.5, "duration": 0.5, "text": "up"}
      ]
    }
  ]
  */
  
  -- Processing metadata
  total_duration DECIMAL(10,3),              -- Total duration of transcript in seconds
  segment_count INTEGER,                     -- Number of transcript segments
  word_count INTEGER,                        -- Total word count
  character_count INTEGER,                   -- Total character count
  
  -- Quality metrics
  confidence_score DECIMAL(3,2),             -- Average confidence score (0.00-1.00)
  has_word_timestamps BOOLEAN DEFAULT FALSE, -- Whether individual word timestamps are available
  
  -- Processing information
  source TEXT,                               -- Source of transcript (youtube_api, manual, etc.)
  processed_at TIMESTAMPTZ DEFAULT NOW(),   -- When transcript was processed
  api_quota_used INTEGER DEFAULT 0,         -- API quota used to obtain transcript
  
  -- System metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT video_transcripts_language_valid CHECK (
    language ~ '^[a-z]{2}(-[A-Z]{2})?$'
  ),
  CONSTRAINT video_transcripts_confidence_valid CHECK (
    confidence_score IS NULL OR (confidence_score >= 0.00 AND confidence_score <= 1.00)
  ),
  CONSTRAINT video_transcripts_duration_positive CHECK (
    total_duration IS NULL OR total_duration > 0
  ),
  CONSTRAINT video_transcripts_counts_positive CHECK (
    segment_count IS NULL OR segment_count > 0
  ),
  UNIQUE(video_id, language)
);

-- Create indexes for performance
CREATE INDEX video_transcripts_video_id_idx ON public.video_transcripts(video_id);
CREATE INDEX video_transcripts_language_idx ON public.video_transcripts(language);
CREATE INDEX video_transcripts_processed_at_idx ON public.video_transcripts(processed_at DESC);
CREATE INDEX video_transcripts_confidence_idx ON public.video_transcripts(confidence_score DESC);

-- GIN index for searching within transcript segments
CREATE INDEX video_transcripts_segments_gin_idx ON public.video_transcripts USING gin(segments);

-- Full-text search index on transcript content
CREATE INDEX video_transcripts_content_search_idx ON public.video_transcripts 
  USING gin(to_tsvector('english', segments::text));

-- Enable Row Level Security
ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow read access to all authenticated users (transcripts are derived from public videos)
CREATE POLICY "Authenticated users can view all video transcripts"
  ON public.video_transcripts
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow system/service role to manage transcripts
CREATE POLICY "Service role can manage video transcripts"
  ON public.video_transcripts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Prevent direct user modifications
CREATE POLICY "Users cannot modify video transcripts"
  ON public.video_transcripts
  FOR INSERT, UPDATE, DELETE
  TO authenticated
  USING (false);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_video_transcripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_transcripts_updated_at
  BEFORE UPDATE ON public.video_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_video_transcripts_updated_at();

-- Create function to extract text from transcript segments
CREATE OR REPLACE FUNCTION public.extract_transcript_text(transcript_segments JSONB)
RETURNS TEXT AS $$
DECLARE
  segment JSONB;
  full_text TEXT := '';
BEGIN
  FOR segment IN SELECT * FROM jsonb_array_elements(transcript_segments)
  LOOP
    full_text := full_text || (segment->>'text') || ' ';
  END LOOP;
  
  RETURN trim(full_text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to search transcript content
CREATE OR REPLACE FUNCTION public.search_transcript_content(
  search_query TEXT,
  target_language TEXT DEFAULT 'en',
  limit_count INTEGER DEFAULT 20
)
RETURNS TABLE(
  video_id UUID,
  language TEXT,
  matching_segments JSONB,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vt.video_id,
    vt.language,
    vt.segments,
    ts_rank(
      to_tsvector('english', vt.segments::text),
      plainto_tsquery('english', search_query)
    ) as rank
  FROM public.video_transcripts vt
  WHERE vt.language = target_language
    AND to_tsvector('english', vt.segments::text) @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC, vt.processed_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get transcript segment at specific time
CREATE OR REPLACE FUNCTION public.get_transcript_segment_at_time(
  p_video_id UUID,
  p_language TEXT,
  p_timestamp DECIMAL
)
RETURNS JSONB AS $$
DECLARE
  segment JSONB;
  start_time DECIMAL;
  duration DECIMAL;
  end_time DECIMAL;
BEGIN
  -- Find the segment that contains the given timestamp
  SELECT jsonb_array_elements(segments) INTO segment
  FROM public.video_transcripts
  WHERE video_id = p_video_id AND language = p_language
  LIMIT 1;
  
  FOR segment IN 
    SELECT jsonb_array_elements(segments)
    FROM public.video_transcripts
    WHERE video_id = p_video_id AND language = p_language
  LOOP
    start_time := (segment->>'start')::DECIMAL;
    duration := (segment->>'duration')::DECIMAL;
    end_time := start_time + duration;
    
    IF p_timestamp >= start_time AND p_timestamp <= end_time THEN
      RETURN segment;
    END IF;
  END LOOP;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for transcript statistics
CREATE OR REPLACE VIEW public.transcript_statistics AS
SELECT 
  vt.video_id,
  yv.video_id as youtube_video_id,
  yv.title as video_title,
  count(*) as language_count,
  array_agg(vt.language) as available_languages,
  max(vt.word_count) as max_word_count,
  avg(vt.confidence_score) as avg_confidence,
  min(vt.processed_at) as first_processed_at,
  max(vt.processed_at) as last_processed_at
FROM public.video_transcripts vt
JOIN public.youtube_videos yv ON vt.video_id = yv.id
GROUP BY vt.video_id, yv.video_id, yv.title;

-- Add table and column comments
COMMENT ON TABLE public.video_transcripts IS 'Stores timestamped transcript data for YouTube videos';
COMMENT ON COLUMN public.video_transcripts.segments IS 'JSONB array of transcript segments with timestamps and word-level data';
COMMENT ON COLUMN public.video_transcripts.confidence_score IS 'Average confidence score for transcript accuracy (0.00-1.00)';
COMMENT ON COLUMN public.video_transcripts.has_word_timestamps IS 'Whether transcript includes word-level timestamp data';
COMMENT ON COLUMN public.video_transcripts.api_quota_used IS 'API quota units used to obtain this transcript';

-- Grant appropriate permissions
GRANT SELECT ON public.transcript_statistics TO authenticated;
GRANT EXECUTE ON FUNCTION public.extract_transcript_text(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_transcript_content(TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_transcript_segment_at_time(UUID, TEXT, DECIMAL) TO authenticated;