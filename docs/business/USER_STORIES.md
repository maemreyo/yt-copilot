# Backend Modules - Detailed User Stories Analysis

## 🎯 THINK: Frontend User Stories → Backend Requirements

### From Original Document - Frontend User Stories:

#### **English Learning Module:**
- **US 1.1**: Tra từ nhanh (hover để thấy nghĩa)
- **US 1.2**: Lưu từ vựng (click để lưu vào sổ từ vựng)  
- **US 1.3**: Hiểu cụm từ và thành ngữ

#### **Knowledge Acquisition Module:**
- **US 2.1**: Ghi chú theo dấu thời gian
- **US 2.2**: AI tóm tắt video
- **US 2.3**: Trích xuất transcript và ghi chú

#### **Critical Thinking Module:**
- **US 3.1**: Đánh giá nhanh nguồn tin
- **US 3.2**: Làm nổi bật lập luận (Fact vs Opinion)
- **US 3.3**: Gợi ý góc nhìn đối lập
- **US 3.4**: Chắt lọc bình luận chất lượng

---

## 📋 PLAN: Backend User Stories by Module

## 🎬 MODULE 7: YouTube Integration

### User Stories for YouTube Data Management

#### US 7.1: Video Metadata Extraction
**As a** system administrator  
**I want to** extract and store YouTube video metadata  
**So that** the extension can provide context-aware features  

**Acceptance Criteria:**
- Extract video ID, title, channel name, duration, description
- Store video data in database with user association
- Handle rate limiting from YouTube Data API (10k units/day)
- Cache video metadata to reduce API calls
- Validate video accessibility and age restrictions

**API Endpoint:** `POST /v1/youtube/video/analyze`
```typescript
// Request
{
  "videoId": "dQw4w9WgXcQ",
  "userId": "user_123"
}

// Response  
{
  "success": true,
  "data": {
    "videoId": "dQw4w9WgXcQ",
    "title": "Never Gonna Give You Up",
    "channelName": "Rick Astley",
    "duration": 212,
    "description": "...",
    "thumbnailUrl": "...",
    "publishedAt": "2009-10-25T06:57:33Z"
  }
}
```

#### US 7.2: Transcript Extraction and Processing
**As a** content processing system  
**I want to** extract and process video transcripts  
**So that** users can interact with subtitle content  

**Acceptance Criteria:**
- Extract transcript using YouTube Transcript API
- Handle multiple languages (prioritize English/Vietnamese)
- Store transcript with timestamps
- Handle videos without transcripts gracefully
- Parse transcript into sentences for word-level interaction

**API Endpoint:** `POST /v1/youtube/transcript/extract`
```typescript
// Request
{
  "videoId": "dQw4w9WgXcQ",
  "language": "en",
  "userId": "user_123"
}

// Response
{
  "success": true,
  "data": {
    "transcript": [
      {
        "start": 0.0,
        "duration": 3.5,
        "text": "Never gonna give you up"
      },
      {
        "start": 3.5, 
        "duration": 3.2,
        "text": "Never gonna let you down"
      }
    ],
    "language": "en",
    "totalDuration": 212
  }
}
```

#### US 7.3: User Video History Management
**As a** registered user  
**I want to** track my viewed videos and learning progress  
**So that** I can continue learning from where I left off  

**Acceptance Criteria:**
- Store user's video viewing history with privacy controls
- Track progress through video (last watched timestamp)
- Allow users to bookmark videos for later
- Enable users to delete their viewing history
- Implement RLS for data privacy

**API Endpoints:**
- `GET /v1/youtube/history` - Get user's video history
- `POST /v1/youtube/history` - Add video to history
- `PUT /v1/youtube/history/{videoId}` - Update progress
- `DELETE /v1/youtube/history/{videoId}` - Remove from history

---

## 🤖 MODULE 8: AI Processing

### User Stories for AI-Powered Features

#### US 8.1: Word and Phrase Translation
**As a** language learner  
**I want to** get instant translations of words and phrases  
**So that** I can understand content while watching videos  

