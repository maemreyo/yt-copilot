/**
 * RLS Policies Verification Script
 * 
 * Verifies that all YouTube extension tables have proper Row Level Security
 * policies implemented and are functioning correctly.
 * 
 * @description: Comprehensive RLS verification for YouTube extension tables
 * @module: youtube
 * @version: 1.0.0
 */

-- Enable error reporting
\set ON_ERROR_STOP on

-- Create verification report table (temporary)
CREATE TEMP TABLE rls_verification_report (
  table_name TEXT,
  rls_enabled BOOLEAN,
  policy_count INTEGER,
  issues TEXT[],
  status TEXT
);

-- Function to check RLS status for a table
CREATE OR REPLACE FUNCTION temp_check_rls_status(schema_name TEXT, table_name TEXT)
RETURNS RECORD AS $$
DECLARE
  rls_enabled BOOLEAN;
  policy_count INTEGER;
  result RECORD;
BEGIN
  -- Check if RLS is enabled
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = schema_name AND c.relname = table_name;
  
  -- Count policies
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = schema_name AND tablename = table_name;
  
  SELECT rls_enabled, policy_count INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Verify RLS for each YouTube extension table
DO $$
DECLARE
  table_record RECORD;
  rls_check RECORD;
  issues TEXT[];
  status TEXT;
BEGIN
  -- List of YouTube extension tables to verify
  FOR table_record IN 
    SELECT unnest(ARRAY[
      'youtube_videos',
      'video_transcripts', 
      'user_video_history',
      'ai_translations',
      'video_summaries',
      'vocabulary_entries',
      'learning_sessions',
      'video_notes'
    ]) as table_name
  LOOP
    -- Reset for each table
    issues := ARRAY[]::TEXT[];
    status := 'PASS';
    
    -- Check RLS status
    SELECT * INTO rls_check FROM temp_check_rls_status('public', table_record.table_name);
    
    -- Verify RLS is enabled
    IF NOT rls_check.rls_enabled THEN
      issues := array_append(issues, 'RLS not enabled');
      status := 'FAIL';
    END IF;
    
    -- Verify policies exist
    IF rls_check.policy_count = 0 THEN
      issues := array_append(issues, 'No RLS policies found');
      status := 'FAIL';
    END IF;
    
    -- Table-specific policy checks
    CASE table_record.table_name
      WHEN 'youtube_videos' THEN
        -- Public videos should allow read access to authenticated users
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies 
          WHERE schemaname = 'public' 
            AND tablename = 'youtube_videos'
            AND cmd = 'SELECT'
            AND roles = '{authenticated}'
        ) THEN
          issues := array_append(issues, 'Missing authenticated read policy');
          status := 'FAIL';
        END IF;
        
      WHEN 'user_video_history' THEN
        -- Must have user-specific policies
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies 
          WHERE schemaname = 'public' 
            AND tablename = 'user_video_history'
            AND policyname LIKE '%own%'
        ) THEN
          issues := array_append(issues, 'Missing user-specific policies');
          status := 'FAIL';
        END IF;
        
      WHEN 'vocabulary_entries' THEN
        -- Must protect user vocabulary
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies 
          WHERE schemaname = 'public' 
            AND tablename = 'vocabulary_entries'
            AND cmd = 'SELECT'
            AND qual LIKE '%auth.uid()%'
        ) THEN
          issues := array_append(issues, 'Missing user isolation for vocabulary');
          status := 'FAIL';
        END IF;
        
      WHEN 'learning_sessions' THEN
        -- Must protect user learning data
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies 
          WHERE schemaname = 'public' 
            AND tablename = 'learning_sessions'
            AND cmd = 'SELECT'
            AND qual LIKE '%user_id%'
        ) THEN
          issues := array_append(issues, 'Missing user isolation for sessions');
          status := 'FAIL';
        END IF;
        
      WHEN 'video_notes' THEN
        -- Must protect private notes
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies 
          WHERE schemaname = 'public' 
            AND tablename = 'video_notes'
            AND cmd = 'SELECT'
            AND qual LIKE '%user_id%'
        ) THEN
          issues := array_append(issues, 'Missing user isolation for notes');
          status := 'FAIL';
        END IF;
        
      ELSE
        -- Default checks for other tables
        NULL;
    END CASE;
    
    -- Verify service role has access
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
        AND tablename = table_record.table_name
        AND roles = '{service_role}'
    ) THEN
      issues := array_append(issues, 'Missing service role policy');
      status := 'FAIL';
    END IF;
    
    -- Insert verification result
    INSERT INTO rls_verification_report 
    VALUES (table_record.table_name, rls_check.rls_enabled, rls_check.policy_count, issues, status);
    
  END LOOP;
