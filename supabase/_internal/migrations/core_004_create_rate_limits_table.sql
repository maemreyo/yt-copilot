/**
 * Rate Limiting Tables
 * 
 * Provides persistent storage for rate limiting across instances.
 * Supports multiple rate limiting strategies and sliding windows.
 */

-- Create rate limits table for persistent rate limiting
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identifier information
  identifier_type TEXT NOT NULL,              -- Type of identifier (ip, user, api_key, global)
  identifier_value TEXT NOT NULL,             -- Actual identifier value
  identifier_hash TEXT,                       -- Hashed version for privacy
  
  -- Rate limit configuration
  resource_type TEXT NOT NULL,                -- Type of resource being limited (api, auth, billing)
  resource_name TEXT NOT NULL,                -- Specific resource name (endpoint, action)
  limit_type TEXT NOT NULL DEFAULT 'sliding_window', -- Type of limit (sliding_window, fixed_window, token_bucket)
  
  -- Rate limit values
  requests_allowed INTEGER NOT NULL,          -- Number of requests allowed
  window_size_seconds INTEGER NOT NULL,       -- Window size in seconds
  current_count INTEGER NOT NULL DEFAULT 0,  -- Current request count
  
  -- Sliding window data
  window_data JSONB DEFAULT '[]',             -- Array of timestamps for sliding window
  
  -- Timestamps
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_end TIMESTAMPTZ NOT NULL,
  first_request_at TIMESTAMPTZ DEFAULT NOW(),
  last_request_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Additional metadata
  metadata JSONB DEFAULT '{}',
  
  -- Constraints
  CONSTRAINT rate_limits_identifier_type_check CHECK (identifier_type IN ('ip', 'user', 'api_key', 'global', 'session')),
  CONSTRAINT rate_limits_limit_type_check CHECK (limit_type IN ('sliding_window', 'fixed_window', 'token_bucket')),
  CONSTRAINT rate_limits_requests_allowed_check CHECK (requests_allowed > 0),
  CONSTRAINT rate_limits_window_size_check CHECK (window_size_seconds > 0),
  CONSTRAINT rate_limits_current_count_check CHECK (current_count >= 0)
);

-- Create unique index for identifier + resource combination
CREATE UNIQUE INDEX rate_limits_identifier_resource_idx 
  ON public.rate_limits(identifier_type, identifier_value, resource_type, resource_name);

-- Create indexes for efficient querying
CREATE INDEX rate_limits_identifier_type_idx ON public.rate_limits(identifier_type);
CREATE INDEX rate_limits_identifier_value_idx ON public.rate_limits(identifier_value);
CREATE INDEX rate_limits_resource_type_idx ON public.rate_limits(resource_type);
CREATE INDEX rate_limits_window_end_idx ON public.rate_limits(window_end);
CREATE INDEX rate_limits_last_request_idx ON public.rate_limits(last_request_at);

-- Composite indexes for common queries
CREATE INDEX rate_limits_active_windows_idx ON public.rate_limits(resource_type, window_end DESC)
  WHERE window_end > NOW();

-- Enable Row Level Security
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rate limits
-- Service role can manage all rate limits
CREATE POLICY "Service role can manage rate limits"
  ON public.rate_limits
  FOR ALL
  USING (true);

-- Users can view their own rate limits
CREATE POLICY "Users can view their own rate limits"
  ON public.rate_limits
  FOR SELECT
  USING (
    (identifier_type = 'user' AND identifier_value = auth.uid()::text)
    OR (identifier_type = 'api_key' AND identifier_value IN (
      SELECT key_prefix FROM public.api_keys WHERE user_id = auth.uid()
    ))
  );

-- Function to check and update rate limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_identifier_type TEXT,
  p_identifier_value TEXT,
  p_resource_type TEXT,
  p_resource_name TEXT,
  p_requests_allowed INTEGER DEFAULT 60,
  p_window_size_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_time TIMESTAMPTZ := NOW();
  window_start_time TIMESTAMPTZ;
  rate_limit_record RECORD;
  new_window_data JSONB;
  is_allowed BOOLEAN := true;
  remaining_requests INTEGER;
  reset_time TIMESTAMPTZ;
