-- Counter perspectives table
CREATE TABLE counter_perspectives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES youtube_videos(id),
    user_id UUID REFERENCES auth.users(id),
    main_topics TEXT [] NOT NULL,
    original_perspective TEXT NOT NULL,
    counter_perspectives JSONB NOT NULL,
    search_keywords TEXT [] NOT NULL,
    model TEXT NOT NULL,
    tokens_used INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(video_id)
);
-- Add RLS policies
ALTER TABLE counter_perspectives ENABLE ROW LEVEL SECURITY;
-- Policy for selecting counter perspectives (users can only see their own)
CREATE POLICY select_counter_perspectives ON counter_perspectives FOR
SELECT USING (auth.uid() = user_id);
-- Policy for inserting counter perspectives
CREATE POLICY insert_counter_perspectives ON counter_perspectives FOR
INSERT WITH CHECK (auth.uid() = user_id);
-- Policy for updating counter perspectives
CREATE POLICY update_counter_perspectives ON counter_perspectives FOR
UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Policy for deleting counter perspectives
CREATE POLICY delete_counter_perspectives ON counter_perspectives FOR DELETE USING (auth.uid() = user_id);
-- Add index for faster lookups
CREATE INDEX counter_perspectives_video_id_idx ON counter_perspectives(video_id);
CREATE INDEX counter_perspectives_user_id_idx ON counter_perspectives(user_id);