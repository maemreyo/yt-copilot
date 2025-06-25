/**
 * Video Notes Table
 * 
 * Stores user's timestamped notes taken while watching YouTube videos.
 * Supports rich text formatting, tagging, and full-text search.
 * 
 * @description: Create video_notes table for timestamped note-taking
 * @depends: youtube_001_create_youtube_videos_table
 * @module: youtube
 * @version: 1.0.0
 */

-- Create video_notes table
CREATE TABLE IF NOT EXISTS public.video_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User and video references
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.youtube_videos(id) ON DELETE CASCADE,
  
  -- Note content
  content TEXT NOT NULL,                     -- Main note content
  title TEXT,                               -- Optional note title
  note_type TEXT DEFAULT 'general',        -- Type of note
  
  -- Video context
  timestamp DECIMAL(10,3) NOT NULL,        -- Video timestamp where note was taken
  video_segment_text TEXT,                 -- Transcript text at this timestamp
  video_context JSONB,                     -- Additional context data
  /*
  Example video_context structure:
  {
    "playback_speed": 1.0,
    "video_duration": 600,
    "chapter_title": "Introduction to the Topic",
    "auto_generated_summary": "This section covers...",
    "related_transcript": "The exact words being said..."
  }
  */
  
  -- Rich text formatting
  formatting JSONB DEFAULT '{}',           -- Text formatting information
  /*
  Example formatting structure:
  {
    "format": "markdown",
    "highlights": [
      {"start": 10, "end": 20, "color": "yellow", "type": "important"},
      {"start": 45, "end": 60, "color": "blue", "type": "definition"}
    ],
    "styles": {
      "bold": [{"start": 5, "end": 15}],
      "italic": [{"start": 25, "end": 35}]
    },
    "links": [
      {"start": 100, "end": 120, "url": "https://example.com", "text": "reference link"}
    ]
  }
  */
  
  -- Organization and categorization
  tags TEXT[] DEFAULT '{}',                -- User-defined tags
  category TEXT,                           -- Note category
  topic TEXT,                              -- Subject topic
  importance_level INTEGER DEFAULT 3,      -- Importance rating (1-5)
  
  -- Learning context
  learning_objective TEXT,                 -- What user was trying to learn
  difficulty_level TEXT DEFAULT 'medium', -- Difficulty of the concept
  understanding_level INTEGER DEFAULT 3,   -- How well user understood (1-5)
  
  -- Note relationships
  parent_note_id UUID REFERENCES public.video_notes(id) ON DELETE SET NULL,
  reply_to_note_id UUID REFERENCES public.video_notes(id) ON DELETE SET NULL,
  related_notes UUID[] DEFAULT '{}',      -- Array of related note IDs
  
  -- Collaboration and sharing
  is_private BOOLEAN DEFAULT TRUE,        -- Whether note is private to user
  is_shared BOOLEAN DEFAULT FALSE,        -- Whether note is shared with others
  share_permissions JSONB DEFAULT '{}',   -- Sharing permissions configuration
  
  -- Note status and lifecycle
  status TEXT DEFAULT 'active',          -- Note status
  is_archived BOOLEAN DEFAULT FALSE,     -- Whether note is archived
  is_pinned BOOLEAN DEFAULT FALSE,       -- Whether note is pinned
  
  -- Review and follow-up
  needs_review BOOLEAN DEFAULT FALSE,    -- Whether note needs review
  review_date DATE,                      -- When to review this note
  follow_up_actions TEXT[],              -- Actions to follow up on
  
  -- Metadata and tracking
  word_count INTEGER,                    -- Number of words in note
  character_count INTEGER,               -- Number of characters
  
  -- Version control
  version INTEGER DEFAULT 1,            -- Note version number
  edit_history JSONB DEFAULT '[]',      -- History of edits
  /*
  Example edit_history structure:
  [
    {
      "version": 1,
      "edited_at": "2025-01-15T10:30:00Z",
      "changes": "Initial creation",
      "word_count": 50
    },
    {
      "version": 2,
      "edited_at": "2025-01-15T11:15:00Z", 
      "changes": "Added more details and examples",
      "word_count": 75
    }
  ]
  */
  
  -- System metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT video_notes_timestamp_positive CHECK (
    timestamp >= 0
  ),
  CONSTRAINT video_notes_importance_valid CHECK (
    importance_level >= 1 AND importance_level <= 5
  ),
  CONSTRAINT video_notes_understanding_valid CHECK (
    understanding_level >= 1 AND understanding_level <= 5
  ),
  CONSTRAINT video_notes_note_type_valid CHECK (
    note_type IN ('general', 'vocabulary', 'grammar', 'pronunciation', 'cultural', 'technical', 'summary', 'question', 'idea', 'quote')
  ),
  CONSTRAINT video_notes_difficulty_valid CHECK (
    difficulty_level IN ('very_easy', 'easy', 'medium', 'hard', 'very_hard')
  ),
  CONSTRAINT video_notes_status_valid CHECK (
    status IN ('active', 'draft', 'archived', 'deleted')
  ),
  CONSTRAINT video_notes_content_not_empty CHECK (
    trim(content) != ''
  ),
  CONSTRAINT video_notes_version_positive CHECK (
    version > 0
  ),
  CONSTRAINT video_notes_no_self_reference CHECK (
    parent_note_id != id AND reply_to_note_id != id
  )
);

