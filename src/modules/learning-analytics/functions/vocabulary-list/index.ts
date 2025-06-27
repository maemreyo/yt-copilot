import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { VocabularyListSchema, validateRequest } from '_shared/validators.ts';
import { isDueForReview } from '_shared/spaced-repetition.ts';
import type { 
  VocabularyListRequest, 
  VocabularyListResponse,
  SuccessResponse, 
  ErrorResponse 
} from '_shared/types.ts';

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
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || ''
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email || ''
    };
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

// Build query based on filters
function buildQuery(
  supabase: any,
  userId: string,
  params: VocabularyListRequest
) {
  let query = supabase
    .from('vocabulary_entries')
    .select('*', { count: 'exact' })
    .eq('user_id', userId);

  // Apply filters
  if (params.filter) {
    if (params.filter.difficulty) {
      query = query.eq('difficulty', params.filter.difficulty);
    }
    
    if (params.filter.video_id) {
      query = query.eq('video_id', params.filter.video_id);
    }
    
    if (params.filter.search) {
      // Search in word, definition, and context
      const searchTerm = `%${params.filter.search}%`;
      query = query.or(
        `word.ilike.${searchTerm},definition.ilike.${searchTerm},context.ilike.${searchTerm}`
      );
    }
    
    // Note: due_for_review filter will be applied after fetching
  }

  // Apply sorting
  const sortBy = params.sort_by || 'learned_at';
  const order = params.order || 'desc';
  query = query.order(sortBy, { ascending: order === 'asc' });

  // Apply pagination
  query = query.range(
    params.offset,
    params.offset + params.limit - 1
  );

  return query;
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  if (req.method !== 'GET') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET method allowed'
      }
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 405, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );
  }

  try {
    // Authenticate user
    const user = await extractUser(req);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 401, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Parse query parameters
    const url = new URL(req.url);
    const queryParams: any = {};
    
    // Extract pagination
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');
    if (limit) queryParams.limit = parseInt(limit);
    if (offset) queryParams.offset = parseInt(offset);
    
    // Extract sorting
    const sortBy = url.searchParams.get('sort_by');
    const order = url.searchParams.get('order');
    if (sortBy) queryParams.sort_by = sortBy;
    if (order) queryParams.order = order;
    
    // Extract filters
    const difficulty = url.searchParams.get('difficulty');
    const videoId = url.searchParams.get('video_id');
    const search = url.searchParams.get('search');
    const dueForReview = url.searchParams.get('due_for_review');
    
    if (difficulty || videoId || search || dueForReview) {
      queryParams.filter = {};
      if (difficulty) queryParams.filter.difficulty = difficulty;
      if (videoId) queryParams.filter.video_id = videoId;
      if (search) queryParams.filter.search = search;
      if (dueForReview) queryParams.filter.due_for_review = dueForReview === 'true';
    }

    // Validate parameters
    const validation = validateRequest(VocabularyListSchema, queryParams);

    if (!validation.isValid) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: validation.errors?.errors
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 400, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    const params = validation.data as VocabularyListRequest;

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Build and execute query
    const query = buildQuery(supabase, user.id, params);
    const { data: entries, count, error } = await query;

    if (error) {
      console.error('Database error:', error);
      
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch vocabulary entries',
          details: error
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 500, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Filter for due items if requested
    let filteredEntries = entries || [];
    if (params.filter?.due_for_review) {
      filteredEntries = filteredEntries.filter(entry => 
        entry.next_review_at && isDueForReview(entry.next_review_at)
      );
    }

    // Prepare response
    const response: VocabularyListResponse = {
      entries: filteredEntries,
      total: count || 0,
      has_more: (params.offset + params.limit) < (count || 0)
    };

    const successResponse: SuccessResponse<VocabularyListResponse> = {
      success: true,
      data: response
    };

    return new Response(
      JSON.stringify(successResponse),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          ...securityHeaders,
          'X-Total-Count': count?.toString() || '0'
        } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 500, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );
  }
});