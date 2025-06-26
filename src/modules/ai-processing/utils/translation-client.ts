import { createAppError, ErrorType } from '@/errors';
import { Logger } from '@/logging';
import type { Definition } from '../types';

const logger = new Logger({ 
  service: 'translation-client',
  enablePerformanceTracking: true 
});

// ============================================
// Translation Provider Interface
// ============================================

export interface TranslationProvider {
  translate(
    text: string,
    sourceLang: string | undefined,
    targetLang: string
  ): Promise<TranslationResult>;
  
  detectLanguage(text: string): Promise<string>;
  
  getSupportedLanguages(): string[];
}

export interface TranslationResult {
  translatedText: string;
  detectedSourceLang?: string;
  provider: string;
}

// ============================================
// Google Translate Provider
// ============================================

export class GoogleTranslateProvider implements TranslationProvider {
  private apiKey: string;
  private baseUrl = 'https://translation.googleapis.com/language/translate/v2';
  
  constructor() {
    this.apiKey = Deno.env.get('GOOGLE_TRANSLATE_API_KEY');
  }
  
  async translate(
    text: string,
    sourceLang: string | undefined,
    targetLang: string
  ): Promise<TranslationResult> {
    const timer = logger.startTimer();
    
    try {
      const params = new URLSearchParams({
        q: text,
        target: targetLang,
        key: this.apiKey
      });
      
      if (sourceLang) {
        params.append('source', sourceLang);
      }
      
      const response = await fetch(`${this.baseUrl}?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw createAppError(
          ErrorType.EXTERNAL_SERVICE_ERROR,
          `Google Translate API error: ${error.error?.message || 'Unknown error'}`,
          { status: response.status, error }
        );
      }
      
      const data = await response.json();
      const translation = data.data.translations[0];
      
      logger.endTimer(timer, 'google_translate_request', {
        sourceLang: translation.detectedSourceLanguage || sourceLang,
        targetLang,
        textLength: text.length
      });
      
      return {
        translatedText: translation.translatedText,
        detectedSourceLang: translation.detectedSourceLanguage,
        provider: 'google'
      };
    } catch (error) {
      logger.error('Google Translate error', { error, text, targetLang });
      throw error;
    }
  }
  
  async detectLanguage(text: string): Promise<string> {
    const params = new URLSearchParams({
      q: text,
      key: this.apiKey
    });
    
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2/detect?${params}`,
      { method: 'POST' }
    );
    
    if (!response.ok) {
      throw createAppError(
        ErrorType.EXTERNAL_SERVICE_ERROR,
        'Failed to detect language'
      );
    }
    
    const data = await response.json();
    return data.data.detections[0][0].language;
  }
  
  getSupportedLanguages(): string[] {
    // Common languages - full list can be fetched from API
    return ['en', 'vi', 'es', 'fr', 'de', 'ja', 'ko', 'zh', 'ru', 'ar'];
  }
}

// ============================================
// LibreTranslate Provider (Self-hosted)
// ============================================

export class LibreTranslateProvider implements TranslationProvider {
  private baseUrl: string;
  private apiKey?: string;
  
  constructor() {
    this.baseUrl = Deno.env.get('LIBRETRANSLATE_URL') || 'http://localhost:5000';
    this.apiKey = Deno.env.get('LIBRETRANSLATE_API_KEY');
  }
  
  async translate(
    text: string,
    sourceLang: string | undefined,
    targetLang: string
  ): Promise<TranslationResult> {
    const timer = logger.startTimer();
    
    try {
      const body: any = {
        q: text,
        target: targetLang,
        format: 'text'
      };
      
      if (sourceLang) {
        body.source = sourceLang;
      } else {
        body.source = 'auto';
      }
      
      if (this.apiKey) {
        body.api_key = this.apiKey;
      }
      
      const response = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw createAppError(
          ErrorType.EXTERNAL_SERVICE_ERROR,
          `LibreTranslate error: ${error.error || 'Unknown error'}`,
          { status: response.status, error }
        );
      }
      
      const data = await response.json();
      
      logger.endTimer(timer, 'libretranslate_request', {
        sourceLang: data.detectedLanguage?.language || sourceLang,
        targetLang,
        textLength: text.length
      });
      
      return {
        translatedText: data.translatedText,
        detectedSourceLang: data.detectedLanguage?.language,
        provider: 'libretranslate'
      };
    } catch (error) {
      logger.error('LibreTranslate error', { error, text, targetLang });
      throw error;
    }
  }
  