-- Create indexes for performance
CREATE INDEX video_notes_user_id_idx ON public.video_notes(user_id);
CREATE INDEX video_notes_video_id_idx ON public.video_notes(video_id);
CREATE INDEX video_notes_timestamp_idx ON public.video_notes(video_id, timestamp);
CREATE INDEX video_notes_created_at_idx ON public.video_notes(user_id, created_at DESC);
CREATE INDEX video_notes_updated_at_idx ON public.video_notes(user_id, updated_at DESC);
CREATE INDEX video_notes_category_idx ON public.video_notes(user_id, category) WHERE category IS NOT NULL;
CREATE INDEX video_notes_importance_idx ON public.video_notes(user_id, importance_level DESC);
CREATE INDEX video_notes_pinned_idx ON public.video_notes(user_id, is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX video_notes_needs_review_idx ON public.video_notes(user_id, review_date) WHERE needs_review = TRUE;
CREATE INDEX video_notes_note_type_idx ON public.video_notes(user_id, note_type);

-- GIN indexes for array and JSONB columns
CREATE INDEX video_notes_tags_gin_idx ON public.video_notes USING gin(tags);
CREATE INDEX video_notes_formatting_gin_idx ON public.video_notes USING gin(formatting);
CREATE INDEX video_notes_video_context_gin_idx ON public.video_notes USING gin(video_context);
CREATE INDEX video_notes_related_notes_gin_idx ON public.video_notes USING gin(related_notes);

-- Full-text search index
CREATE INDEX video_notes_search_idx ON public.video_notes 
  USING gin(to_tsvector('english', 
    coalesce(title, '') || ' ' || 
    content || ' ' || 
    coalesce(video_segment_text, '') || ' ' ||
    coalesce(learning_objective, '')
  ));

-- Partial indexes for common queries
CREATE INDEX video_notes_recent_active_idx
  ON public.video_notes(user_id, created_at DESC)
  WHERE status = 'active' AND NOT is_archived;

CREATE INDEX video_notes_shared_public_idx
  ON public.video_notes(video_id, created_at DESC)
  WHERE is_shared = TRUE AND NOT is_private;

CREATE INDEX video_notes_by_video_timestamp_idx
  ON public.video_notes(video_id, timestamp ASC)
  WHERE status = 'active';

-- Enable Row Level Security
ALTER TABLE public.video_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only access their own private notes
CREATE POLICY "Users can view their own notes"
  ON public.video_notes
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can view shared public notes
CREATE POLICY "Users can view shared public notes"
  ON public.video_notes
  FOR SELECT
  USING (is_shared = TRUE AND NOT is_private);

CREATE POLICY "Users can insert their own notes"
  ON public.video_notes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes"
  ON public.video_notes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes"
  ON public.video_notes
  FOR DELETE
  USING (auth.uid() = user_id);

-- Allow service role full access
CREATE POLICY "Service role can manage all notes"
  ON public.video_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create trigger for updated_at and calculated fields
CREATE OR REPLACE FUNCTION public.handle_video_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Calculate word and character counts
  NEW.word_count = array_length(string_to_array(trim(NEW.content), ' '), 1);
  NEW.character_count = length(NEW.content);
  
  -- Update version if content changed
  IF OLD.content IS DISTINCT FROM NEW.content THEN
    NEW.version = OLD.version + 1;
    
    -- Add to edit history
    NEW.edit_history = COALESCE(OLD.edit_history, '[]'::jsonb) || 
      jsonb_build_object(
        'version', NEW.version,
        'edited_at', NOW(),
        'changes', 'Content updated',
        'word_count', NEW.word_count,
        'previous_word_count', OLD.word_count
      );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_notes_updated_at
  BEFORE UPDATE ON public.video_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_video_notes_updated_at();

-- Create trigger for initial word count calculation
CREATE OR REPLACE FUNCTION public.handle_video_notes_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate initial word and character counts
  NEW.word_count = array_length(string_to_array(trim(NEW.content), ' '), 1);
  NEW.character_count = length(NEW.content);
  
  -- Initialize edit history
  NEW.edit_history = jsonb_build_array(
    jsonb_build_object(
      'version', 1,
      'edited_at', NOW(),
      'changes', 'Initial creation',
      'word_count', NEW.word_count
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_notes_insert
  BEFORE INSERT ON public.video_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_video_notes_insert();

-- Create function to get notes for a video with timestamps
CREATE OR REPLACE FUNCTION public.get_video_notes_timeline(
  p_video_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_include_shared BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  note_id UUID,
  user_id UUID,
  timestamp DECIMAL,
  title TEXT,
  content TEXT,
  note_type TEXT,
  importance_level INTEGER,
  tags TEXT[],
  created_at TIMESTAMPTZ,
  is_own_note BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vn.id,
    vn.user_id,
    vn.timestamp,
    vn.title,
    vn.content,
    vn.note_type,
    vn.importance_level,
    vn.tags,
    vn.created_at,
    (vn.user_id = COALESCE(p_user_id, auth.uid())) as is_own_note
  FROM public.video_notes vn
  WHERE vn.video_id = p_video_id
    AND vn.status = 'active'
    AND NOT vn.is_archived
    AND (
      -- Own notes
      (p_user_id IS NOT NULL AND vn.user_id = p_user_id)
      OR
      -- Current user's notes
      (p_user_id IS NULL AND vn.user_id = auth.uid())
      OR
      -- Shared public notes if requested
      (p_include_shared AND vn.is_shared = TRUE AND NOT vn.is_private)
    )
  ORDER BY vn.timestamp ASC, vn.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to search notes
CREATE OR REPLACE FUNCTION public.search_video_notes(
  p_user_id UUID,
  search_query TEXT,
  p_video_id UUID DEFAULT NULL,
  p_note_type TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE(
  note_id UUID,
  video_id UUID,
  video_title TEXT,
  title TEXT,
  content TEXT,
  timestamp DECIMAL,
  note_type TEXT,
  importance_level INTEGER,
  created_at TIMESTAMPTZ,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vn.id,
    vn.video_id,
    yv.title,
    vn.title,
    vn.content,
    vn.timestamp,
    vn.note_type,
    vn.importance_level,
    vn.created_at,
    ts_rank(
      to_tsvector('english', 
        coalesce(vn.title, '') || ' ' || 
        vn.content || ' ' || 
        coalesce(vn.video_segment_text, '')
      ),
      plainto_tsquery('english', search_query)
    ) as rank
  FROM public.video_notes vn
  JOIN public.youtube_videos yv ON vn.video_id = yv.id
  WHERE vn.user_id = p_user_id
    AND vn.status = 'active'
    AND NOT vn.is_archived
    AND (p_video_id IS NULL OR vn.video_id = p_video_id)
    AND (p_note_type IS NULL OR vn.note_type = p_note_type)
    AND (p_category IS NULL OR vn.category = p_category)
    AND to_tsvector('english', 
        coalesce(vn.title, '') || ' ' || 
        vn.content || ' ' || 
        coalesce(vn.video_segment_text, '')
      ) @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC, vn.importance_level DESC, vn.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get note statistics
CREATE OR REPLACE FUNCTION public.get_note_statistics(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_notes', COUNT(*),
    'notes_this_week', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'),
    'notes_this_month', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),
    'average_words_per_note', ROUND(AVG(word_count)::NUMERIC, 1),
    'total_words_written', SUM(word_count),
    'notes_by_type', jsonb_object_agg(
      note_type, 
      COUNT(*) FILTER (WHERE note_type IS NOT NULL)
    ),
    'notes_by_importance', jsonb_object_agg(
      importance_level::TEXT, 
      COUNT(*)
    ),
    'pinned_notes', COUNT(*) FILTER (WHERE is_pinned = TRUE),
    'notes_needing_review', COUNT(*) FILTER (WHERE needs_review = TRUE),
    'most_active_videos', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'video_id', video_id,
          'video_title', video_title,
          'note_count', note_count
        )
      )
      FROM (
        SELECT 
          vn.video_id,
          yv.title as video_title,
          COUNT(*) as note_count
        FROM public.video_notes vn
        JOIN public.youtube_videos yv ON vn.video_id = yv.id
        WHERE vn.user_id = p_user_id
          AND vn.status = 'active'
        GROUP BY vn.video_id, yv.title
        ORDER BY note_count DESC
        LIMIT 5
      ) top_videos
    ),
    'writing_consistency', (
      SELECT COUNT(DISTINCT DATE(created_at))::DECIMAL / 30
      FROM public.video_notes
      WHERE user_id = p_user_id 
        AND created_at >= NOW() - INTERVAL '30 days'
    )
  ) INTO stats
  FROM public.video_notes
  WHERE user_id = p_user_id
    AND status = 'active'
    AND NOT is_archived;
  
  RETURN stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to export notes
CREATE OR REPLACE FUNCTION public.export_video_notes(
  p_user_id UUID,
  p_video_id UUID DEFAULT NULL,
  p_format TEXT DEFAULT 'json',
  p_include_formatting BOOLEAN DEFAULT TRUE
)
RETURNS TEXT AS $$
DECLARE
  export_data JSONB;
  markdown_output TEXT;
  note_record RECORD;
BEGIN
  -- Get notes data
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', vn.id,
      'video_title', yv.title,
      'video_url', 'https://youtube.com/watch?v=' || yv.video_id,
      'timestamp', vn.timestamp,
      'title', vn.title,
      'content', vn.content,
      'note_type', vn.note_type,
      'tags', vn.tags,
      'importance_level', vn.importance_level,
      'created_at', vn.created_at,
      'formatting', CASE WHEN p_include_formatting THEN vn.formatting ELSE NULL END
    ) ORDER BY vn.video_id, vn.timestamp
  ) INTO export_data
  FROM public.video_notes vn
  JOIN public.youtube_videos yv ON vn.video_id = yv.id
  WHERE vn.user_id = p_user_id
    AND vn.status = 'active'
    AND NOT vn.is_archived
    AND (p_video_id IS NULL OR vn.video_id = p_video_id);
  
  -- Return based on format
  CASE p_format
    WHEN 'json' THEN
      RETURN export_data::TEXT;
    
    WHEN 'markdown' THEN
      markdown_output := E'# Video Notes Export\n\nExported on: ' || NOW()::TEXT || E'\n\n';
      
      FOR note_record IN 
        SELECT 
          yv.title as video_title,
          yv.video_id,
          vn.timestamp,
          vn.title,
          vn.content,
          vn.note_type,
          vn.tags,
          vn.created_at
        FROM public.video_notes vn
        JOIN public.youtube_videos yv ON vn.video_id = yv.id
        WHERE vn.user_id = p_user_id
          AND vn.status = 'active'
          AND NOT vn.is_archived
          AND (p_video_id IS NULL OR vn.video_id = p_video_id)
        ORDER BY vn.video_id, vn.timestamp
      LOOP
        markdown_output := markdown_output || 
          E'## ' || COALESCE(note_record.title, 'Note') || E'\n\n' ||
          E'**Video:** [' || note_record.video_title || '](https://youtube.com/watch?v=' || note_record.video_id || ')' || E'\n' ||
          E'**Timestamp:** ' || note_record.timestamp || E's\n' ||
          E'**Type:** ' || note_record.note_type || E'\n' ||
          E'**Tags:** ' || array_to_string(note_record.tags, ', ') || E'\n' ||
          E'**Created:** ' || note_record.created_at || E'\n\n' ||
          note_record.content || E'\n\n---\n\n';
      END LOOP;
      
      RETURN markdown_output;
    
    ELSE
      RETURN export_data::TEXT;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for notes dashboard
