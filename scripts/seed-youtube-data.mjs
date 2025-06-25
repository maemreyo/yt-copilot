/**
 * YouTube Extension Seed Data
 * 
 * Extends existing seed-dev-data.mjs with realistic YouTube learning data
 * for testing and development purposes.
 * 
 * @description: Generate test data for YouTube extension features
 * @module: youtube
 * @version: 1.0.0
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client (service role for seeding)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Sample YouTube videos for testing
const SAMPLE_VIDEOS = [
  {
    video_id: 'dQw4w9WgXcQ',
    title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
    description: 'The official video for "Never Gonna Give You Up" by Rick Astley...',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_name: 'Rick Astley',
    duration: 212,
    published_at: '2009-10-25T06:57:33Z',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    view_count: 1400000000,
    like_count: 15000000,
    language: 'en',
    has_transcript: true,
    transcript_languages: ['en', 'es', 'fr'],
    category_id: 10,
    tags: ['music', 'official', 'classic', '80s']
  },
  {
    video_id: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    description: 'The first video uploaded to YouTube...',
    channel_id: 'UC4QobU6STFB0P71PMvOGN5A',
    channel_name: 'jawed',
    duration: 19,
    published_at: '2005-04-23T20:31:52Z',
    thumbnail_url: 'https://i.ytimg.com/vi/jNQXAC9IVRw/maxresdefault.jpg',
    view_count: 280000000,
    like_count: 8000000,
    language: 'en',
    has_transcript: true,
    transcript_languages: ['en'],
    category_id: 22,
    tags: ['first', 'youtube', 'zoo', 'history']
  },
  {
    video_id: 'kJQP7kiw5Fk',
    title: 'Despacito',
    description: 'Luis Fonsi - Despacito ft. Daddy Yankee...',
    channel_id: 'UC_OdX7xTFtVN3xreMhQxnPQ',
    channel_name: 'Luis Fonsi',
    duration: 282,
    published_at: '2017-01-12T21:30:09Z',
    thumbnail_url: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg',
    view_count: 8200000000,
    like_count: 50000000,
    language: 'es',
    has_transcript: true,
    transcript_languages: ['es', 'en'],
    category_id: 10,
    tags: ['spanish', 'latin', 'music', 'reggaeton']
  },
  {
    video_id: '9bZkp7q19f0',
    title: 'PSY - GANGNAM STYLE (강남스타일) M/V',
    description: 'PSY - GANGNAM STYLE (강남스타일) M/V...',
    channel_id: 'UCrDkAvF9ZLzWlq5XZ_4xBJw',
    channel_name: 'officialpsy',
    duration: 253,
    published_at: '2012-07-15T07:54:46Z',
    thumbnail_url: 'https://i.ytimg.com/vi/9bZkp7q19f0/maxresdefault.jpg',
    view_count: 5000000000,
    like_count: 25000000,
    language: 'ko',
    has_transcript: true,
    transcript_languages: ['ko', 'en'],
    category_id: 10,
    tags: ['kpop', 'korean', 'dance', 'viral']
  },
  {
    video_id: 'L_jWHffIx5E',
    title: 'Smash Mouth - All Star (Official Music Video)',
    description: 'Official music video for Smash Mouth - All Star...',
    channel_id: 'UCN1hnUccO4FD5WfM7ithXaw',
    channel_name: 'Smash Mouth',
    duration: 200,
    published_at: '2009-06-17T01:00:31Z',
    thumbnail_url: 'https://i.ytimg.com/vi/L_jWHffIx5E/maxresdefault.jpg',
    view_count: 800000000,
    like_count: 5000000,
    language: 'en',
    has_transcript: true,
    transcript_languages: ['en'],
    category_id: 10,
    tags: ['rock', 'alternative', '90s', 'meme']
  }
];

// Sample transcript segments
const SAMPLE_TRANSCRIPTS = {
  'dQw4w9WgXcQ': [
    { start: 0.0, duration: 3.5, text: "We're no strangers to love" },
    { start: 3.5, duration: 3.2, text: "You know the rules and so do I" },
    { start: 6.7, duration: 3.8, text: "A full commitment's what I'm thinking of" },
    { start: 10.5, duration: 4.1, text: "You wouldn't get this from any other guy" },
    { start: 14.6, duration: 2.9, text: "I just wanna tell you how I'm feeling" },
    { start: 17.5, duration: 3.2, text: "Gotta make you understand" },
    { start: 20.7, duration: 2.8, text: "Never gonna give you up" },
    { start: 23.5, duration: 2.9, text: "Never gonna let you down" },
    { start: 26.4, duration: 3.4, text: "Never gonna run around and desert you" }
  ],
  'jNQXAC9IVRw': [
    { start: 0.0, duration: 2.1, text: "All right, so here we are" },
    { start: 2.1, duration: 1.8, text: "in front of the elephants" },
    { start: 3.9, duration: 3.2, text: "and the cool thing about these guys" },
    { start: 7.1, duration: 2.4, text: "is that they have really" },
    { start: 9.5, duration: 1.6, text: "really long trunks" },
    { start: 11.1, duration: 2.8, text: "and that's pretty much all" },
    { start: 13.9, duration: 1.9, text: "there is to say" }
  ]
};

// Sample learning content
const VOCABULARY_WORDS = [
  {
    word_text: 'commitment',
    definition: 'a promise or firm decision to do something',
    translation: 'cam kết, lời hứa',
    pronunciation: '/kəˈmɪtmənt/',
    part_of_speech: 'noun',
    context_sentence: "A full commitment's what I'm thinking of",
    difficulty_level: 'medium',
    cefr_level: 'B2'
  },
  {
    word_text: 'stranger',
    definition: 'a person whom one does not know',
    translation: 'người lạ',
    pronunciation: '/ˈstreɪndʒər/',
    part_of_speech: 'noun',
    context_sentence: "We're no strangers to love",
    difficulty_level: 'easy',
    cefr_level: 'A2'
  },
  {
    word_text: 'desert',
    definition: 'to abandon or leave someone',
    translation: 'bỏ rơi, từ bỏ',
    pronunciation: '/dɪˈzɜːrt/',
    part_of_speech: 'verb',
    context_sentence: "Never gonna run around and desert you",
    difficulty_level: 'medium',
    cefr_level: 'B1'
  },
  {
    word_text: 'trunk',
    definition: 'the elongated prehensile nose of an elephant',
    translation: 'vòi voi',
    pronunciation: '/trʌŋk/',
    part_of_speech: 'noun',
    context_sentence: "they have really really long trunks",
    difficulty_level: 'easy',
    cefr_level: 'A1'
  }
];

// Sample translations for caching
const SAMPLE_TRANSLATIONS = [
  {
    original_text: 'give up',
    translated_text: 'từ bỏ',
    source_language: 'en',
    target_language: 'vi',
    context_text: 'Never gonna give you up',
    pronunciation: '/ɡɪv ʌp/',
    part_of_speech: 'phrasal verb',
    confidence_score: 0.95,
    alternatives: {
      translations: [
        { text: 'từ bỏ', confidence: 0.95, frequency: 'common' },
        { text: 'bỏ cuộc', confidence: 0.87, frequency: 'common' },
        { text: 'đầu hàng', confidence: 0.73, frequency: 'less_common' }
      ],
      examples: [
        {
          source: 'Never give up on your dreams',
          target: 'Đừng bao giờ từ bỏ ước mơ của bạn'
        }
      ]
    },
    translation_service: 'google_translate'
  },
  {
    original_text: 'elephant',
    translated_text: 'con voi',
    source_language: 'en',
    target_language: 'vi',
    context_text: 'in front of the elephants',
    pronunciation: '/ˈɛlɪfənt/',
    part_of_speech: 'noun',
    confidence_score: 0.99,
    alternatives: {
      translations: [
        { text: 'con voi', confidence: 0.99, frequency: 'common' },
        { text: 'voi', confidence: 0.95, frequency: 'common' }
      ]
    },
    translation_service: 'google_translate'
  }
];

/**
 * Seed YouTube videos data
 */