**Acceptance Criteria:**
- Translate single words and phrases English→Vietnamese
- Cache translations to reduce API costs
- Handle context-aware translations
- Support pronunciation data
- Rate limit to prevent abuse (100 translations/hour for free users)

**API Endpoint:** `POST /v1/ai/translate`
```typescript
// Request
{
  "text": "give up",
  "context": "Never gonna give you up",
  "sourceLang": "en",
  "targetLang": "vi",
  "userId": "user_123"
}

// Response
{
  "success": true,
  "data": {
    "originalText": "give up",
    "translatedText": "từ bỏ",
    "pronunciation": "/ɡɪv ʌp/",
    "partOfSpeech": "phrasal verb",
    "contextualMeaning": "không bao giờ từ bỏ",
    "examples": [
      {
        "english": "Don't give up on your dreams",
        "vietnamese": "Đừng từ bỏ ước mơ của bạn"
      }
    ]
  }
}
```

#### US 8.2: Video Content Summarization
**As a** busy learner  
**I want to** get AI-generated summaries of video content  
**So that** I can quickly understand key points before watching  

**Acceptance Criteria:**
- Generate concise summaries using GPT-4o Mini
- Summarize in both English and Vietnamese
- Include key timestamps for important points
- Handle different video lengths appropriately
- Cache summaries to reduce costs

**API Endpoint:** `POST /v1/ai/summarize`
```typescript
// Request
{
  "videoId": "dQw4w9WgXcQ",
  "transcript": "full transcript text...",
  "summaryType": "brief", // brief, detailed, bullet-points
  "language": "vi",
  "userId": "user_123"
}

// Response
{
  "success": true,
  "data": {
    "summary": {
      "brief": "Video này là bài hát nổi tiếng của Rick Astley về tình yêu và lời hứa không bao giờ từ bỏ người mình yêu.",
      "keyPoints": [
        {
          "timestamp": "0:00",
          "point": "Lời hứa không bao giờ từ bỏ"
        },
        {
          "timestamp": "1:30", 
          "point": "Cam kết sẽ luôn ở bên"
        }
      ]
    },
    "processingTime": 2.3,
    "tokensUsed": 450
  }
}
```

#### US 8.3: Content Analysis for Critical Thinking
**As a** critical thinker  
**I want to** analyze video content for facts vs opinions  
**So that** I can develop better media literacy skills  

**Acceptance Criteria:**
- Analyze transcript to identify factual statements vs opinions
- Detect emotional language and bias indicators
- Provide confidence scores for analysis
- Support both English and Vietnamese content
- Handle edge cases and ambiguous statements

**API Endpoint:** `POST /v1/ai/analyze-content`
```typescript
// Request
{
  "transcript": "I think this is the best song ever made. Studies show that...",
  "analysisType": "fact-opinion", // fact-opinion, sentiment, bias
  "userId": "user_123"
}

// Response
{
  "success": true,  
  "data": {
    "analysis": {
      "segments": [
        {
          "text": "I think this is the best song ever made",
          "type": "opinion",
          "confidence": 0.95,
          "indicators": ["I think", "best", "ever"]
        },
        {
          "text": "Studies show that...",
          "type": "fact_claim",
          "confidence": 0.87,
          "indicators": ["Studies show"]
        }
      ],
      "overallTone": "positive",
      "biasScore": 0.3,
      "factualityScore": 0.6
    }
  }
}
```

#### US 8.4: Counter-Perspective Discovery
**As a** user seeking balanced information  
**I want to** find content with opposing viewpoints  
**So that** I can make informed decisions  

**Acceptance Criteria:**
- Identify main topics/themes from video content
- Search for credible sources with different perspectives
- Rank suggestions by credibility and relevance
- Provide reasoning for why content offers counter-perspective
- Filter out low-quality or extremist sources

