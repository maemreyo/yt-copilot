import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { NoteListSchema } from '../../_shared/validators.ts';
import type {
  ErrorResponse,
  NoteListRequest,
  SuccessResponse,
} from '../../_shared/types.ts';

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
async function extractUser(
  request: Request,
): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
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
function parseQueryParams(url: string): NoteListRequest {
  const params = new URL(url).searchParams;

  const request: NoteListRequest = {
    limit: parseInt(params.get('limit') || '20'),
    offset: parseInt(params.get('offset') || '0'),
    filter: {},
    sort_by: 'created_at',
    order: 'desc',
  };

  // Parse filters
  if (params.get('video_id')) {
    request.filter!.video_id = params.get('video_id')!;
  }

  if (params.get('tags')) {
    request.filter!.tags = params.get('tags')!.split(',').map((t) => t.trim());
  }

  if (params.get('search')) {
    request.filter!.search = params.get('search')!;
  }

  if (params.get('is_private') !== null) {
    request.filter!.is_private = params.get('is_private') === 'true';
  }

  // Parse sorting
  const sortBy = params.get('sort_by');
  if (sortBy && ['created_at', 'updated_at', 'timestamp'].includes(sortBy)) {
    request.sort_by = sortBy as any;
  }

  const order = params.get('order');
  if (order && ['asc', 'desc'].includes(order)) {
    request.order = order as any;
  }

  return request;
}

// Build query based on filters
function buildQuery(
  supabase: any,
  userId: string,
  params: NoteListRequest,
) {
  let query = supabase
    .from('video_notes')
    .select(
      `
      *,
      youtube_videos!video_id(
        id,
        title,
        channel_name,
        thumbnail_url,
        duration
      )
    `,
      { count: 'exact' },
    )
    .eq('user_id', userId)
    .is('deleted_at', null);

  // Apply filters
  if (params.filter) {
    if (params.filter.video_id) {
      query = query.eq('video_id', params.filter.video_id);
    }

    if (params.filter.tags && params.filter.tags.length > 0) {
      // PostgreSQL array overlap operator
      query = query.overlaps('tags', params.filter.tags);
    }

    if (params.filter.search) {
      // Full-text search on content
      query = query.textSearch('content', params.filter.search, {
        type: 'websearch',
        config: 'english',
      });
    }

    if (params.filter.is_private !== undefined) {
      query = query.eq('is_private', params.filter.is_private);
    }
  }

  // Apply sorting
  query = query.order(params.sort_by || 'created_at', {
    ascending: params.order === 'asc',
  });

  // Apply pagination
  query = query.range(
    params.offset || 0,
    (params.offset || 0) + (params.limit || 20) - 1,
  );

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

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 405,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
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

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    // Parse and validate query parameters
    const params = parseQueryParams(request.url);
    const validation = NoteListSchema.safeParse(params);

    if (!validation.success) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: validation.error.errors,
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    const validatedParams = validation.data;

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } },
    );

    // Build and execute query
    const query = buildQuery(supabase, user.id, validatedParams);
    const { data: notes, error, count } = await query;

    if (error) {
      console.error('Database error:', error);

      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch notes',
          details: error,
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 500,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    // Get unique tags for the user
    const { data: allTags } = await supabase
      .from('video_notes')
      .select('tags')
      .eq('user_id', user.id)
      .is('deleted_at', null);

    const uniqueTags = new Set<string>();
    if (allTags) {
      allTags.forEach((note) => {
        if (note.tags && Array.isArray(note.tags)) {
          note.tags.forEach((tag: string) => uniqueTags.add(tag));
        }
      });
    }

    // Return success response
    const successResponse: SuccessResponse = {
      success: true,
      data: {
        notes: notes || [],
        total: count || 0,
        has_more:
          (count || 0) > (validatedParams.offset || 0) + (notes?.length || 0),
        available_tags: Array.from(uniqueTags).sort(),
      },
    };

    return new Response(
      JSON.stringify(successResponse),
      {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
  } catch (error: any) {
    console.error('Unexpected error:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
  }
});
