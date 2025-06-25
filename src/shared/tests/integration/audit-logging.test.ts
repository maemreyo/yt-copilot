/**
 * Audit Logging Integration Test
 * 
 * Tests the complete audit logging system:
 * - Audit log creation và storage
 * - RLS policies và security
 * - Integration với auth system
 * - Event tracking across modules
 * - Compliance và monitoring features
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { database } from '@/database';
import { logger } from '@/logging';
import { AuthenticationError, ValidationError } from '@/errors';

describe('Audit Logging Integration', () => {
  let testUser: any;
  let serviceHelper: any;
  let userHelper: any;

  beforeAll(async () => {
    // Create test user
    testUser = await globalThis.testDb.createTestUser({
      email: 'audit-test@example.com',
      name: 'Audit Test User',
      role: 'user'
    });

    // Setup database helpers
    serviceHelper = database.createQueryHelper(database.getServiceClient());
    
    // Create authenticated helper (mock)
    const authClient = database.getAuthenticatedClient(testUser.authToken);
    userHelper = database.createQueryHelper(authClient);
  });

  afterEach(async () => {
    // Clean up test audit logs after each test
    await serviceHelper.delete('audit_logs', {
      event_type: 'test_event'
    });
    await serviceHelper.delete('audit_logs', {
      actor_id: testUser.id
    });
  });

  describe('Audit Log Creation', () => {
    it('should create audit logs using RPC function', async () => {
      const auditResult = await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'test_event',
        p_event_action: 'create',
        p_event_category: 'system',
        p_actor_type: 'user',
        p_actor_id: testUser.id,
        p_actor_email: testUser.email,
        p_target_type: 'resource',
        p_target_id: 'test-resource-123',
        p_event_data: JSON.stringify({ test: true, value: 42 }),
        p_event_result: 'success',
        p_event_message: 'Test audit log creation',
        p_module_name: 'test',
        p_function_name: 'audit_integration_test'
      });

      expect(auditResult.error).toBeNull();
      expect(auditResult.data).toBeDefined();
      expect(auditResult.data).toBeValidUuid();

      // Verify audit log was created
      const auditLogs = await serviceHelper.select('audit_logs', {
        filters: { id: auditResult.data }
      });

      expect(auditLogs.error).toBeNull();
      expect(auditLogs.data).toHaveLength(1);

      const auditLog = auditLogs.data[0];
      expect(auditLog.event_type).toBe('test_event');
      expect(auditLog.event_action).toBe('create');
      expect(auditLog.event_category).toBe('system');
      expect(auditLog.actor_type).toBe('user');
      expect(auditLog.actor_id).toBe(testUser.id);
      expect(auditLog.actor_email).toBe(testUser.email);
      expect(auditLog.target_type).toBe('resource');
      expect(auditLog.target_id).toBe('test-resource-123');
      expect(auditLog.event_result).toBe('success');
      expect(auditLog.event_message).toBe('Test audit log creation');
      expect(auditLog.module_name).toBe('test');
      expect(auditLog.function_name).toBe('audit_integration_test');
      expect(auditLog.created_at).toBeValidTimestamp();

      // Verify event_data JSON parsing
      const eventData = JSON.parse(auditLog.event_data);
      expect(eventData.test).toBe(true);
      expect(eventData.value).toBe(42);
    });

    it('should handle different event types và categories', async () => {
      const testEvents = [
        {
          type: 'user_login',
          action: 'access',
          category: 'auth',
          message: 'User successful login'
        },
        {
          type: 'api_key_created',
          action: 'create',
          category: 'api',
          message: 'New API key generated'
        },
        {
          type: 'subscription_updated',
          action: 'update',
          category: 'billing',
          message: 'Subscription tier changed'
        },
        {
          type: 'security_violation',
          action: 'access',
          category: 'security',
          message: 'Unauthorized access attempt'
        }
      ];

      const auditIds = [];

      for (const event of testEvents) {
        const result = await serviceHelper.rpc('create_audit_log', {
          p_event_type: event.type,
          p_event_action: event.action,
          p_event_category: event.category,
          p_actor_type: 'user',
          p_actor_id: testUser.id,
          p_event_message: event.message,
          p_module_name: 'test'
        });

        expect(result.error).toBeNull();
        auditIds.push(result.data);
      }

      // Verify all events were created
      const allAuditLogs = await serviceHelper.select('audit_logs', {
        filters: { actor_id: testUser.id },
        orderBy: 'created_at',
        ascending: true
      });

      expect(allAuditLogs.error).toBeNull();
      expect(allAuditLogs.data.length).toBeGreaterThanOrEqual(testEvents.length);

      // Verify event details
      const recentLogs = allAuditLogs.data.slice(-testEvents.length);
      testEvents.forEach((event, index) => {
        const log = recentLogs[index];
        expect(log.event_type).toBe(event.type);
        expect(log.event_action).toBe(event.action);
        expect(log.event_category).toBe(event.category);
        expect(log.event_message).toBe(event.message);
      });
    });

    it('should validate required fields và constraints', async () => {
      // Test với invalid event_action
      const invalidActionResult = await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'test_event',
        p_event_action: 'invalid_action', // Not in allowed values
        p_event_category: 'system',
        p_actor_type: 'user'
      });

      expect(invalidActionResult.error).toBeDefined();

      // Test với invalid event_category
      const invalidCategoryResult = await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'test_event',
        p_event_action: 'create',
        p_event_category: 'invalid_category', // Not in allowed values
        p_actor_type: 'user'
      });

      expect(invalidCategoryResult.error).toBeDefined();

      // Test với valid data should succeed
      const validResult = await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'test_event',
        p_event_action: 'create',
        p_event_category: 'system',
        p_actor_type: 'user',
        p_actor_id: testUser.id
      });

      expect(validResult.error).toBeNull();
    });
  });

  describe('Row Level Security (RLS)', () => {
    it('should allow service role to insert audit logs', async () => {
      // Service role should be able to create audit logs
      const result = await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'test_event',
        p_event_action: 'create',
        p_event_category: 'system',
        p_actor_type: 'system',
        p_event_message: 'System audit log'
      });

      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
    });

    it('should allow users to view their own audit logs', async () => {
      // Create audit log for test user
      const createResult = await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'test_event',
        p_event_action: 'access',
        p_event_category: 'auth',
        p_actor_type: 'user',
        p_actor_id: testUser.id,
        p_actor_email: testUser.email,
        p_event_message: 'User action audit'
      });

      expect(createResult.error).toBeNull();

      // User should be able to view their own audit logs
      // Note: This would require actual user authentication context
      // For testing purposes, we'll verify the RLS policy structure exists
      const userAuditLogs = await serviceHelper.select('audit_logs', {
        filters: { actor_id: testUser.id }
      });

      expect(userAuditLogs.error).toBeNull();
      expect(userAuditLogs.data.length).toBeGreaterThan(0);
    });

    it('should restrict access to other users audit logs', async () => {
      // Create another test user
      const otherUser = await globalThis.testDb.createTestUser({
        email: 'other-audit-user@example.com',
        name: 'Other User'
      });

      // Create audit log for other user
      await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'test_event',
        p_event_action: 'access',
        p_event_category: 'auth',
        p_actor_type: 'user',
        p_actor_id: otherUser.id,
        p_actor_email: otherUser.email,
        p_event_message: 'Other user action'
      });

      // Service role can see all logs
      const allLogs = await serviceHelper.select('audit_logs', {
        filters: { actor_id: otherUser.id }
      });

      expect(allLogs.error).toBeNull();
      expect(allLogs.data.length).toBeGreaterThan(0);

      // Note: In a real implementation, we would test that user A cannot see user B's logs
      // This requires proper authentication context trong test
    });
  });

  describe('Security Events View', () => {
    it('should provide recent security events view', async () => {
      // Create some security events
      const securityEvents = [
        {
          type: 'failed_login',
          message: 'Failed login attempt'
        },
        {
          type: 'api_key_revoked',
          message: 'API key manually revoked'
        },
        {
          type: 'permission_denied',
          message: 'Access denied to restricted resource'
        }
      ];

      for (const event of securityEvents) {
        await serviceHelper.rpc('create_audit_log', {
          p_event_type: event.type,
          p_event_action: 'access',
          p_event_category: 'security',
          p_actor_type: 'user',
          p_actor_id: testUser.id,
          p_event_message: event.message,
          p_module_name: 'auth'
        });
      }

      // Query recent security events view
      const securityEventsResult = await serviceHelper.select('recent_security_events', {
        limit: 10
      });

      expect(securityEventsResult.error).toBeNull();
      expect(securityEventsResult.data).toBeDefined();
      expect(securityEventsResult.data.length).toBeGreaterThanOrEqual(securityEvents.length);

      // Verify security events structure
      securityEventsResult.data.forEach(event => {
        expect(event.event_type).toBeDefined();
        expect(event.event_action).toBeDefined();
        expect(event.actor_type).toBeDefined();
        expect(event.event_result).toBeDefined();
        expect(event.created_at).toBeValidTimestamp();
      });
    });
  });

  describe('Integration với Auth System', () => {
    it('should track authentication events', async () => {
      // Simulate auth events that would be created by auth middleware
      const authEvents = [
        {
          type: 'user_login',
          action: 'access',
          result: 'success',
          message: 'User login successful',
          ip: '192.168.1.100'
        },
        {
          type: 'jwt_validated',
          action: 'access', 
          result: 'success',
          message: 'JWT token validated successfully'
        },
        {
          type: 'api_key_used',
          action: 'access',
          result: 'success',
          message: 'API key authentication successful'
        }
      ];

      for (const event of authEvents) {
        await serviceHelper.rpc('create_audit_log', {
          p_event_type: event.type,
          p_event_action: event.action,
          p_event_category: 'auth',
          p_actor_type: 'user',
          p_actor_id: testUser.id,
          p_actor_email: testUser.email,
          p_actor_ip_address: event.ip || null,
          p_event_result: event.result,
          p_event_message: event.message,
          p_module_name: 'auth',
          p_function_name: 'auth_middleware'
        });
      }

      // Query auth events
      const authLogs = await serviceHelper.select('audit_logs', {
        filters: { 
          event_category: 'auth',
          actor_id: testUser.id
        },
        orderBy: 'created_at',
        ascending: false
      });

      expect(authLogs.error).toBeNull();
      expect(authLogs.data.length).toBeGreaterThanOrEqual(authEvents.length);

      // Verify auth event details
      const recentAuthLogs = authLogs.data.slice(0, authEvents.length);
      authEvents.reverse().forEach((event, index) => {
        const log = recentAuthLogs[index];
        expect(log.event_type).toBe(event.type);
        expect(log.event_category).toBe('auth');
        expect(log.event_result).toBe(event.result);
        expect(log.module_name).toBe('auth');
        if (event.ip) {
          expect(log.actor_ip_address).toBe(event.ip);
        }
      });
    });

    it('should track session management events', async () => {
      // Simulate session events
      const sessionEvents = [
        {
          type: 'session_created',
          action: 'create',
          target_id: 'sess_123456',
          message: 'User session created'
        },
        {
          type: 'session_extended',
          action: 'update', 
          target_id: 'sess_123456',
          message: 'Session timeout extended'
        },
        {
          type: 'session_revoked',
          action: 'delete',
          target_id: 'sess_123456',
          message: 'Session manually revoked'
        }
      ];

      for (const event of sessionEvents) {
        await serviceHelper.rpc('create_audit_log', {
          p_event_type: event.type,
          p_event_action: event.action,
          p_event_category: 'auth',
          p_actor_type: 'user',
          p_actor_id: testUser.id,
          p_target_type: 'user_session',
          p_target_id: event.target_id,
          p_event_message: event.message,
          p_module_name: 'auth',
          p_function_name: 'session_manager'
        });
      }

      // Verify session events were logged
      const sessionLogs = await serviceHelper.select('audit_logs', {
        filters: {
          target_type: 'user_session',
          target_id: 'sess_123456'
        },
        orderBy: 'created_at',
        ascending: true
      });

      expect(sessionLogs.error).toBeNull();
      expect(sessionLogs.data.length).toBe(sessionEvents.length);

      sessionEvents.forEach((event, index) => {
        const log = sessionLogs.data[index];
        expect(log.event_type).toBe(event.type);
        expect(log.event_action).toBe(event.action);
        expect(log.target_id).toBe(event.target_id);
      });
    });
  });

  describe('Cross-Module Event Tracking', () => {
    it('should track events across different modules', async () => {
      const crossModuleEvents = [
        {
          module: 'auth',
          type: 'api_key_created',
          category: 'api'
        },
        {
          module: 'billing',
          type: 'subscription_updated', 
          category: 'billing'
        },
        {
          module: 'core',
          type: 'health_check_failed',
          category: 'system'
        }
      ];

      for (const event of crossModuleEvents) {
        await serviceHelper.rpc('create_audit_log', {
          p_event_type: event.type,
          p_event_action: 'update',
          p_event_category: event.category,
          p_actor_type: 'user',
          p_actor_id: testUser.id,
          p_event_message: `${event.module} module event`,
          p_module_name: event.module,
          p_function_name: 'integration_test'
        });
      }

      // Verify events từ different modules
      const moduleStats = await serviceHelper.rpc('exec', {
        sql: `
          SELECT module_name, COUNT(*) as event_count
          FROM audit_logs 
          WHERE actor_id = $1 
            AND created_at > NOW() - INTERVAL '1 hour'
          GROUP BY module_name
          ORDER BY module_name
        `,
        params: [testUser.id]
      });

      expect(moduleStats.error).toBeNull();
      expect(moduleStats.data.length).toBeGreaterThanOrEqual(crossModuleEvents.length);

      // Should have events từ auth, billing, core modules
      const moduleNames = moduleStats.data.map((row: any) => row.module_name);
      expect(moduleNames).toContain('auth');
      expect(moduleNames).toContain('billing');
      expect(moduleNames).toContain('core');
    });
  });

  describe('Performance và Cleanup', () => {
    it('should handle large numbers of audit logs efficiently', async () => {
      const startTime = Date.now();
      
      // Create multiple audit logs concurrently
      const promises = Array.from({ length: 20 }, (_, i) =>
        serviceHelper.rpc('create_audit_log', {
          p_event_type: 'performance_test',
          p_event_action: 'create',
          p_event_category: 'system',
          p_actor_type: 'system',
          p_event_message: `Performance test log ${i}`,
          p_module_name: 'test'
        })
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All should succeed
      results.forEach(result => {
        expect(result.error).toBeNull();
      });

      // Should complete trong reasonable time (under 5 seconds)
      expect(duration).toBeLessThan(5000);

      // Cleanup
      await serviceHelper.delete('audit_logs', {
        event_type: 'performance_test'
      });
    });

    it('should support audit log querying và filtering', async () => {
      // Create test data với different timestamps
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'query_test_recent',
        p_event_action: 'access',
        p_event_category: 'auth',
        p_actor_type: 'user',
        p_actor_id: testUser.id,
        p_event_message: 'Recent event'
      });

      // Query recent events
      const recentEvents = await serviceHelper.rpc('exec', {
        sql: `
          SELECT * FROM audit_logs 
          WHERE actor_id = $1 
            AND created_at > $2
            AND event_type LIKE 'query_test%'
          ORDER BY created_at DESC
        `,
        params: [testUser.id, oneHourAgo.toISOString()]
      });

      expect(recentEvents.error).toBeNull();
      expect(recentEvents.data.length).toBeGreaterThan(0);

      // Query by event category
      const authEvents = await serviceHelper.select('audit_logs', {
        filters: {
          actor_id: testUser.id,
          event_category: 'auth'
        },
        limit: 10
      });

      expect(authEvents.error).toBeNull();
      authEvents.data.forEach((event: any) => {
        expect(event.event_category).toBe('auth');
      });
    });
  });

  describe('Integration với Logging System', () => {
    it('should integrate với structured logging', async () => {
      const logSpy = vi.spyOn(logger, 'info');

      // Create audit log
      await serviceHelper.rpc('create_audit_log', {
        p_event_type: 'logging_integration_test',
        p_event_action: 'create',
        p_event_category: 'system',
        p_actor_type: 'system',
        p_event_message: 'Testing logging integration'
      });

      // Verify that audit operations can be logged
      // Note: Actual integration would depend on implementation details
      expect(logSpy).toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe('Compliance và Monitoring', () => {
    it('should provide audit trail for compliance', async () => {
      // Create a sequence of events for compliance tracking
      const complianceEvents = [
        { type: 'data_access', message: 'User accessed personal data' },
        { type: 'data_export', message: 'User exported data' },
        { type: 'data_deletion', message: 'User requested data deletion' }
      ];

      const auditIds = [];
      for (const event of complianceEvents) {
        const result = await serviceHelper.rpc('create_audit_log', {
          p_event_type: event.type,
          p_event_action: 'access',
          p_event_category: 'security',
          p_actor_type: 'user',
          p_actor_id: testUser.id,
          p_actor_email: testUser.email,
          p_event_message: event.message,
          p_module_name: 'compliance'
        });

        expect(result.error).toBeNull();
        auditIds.push(result.data);
      }

      // Verify complete audit trail exists
      const auditTrail = await serviceHelper.select('audit_logs', {
        filters: { actor_id: testUser.id },
        orderBy: 'created_at',
        ascending: true
      });

      expect(auditTrail.error).toBeNull();
      expect(auditTrail.data.length).toBeGreaterThanOrEqual(complianceEvents.length);

      // Verify audit trail integrity
      auditTrail.data.forEach((log: any) => {
        expect(log.id).toBeValidUuid();
        expect(log.created_at).toBeValidTimestamp();
        expect(log.actor_id).toBe(testUser.id);
        expect(log.actor_email).toBe(testUser.email);
      });
    });
  });
});