async function seedYouTubeVideos() {
  console.log('🎬 Seeding YouTube videos...');
  
  const { data, error } = await supabase
    .from('youtube_videos')
    .insert(SAMPLE_VIDEOS)
    .select();
  
  if (error) {
    console.error('Error seeding YouTube videos:', error);
    throw error;
  }
  
  console.log(`✅ Inserted ${data.length} YouTube videos`);
  return data;
}

/**
 * Seed video transcripts
 */
async function seedVideoTranscripts(videoData) {
  console.log('📝 Seeding video transcripts...');
  
  const transcripts = [];
  
  for (const video of videoData) {
    if (SAMPLE_TRANSCRIPTS[video.video_id]) {
      transcripts.push({
        video_id: video.id,
        language: 'en',
        is_auto_generated: true,
        segments: SAMPLE_TRANSCRIPTS[video.video_id],
        total_duration: video.duration,
        segment_count: SAMPLE_TRANSCRIPTS[video.video_id].length,
        word_count: SAMPLE_TRANSCRIPTS[video.video_id].reduce((acc, seg) => 
          acc + seg.text.split(' ').length, 0
        ),
        character_count: SAMPLE_TRANSCRIPTS[video.video_id].reduce((acc, seg) => 
          acc + seg.text.length, 0
        ),
        confidence_score: 0.85,
        has_word_timestamps: false,
        source: 'youtube_api'
      });
    }
  }
  
  const { data, error } = await supabase
    .from('video_transcripts')
    .insert(transcripts)
    .select();
  
  if (error) {
    console.error('Error seeding transcripts:', error);
    throw error;
  }
  
  console.log(`✅ Inserted ${data.length} video transcripts`);
  return data;
}

