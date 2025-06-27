import type {
  ContentAnalysis,
  Definition,
  VideoSummaryContent,
} from './types.ts';

/**
 * AI service provider integrations
 * Compatible with Deno/Edge Functions runtime
 */

// ============================================
// Translation Providers
// ============================================

export async function translateWithGoogle(
  text: string,
  sourceLang: string | undefined,
  targetLang: string,
): Promise<{
  translatedText: string;
  detectedSourceLang?: string;
  provider: string;
}> {
  const apiKey = Deno.env.get('GOOGLE_TRANSLATE_API_KEY');
  if (!apiKey) {
    throw new Error('Google Translate API key not configured');
  }

  const params = new URLSearchParams({
    q: text,
    target: targetLang,
    key: apiKey,
  });

  if (sourceLang && sourceLang !== 'auto') {
    params.append('source', sourceLang);
  }

  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?${params}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Google Translate error: ${error.error?.message || response.statusText}`,
    );
  }

  const data = await response.json();
  const translation = data.data.translations[0];

  return {
    translatedText: translation.translatedText,
    detectedSourceLang: translation.detectedSourceLanguage,
    provider: 'google',
  };
}

export async function translateWithLibre(
  text: string,
  sourceLang: string | undefined,
  targetLang: string,
): Promise<{
  translatedText: string;
  detectedSourceLang?: string;
  provider: string;
}> {
  const baseUrl = Deno.env.get('LIBRETRANSLATE_URL') || 'http://localhost:5000';
  const apiKey = Deno.env.get('LIBRETRANSLATE_API_KEY');

  const body: any = {
    q: text,
    target: targetLang,
    format: 'text',
  };

  if (sourceLang && sourceLang !== 'auto') {
    body.source = sourceLang;
  } else {
    body.source = 'auto';
  }

  if (apiKey) {
    body.api_key = apiKey;
  }

  const response = await fetch(`${baseUrl}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `LibreTranslate error: ${error.error || response.statusText}`,
    );
  }

  const data = await response.json();

  return {
    translatedText: data.translatedText,
    detectedSourceLang: data.detectedLanguage?.language,
    provider: 'libretranslate',
  };
}

// ============================================
// WordsAPI Integration (Optional)
// ============================================

export async function getWordDefinitions(
  word: string,
): Promise<Definition[] | undefined> {
  const apiKey = Deno.env.get('WORDSAPI_KEY');
  if (!apiKey) {
    return undefined;
  }

  try {
    const response = await fetch(
      `https://wordsapiv1.p.rapidapi.com/words/${encodeURIComponent(word)}`,
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'wordsapiv1.p.rapidapi.com',
        },
      },
    );

    if (!response.ok) {
      console.log('WordsAPI request failed:', response.status);
      return undefined;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return undefined;
    }

    return data.results.slice(0, 5).map((result: any) => ({
      partOfSpeech: result.partOfSpeech || 'unknown',
      definition: result.definition,
      example: result.examples?.[0],
      synonyms: result.synonyms?.slice(0, 5),
    }));
  } catch (error: any) {
    console.error('WordsAPI error:', error);
    return undefined;
  }
}

export async function getWordPronunciation(
  word: string,
): Promise<string | undefined> {
  const apiKey = Deno.env.get('WORDSAPI_KEY');
  if (!apiKey) {
    return undefined;
  }

  try {
    const response = await fetch(
      `https://wordsapiv1.p.rapidapi.com/words/${
        encodeURIComponent(word)
      }/pronunciation`,
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'wordsapiv1.p.rapidapi.com',
        },
      },
    );

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    return data.pronunciation?.all || data.pronunciation;
  } catch (error: any) {
    console.error('WordsAPI pronunciation error:', error);
    return undefined;
  }
}

// ============================================
// OpenAI Integration
// ============================================

export async function callOpenAI(
  messages: Array<{ role: string; content: string }>,
  options: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    responseFormat?: { type: 'json_object' };
  } = {},
): Promise<{ response: string; tokensUsed: number }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const model = options.model || Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
  const maxTokens = options.maxTokens ||
    parseInt(Deno.env.get('OPENAI_MAX_TOKENS') || '2000');
  const temperature = options.temperature ||
    parseFloat(Deno.env.get('OPENAI_TEMPERATURE') || '0.7');

  const body: any = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `OpenAI API error: ${error.error?.message || response.statusText}`,
    );
  }

  const data = await response.json();

  return {
    response: data.choices[0].message.content,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

// ============================================
// Summarization
// ============================================

export async function summarizeWithOpenAI(
  title: string,
  transcript: string,
  summaryType: 'brief' | 'detailed' | 'bullet_points',
  language: string = 'en',
): Promise<{ summary: VideoSummaryContent; tokensUsed: number }> {
  const languageName = language === 'vi' ? 'Vietnamese' : 'English';

  const systemPrompt =
    `You are an expert video content summarizer. Create summaries in ${languageName}.
Always respond with valid JSON matching this structure:
{
  "summary": "main summary text",
  "key_points": ["point 1", "point 2", ...],
  "topics": ["topic1", "topic2", ...],
  "duration_estimate": <reading time in minutes>
}

${
      summaryType === 'brief'
        ? 'Create a concise 2-3 sentence summary capturing the main idea.'
        : ''
    }
${
      summaryType === 'detailed'
        ? 'Create a comprehensive summary with context and important details.'
        : ''
    }
${
      summaryType === 'bullet_points'
        ? 'Focus on creating detailed bullet points for key_points field.'
        : ''
    }`;

  const maxLength = summaryType === 'brief' ? 5000 : 10000;
  const truncatedTranscript = transcript.length > maxLength
    ? transcript.substring(0, maxLength) + '...[truncated]'
    : transcript;

  const userPrompt = `Video Title: "${title}"

Transcript:
${truncatedTranscript}

Create a ${summaryType} summary of this video content.`;

  const { response, tokensUsed } = await callOpenAI(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.5,
      maxTokens: summaryType === 'brief' ? 500 : 2000,
      responseFormat: { type: 'json_object' },
    },
  );

  try {
    const parsed = JSON.parse(response);

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
    console.error('Failed to parse summary response:', error);
    throw new Error('Failed to parse AI summary response');
  }
}

// ============================================
// Content Analysis
// ============================================

export async function analyzeContentWithOpenAI(
  transcript: string,
  analysisType: 'fact_opinion' | 'sentiment' | 'bias',
  segments?: number[],
): Promise<{ analysis: ContentAnalysis; tokensUsed: number }> {
  const systemPrompts = {
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

  const systemPrompt =
    `You are an expert content analyst specializing in critical thinking and media literacy.
Always respond with valid JSON.
${systemPrompts[analysisType]}`;

  const maxLength = 8000;
  let content = transcript;

  if (segments && segments.length > 0) {
    content = `[Analyzing specific segments: ${
      segments.join(', ')
    }]\n${transcript}`;
  }

  if (content.length > maxLength) {
    content = content.substring(0, maxLength) + '...[truncated]';
  }

  const { response, tokensUsed } = await callOpenAI(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          `Analyze the following content for ${analysisType}:\n\n${content}`,
      },
    ],
    {
      temperature: 0.3,
      maxTokens: 3000,
      responseFormat: { type: 'json_object' },
    },
  );

  try {
    const parsed = JSON.parse(response);

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
    console.error('Failed to parse analysis response:', error);
    throw new Error('Failed to parse AI analysis response');
  }
}
