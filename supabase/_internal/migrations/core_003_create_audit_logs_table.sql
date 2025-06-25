/**
 * Audit Logs Table
 * 
 * Tracks all important system events for security, compliance, and debugging.
 * Used by all modules to log significant actions.
 */

-- Create audit logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Event information
  event_type TEXT NOT NULL,                    -- Type of event (user_login, api_key_created, etc.)
  event_action TEXT NOT NULL,                  -- Action performed (create, update, delete, access)
  event_category TEXT NOT NULL DEFAULT 'system', -- Category (auth, billing, api, system, security)
  
  -- Actor information (who performed the action)
  actor_type TEXT NOT NULL,                    -- Type of actor (user, api_key, system, admin)
  actor_id TEXT,                              -- ID of the actor (user_id, api_key_id, etc.)
  actor_email TEXT,                           -- Email if available
  actor_ip_address INET,                      -- IP address of the actor
  actor_user_agent TEXT,                      -- User agent string
  
  -- Target information (what was acted upon)
  target_type TEXT,                           -- Type of target (profile, api_key, subscription, etc.)
  target_id TEXT,                             -- ID of the target
  target_metadata JSONB,                      -- Additional target information
  
  -- Event details
  event_data JSONB,                           -- Detailed event data
  event_result TEXT DEFAULT 'success',        -- Result (success, failure, error)
  event_message TEXT,                         -- Human-readable event description
  
  -- Context information
  request_id TEXT,                            -- Request ID for tracing
  session_id TEXT,                            -- Session ID if available
  module_name TEXT,                           -- Module that generated the event
  function_name TEXT,                         -- Function that generated the event
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT audit_logs_event_type_check CHECK (event_type ~ '^[a-z_]+$'),
  CONSTRAINT audit_logs_event_action_check CHECK (event_action IN ('create', 'read', 'update', 'delete', 'access', 'login', 'logout', 'revoke', 'activate', 'deactivate')),
  CONSTRAINT audit_logs_event_category_check CHECK (event_category IN ('auth', 'billing', 'api', 'system', 'security', 'admin')),
  CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('user', 'api_key', 'system', 'admin', 'webhook')),
  CONSTRAINT audit_logs_event_result_check CHECK (event_result IN ('success', 'failure', 'error', 'warning'))
);

-- Create indexes for efficient querying
CREATE INDEX audit_logs_event_type_idx ON public.audit_logs(event_type);
CREATE INDEX audit_logs_event_category_idx ON public.audit_logs(event_category);
CREATE INDEX audit_logs_actor_id_idx ON public.audit_logs(actor_id);
CREATE INDEX audit_logs_actor_email_idx ON public.audit_logs(actor_email);
CREATE INDEX audit_logs_target_type_idx ON public.audit_logs(target_type);
CREATE INDEX audit_logs_target_id_idx ON public.audit_logs(target_id);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs(created_at DESC);
CREATE INDEX audit_logs_event_result_idx ON public.audit_logs(event_result);

-- Composite indexes for common queries
CREATE INDEX audit_logs_actor_events_idx ON public.audit_logs(actor_id, event_type, created_at DESC);
CREATE INDEX audit_logs_target_events_idx ON public.audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX audit_logs_security_events_idx ON public.audit_logs(event_category, event_result, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for audit logs
-- Only admins and system can insert audit logs
CREATE POLICY "System can insert audit logs"
  ON public.audit_logs
  FOR INSERT
  WITH CHECK (true); -- Allow all inserts from service role

-- Users can view their own audit logs
CREATE POLICY "Users can view their own audit logs"
  ON public.audit_logs
  FOR SELECT
  USING (
    actor_id = auth.uid()::text 
    OR actor_email = auth.email()
    OR (target_type = 'user' AND target_id = auth.uid()::text)
  );

-- Admins can view all audit logs
CREATE POLICY "Admins can view all audit logs"
  ON public.audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Function to automatically add audit log entries
CREATE OR REPLACE FUNCTION public.create_audit_log(
  p_event_type TEXT,
  p_event_action TEXT,
  p_event_category TEXT DEFAULT 'system',
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id TEXT DEFAULT NULL,
  p_actor_email TEXT DEFAULT NULL,
  p_actor_ip_address INET DEFAULT NULL,
  p_target_type TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL,
  p_target_metadata JSONB DEFAULT NULL,
  p_event_data JSONB DEFAULT NULL,
  p_event_result TEXT DEFAULT 'success',
  p_event_message TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL,
  p_module_name TEXT DEFAULT NULL,
  p_function_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  audit_log_id UUID;
BEGIN
  INSERT INTO public.audit_logs (
    event_type,
    event_action,
    event_category,
    actor_type,
    actor_id,
    actor_email,
    actor_ip_address,
    target_type,
    target_id,
    target_metadata,
    event_data,
    event_result,
    event_message,
    request_id,
    session_id,
    module_name,
    function_name
  ) VALUES (
    p_event_type,
    p_event_action,
    p_event_category,
    p_actor_type,
    p_actor_id,
    p_actor_email,
    p_actor_ip_address,
    p_target_type,
    p_target_id,
    p_target_metadata,
    p_event_data,
    p_event_result,
    p_event_message,
    p_request_id,
    p_session_id,
    p_module_name,
    p_function_name
  ) RETURNING id INTO audit_log_id;
  
  RETURN audit_log_id;
END;
$$;

-- Grant execute permission on the audit log function
GRANT EXECUTE ON FUNCTION public.create_audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_audit_log TO service_role;

-- Create view for recent security events
CREATE OR REPLACE VIEW public.recent_security_events AS
SELECT 
  id,
  event_type,
  event_action,
  actor_type,
  actor_id,
  actor_email,
  actor_ip_address,
  target_type,
  target_id,
  event_result,
  event_message,
  created_at
FROM public.audit_logs
WHERE 
  event_category = 'security'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 100;

-- Grant access to the view
GRANT SELECT ON public.recent_security_events TO authenticated;

---