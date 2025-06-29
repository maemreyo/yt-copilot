import { Logger } from '@/logging';
import { denoEnv } from '@/shared-deno-env';
import { createClient } from '@supabase/supabase-js';
import type {
  AITranslationRecord,
  ContentAnalysisRecord,
  CounterPerspectiveRecord,
  VideoSummaryRecord,
} from '../types';

const logger = new Logger({ service: 'ai-cache-manager' });

// Cache TTL configuration (in seconds)
const CACHE_TTL = {
  translation: parseInt(denoEnv.get('TRANSLATION_CACHE_TTL') || '2592000'), // 30 days
  summary: parseInt(denoEnv.get('SUMMARY_CACHE_TTL') || '604800'), // 7 days
  analysis: parseInt(denoEnv.get('ANALYSIS_CACHE_TTL') || '604800'), // 7 days
  counterpoints: parseInt(denoEnv.get('COUNTERPOINTS_CACHE_TTL') || '604800'), // 7 days
};

export class AICacheManager {
  private supabase = createClient();

  // ============================================
  // Translation Cache
  // ============================================

  async getCachedTranslation(
    originalText: string,
    sourceLang: string,
    targetLang: string,
    provider: string
  ): Promise<AITranslationRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('ai_translations')
        .select('*')
        .eq('original_text', originalText)
        .eq('source_lang', sourceLang)
        .eq('target_lang', targetLang)
        .eq('provider', provider)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        logger.error('Failed to get cached translation', { error });
        return null;
      }

      // Check if cache is still valid
      const createdAt = new Date(data.created_at).getTime();
      const now = Date.now();
      const ageInSeconds = (now - createdAt) / 1000;

      if (ageInSeconds > CACHE_TTL.translation) {
        // Cache expired, delete it
        await this.deleteCachedTranslation(data.id);
        return null;
      }

      logger.info('Translation cache hit', {
        originalText: originalText.substring(0, 50),
        sourceLang,
        targetLang,
        cacheAge: Math.round(ageInSeconds / 60) + ' minutes',
      });

      return data;
    } catch (error: any) {
      logger.error('Translation cache lookup error', { error });
      return null;
    }
  }

  async cacheTranslation(
    userId: string,
    originalText: string,
    translatedText: string,
    sourceLang: string,
    targetLang: string,
    provider: string,
    context?: string
  ): Promise<void> {
    try {
      // First, try to update existing cache entry
      const { error: updateError } = await this.supabase
        .from('ai_translations')
        .update({
          translated_text: translatedText,
          user_id: userId,
          context,
          updated_at: new Date().toISOString(),
        })
        .eq('original_text', originalText)
        .eq('source_lang', sourceLang)
        .eq('target_lang', targetLang)
        .eq('provider', provider);

      if (updateError) {
        // If update failed, insert new record
        const { error: insertError } = await this.supabase.from('ai_translations').insert({
          user_id: userId,
          original_text: originalText,
          translated_text: translatedText,
          source_lang: sourceLang,
          target_lang: targetLang,
          provider,
          context,
        });

        if (insertError) {
          logger.error('Failed to cache translation', { error: insertError });
        }
      }

      logger.info('Translation cached', {
        originalText: originalText.substring(0, 50),
        sourceLang,
        targetLang,
        provider,
      });
    } catch (error: any) {
      logger.error('Translation cache write error', { error });
    }
  }

  private async deleteCachedTranslation(id: string): Promise<void> {
    await this.supabase.from('ai_translations').delete().eq('id', id);
  }

  // ============================================
  // Summary Cache
  // ============================================

  async getCachedSummary(
    videoId: string,
    summaryType: string,
    language: string
  ): Promise<VideoSummaryRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('video_summaries')
        .select('*')
        .eq('video_id', videoId)
        .eq('summary_type', summaryType)
        .eq('language', language)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to get cached summary', { error });
        return null;
      }

      // Check if cache is still valid
      const createdAt = new Date(data.created_at).getTime();
      const now = Date.now();
      const ageInSeconds = (now - createdAt) / 1000;

      if (ageInSeconds > CACHE_TTL.summary) {
        // Cache expired, delete it
        await this.deleteCachedSummary(data.id);
        return null;
      }

      logger.info('Summary cache hit', {
        videoId,
        summaryType,
        language,
        cacheAge: Math.round(ageInSeconds / 3600) + ' hours',
      });

      return data;
    } catch (error: any) {
      logger.error('Summary cache lookup error', { error });
      return null;
    }
  }

  async cacheSummary(
    videoId: string,
    userId: string,
    summaryType: 'brief' | 'detailed' | 'bullet_points',
    language: string,
    content: any,
    model: string,
    tokensUsed?: number
  ): Promise<void> {
    try {
      // First, try to update existing cache entry
      const { error: updateError } = await this.supabase
        .from('video_summaries')
        .update({
          user_id: userId,
          content,
          model,
          tokens_used: tokensUsed,
          updated_at: new Date().toISOString(),
        })
        .eq('video_id', videoId)
        .eq('summary_type', summaryType)
        .eq('language', language);

      if (updateError) {
        // If update failed, insert new record
        const { error: insertError } = await this.supabase.from('video_summaries').insert({
          video_id: videoId,
          user_id: userId,
          summary_type: summaryType,
          language,
          content,
          model,
          tokens_used: tokensUsed,
        });

        if (insertError) {
          logger.error('Failed to cache summary', { error: insertError });
        }
      }

      logger.info('Summary cached', {
        videoId,
        summaryType,
        language,
        model,
        tokensUsed,
      });
    } catch (error: any) {
      logger.error('Summary cache write error', { error });
    }
  }

  private async deleteCachedSummary(id: string): Promise<void> {
    await this.supabase.from('video_summaries').delete().eq('id', id);
  }

  // ============================================
  // Content Analysis Cache
  // ============================================

  async getCachedAnalysis(
    videoId: string,
    analysisType: string
  ): Promise<ContentAnalysisRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('content_analysis')
        .select('*')
        .eq('video_id', videoId)
        .eq('analysis_type', analysisType)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to get cached analysis', { error });
        return null;
      }

      // Check if cache is still valid
      const createdAt = new Date(data.created_at).getTime();
      const now = Date.now();
      const ageInSeconds = (now - createdAt) / 1000;

      if (ageInSeconds > CACHE_TTL.analysis) {
        // Cache expired, delete it
        await this.deleteCachedAnalysis(data.id);
        return null;
      }

      logger.info('Analysis cache hit', {
        videoId,
        analysisType,
        cacheAge: Math.round(ageInSeconds / 3600) + ' hours',
      });

      return data;
    } catch (error: any) {
      logger.error('Analysis cache lookup error', { error });
      return null;
    }
  }

  async cacheAnalysis(
    videoId: string,
    userId: string,
    analysisType: 'fact_opinion' | 'sentiment' | 'bias',
    analysisData: any,
    confidenceScore: number,
    model: string,
    segments?: number[],
    tokensUsed?: number
  ): Promise<void> {
    try {
      // First, try to update existing cache entry
      const { error: updateError } = await this.supabase
        .from('content_analysis')
        .update({
          user_id: userId,
          analysis_data: analysisData,
          confidence_score: confidenceScore,
          model,
          segments,
          tokens_used: tokensUsed,
        })
        .eq('video_id', videoId)
        .eq('analysis_type', analysisType);

      if (updateError) {
        // If update failed, insert new record
        const { error: insertError } = await this.supabase.from('content_analysis').insert({
          video_id: videoId,
          user_id: userId,
          analysis_type: analysisType,
          analysis_data: analysisData,
          confidence_score: confidenceScore,
          model,
          segments,
          tokens_used: tokensUsed,
        });

        if (insertError) {
          logger.error('Failed to cache analysis', { error: insertError });
        }
      }

      logger.info('Analysis cached', {
        videoId,
        analysisType,
        model,
        tokensUsed,
      });
    } catch (error: any) {
      logger.error('Analysis cache write error', { error });
    }
  }

  private async deleteCachedAnalysis(id: string): Promise<void> {
    await this.supabase.from('content_analysis').delete().eq('id', id);
  }

  // ============================================
  // Counter-Perspectives Cache
  // ============================================

  async getCachedCounterPerspectives(videoId: string): Promise<CounterPerspectiveRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('counter_perspectives')
        .select('*')
        .eq('video_id', videoId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to get cached counter-perspectives', { error });
        return null;
      }

      // Check if cache is still valid
      const createdAt = new Date(data.created_at).getTime();
      const now = Date.now();
      const ageInSeconds = (now - createdAt) / 1000;

      if (ageInSeconds > CACHE_TTL.counterpoints) {
        // Cache expired, delete it
        await this.deleteCachedCounterPerspectives(data.id);
        return null;
      }

      logger.info('Counter-perspectives cache hit', {
        videoId,
        cacheAge: Math.round(ageInSeconds / 3600) + ' hours',
      });

      return data;
    } catch (error: any) {
      logger.error('Counter-perspectives cache lookup error', { error });
      return null;
    }
  }

  async cacheCounterPerspectives(
    videoId: string,
    userId: string,
    mainTopics: string[],
    originalPerspective: string,
    counterPerspectives: any[],
    searchKeywords: string[],
    model: string,
    tokensUsed?: number
  ): Promise<void> {
    try {
      // First, try to update existing cache entry
      const { error: updateError } = await this.supabase
        .from('counter_perspectives')
        .update({
          user_id: userId,
          main_topics: mainTopics,
          original_perspective: originalPerspective,
          counter_perspectives: counterPerspectives,
          search_keywords: searchKeywords,
          model,
          tokens_used: tokensUsed,
        })
        .eq('video_id', videoId);

      if (updateError) {
        // If update failed, insert new record
        const { error: insertError } = await this.supabase.from('counter_perspectives').insert({
          video_id: videoId,
          user_id: userId,
          main_topics: mainTopics,
          original_perspective: originalPerspective,
          counter_perspectives: counterPerspectives,
          search_keywords: searchKeywords,
          model,
          tokens_used: tokensUsed,
        });

        if (insertError) {
          logger.error('Failed to cache counter-perspectives', {
            error: insertError,
          });
        }
      }

      logger.info('Counter-perspectives cached', {
        videoId,
        model,
        tokensUsed,
        perspectiveCount: counterPerspectives.length,
      });
    } catch (error: any) {
      logger.error('Counter-perspectives cache write error', { error });
    }
  }

  private async deleteCachedCounterPerspectives(id: string): Promise<void> {
    await this.supabase.from('counter_perspectives').delete().eq('id', id);
  }

  // ============================================
  // Cache Statistics
  // ============================================

  async getCacheStats(userId: string): Promise<{
    translations: number;
    summaries: number;
    analyses: number;
    counterpoints: number;
    totalSaved: number; // Estimated cost savings
  }> {
    try {
      const [translationsResult, summariesResult, analysesResult, counterpointsResult] =
        await Promise.all([
          this.supabase
            .from('ai_translations')
            .select('id', { count: 'exact' })
            .eq('user_id', userId),

          this.supabase.from('video_summaries').select('tokens_used').eq('user_id', userId),

          this.supabase.from('content_analysis').select('tokens_used').eq('user_id', userId),

          this.supabase.from('counter_perspectives').select('tokens_used').eq('user_id', userId),
        ]);

      const translations = translationsResult.count || 0;
      const summaries = summariesResult.data?.length || 0;
      const analyses = analysesResult.data?.length || 0;
      const counterpoints = counterpointsResult.data?.length || 0;

      // Calculate estimated cost savings
      const avgTranslationCost = 0.00002; // $20 per 1M chars
      const avgTokenCost = 0.00000015; // $0.15 per 1M tokens

      const translationSavings = translations * 100 * avgTranslationCost; // Assume 100 chars avg
      const tokenSavings =
        [
          ...(summariesResult.data || []),
          ...(analysesResult.data || []),
          ...(counterpointsResult.data || []),
        ].reduce((sum, item) => sum + (item.tokens_used || 0), 0) * avgTokenCost;

      return {
        translations,
        summaries,
        analyses,
        counterpoints,
        totalSaved: Math.round((translationSavings + tokenSavings) * 100) / 100,
      };
    } catch (error: any) {
      logger.error('Failed to get cache stats', { error });
      return {
        translations: 0,
        summaries: 0,
        analyses: 0,
        counterpoints: 0,
        totalSaved: 0,
      };
    }
  }
}

// Export singleton instance
export const aiCacheManager = new AICacheManager();
