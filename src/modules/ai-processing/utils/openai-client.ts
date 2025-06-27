import { createAppError, ErrorType } from '@/errors';
import { Logger } from '@/logging';
import type {
  BiasIndicator,
  ContentAnalysis,
  Fact,
  Opinion,
  SentimentScore,
  VideoSummaryContent,
} from '../types';

const logger = new Logger({
  service: 'openai-client',
  enablePerformanceTracking: true,
});

// Configuration
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
const OPENAI_MAX_TOKENS = parseInt(Deno.env.get('OPENAI_MAX_TOKENS') || '2000');
const OPENAI_TEMPERATURE = parseFloat(
  Deno.env.get('OPENAI_TEMPERATURE') || '0.7',
);

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIClient {
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.openai.com/v1/chat/completions';

  constructor() {
    this.apiKey = OPENAI_API_KEY;
    this.model = OPENAI_MODEL;
  }

  // ============================================
  // Core API Methods
  // ============================================

  private async makeRequest(
    messages: OpenAIMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: { type: 'json_object' };
    } = {},
  ): Promise<{ response: string; tokensUsed: number }> {
    const timer = logger.startTimer();

    try {
      const body: any = {
        model: this.model,
        messages,
        temperature: options.temperature || OPENAI_TEMPERATURE,
        max_tokens: options.maxTokens || OPENAI_MAX_TOKENS,
      };

      if (options.responseFormat) {
        body.response_format = options.responseFormat;
      }

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw createAppError(
          ErrorType.EXTERNAL_SERVICE_ERROR,
          `OpenAI API error: ${error.error?.message || 'Unknown error'}`,
          { status: response.status, error },
        );
      }

      const data: OpenAIResponse = await response.json();

      logger.endTimer(timer, 'openai_request', {
        model: this.model,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      });

      return {
        response: data.choices[0].message.content,
        tokensUsed: data.usage?.total_tokens || 0,
      };
    } catch (error: any) {
      logger.error('OpenAI API error', { error, model: this.model });
      throw error;
    }
  }

  // ============================================
  // Video Summarization
  // ============================================

  async summarizeVideo(
    title: string,
    transcript: string,
    summaryType: 'brief' | 'detailed' | 'bullet_points',
    language: string = 'en',
  ): Promise<{ summary: VideoSummaryContent; tokensUsed: number }> {
    logger.info('Generating video summary', { title, summaryType, language });

    const systemPrompt = this.getSummarizationSystemPrompt(
      summaryType,
      language,
    );
    const userPrompt = this.getSummarizationUserPrompt(
      title,
      transcript,
      summaryType,
    );

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const { response, tokensUsed } = await this.makeRequest(messages, {
      temperature: 0.5, // Lower temperature for more consistent summaries
      maxTokens: summaryType === 'brief' ? 500 : 2000,
      responseFormat: { type: 'json_object' },
    });

    try {
      const parsed = JSON.parse(response);

      // Ensure all required fields are present
      const summary: VideoSummaryContent = {
        summary: parsed.summary || '',
        key_points: parsed.key_points || [],
        topics: parsed.topics || [],
        duration_estimate: parsed.duration_estimate ||
          Math.ceil(parsed.summary.split(' ').length / 200),
        generated_at: new Date().toISOString(),
      };

      return { summary, tokensUsed };
    } catch (error: any) {
      logger.error('Failed to parse summary response', { error, response });
      throw createAppError(
        ErrorType.INTERNAL_ERROR,
        'Failed to parse AI summary response',
      );
    }
  }

  private getSummarizationSystemPrompt(
    summaryType: string,
    language: string,
  ): string {
    const languageName = language === 'vi' ? 'Vietnamese' : 'English';

    const basePrompt =
      `You are an expert video content summarizer. Create summaries in ${languageName}.
Always respond with valid JSON matching this structure:
{
  "summary": "main summary text",
  "key_points": ["point 1", "point 2", ...],
  "topics": ["topic1", "topic2", ...],
  "duration_estimate": <reading time in minutes>
}`;

    const typeSpecific = {
      brief: 'Create a concise 2-3 sentence summary capturing the main idea.',
      detailed:
        'Create a comprehensive summary with context and important details.',
      bullet_points:
        'Focus on creating detailed bullet points for key_points field.',
    };

    return `${basePrompt}\n${
      typeSpecific[summaryType as keyof typeof typeSpecific]
    }`;
  }

  private getSummarizationUserPrompt(
    title: string,
    transcript: string,
    summaryType: string,
  ): string {
    const maxTranscriptLength = summaryType === 'brief' ? 5000 : 10000;
    const truncatedTranscript = transcript.length > maxTranscriptLength
      ? transcript.substring(0, maxTranscriptLength) + '...[truncated]'
      : transcript;

    return `Video Title: "${title}"

Transcript:
${truncatedTranscript}

Create a ${summaryType} summary of this video content.`;
  }

  // ============================================
  // Content Analysis
  // ============================================

  async analyzeContent(
    transcript: string,
    analysisType: 'fact_opinion' | 'sentiment' | 'bias',
    segments?: number[],
  ): Promise<{ analysis: ContentAnalysis; tokensUsed: number }> {
    logger.info('Analyzing content', {
      analysisType,
      segmentCount: segments?.length,
    });

    const systemPrompt = this.getAnalysisSystemPrompt(analysisType);
    const userPrompt = this.getAnalysisUserPrompt(
      transcript,
      analysisType,
      segments,
    );

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const { response, tokensUsed } = await this.makeRequest(messages, {
      temperature: 0.3, // Lower temperature for analytical tasks
      maxTokens: 3000,
      responseFormat: { type: 'json_object' },
    });

    try {
      const parsed = JSON.parse(response);

      // Ensure all required fields are present
      const analysis: ContentAnalysis = {
        facts: parsed.facts || [],
        opinions: parsed.opinions || [],
        sentiment: parsed.sentiment ||
          { overall: 'neutral', positive: 0, negative: 0, neutral: 1 },
        bias_indicators: parsed.bias_indicators,
        confidence_score: parsed.confidence_score || 0.7,
      };

      return { analysis, tokensUsed };
    } catch (error: any) {
      logger.error('Failed to parse analysis response', { error, response });
      throw createAppError(
        ErrorType.INTERNAL_ERROR,
        'Failed to parse AI analysis response',
      );
    }
  }

  private getAnalysisSystemPrompt(analysisType: string): string {
    const basePrompt =
      `You are an expert content analyst specializing in critical thinking and media literacy.
Always respond with valid JSON.`;

    const typeSpecific = {
      fact_opinion: `Identify and separate facts from opinions in the content.
Response structure:
{
  "facts": [{"text": "...", "confidence": 0.9, "source_segments": [1,2], "verifiable": true}],
  "opinions": [{"text": "...", "confidence": 0.8, "source_segments": [3], "sentiment": "positive"}],
  "sentiment": {"overall": "neutral", "positive": 0.3, "negative": 0.2, "neutral": 0.5},
  "confidence_score": 0.85
}`,

      sentiment: `Analyze the overall sentiment and emotional tone.
Response structure:
{
  "facts": [],
  "opinions": [],
  "sentiment": {"overall": "positive|negative|neutral|mixed", "positive": 0.4, "negative": 0.1, "neutral": 0.5},
  "confidence_score": 0.9
}`,

      bias: `Identify potential biases and one-sided arguments.
Response structure:
{
  "facts": [],
  "opinions": [],
  "sentiment": {"overall": "neutral", "positive": 0, "negative": 0, "neutral": 1},
  "bias_indicators": [{"type": "confirmation_bias", "description": "...", "examples": ["..."], "severity": "medium"}],
  "confidence_score": 0.75
}`,
    };

    return `${basePrompt}\n${
      typeSpecific[analysisType as keyof typeof typeSpecific]
    }`;
  }

  private getAnalysisUserPrompt(
    transcript: string,
    analysisType: string,
    segments?: number[],
  ): string {
    const maxLength = 8000;
    let content = transcript;

    // If specific segments requested, extract them
    if (segments && segments.length > 0) {
      // This assumes transcript has segment markers or is an array
      // Adjust based on actual transcript format
      content = `[Analyzing specific segments: ${
        segments.join(', ')
      }]\n${transcript}`;
    }

    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...[truncated]';
    }

    return `Analyze the following content for ${analysisType}:\n\n${content}`;
  }

  // ============================================
  // Counter-Perspective Suggestions
  // ============================================

  async generateCounterPerspectives(
    topic: string,
    currentPerspective: string,
  ): Promise<{ suggestions: string[]; tokensUsed: number }> {
    const messages: OpenAIMessage[] = [
      {
        role: 'system',
        content:
          `You are a critical thinking assistant helping users explore different perspectives.
Suggest 3-5 search queries or topics that would help someone find alternative viewpoints or counter-arguments.
Respond with a JSON array of strings.`,
      },
      {
        role: 'user',
        content:
          `Topic: "${topic}"\nCurrent perspective: "${currentPerspective}"\n\nSuggest searches for alternative viewpoints.`,
      },
    ];

    const { response, tokensUsed } = await this.makeRequest(messages, {
      temperature: 0.8, // Higher temperature for creative suggestions
      maxTokens: 500,
      responseFormat: { type: 'json_object' },
    });

    try {
      const parsed = JSON.parse(response);
      const suggestions = Array.isArray(parsed)
        ? parsed
        : (parsed.suggestions || []);
      return { suggestions, tokensUsed };
    } catch (error: any) {
      logger.error('Failed to parse suggestions', { error, response });
      return { suggestions: [], tokensUsed };
    }
  }

  async findCounterPerspectives(
    videoTitle: string,
    transcript: string,
    mainTopics?: string[],
    originalPerspective?: string,
  ): Promise<{
    counterPerspectives: any[];
    searchKeywords: string[];
    tokensUsed: number;
  }> {
    logger.info('Finding counter-perspectives', {
      videoTitle,
      mainTopicsProvided: !!mainTopics,
      originalPerspectiveProvided: !!originalPerspective,
    });

    // Prepare transcript for analysis
    const maxTranscriptLength = 5000;
    const truncatedTranscript = transcript.length > maxTranscriptLength
      ? transcript.substring(0, maxTranscriptLength) + '...[truncated]'
      : transcript;

    // Create system prompt
    const systemPrompt =
      `You are an expert in critical thinking and media literacy.
Your task is to identify the main perspective in the content and suggest credible counter-perspectives.
Always respond with valid JSON matching this structure:
{
  "main_topics": ["topic1", "topic2", ...],
  "original_perspective": "summary of the main perspective or argument",
  "counter_perspectives": [
    {
      "source": "name of credible source",
      "title": "title of article or content",
      "url": "hypothetical URL",
      "relevance_score": 0.95, // 0-1 scale
      "credibility_score": 0.85, // 0-1 scale
      "reasoning": "why this offers a valuable counter-perspective"
    },
    ...
  ],
  "search_keywords": ["keyword1", "keyword2", ...]
}`;

    // Create user prompt
    let userPrompt = `Video Title: "${videoTitle}"\n\n`;

    if (mainTopics && mainTopics.length > 0) {
      userPrompt += `Main Topics: ${mainTopics.join(', ')}\n\n`;
    }

    if (originalPerspective) {
      userPrompt += `Original Perspective: ${originalPerspective}\n\n`;
    }

    userPrompt += `Transcript:\n${truncatedTranscript}\n\n`;
    userPrompt +=
      `Identify the main perspective in this content and suggest 3-5 credible counter-perspectives.
Focus on academic, journalistic, or expert sources that would offer balanced alternative viewpoints.
If no clear perspective is detected, suggest diverse viewpoints on the main topics.`;

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const { response, tokensUsed } = await this.makeRequest(messages, {
      temperature: 0.7,
      maxTokens: 2000,
      responseFormat: { type: 'json_object' },
    });

    try {
      const parsed = JSON.parse(response);

      // Ensure all required fields are present
      return {
        counterPerspectives: parsed.counter_perspectives || [],
        searchKeywords: parsed.search_keywords || [],
        tokensUsed,
      };
    } catch (error: any) {
      logger.error('Failed to parse counter-perspectives response', {
        error,
        response,
      });
      throw createAppError(
        ErrorType.INTERNAL_ERROR,
        'Failed to parse AI counter-perspectives response',
      );
    }
  }

  // ============================================
  // Cost Estimation
  // ============================================

  estimateCost(tokensUsed: number): number {
    // GPT-4o-mini pricing: $0.15 per 1M input tokens, $0.60 per 1M output tokens
    // Rough estimate assuming 70% input, 30% output
    const inputTokens = tokensUsed * 0.7;
    const outputTokens = tokensUsed * 0.3;

    const inputCost = (inputTokens / 1_000_000) * 0.15;
    const outputCost = (outputTokens / 1_000_000) * 0.60;

    return Math.round((inputCost + outputCost) * 10000) / 10000; // Round to 4 decimal places
  }
}

// Export singleton instance
export const openAIClient = new OpenAIClient();
