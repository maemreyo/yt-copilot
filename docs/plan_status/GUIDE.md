# Module 8 & 9 Implementation Guide

## 🎯 Module 8: AI Processing

### Tech Stack Required:
- **Google Translate API** hoặc **LibreTranslate** (self-hosted)
- **OpenAI API** (GPT-4o-mini cho cost optimization)
- **Deno runtime** (Edge Functions)

### Implementation Notes:

#### 8.1 Translation Service
```typescript
// Tận dụng từ modules trước:
- Layer 1: Cache utilities (cache translations 30 days)
- Layer 1: Rate limiting (100 trans/hour free users)
- Module 7: Get transcript từ video_transcripts table
```

#### 8.2 Summarization
```typescript
// Reuse:
- Module 7: YouTubeVideoRecord + VideoTranscript data
- Layer 1: Error handling cho OpenAI API failures
- Layer 2: Database utilities để lưu summaries
```

#### 8.3 Content Analysis
```typescript
// Build on:
- Layer 1: Validation schemas cho AI responses
- Layer 5: User permissions (premium features)
- Module 7: Video metadata for context
```

### Key Tables to Create:
- `ai_translations` (cache translations)
- `video_summaries` (store AI summaries)
- `content_analysis` (facts vs opinions)

---

## 📊 Module 9: Learning Analytics

### Tech Stack Required:
- **PostgreSQL** full-text search
- **Supabase Realtime** (optional - live progress)
- **Chart.js** hoặc **Recharts** (frontend visualization)

### Implementation Notes:

#### 9.1 Vocabulary Management
```typescript
// Leverage:
- Module 7: Link to video_transcripts.segments
- Module 8: Translation data
- Layer 1: Pagination utilities
- Layer 2: Audit logging for learning events
```

#### 9.2 Session Analytics
```typescript
// Reuse:
- Module 7: user_video_history for watch data
- Layer 1: Rate limiting middleware
- Layer 4: Metrics collection patterns
```

#### 9.3 Note-Taking
```typescript
// Build on:
- Module 7: Timestamp từ transcripts
- Layer 1: Sanitization cho user input
- Layer 5: RLS policies pattern
```

### Key Tables to Create:
- `vocabulary_entries` (user's saved words)
- `learning_sessions` (track study sessions)
- `video_notes` (timestamped annotations)

---

## 🔧 Critical Integration Points

### Must Reuse from Previous Layers:
1. **Layer 1 Utilities**:
   - Error handling (`@/errors`)
   - Caching (`@/cache`) - CRITICAL for API costs
   - Rate limiting (`@/rate-limiting`)
   - Validation (`@/validation`)

2. **Layer 2 Database**:
   - Database utilities (`@/database`)
   - Migration patterns
   - Type generation workflow

3. **Module 7 Data**:
   - Video metadata for context
   - Transcripts for word extraction
   - User history for personalization

### API Key Management:
```env
# Add to .env:
OPENAI_API_KEY=sk-...
GOOGLE_TRANSLATE_API_KEY=...
# OR
LIBRETRANSLATE_URL=http://localhost:5000
```

### Cost Optimization Strategy:
1. **Cache aggressively** - Translations don't change
2. **Batch operations** - Group AI requests
3. **Use GPT-4o-mini** - 10x cheaper than GPT-4
4. **Rate limit by user tier** - Free vs Premium limits

### Testing Approach:
- Mock external APIs in tests
- Use fixtures for AI responses
- Test rate limiting logic thoroughly
- Verify caching behavior

---

## ⚡ Quick Start Commands

```bash
# Create module structure
mkdir -p src/modules/{ai-processing,learning-analytics}/{functions,migrations,tests,types,utils}

# Copy patterns from Module 7
cp -r src/modules/youtube/types/* src/modules/ai-processing/types/
# Then modify for AI types

# Run after creating migrations
pnpm build:backend
pnpm db:migrate

# Test with mock data first
MOCK_EXTERNAL_APIS=true pnpm test:integration
```

**Remember**: Every external API call costs money. Cache everything possible!