/**
 * Seed user video history for test users
 */
async function seedUserVideoHistory(videoData, users) {
  console.log('📊 Seeding user video history...');
  
  const histories = [];
  
  // Create history for each user with different videos
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userVideos = videoData.slice(0, Math.min(3 + i, videoData.length));
    
    for (let j = 0; j < userVideos.length; j++) {
      const video = userVideos[j];
      const progress = Math.random() * video.duration;
      const completion = (progress / video.duration) * 100;
      
      histories.push({
        user_id: user.id,
        video_id: video.id,
        progress_seconds: progress,
        total_watch_time: progress + Math.random() * 300, // Some rewatching
        completion_percentage: completion,
        first_watched_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Last 30 days
        last_watched_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Last 7 days
        watch_session_count: Math.floor(Math.random() * 5) + 1,
        is_bookmarked: Math.random() > 0.7,
        is_favorite: Math.random() > 0.8,
        user_rating: Math.random() > 0.5 ? Math.floor(Math.random() * 5) + 1 : null,
        learning_focus: ['vocabulary', 'pronunciation', 'grammar', 'culture'][Math.floor(Math.random() * 4)],
        difficulty_rating: ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)],
        pause_count: Math.floor(Math.random() * 20),
        replay_count: Math.floor(Math.random() * 10),
        words_learned_count: Math.floor(Math.random() * 15),
        notes_taken_count: Math.floor(Math.random() * 8),
        translations_requested: Math.floor(Math.random() * 25),
        video_duration_at_time: video.duration
      });
    }
  }
  
  const { data, error } = await supabase
    .from('user_video_history')
    .insert(histories)
    .select();
  
  if (error) {
    console.error('Error seeding user video history:', error);
    throw error;
  }
  
  console.log(`✅ Inserted ${data.length} user video history records`);
  return data;
}

/**
 * Seed AI translations cache
 */
async function seedAITranslations() {
  console.log('🤖 Seeding AI translations...');
  
  const translations = SAMPLE_TRANSLATIONS.map(translation => ({
    ...translation,
    content_hash: generateTranslationHash(
      translation.original_text, 
      translation.context_text, 
      translation.source_language
    ),
    usage_count: Math.floor(Math.random() * 50) + 1,
    is_phrase: translation.original_text.includes(' '),
    word_count: translation.original_text.split(' ').length
  }));
  
  const { data, error } = await supabase
    .from('ai_translations')
    .insert(translations)
    .select();
  
  if (error) {
    console.error('Error seeding AI translations:', error);
    throw error;
  }
  
  console.log(`✅ Inserted ${data.length} AI translations`);
  return data;
}

/**
 * Seed vocabulary entries for users
 */