  async detectLanguage(text: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: text })
    });
    
    if (!response.ok) {
      throw createAppError(
        ErrorType.EXTERNAL_SERVICE_ERROR,
        'Failed to detect language'
      );
    }
    
    const data = await response.json();
    return data[0].language;
  }
  
  getSupportedLanguages(): string[] {
    // LibreTranslate supports these by default
    return ['en', 'vi', 'es', 'fr', 'de', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'pt'];
  }
}

// ============================================
// Translation Client Manager
// ============================================

export class TranslationClient {
  private provider: TranslationProvider;
  
  constructor() {
    // Choose provider based on environment configuration
    if (Deno.env.get('GOOGLE_TRANSLATE_API_KEY')) {
      this.provider = new GoogleTranslateProvider();
      logger.info('Using Google Translate provider');
    } else if (Deno.env.get('LIBRETRANSLATE_URL')) {
      this.provider = new LibreTranslateProvider();
      logger.info('Using LibreTranslate provider');
    } else {
      throw createAppError(
        ErrorType.CONFIGURATION_ERROR,
        'No translation provider configured. Set either GOOGLE_TRANSLATE_API_KEY or LIBRETRANSLATE_URL'
      );
    }
  }
  
  async translate(
    text: string,
    targetLang: string,
    sourceLang?: string
  ): Promise<TranslationResult> {
    // Validate languages
    const supportedLangs = this.provider.getSupportedLanguages();
    
    if (!supportedLangs.includes(targetLang)) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        `Unsupported target language: ${targetLang}`,
        { supportedLanguages: supportedLangs }
      );
    }
    
    if (sourceLang && !supportedLangs.includes(sourceLang)) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        `Unsupported source language: ${sourceLang}`,
        { supportedLanguages: supportedLangs }
      );
    }
    
    return this.provider.translate(text, sourceLang, targetLang);
  }
  
  async detectLanguage(text: string): Promise<string> {
    return this.provider.detectLanguage(text);
  }
  
  getSupportedLanguages(): string[] {
    return this.provider.getSupportedLanguages();
  }
}

// ============================================
// WordsAPI Integration (Optional)
// ============================================

export class WordsAPIClient {
  private apiKey?: string;
  private baseUrl = 'https://wordsapiv1.p.rapidapi.com/words';
  
  constructor() {
    this.apiKey = Deno.env.get('WORDSAPI_KEY');
  }
  
  async getDefinitions(word: string): Promise<Definition[] | undefined> {
    if (!this.apiKey) {
      return undefined; // WordsAPI is optional
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/${encodeURIComponent(word)}`, {
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': 'wordsapiv1.p.rapidapi.com'
        }
      });
      
      if (!response.ok) {
        logger.warn('WordsAPI request failed', { 
          status: response.status, 
          word 
        });
        return undefined;
      }
      
      const data = await response.json();
      
      if (!data.results || data.results.length === 0) {
        return undefined;
      }
      
      return data.results.map((result: any) => ({
        partOfSpeech: result.partOfSpeech || 'unknown',
        definition: result.definition,
        example: result.examples?.[0],
        synonyms: result.synonyms?.slice(0, 5)
      }));
    } catch (error) {
      logger.warn('WordsAPI error', { error, word });
      return undefined;
    }
  }
  
  async getPronunciation(word: string): Promise<string | undefined> {
    if (!this.apiKey) {
      return undefined;
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/${encodeURIComponent(word)}/pronunciation`, {
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': 'wordsapiv1.p.rapidapi.com'
        }
      });
      
      if (!response.ok) {
        return undefined;
      }
      
      const data = await response.json();
      return data.pronunciation?.all || data.pronunciation;
    } catch (error) {
      logger.warn('WordsAPI pronunciation error', { error, word });
      return undefined;
    }
  }
}

// Export singleton instance
export const translationClient = new TranslationClient();
export const wordsAPIClient = new WordsAPIClient();