BEGIN
  -- Calculate window start time
  window_start_time := current_time - (p_window_size_seconds || ' seconds')::INTERVAL;
  
  -- Try to get existing rate limit record
  SELECT * INTO rate_limit_record
  FROM public.rate_limits
  WHERE identifier_type = p_identifier_type
    AND identifier_value = p_identifier_value
    AND resource_type = p_resource_type
    AND resource_name = p_resource_name;
  
  IF FOUND THEN
    -- Update existing record
    -- Filter out old requests from sliding window
    SELECT jsonb_agg(request_time)
    INTO new_window_data
    FROM (
      SELECT value as request_time
      FROM jsonb_array_elements_text(rate_limit_record.window_data)
      WHERE value::TIMESTAMPTZ > window_start_time
    ) AS recent_requests;
    
    -- Add current request
    new_window_data := COALESCE(new_window_data, '[]'::jsonb) || to_jsonb(current_time::text);
    
    -- Check if limit exceeded
    IF jsonb_array_length(new_window_data) > p_requests_allowed THEN
      is_allowed := false;
    END IF;
    
    -- Update the record
    UPDATE public.rate_limits
    SET 
      window_data = new_window_data,
      current_count = jsonb_array_length(new_window_data),
      window_start = window_start_time,
      window_end = current_time + (p_window_size_seconds || ' seconds')::INTERVAL,
      last_request_at = current_time,
      updated_at = current_time
    WHERE id = rate_limit_record.id;
    
    remaining_requests := GREATEST(0, p_requests_allowed - jsonb_array_length(new_window_data));
    reset_time := current_time + (p_window_size_seconds || ' seconds')::INTERVAL;
    
  ELSE
    -- Create new rate limit record
    INSERT INTO public.rate_limits (
      identifier_type,
      identifier_value,
      resource_type,
      resource_name,
      requests_allowed,
      window_size_seconds,
      current_count,
      window_data,
      window_start,
      window_end,
      first_request_at,
      last_request_at
    ) VALUES (
      p_identifier_type,
      p_identifier_value,
      p_resource_type,
      p_resource_name,
      p_requests_allowed,
      p_window_size_seconds,
      1,
      to_jsonb(ARRAY[current_time::text]),
      window_start_time,
      current_time + (p_window_size_seconds || ' seconds')::INTERVAL,
      current_time,
      current_time
    );
    
    remaining_requests := p_requests_allowed - 1;
    reset_time := current_time + (p_window_size_seconds || ' seconds')::INTERVAL;
  END IF;
  
  -- Return result
  RETURN jsonb_build_object(
    'allowed', is_allowed,
    'remaining', remaining_requests,
    'reset_time', reset_time,
    'window_size_seconds', p_window_size_seconds,
    'limit', p_requests_allowed
  );
END;
$$;

-- Function to reset rate limit for an identifier
CREATE OR REPLACE FUNCTION public.reset_rate_limit(
  p_identifier_type TEXT,
  p_identifier_value TEXT,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_name TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.rate_limits
  WHERE identifier_type = p_identifier_type
    AND identifier_value = p_identifier_value
    AND (p_resource_type IS NULL OR resource_type = p_resource_type)
    AND (p_resource_name IS NULL OR resource_name = p_resource_name);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log the reset action
  PERFORM public.create_audit_log(
    'rate_limit_reset',
    'delete',
    'system',
    'admin',
    NULL,
    NULL,
    NULL,
    'rate_limit',
    p_identifier_type || ':' || p_identifier_value,
    jsonb_build_object(
      'identifier_type', p_identifier_type,
      'identifier_value', p_identifier_value,
      'resource_type', p_resource_type,
      'resource_name', p_resource_name,
      'deleted_count', deleted_count
    ),
    NULL,
    'success',
    'Rate limit reset for ' || p_identifier_type || ':' || p_identifier_value
  );
  
  RETURN deleted_count;
END;
$$;

-- Function to clean up expired rate limit records
CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.rate_limits
  WHERE window_end < NOW() - INTERVAL '1 hour'; -- Keep records for 1 hour after expiry for analysis
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log cleanup action
  PERFORM public.create_audit_log(
    'rate_limit_cleanup',
    'delete',
    'system',
    'system',
    NULL,
    NULL,
    NULL,
    'rate_limit',
    'expired_records',
    jsonb_build_object('deleted_count', deleted_count),
    NULL,
    'success',
    'Cleaned up ' || deleted_count || ' expired rate limit records'
  );
  
  RETURN deleted_count;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.check_rate_limit TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_rate_limit TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits TO service_role;

-- Create view for rate limit statistics
CREATE OR REPLACE VIEW public.rate_limit_stats AS
SELECT 
  resource_type,
  resource_name,
  identifier_type,
  COUNT(*) as active_limits,
  AVG(current_count) as avg_usage,
  MAX(current_count) as max_usage,
  COUNT(CASE WHEN current_count >= requests_allowed THEN 1 END) as limits_exceeded
FROM public.rate_limits
WHERE window_end > NOW()
GROUP BY resource_type, resource_name, identifier_type
ORDER BY resource_type, resource_name, identifier_type;

-- Grant access to the view
GRANT SELECT ON public.rate_limit_stats TO authenticated;

-- Create trigger for updated_at on rate_limits table
CREATE TRIGGER rate_limits_updated_at
  BEFORE UPDATE ON public.rate_limits
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();