async function seedVocabularyEntries(videoData, users) {
  console.log('📚 Seeding vocabulary entries...');
  
  const vocabularies = [];
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userWords = VOCABULARY_WORDS.slice(0, Math.min(2 + i, VOCABULARY_WORDS.length));
    
    for (const word of userWords) {
      const relatedVideo = videoData[Math.floor(Math.random() * videoData.length)];
      
      vocabularies.push({
        user_id: user.id,
        video_id: relatedVideo.id,
        word_text: word.word_text,
        definition: word.definition,
        translation: word.translation,
        pronunciation: word.pronunciation,
        part_of_speech: word.part_of_speech,
        context_sentence: word.context_sentence,
        context_translation: '', // Would be filled by translation service
        video_timestamp: Math.random() * relatedVideo.duration,
        source_language: 'en',
        target_language: 'vi',
        difficulty_level: word.difficulty_level,
        cefr_level: word.cefr_level,
        srs_level: Math.floor(Math.random() * 3) + 1,
        ease_factor: 2.5 + (Math.random() - 0.5) * 0.5,
        interval_days: Math.floor(Math.random() * 7) + 1,
        next_review_date: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000),
        correct_answers: Math.floor(Math.random() * 10),
        incorrect_answers: Math.floor(Math.random() * 3),
        mastery_level: Math.random() * 0.8 + 0.2,
        is_starred: Math.random() > 0.8,
        tags: ['learning', 'english'],
        category: ['music', 'general', 'entertainment'][Math.floor(Math.random() * 3)],
        learning_source: 'youtube'
      });
    }
  }
  
  const { data, error } = await supabase
    .from('vocabulary_entries')
    .insert(vocabularies)
    .select();
  
  if (error) {
    console.error('Error seeding vocabulary entries:', error);
    throw error;
  }
  
  console.log(`✅ Inserted ${data.length} vocabulary entries`);
  return data;
}

/**
 * Seed learning sessions
 */
async function seedLearningSessions(videoData, users) {
  console.log('🎯 Seeding learning sessions...');
  
  const sessions = [];
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const sessionCount = Math.floor(Math.random() * 5) + 2; // 2-6 sessions per user
    
    for (let j = 0; j < sessionCount; j++) {
      const video = videoData[Math.floor(Math.random() * videoData.length)];
      const duration = Math.floor(Math.random() * 3600) + 300; // 5min to 1hour
      const startTime = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      
      sessions.push({
        user_id: user.id,
        video_id: video.id,
        started_at: startTime,
        ended_at: new Date(startTime.getTime() + duration * 1000),
        duration_seconds: duration,
        active_learning_seconds: Math.floor(duration * 0.8), // 80% active
        session_type: ['video_learning', 'vocabulary_review', 'practice_session'][Math.floor(Math.random() * 3)],
        learning_mode: ['active', 'mixed', 'focused'][Math.floor(Math.random() * 3)],
        focus_area: ['vocabulary', 'pronunciation', 'grammar', 'listening'][Math.floor(Math.random() * 4)],
        activities_completed: {
          video_watching: {
            time_watched: duration * 0.6,
            completion_percentage: Math.random() * 100,
            pauses_count: Math.floor(Math.random() * 15),
            rewinds_count: Math.floor(Math.random() * 8),
            speed_changes: Math.floor(Math.random() * 5)
          },
          vocabulary_learning: {
            words_encountered: Math.floor(Math.random() * 30) + 5,
            words_saved: Math.floor(Math.random() * 15) + 2,
            words_translated: Math.floor(Math.random() * 20) + 3,
            new_words_learned: Math.floor(Math.random() * 10) + 1
          },
          note_taking: {
            notes_created: Math.floor(Math.random() * 8),
            total_note_length: Math.floor(Math.random() * 500) + 100,
            timestamped_notes: Math.floor(Math.random() * 5)
          }
        },
        words_learned_count: Math.floor(Math.random() * 12) + 1,
        notes_taken_count: Math.floor(Math.random() * 6),
        translations_requested: Math.floor(Math.random() * 20) + 5,
        summaries_generated: Math.random() > 0.7 ? 1 : 0,
        engagement_score: Math.random() * 0.4 + 0.6, // 0.6-1.0
        focus_score: Math.random() * 0.5 + 0.5, // 0.5-1.0
        productivity_score: Math.random() * 0.4 + 0.6, // 0.6-1.0
        difficulty_experienced: ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)],
        learning_satisfaction: Math.floor(Math.random() * 2) + 4, // 4-5 stars
        comprehension_level: Math.random() * 0.3 + 0.7, // 0.7-1.0
        learning_goals: ['Learn new vocabulary', 'Improve pronunciation', 'Understand grammar'],
        goals_achieved: ['Learn new vocabulary'],
        achievement_rate: Math.random() * 0.5 + 0.5, // 0.5-1.0
        completion_status: 'completed',
        device_type: ['desktop', 'mobile', 'tablet'][Math.floor(Math.random() * 3)]
      });
    }
  }
  
  const { data, error } = await supabase
    .from('learning_sessions')
    .insert(sessions)
    .select();
  
  if (error) {
    console.error('Error seeding learning sessions:', error);
    throw error;
  }
  
  console.log(`✅ Inserted ${data.length} learning sessions`);
  return data;
}

/**
 * Seed video notes
 */