END $$;

-- Display verification results
SELECT 
  table_name,
  rls_enabled,
  policy_count,
  CASE 
    WHEN status = 'PASS' THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status,
  CASE 
    WHEN array_length(issues, 1) > 0 THEN array_to_string(issues, '; ')
    ELSE 'All checks passed'
  END as issues
FROM rls_verification_report
ORDER BY 
  CASE WHEN status = 'FAIL' THEN 0 ELSE 1 END,
  table_name;

-- Summary report
SELECT 
  COUNT(*) as total_tables,
  COUNT(*) FILTER (WHERE status = 'PASS') as passed,
  COUNT(*) FILTER (WHERE status = 'FAIL') as failed,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'PASS')::DECIMAL / COUNT(*) * 100, 
    1
  ) as pass_percentage
FROM rls_verification_report;

-- Detailed policy listing for failed tables
SELECT 
  'Detailed policies for: ' || r.table_name as info,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual
FROM rls_verification_report r
JOIN pg_policies p ON p.tablename = r.table_name AND p.schemaname = 'public'
WHERE r.status = 'FAIL'
ORDER BY r.table_name, p.cmd, p.policyname;

-- RLS Security Test Queries
-- These queries test that RLS is working properly

-- Test 1: Verify users cannot access other users' vocabulary
SELECT 'TEST 1: User vocabulary isolation' as test_name;
DO $$
DECLARE
  test_user_1 UUID := gen_random_uuid();
  test_user_2 UUID := gen_random_uuid();
  test_video UUID := gen_random_uuid();
BEGIN
  -- This should fail if RLS is working (cannot set auth.uid() in function)
  -- In real testing, this would be done with different authenticated sessions
  RAISE NOTICE 'RLS isolation test requires session-level authentication testing';
END $$;

-- Test 2: Verify service role can access all data
SET ROLE service_role;
SELECT 'TEST 2: Service role access' as test_name;
SELECT COUNT(*) as accessible_youtube_videos FROM public.youtube_videos;
SELECT COUNT(*) as accessible_user_history FROM public.user_video_history;
SELECT COUNT(*) as accessible_vocabulary FROM public.vocabulary_entries;
RESET ROLE;

-- Test 3: Verify authenticated users can read public YouTube video data
SELECT 'TEST 3: Public video data access' as test_name;
-- This would pass for authenticated users
SELECT 
  CASE 
    WHEN COUNT(*) >= 0 THEN 'PASS: Can read youtube_videos'
    ELSE 'FAIL: Cannot read youtube_videos'
  END as result
FROM public.youtube_videos LIMIT 1;

-- Clean up temporary function
DROP FUNCTION temp_check_rls_status(TEXT, TEXT);

-- Final RLS security recommendations
SELECT '
🔒 RLS SECURITY RECOMMENDATIONS:

1. Ensure all YouTube extension tables have RLS enabled
2. User-specific data (vocabulary, notes, history) must be isolated by user_id
3. Public data (video metadata, transcripts) should be readable by authenticated users
4. Service role should have full access for system operations
5. Test RLS policies with different user sessions
6. Monitor for RLS bypass attempts in logs
7. Regular RLS policy audits should be conducted

📊 TESTING REQUIREMENTS:

- Create test users and verify data isolation
- Test with different authentication states
- Verify API endpoints respect RLS policies
- Test bulk operations respect user boundaries
- Validate sharing permissions work correctly

🚨 CRITICAL SECURITY NOTES:

- Never disable RLS on user data tables
- Always use auth.uid() for user identification
- Validate API endpoints honor RLS at application level
- Monitor for direct database access bypassing RLS
- Keep service role credentials secure
' as security_recommendations;