**API Endpoint:** `POST /v1/ai/find-counterpoints`
```typescript
// Request
{
  "videoId": "dQw4w9WgXcQ",
  "mainTopics": ["relationships", "commitment", "love"],
  "originalPerspective": "romantic commitment is always positive",
  "userId": "user_123"
}

// Response
{
  "success": true,
  "data": {
    "counterPerspectives": [
      {
        "source": "Psychology Today",
        "title": "When Commitment Becomes Unhealthy",
        "url": "https://...",
        "relevanceScore": 0.85,
        "credibilityScore": 0.92,
        "reasoning": "Discusses potential negative aspects of excessive commitment in relationships"
      }
    ],
    "searchKeywords": ["relationship boundaries", "healthy commitment", "independence in relationships"]
  }
}
```

---

## 📊 MODULE 9: Learning Analytics

### User Stories for Learning Progress Management

#### US 9.1: Vocabulary Management System
**As a** language learner  
**I want to** save and manage my learned vocabulary  
**So that** I can review and reinforce my learning  

**Acceptance Criteria:**
- Save words/phrases with context and video source
- Categorize vocabulary by difficulty, topic, or video
- Implement spaced repetition algorithm for review
- Track learning progress and retention rates
- Export vocabulary lists in multiple formats

**API Endpoints:**
- `POST /v1/learning/vocabulary` - Save new vocabulary
- `GET /v1/learning/vocabulary` - Get user's vocabulary
- `PUT /v1/learning/vocabulary/{id}` - Update learning status
- `DELETE /v1/learning/vocabulary/{id}` - Remove vocabulary

```typescript
// POST /v1/learning/vocabulary
{
  "word": "give up",
  "definition": "từ bỏ",
  "context": "Never gonna give you up",
  "videoId": "dQw4w9WgXcQ",
  "timestamp": 15.5,
  "difficulty": "intermediate",
  "partOfSpeech": "phrasal verb"
}
```

#### US 9.2: Learning Session Tracking
**As a** learner  
**I want to** track my learning sessions and progress  
**So that** I can understand my learning patterns and improve  

**Acceptance Criteria:**
- Record learning session duration and activities
- Track words learned, notes taken, videos watched
- Calculate learning velocity and retention rates
- Provide insights and recommendations
- Generate progress reports

**API Endpoints:**
- `POST /v1/learning/sessions` - Start/end learning session
- `GET /v1/learning/analytics` - Get learning analytics
- `GET /v1/learning/insights` - Get personalized insights

```typescript
// POST /v1/learning/sessions
{
  "sessionType": "video_learning",
  "videoId": "dQw4w9WgXcQ", 
  "duration": 1800, // 30 minutes
  "activitiesCompleted": {
    "wordsLearned": 15,
    "notesTaken": 5,
    "timesPaused": 8,
    "translationsRequested": 12
  }
}
```

#### US 9.3: Note-Taking and Organization
**As a** knowledge seeker  
**I want to** take and organize timestamped notes  
**So that** I can review key insights later  

**Acceptance Criteria:**
- Save notes with precise video timestamps
- Support rich text formatting and tagging
- Enable search across all notes
- Organize notes by video, topic, or date
- Export notes in various formats (Markdown, PDF, etc.)

**API Endpoints:**
- `POST /v1/learning/notes` - Create new note
- `GET /v1/learning/notes` - Get user's notes (with filtering)
- `PUT /v1/learning/notes/{id}` - Update note
- `DELETE /v1/learning/notes/{id}` - Delete note

```typescript
// POST /v1/learning/notes
{
  "videoId": "dQw4w9WgXcQ",
  "timestamp": 45.2,
  "content": "This song represents the ultimate commitment in relationships",
  "tags": ["relationships", "commitment", "music"],
  "isPrivate": true,
  "formatting": {
    "type": "markdown",
    "highlights": ["ultimate commitment"]
  }
}
```

#### US 9.4: Progress Analytics and Reporting
**As a** learner  
**I want to** see detailed analytics about my learning progress  
**So that** I can optimize my learning strategy  