async function seedVideoNotes(videoData, users) {
  console.log('📔 Seeding video notes...');
  
  const notes = [];
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const noteCount = Math.floor(Math.random() * 8) + 3; // 3-10 notes per user
    
    for (let j = 0; j < noteCount; j++) {
      const video = videoData[Math.floor(Math.random() * videoData.length)];
      const timestamp = Math.random() * video.duration;
      
      const sampleNotes = [
        'Great explanation of the concept here',
        'This part is confusing, need to review later',
        'Key vocabulary: commitment, stranger, desert',
        'Pronunciation tip: the "r" sound is different here',
        'Cultural context: this is a reference to...',
        'Grammar note: past perfect tense usage',
        'This melody is really catchy!',
        'Translation: "We\'re no strangers" = "Chúng ta không xa lạ"'
      ];
      
      notes.push({
        user_id: user.id,
        video_id: video.id,
        content: sampleNotes[Math.floor(Math.random() * sampleNotes.length)],
        title: Math.random() > 0.6 ? `Note at ${Math.floor(timestamp)}s` : null,
        note_type: ['general', 'vocabulary', 'grammar', 'pronunciation', 'cultural'][Math.floor(Math.random() * 5)],
        timestamp: timestamp,
        video_segment_text: SAMPLE_TRANSCRIPTS[video.video_id] ? 
          SAMPLE_TRANSCRIPTS[video.video_id][0]?.text : 'Sample transcript text',
        formatting: {
          format: 'markdown',
          highlights: []
        },
        tags: ['learning', 'english', 'notes'],
        category: ['vocabulary', 'grammar', 'pronunciation', 'general'][Math.floor(Math.random() * 4)],
        importance_level: Math.floor(Math.random() * 5) + 1,
        learning_objective: 'Understanding English through music',
        difficulty_level: ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)],
        understanding_level: Math.floor(Math.random() * 3) + 3, // 3-5
        is_private: Math.random() > 0.2, // 80% private
        is_pinned: Math.random() > 0.8, // 20% pinned
        needs_review: Math.random() > 0.7 // 30% need review
      });
    }
  }
  
  const { data, error } = await supabase
    .from('video_notes')
    .insert(notes)
    .select();
  
  if (error) {
    console.error('Error seeding video notes:', error);
    throw error;
  }
  
  console.log(`✅ Inserted ${data.length} video notes`);
  return data;
}

/**
 * Helper function to generate translation hash
 */
function generateTranslationHash(originalText, context, sourceLang) {
  const crypto = await import('crypto');
  const content = (originalText + '|' + (context || '') + '|' + sourceLang).toLowerCase().trim();
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get existing test users from the database
 */
async function getTestUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .limit(5);
  
  if (error) {
    throw error;
  }
  
  if (data.length === 0) {
    console.warn('⚠️  No test users found. Please run the main seed script first.');
    return [];
  }
  
  console.log(`👥 Found ${data.length} test users`);
  return data;
}

/**
 * Main seeding function
 */
async function seedYouTubeData() {
  try {
    console.log('🚀 Starting YouTube extension data seeding...\n');
    
    // Get test users
    const users = await getTestUsers();
    if (users.length === 0) {
      console.error('❌ Cannot seed YouTube data without test users');
      process.exit(1);
    }
    
    // Seed in dependency order
    const videoData = await seedYouTubeVideos();
    const transcriptData = await seedVideoTranscripts(videoData);
    const historyData = await seedUserVideoHistory(videoData, users);
    const translationData = await seedAITranslations();
    const vocabularyData = await seedVocabularyEntries(videoData, users);
    const sessionData = await seedLearningSessions(videoData, users);
    const notesData = await seedVideoNotes(videoData, users);
    
    console.log('\n🎉 YouTube extension data seeding completed successfully!');
    console.log('📊 Summary:');
    console.log(`   • ${videoData.length} YouTube videos`);
    console.log(`   • ${transcriptData.length} video transcripts`);
    console.log(`   • ${historyData.length} user video history records`);
    console.log(`   • ${translationData.length} AI translations`);
    console.log(`   • ${vocabularyData.length} vocabulary entries`);
    console.log(`   • ${sessionData.length} learning sessions`);
    console.log(`   • ${notesData.length} video notes`);
    console.log('\n✅ Ready for YouTube extension development and testing!');
    
  } catch (error) {
    console.error('❌ Error seeding YouTube data:', error);
    process.exit(1);
  }
}

// Run seeding if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await seedYouTubeData();
}

export { seedYouTubeData };