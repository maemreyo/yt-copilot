import { denoEnv } from '@/shared-deno-env';
import { createClient } from '@supabase/supabase-js';
import { serve } from 'std/http/server.ts';
import type { ErrorResponse, SessionListRequest, SuccessResponse } from '../../_shared/types.ts';
import { SessionListSchema } from '../../_shared/validators.ts';

// Response headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
};

const securityHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

// Extract user from JWT
async function extractUser(request: Request): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const supabase = createClient(
      denoEnv.get('SUPABASE_URL') || '',
      denoEnv.get('SUPABASE_ANON_KEY') || ''
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email || '',
    };
  } catch (error: any) {
    console.error('Auth error:', error);
    return null;
  }
}

// Parse query parameters
function parseQueryParams(url: string): SessionListRequest {
  const params = new URL(url).searchParams;

  const request: SessionListRequest = {
    limit: parseInt(params.get('limit') || '20'),
    offset: parseInt(params.get('offset') || '0'),
    filter: {},
    sort_by: 'started_at',
    order: 'desc',
  };

  // Parse filters
  if (params.get('video_id')) {
    request.filter!.video_id = params.get('video_id')!;
  }

  if (params.get('session_type')) {
    request.filter!.session_type = params.get('session_type')!;
  }

  if (params.get('date_from')) {
    request.filter!.date_from = params.get('date_from')!;
  }

  if (params.get('date_to')) {
    request.filter!.date_to = params.get('date_to')!;
  }

  // Parse sorting
  const sortBy = params.get('sort_by');
  if (sortBy && ['started_at', 'duration_seconds', 'words_learned'].includes(sortBy)) {
    request.sort_by = sortBy as any;
  }

  const order = params.get('order');
  if (order && ['asc', 'desc'].includes(order)) {
    request.order = order as any;
  }

  return request;
}

// Build query based on filters
function buildQuery(supabase: any, userId: string, params: SessionListRequest) {
  let query = supabase
    .from('learning_sessions')
    .select('*, youtube_videos!video_id(title, channel_name)', {
      count: 'exact',
    })
    .eq('user_id', userId);

  // Apply filters
  if (params.filter) {
    if (params.filter.video_id) {
      query = query.eq('video_id', params.filter.video_id);
    }

    if (params.filter.session_type) {
      query = query.eq('session_type', params.filter.session_type);
    }

    if (params.filter.date_from) {
      query = query.gte('started_at', params.filter.date_from);
    }

    if (params.filter.date_to) {
      query = query.lte('started_at', params.filter.date_to);
    }
  }

  // Apply sorting
  query = query.order(params.sort_by || 'started_at', {
    ascending: params.order === 'asc',
  });

  // Apply pagination
  query = query.range(params.offset || 0, (params.offset || 0) + (params.limit || 20) - 1);

  return query;
}

serve(async (request: Request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow GET
  if (request.method !== 'GET') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET method is allowed',
      },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 405,
      headers: { ...corsHeaders, ...securityHeaders },
    });
  }

  try {
    // Authenticate user
    const user = await extractUser(request);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing authentication token',
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 401,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    // Parse and validate query parameters
    const params = parseQueryParams(request.url);
    const validation = SessionListSchema.safeParse(params);

    if (!validation.success) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: validation.error.errors,
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    const validatedParams = validation.data;

    // Initialize Supabase client
    const supabase = createClient(
      denoEnv.get('SUPABASE_URL') || '',
      denoEnv.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } }
    );

    // Build and execute query
    const query = buildQuery(supabase, user.id, validatedParams);
    const { data: sessions, error, count } = await query;

    if (error) {
      console.error('Database error:', error);

      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch sessions',
          details: error,
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    // Calculate summary statistics
    const { data: stats } = await supabase
      .from('learning_sessions')
      .select('count(*), sum(duration_seconds), sum(words_learned), sum(notes_taken)')
      .eq('user_id', user.id)
      .single();

    // Calculate learning streak
    const { data: streakData } = await supabase.rpc('calculate_learning_streak', {
      p_user_id: user.id,
    });

    // Return success response
    const successResponse: SuccessResponse = {
      success: true,
      data: {
        sessions: sessions || [],
        total: count || 0,
        has_more: (count || 0) > (validatedParams.offset || 0) + (sessions?.length || 0),
        summary: {
          total_sessions: stats?.count || 0,
          total_duration_seconds: stats?.sum_duration_seconds || 0,
          total_words_learned: stats?.sum_words_learned || 0,
          total_notes_taken: stats?.sum_notes_taken || 0,
          learning_streak: streakData || 0,
        },
      },
    };

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: { ...corsHeaders, ...securityHeaders },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, ...securityHeaders },
    });
  }
});