**Acceptance Criteria:**
- Generate comprehensive learning reports
- Show vocabulary growth over time
- Track video watching patterns and preferences
- Provide learning streak and consistency metrics
- Recommend areas for improvement

**API Endpoint:** `GET /v1/learning/analytics/dashboard`
```typescript
// Response
{
  "success": true,
  "data": {
    "overview": {
      "totalVideosWatched": 47,
      "totalWordsLearned": 234,
      "totalNotesTaken": 89,
      "learningStreak": 12, // days
      "averageSessionTime": 28 // minutes
    },
    "progressTrends": {
      "vocabularyGrowth": [
        { "date": "2025-01-01", "count": 200 },
        { "date": "2025-01-02", "count": 215 }
      ],
      "sessionFrequency": [
        { "week": "2025-W01", "sessions": 5 },
        { "week": "2025-W02", "sessions": 7 }
      ]
    },
    "recommendations": [
      {
        "type": "vocabulary_review",
        "message": "You have 23 words due for review",
        "action": "review_vocabulary"
      },
      {
        "type": "content_suggestion", 
        "message": "Try videos about technology - you learn 40% faster",
        "action": "browse_tech_videos"
      }
    ]
  }
}
```

---

## 🔗 Cross-Module User Stories

### US 10.1: Unified Learning Experience
**As a** user  
**I want to** have all learning features work seamlessly together  
**So that** I can focus on learning without technical interruptions  

**Acceptance Criteria:**
- All modules share user authentication and session management
- Data flows seamlessly between modules (video → translation → notes)
- Consistent error handling and user feedback
- Real-time synchronization across all features
- Offline capability where possible

### US 10.2: Data Privacy and Control
**As a** privacy-conscious user  
**I want to** control what data is stored and how it's used  
**So that** I can learn while maintaining my privacy  

**Acceptance Criteria:**
- Users can export all their data
- Users can delete specific data or entire account
- All personal data uses RLS for security
- Clear consent for AI processing
- Option to use anonymous/guest mode

---

## 📊 Success Metrics by Module

### Module 7 (YouTube Integration)
- **Performance**: Video metadata extraction <2s
- **Reliability**: 99.5% success rate for transcript extraction
- **Coverage**: Support for 95% of YouTube video types

### Module 8 (AI Processing)  
- **Accuracy**: Translation accuracy >90% for common phrases
- **Speed**: AI responses <3s for 95% of requests
- **Cost**: Stay within $50/month budget for 1000 users

### Module 9 (Learning Analytics)
- **Engagement**: Users save average 10 words per session  
- **Retention**: 70% of users return within 7 days
- **Satisfaction**: 4.5+ star rating for learning features

---

## 🚀 Implementation Priority

### Phase 1 (Weeks 1-2): Foundation
1. **US 7.1**: Video metadata extraction
2. **US 7.2**: Transcript extraction  
3. **US 9.3**: Basic note-taking

### Phase 2 (Weeks 3-4): Core Learning
1. **US 8.1**: Word translation
2. **US 9.1**: Vocabulary management
3. **US 9.2**: Session tracking

### Phase 3 (Weeks 5-6): Advanced Features
1. **US 8.2**: Video summarization
2. **US 8.3**: Content analysis
3. **US 9.4**: Analytics dashboard

### Phase 4 (Future): Premium Features
1. **US 8.4**: Counter-perspective discovery
2. **US 10.1**: Advanced integrations
3. **US 10.2**: Enhanced privacy controls

---

---

## 📋 TODO.MD UPDATE - Implementation Tracking

### LAYER 8: YOUTUBE EXTENSION BACKEND MODULES

#### 8.1 Module 7: YouTube Integration (Week 2)
**User Stories to Implement:**
- [ ] **US 7.1: Video Metadata Extraction** (2 days)
  - [ ] Create `POST /v1/youtube/video/analyze` endpoint
  - [ ] Integrate YouTube Data API v3
  - [ ] Implement rate limiting (10k units/day)
  - [ ] Add video data caching strategy
  - [ ] Write integration tests
  