CREATE OR REPLACE VIEW public.video_notes_dashboard AS
SELECT 
  vn.user_id,
  vn.id as note_id,
  vn.title,
  vn.content,
  vn.timestamp,
  vn.note_type,
  vn.importance_level,
  vn.tags,
  vn.is_pinned,
  vn.needs_review,
  vn.review_date,
  vn.word_count,
  vn.created_at,
  vn.updated_at,
  yv.video_id as youtube_video_id,
  yv.title as video_title,
  yv.channel_name,
  yv.duration as video_duration,
  CASE 
    WHEN vn.needs_review AND vn.review_date <= CURRENT_DATE THEN 'review_due'
    WHEN vn.needs_review THEN 'review_scheduled'
    WHEN vn.is_pinned THEN 'pinned'
    ELSE 'normal'
  END as note_status,
  CASE
    WHEN vn.importance_level >= 4 THEN 'high'
    WHEN vn.importance_level >= 3 THEN 'medium'
    ELSE 'low'
  END as priority_level
FROM public.video_notes vn
JOIN public.youtube_videos yv ON vn.video_id = yv.id
WHERE vn.status = 'active' AND NOT vn.is_archived;

-- Add table and column comments
COMMENT ON TABLE public.video_notes IS 'User-generated notes with timestamps linked to YouTube videos';
COMMENT ON COLUMN public.video_notes.timestamp IS 'Video timestamp in seconds where note was taken';
COMMENT ON COLUMN public.video_notes.formatting IS 'JSONB containing rich text formatting information';
COMMENT ON COLUMN public.video_notes.video_context IS 'JSONB containing video context when note was taken';
COMMENT ON COLUMN public.video_notes.edit_history IS 'JSONB array tracking note edit history';
COMMENT ON COLUMN public.video_notes.importance_level IS 'User-assigned importance rating (1-5)';

-- Grant permissions
GRANT SELECT ON public.video_notes_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_notes_timeline(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_video_notes(UUID, TEXT, UUID, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_note_statistics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_video_notes(UUID, UUID, TEXT, BOOLEAN) TO authenticated;