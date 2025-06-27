# Module 9: Learning Analytics - Implementation Plan

## 📋 Module Overview

Module 9 provides learning analytics features including vocabulary management, session tracking, note-taking, and progress analytics for the YouTube Learning Co-pilot extension.

## 📁 Module Structure

```
src/modules/learning-analytics/
├── functions/                    # Edge Functions (Deno)
│   ├── vocabulary-add/          # POST /v1/learning/vocabulary
│   │   └── index.ts
│   ├── vocabulary-list/         # GET /v1/learning/vocabulary
│   │   └── index.ts
│   ├── vocabulary-update/       # PUT /v1/learning/vocabulary/{id}
│   │   └── index.ts
│   ├── vocabulary-delete/       # DELETE /v1/learning/vocabulary/{id}
│   │   └── index.ts
│   ├── sessions-track/          # POST /v1/learning/sessions
│   │   └── index.ts
│   ├── sessions-list/           # GET /v1/learning/sessions
│   │   └── index.ts
│   ├── notes-create/            # POST /v1/learning/notes
│   │   └── index.ts
│   ├── notes-list/              # GET /v1/learning/notes
│   │   └── index.ts
│   ├── notes-update/            # PUT /v1/learning/notes/{id}
│   │   └── index.ts
│   ├── notes-delete/            # DELETE /v1/learning/notes/{id}
│   │   └── index.ts
│   ├── analytics-overview/      # GET /v1/learning/analytics/overview
│   │   └── index.ts
│   └── analytics-dashboard/     # GET /v1/learning/analytics/dashboard
│       └── index.ts
├── _shared/                     # Shared utilities
│   ├── types.ts                # Type definitions
│   ├── spaced-repetition.ts   # Spaced repetition algorithm
│   ├── analytics.ts            # Analytics calculations
│   └── validators.ts           # Input validation
├── migrations/
│   └── 001_create_learning_tables.sql
├── tests/
│   └── integration/
│       ├── vocabulary.test.ts
│       ├── sessions.test.ts
│       ├── notes.test.ts
│       └── analytics.test.ts
└── openapi.yaml                # API documentation
```

## 🗂️ Database Schema

```sql
-- vocabulary_entries table
CREATE TABLE vocabulary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  definition TEXT NOT NULL,
  context TEXT,
  video_id UUID REFERENCES youtube_videos(id) ON DELETE SET NULL,
  timestamp DECIMAL,
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  part_of_speech TEXT,
  learned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  next_review_at TIMESTAMP WITH TIME ZONE,
  review_count INTEGER DEFAULT 0,
  success_rate DECIMAL DEFAULT 0 CHECK (success_rate >= 0 AND success_rate <= 1),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_vocabulary_user_id (user_id),
  INDEX idx_vocabulary_next_review (user_id, next_review_at),
  UNIQUE(user_id, word, context)
);

-- learning_sessions table
CREATE TABLE learning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID REFERENCES youtube_videos(id) ON DELETE SET NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  words_learned INTEGER DEFAULT 0,
  notes_taken INTEGER DEFAULT 0,
  translations_requested INTEGER DEFAULT 0,
  session_type TEXT CHECK (session_type IN ('video_learning', 'vocabulary_review', 'note_review')),
  session_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_sessions_user_id (user_id),
  INDEX idx_sessions_started_at (user_id, started_at DESC)
);

-- video_notes table
CREATE TABLE video_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID REFERENCES youtube_videos(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp DECIMAL NOT NULL,
  tags TEXT[],
  is_private BOOLEAN DEFAULT TRUE,
  formatting JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_notes_user_id (user_id),
  INDEX idx_notes_video_id (video_id, timestamp),
  INDEX idx_notes_tags USING GIN (tags)
);

-- Enable RLS
ALTER TABLE vocabulary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vocabulary_entries
CREATE POLICY "Users can view their own vocabulary"
  ON vocabulary_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own vocabulary"
  ON vocabulary_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vocabulary"
  ON vocabulary_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vocabulary"
  ON vocabulary_entries FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for learning_sessions
CREATE POLICY "Users can view their own sessions"
  ON learning_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions"
  ON learning_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
  ON learning_sessions FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for video_notes
CREATE POLICY "Users can view their own notes"
  ON video_notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own notes"
  ON video_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes"
  ON video_notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes"
  ON video_notes FOR DELETE
  USING (auth.uid() = user_id);
```

## 🎯 Implementation Tasks

### Day 1-2: Vocabulary Management (US 9.1)
- [ ] Create vocabulary CRUD endpoints
- [ ] Implement spaced repetition algorithm
- [ ] Add vocabulary categorization
- [ ] Create export functionality
- [ ] Add progress tracking

### Day 3: Session Tracking (US 9.2)
- [ ] Create session tracking endpoints
- [ ] Implement session analytics
- [ ] Add learning pattern detection
- [ ] Create recommendation engine

### Day 4: Note-Taking System (US 9.3)
- [ ] Create note CRUD endpoints
- [ ] Add timestamp synchronization
- [ ] Implement tag system
- [ ] Add search functionality

### Day 5: Analytics Dashboard (US 9.4)
- [ ] Create analytics endpoints
- [ ] Implement progress calculations
- [ ] Add trend analysis
- [ ] Create visualization-ready data

## 🔧 Key Features

### 1. Spaced Repetition Algorithm
- SM-2 algorithm implementation
- Automatic review scheduling
- Difficulty adjustment based on performance
- Customizable intervals

### 2. Session Analytics
- Real-time tracking
- Activity metrics
- Learning velocity calculation
- Pattern recognition

### 3. Smart Note-Taking
- Timestamp synchronization with videos
- Rich text support (Markdown)
- Tag-based organization
- Full-text search

### 4. Comprehensive Analytics
- Vocabulary growth tracking
- Learning streak calculation
- Progress visualization data
- Personalized recommendations

## 📊 API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/learning/vocabulary` | Add new vocabulary |
| GET | `/v1/learning/vocabulary` | List vocabulary with filters |
| PUT | `/v1/learning/vocabulary/{id}` | Update vocabulary status |
| DELETE | `/v1/learning/vocabulary/{id}` | Remove vocabulary |
| POST | `/v1/learning/sessions` | Start/end session |
| GET | `/v1/learning/sessions` | Get session history |
| POST | `/v1/learning/notes` | Create note |
| GET | `/v1/learning/notes` | List notes |
| PUT | `/v1/learning/notes/{id}` | Update note |
| DELETE | `/v1/learning/notes/{id}` | Delete note |
| GET | `/v1/learning/analytics/overview` | Get overview stats |
| GET | `/v1/learning/analytics/dashboard` | Get full dashboard data |

## 🚀 Next Steps

1. Create migration file and run database setup
2. Implement shared utilities (_shared directory)
3. Create Edge Functions for each endpoint
4. Write integration tests
5. Update OpenAPI documentation