- [ ] **US 7.2: Transcript Extraction** (2 days)
  - [ ] Create `POST /v1/youtube/transcript/extract` endpoint
  - [ ] Integrate YouTube Transcript API
  - [ ] Handle multiple languages (EN/VI)
  - [ ] Parse transcript into timestamped segments
  - [ ] Add error handling for videos without transcripts
  
- [ ] **US 7.3: Video History Management** (1 day)
  - [ ] Create CRUD endpoints for video history
  - [ ] Implement RLS policies for privacy
  - [ ] Add progress tracking functionality
  - [ ] Create database migrations

**Database Schema:**
```sql
-- youtube_videos table
CREATE TABLE youtube_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  video_id TEXT NOT NULL UNIQUE,
  title TEXT,
  channel_name TEXT,
  duration INTEGER,
  thumbnail_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- video_transcripts table  
CREATE TABLE video_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES youtube_videos(id),
  language TEXT NOT NULL,
  segments JSONB NOT NULL, -- Array of {start, duration, text}
  created_at TIMESTAMP DEFAULT NOW()
);

-- user_video_history table
CREATE TABLE user_video_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  video_id UUID REFERENCES youtube_videos(id),
  last_watched_at TIMESTAMP DEFAULT NOW(),
  progress_seconds INTEGER DEFAULT 0,
  is_bookmarked BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id, video_id)
);
```

#### 8.2 Module 8: AI Processing (Week 3)
**User Stories to Implement:**
- [ ] **US 8.1: Word Translation** (2 days)
  - [ ] Create `POST /v1/ai/translate` endpoint
  - [ ] Integrate Google Translate API
  - [ ] Add WordsAPI for definitions/pronunciation
  - [ ] Implement smart caching (3-hour TTL)
  - [ ] Add rate limiting (100 translations/hour)
  
- [ ] **US 8.2: Video Summarization** (2 days)
  - [ ] Create `POST /v1/ai/summarize` endpoint
  - [ ] Integrate OpenAI GPT-4o Mini
  - [ ] Handle different summary types (brief/detailed)
  - [ ] Add bilingual support (EN/VI)
  - [ ] Implement cost-optimization strategies
  
- [ ] **US 8.3: Content Analysis** (1 day)
  - [ ] Create `POST /v1/ai/analyze-content` endpoint
  - [ ] Implement fact vs opinion detection
  - [ ] Add sentiment analysis
  - [ ] Calculate confidence scores
  - [ ] Handle edge cases

**Database Schema:**
```sql
-- ai_translations table
CREATE TABLE ai_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  context TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  -- Index for caching
  UNIQUE(original_text, source_lang, target_lang)
);

-- video_summaries table
CREATE TABLE video_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES youtube_videos(id),
  summary_type TEXT NOT NULL, -- brief, detailed, bullet-points
  language TEXT NOT NULL,
  content JSONB NOT NULL,
  tokens_used INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 8.3 Module 9: Learning Analytics (Week 4)
**User Stories to Implement:**
- [ ] **US 9.1: Vocabulary Management** (2 days)
  - [ ] Create vocabulary CRUD endpoints
  - [ ] Implement spaced repetition algorithm
  - [ ] Add vocabulary categorization
  - [ ] Create export functionality
  - [ ] Add progress tracking
  
- [ ] **US 9.2: Learning Session Tracking** (1 day)
  - [ ] Create session tracking endpoints
  - [ ] Implement learning metrics calculation
  - [ ] Add session analytics
  - [ ] Create insights generation
  
- [ ] **US 9.3: Note-Taking System** (1 day)
  - [ ] Create note CRUD endpoints
  - [ ] Add rich text support
  - [ ] Implement search functionality
  - [ ] Add export capabilities
  
- [ ] **US 9.4: Analytics Dashboard** (1 day)
  - [ ] Create analytics endpoint
  - [ ] Implement progress calculations
  - [ ] Add recommendation engine
  - [ ] Create trend analysis

**Database Schema:**
```sql
-- vocabulary_entries table
CREATE TABLE vocabulary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  word TEXT NOT NULL,
  definition TEXT NOT NULL,
  context TEXT,
  video_id UUID REFERENCES youtube_videos(id),
  timestamp DECIMAL,
  difficulty TEXT, -- beginner, intermediate, advanced
  part_of_speech TEXT,
  learned_at TIMESTAMP DEFAULT NOW(),
  next_review_at TIMESTAMP,
  review_count INTEGER DEFAULT 0,
  success_rate DECIMAL DEFAULT 0
);

