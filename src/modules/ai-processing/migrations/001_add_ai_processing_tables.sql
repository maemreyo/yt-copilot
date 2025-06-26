-- Translation cache table
CREATE TABLE ai_translations (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    original_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    context TEXT,
    provider TEXT NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(
        original_text,
        source_lang,
        target_lang,
        provider
    )
);
-- Video summaries table
CREATE TABLE video_summaries (
    id UUID PRIMARY KEY,
    video_id UUID REFERENCES youtube_videos(id),
    user_id UUID REFERENCES auth.users(id),
    summary_type TEXT NOT NULL,
    language TEXT NOT NULL,
    content JSONB NOT NULL,
    model TEXT NOT NULL,
    tokens_used INTEGER,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(video_id, summary_type, language)
);
-- Content analysis table
CREATE TABLE content_analysis (
    id UUID PRIMARY KEY,
    video_id UUID REFERENCES youtube_videos(id),
    user_id UUID REFERENCES auth.users(id),
    analysis_type TEXT NOT NULL,
    segments INTEGER [],
    analysis_data JSONB NOT NULL,
    confidence_score NUMERIC(3, 2),
    model TEXT NOT NULL,
    tokens_used INTEGER,
    created_at TIMESTAMP,
    UNIQUE(video_id, analysis_type)
);