-- learning_sessions table
CREATE TABLE learning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  video_id UUID REFERENCES youtube_videos(id),
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  duration_seconds INTEGER,
  words_learned INTEGER DEFAULT 0,
  notes_taken INTEGER DEFAULT 0,
  translations_requested INTEGER DEFAULT 0,
  session_type TEXT -- video_learning, vocabulary_review, etc
);

-- video_notes table
CREATE TABLE video_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  video_id UUID REFERENCES youtube_videos(id),
  content TEXT NOT NULL,
  timestamp DECIMAL NOT NULL,
  tags TEXT[],
  is_private BOOLEAN DEFAULT TRUE,
  formatting JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 8.4 Testing Strategy (Week 5)
- [ ] **Integration Tests** (3 days)
  - [ ] Test all API endpoints end-to-end
  - [ ] Test external API integrations
  - [ ] Test error handling scenarios
  - [ ] Test rate limiting functionality
  
- [ ] **Performance Tests** (2 days)
  - [ ] Load test with 100 concurrent users
  - [ ] Test caching effectiveness
  - [ ] Measure API response times
  - [ ] Test database query performance

### 8.5 Documentation & Deployment (Week 6)
- [ ] **API Documentation** (2 days)
  - [ ] Complete OpenAPI specifications
  - [ ] Update Swagger UI
  - [ ] Add usage examples
  - [ ] Document rate limits and quotas
  
- [ ] **Deployment** (3 days)
  - [ ] Deploy to Supabase Edge Functions
  - [ ] Set up monitoring and alerts
  - [ ] Configure production environment
  - [ ] Run smoke tests in production

---

## 🎯 IMPLEMENTATION CHECKLIST

### Week 1: Environment Setup ✅
- [x] Technology choice analysis completed
- [x] Architecture planning finished
- [x] User stories defined (14 total)
- [x] Database schema designed

### Week 2: Module 7 Implementation
- [ ] 3 User Stories (US 7.1, 7.2, 7.3)
- [ ] 4 API endpoints
- [ ] 3 database tables
- [ ] Integration tests

### Week 3: Module 8 Implementation  
- [ ] 3 User Stories (US 8.1, 8.2, 8.3)
- [ ] 3 API endpoints
- [ ] 2 database tables
- [ ] AI service integrations

### Week 4: Module 9 Implementation
- [ ] 4 User Stories (US 9.1, 9.2, 9.3, 9.4)
- [ ] 8+ API endpoints
- [ ] 3 database tables
- [ ] Analytics and reporting

### Week 5: Testing & QA
- [ ] Integration testing
- [ ] Performance testing
- [ ] Security testing
- [ ] Bug fixes

### Week 6: Documentation & Deployment
- [ ] API documentation
- [ ] Production deployment
- [ ] Monitoring setup
- [ ] Launch readiness

---

**📊 TOTAL SCOPE:**
- **14 User Stories** across 3 modules
- **15+ API endpoints** for complete functionality
- **8 database tables** with proper RLS
- **3 external API integrations** (YouTube, Google Translate, OpenAI)
- **95% test coverage** target
- **Production-ready deployment** with monitoring

**🚀 READY TO START: Proceed with Week 2 - Module 7 Implementation**