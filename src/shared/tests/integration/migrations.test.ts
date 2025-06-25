/**
 * Migration System Integration Test
 * 
 * Tests the complete migration foundation:
 * - Migration discovery từ modules
 * - Dependency resolution và topological sorting
 * - Migration validation và tracking
 * - Integration với database utilities
 * - Error handling for migration conflicts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { 
  migrationManager,
  MigrationDiscovery,
  DependencyResolver,
  MigrationTracker
} from '@/migrations';
import { database } from '@/database';
import { logger } from '@/logging';
import { ValidationError, DatabaseError } from '@/errors';

describe('Migration System Integration', () => {
  const testModulesDir = path.join(process.cwd(), 'src', 'modules');

  beforeAll(async () => {
    // Initialize migration tracking
    const tracker = new MigrationTracker();
    await tracker.initializeTracking();
  });

  describe('Migration Discovery', () => {
    it('should discover migrations from all modules', async () => {
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      
      expect(migrations).toBeDefined();
      expect(Array.isArray(migrations)).toBe(true);
      expect(migrations.length).toBeGreaterThan(0);

      // Should find migrations from core and auth modules at minimum
      const moduleNames = [...new Set(migrations.map(m => m.module))];
      expect(moduleNames).toContain('auth');
      expect(moduleNames).toContain('core');

      // Each migration should have required properties
      migrations.forEach(migration => {
        expect(migration.id).toBeDefined();
        expect(migration.module).toBeDefined();
        expect(migration.filename).toBeDefined();
        expect(migration.fullPath).toBeDefined();
        expect(migration.sequence).toBeTypeOf('number');
        expect(migration.content).toBeDefined();
        expect(migration.checksum).toBeDefined();
      });
    });

    it('should properly parse migration metadata', async () => {
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      
      // Find a specific migration we know exists
      const profilesMigration = migrations.find(m => 
        m.filename.includes('create_profiles_table')
      );

      if (profilesMigration) {
        expect(profilesMigration.module).toBe('auth');
        expect(profilesMigration.sequence).toBe(1);
        expect(profilesMigration.content).toContain('CREATE TABLE');
        expect(profilesMigration.content).toContain('profiles');
        expect(profilesMigration.checksum).toMatch(/^[a-f0-9]+$/);
      }

      // Find audit logs migration
      const auditMigration = migrations.find(m => 
        m.filename.includes('create_audit_logs_table')
      );

      if (auditMigration) {
        expect(auditMigration.module).toBe('core');
        expect(auditMigration.content).toContain('audit_logs');
        expect(auditMigration.content).toContain('CREATE TABLE');
      }
    });

    it('should handle missing migrations directory gracefully', async () => {
      const nonExistentDir = path.join(testModulesDir, 'non-existent');
      const migrations = await MigrationDiscovery.discoverMigrations(nonExistentDir);
      
      expect(migrations).toEqual([]);
    });
  });

  describe('Dependency Resolution', () => {
    it('should build dependency graph correctly', async () => {
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      const graph = DependencyResolver.buildDependencyGraph(migrations);
      
      expect(graph.nodes).toBeInstanceOf(Map);
      expect(graph.edges).toBeInstanceOf(Map);
      expect(graph.order).toBeInstanceOf(Array);

      // Should have all migrations in the graph
      expect(graph.nodes.size).toBe(migrations.length);
      expect(graph.order.length).toBe(migrations.length);

      // Order should respect dependencies
      const orderMap = new Map();
      graph.order.forEach((id, index) => {
        orderMap.set(id, index);
      });

      // Check that dependencies come before dependents
      for (const [nodeId, dependencies] of graph.edges) {
        const nodeIndex = orderMap.get(nodeId);
        
        for (const depId of dependencies) {
          if (orderMap.has(depId)) {
            const depIndex = orderMap.get(depId);
            expect(depIndex).toBeLessThan(nodeIndex);
          }
        }
      }
    });

    it('should validate dependencies correctly', async () => {
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      const graph = DependencyResolver.buildDependencyGraph(migrations);
      const errors = DependencyResolver.validateDependencies(graph);
      
      // Should not have validation errors với current migrations
      expect(errors).toBeInstanceOf(Array);
      expect(errors.length).toBe(0);
    });

    it('should detect circular dependencies', () => {
      // Create mock migrations với circular dependency
      const mockMigrations = [
        {
          id: 'a_001',
          module: 'a',
          filename: '001_test.sql',
          fullPath: '/fake/path',
          sequence: 1,
          dependencies: ['b_001'],
          description: 'Test A',
          content: 'CREATE TABLE a;',
          checksum: 'abc123'
        },
        {
          id: 'b_001',
          module: 'b', 
          filename: '001_test.sql',
          fullPath: '/fake/path',
          sequence: 1,
          dependencies: ['a_001'],
          description: 'Test B',
          content: 'CREATE TABLE b;',
          checksum: 'def456'
        }
      ];

      expect(() => {
        DependencyResolver.buildDependencyGraph(mockMigrations);
      }).toThrow(ValidationError);
    });
  });

  describe('Migration Validation', () => {
    it('should validate all migrations successfully', async () => {
      const result = await migrationManager.validateMigrations(testModulesDir);
      
      expect(result.success).toBe(true);
      expect(result.migrations).toBeDefined();
      expect(result.migrations.length).toBeGreaterThan(0);
      expect(result.errors).toBeInstanceOf(Array);
      expect(result.errors.length).toBe(0);
      expect(result.graph).toBeDefined();

      // Graph should be properly constructed
      expect(result.graph.nodes.size).toBe(result.migrations.length);
      expect(result.graph.order.length).toBe(result.migrations.length);
    });

    it('should provide migration summary', async () => {
      const summary = await migrationManager.getMigrationSummary(testModulesDir);
      
      expect(summary.modules).toBeDefined();
      expect(summary.overall).toBeDefined();

      // Overall summary should have correct structure
      expect(summary.overall.total).toBeGreaterThan(0);
      expect(summary.overall.pending).toBeTypeOf('number');
      expect(summary.overall.applied).toBeTypeOf('number');
      expect(summary.overall.failed).toBeTypeOf('number');

      // Module summaries should exist
      expect(Object.keys(summary.modules).length).toBeGreaterThan(0);
      
      for (const [moduleName, moduleStats] of Object.entries(summary.modules)) {
        expect(moduleStats.total).toBeGreaterThanOrEqual(0);
        expect(moduleStats.pending).toBeGreaterThanOrEqual(0);
        expect(moduleStats.applied).toBeGreaterThanOrEqual(0);
        expect(moduleStats.failed).toBeGreaterThanOrEqual(0);
        
        // Total should equal sum of states
        expect(moduleStats.total).toBe(
          moduleStats.pending + moduleStats.applied + moduleStats.failed
        );
      }
    });
  });

  describe('Migration Tracking Integration', () => {
    it('should track migration history correctly', async () => {
      const tracker = new MigrationTracker();
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      
      // Get migration status
      const statuses = await tracker.getMigrationStatus(migrations);
      
      expect(statuses).toBeInstanceOf(Array);
      expect(statuses.length).toBe(migrations.length);

      statuses.forEach(status => {
        expect(status.id).toBeDefined();
        expect(status.module).toBeDefined();
        expect(status.filename).toBeDefined();
        expect(['pending', 'applied', 'failed', 'skipped']).toContain(status.status);
      });
    });

    it('should record migration results', async () => {
      const tracker = new MigrationTracker();
      const testMigrationId = `test_${Date.now()}`;
      
      const result = {
        id: testMigrationId,
        success: true,
        executionTime: 150,
        appliedAt: new Date()
      };

      // Record migration (should not throw)
      await expect(tracker.recordMigration(result)).resolves.toBeUndefined();

      // Note: In a full implementation, we would verify the record was stored
      // For now, we're testing that the function executes without error
    });
  });

  describe('Integration với Database Layer', () => {
    it('should use database utilities correctly', async () => {
      const helper = database.createQueryHelper(database.getServiceClient());
      
      // Test that migration system can use database utilities
      expect(helper).toBeDefined();
      
      // Verify migration history table exists
      const tableCheck = await helper.select('migration_history', { limit: 1 });
      
      // Should either return data or empty result, not an error
      expect(tableCheck.error).toBeNull();
      expect(tableCheck.data).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      const tracker = new MigrationTracker();
      
      // Test with invalid migration data should handle errors properly
      const invalidResult = {
        id: '', // Invalid empty ID
        success: true,
        executionTime: -1, // Invalid negative time
        appliedAt: new Date()
      };

      // Should handle error gracefully (may log warning but shouldn't throw)
      await expect(tracker.recordMigration(invalidResult)).resolves.toBeUndefined();
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle missing module directory', async () => {
      await expect(
        MigrationDiscovery.discoverMigrations('/nonexistent/path')
      ).resolves.toEqual([]);
    });

    it('should handle invalid migration files', async () => {
      // This would be tested với actual invalid files in a real scenario
      // For now, we test the error handling structure
      const tracker = new MigrationTracker();
      
      expect(() => {
        // Mock invalid migration data
        DependencyResolver.buildDependencyGraph([]);
      }).not.toThrow();
    });

    it('should integrate với error logging', async () => {
      const logSpy = vi.spyOn(logger, 'info');
      
      await migrationManager.validateMigrations(testModulesDir);
      
      // Verify that migration operations are logged
      expect(logSpy).toHaveBeenCalled();
      
      logSpy.mockRestore();
    });
  });

  describe('Performance và Monitoring', () => {
    it('should complete migration discovery in reasonable time', async () => {
      const startTime = Date.now();
      
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      
      const duration = Date.now() - startTime;
      
      // Discovery should complete quickly (under 5 seconds)
      expect(duration).toBeLessThan(5000);
      expect(migrations).toBeDefined();
    });

    it('should handle concurrent migration operations', async () => {
      // Test multiple operations running concurrently
      const promises = [
        MigrationDiscovery.discoverMigrations(testModulesDir),
        migrationManager.getMigrationSummary(testModulesDir),
        migrationManager.validateMigrations(testModulesDir)
      ];

      const results = await Promise.all(promises);
      
      // All operations should complete successfully
      results.forEach(result => {
        expect(result).toBeDefined();
      });

      // Results should be consistent
      const [migrations, summary, validation] = results;
      expect(validation.migrations.length).toBe(migrations.length);
      expect(summary.overall.total).toBe(migrations.length);
    });
  });

  describe('Real Migration Files Validation', () => {
    it('should validate auth module migrations', async () => {
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      const authMigrations = migrations.filter(m => m.module === 'auth');
      
      expect(authMigrations.length).toBeGreaterThan(0);

      // Should have profiles table migration
      const profilesMigration = authMigrations.find(m => 
        m.filename.includes('profiles_table')
      );
      expect(profilesMigration).toBeDefined();
      expect(profilesMigration?.content).toContain('CREATE TABLE');
      expect(profilesMigration?.content).toContain('profiles');

      // Should have api_keys table migration
      const apiKeysMigration = authMigrations.find(m => 
        m.filename.includes('api_keys_table')
      );
      expect(apiKeysMigration).toBeDefined();
      expect(apiKeysMigration?.content).toContain('api_keys');

      // Should have sessions table migration
      const sessionsMigration = authMigrations.find(m => 
        m.filename.includes('sessions_table')
      );
      expect(sessionsMigration).toBeDefined();
      expect(sessionsMigration?.content).toContain('user_sessions');
    });

    it('should validate core module migrations', async () => {
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      const coreMigrations = migrations.filter(m => m.module === 'core');
      
      expect(coreMigrations.length).toBeGreaterThan(0);

      // Should have audit logs migration
      const auditMigration = coreMigrations.find(m => 
        m.filename.includes('audit_logs')
      );
      expect(auditMigration).toBeDefined();
      expect(auditMigration?.content).toContain('audit_logs');

      // Should have rate limits migration
      const rateLimitMigration = coreMigrations.find(m => 
        m.filename.includes('rate_limits')
      );
      expect(rateLimitMigration).toBeDefined();
      expect(rateLimitMigration?.content).toContain('rate_limits');
    });

    it('should have proper migration sequencing', async () => {
      const migrations = await MigrationDiscovery.discoverMigrations(testModulesDir);
      
      // Group by module
      const moduleGroups = migrations.reduce((acc, migration) => {
        if (!acc[migration.module]) {
          acc[migration.module] = [];
        }
        acc[migration.module].push(migration);
        return acc;
      }, {} as Record<string, typeof migrations>);

      // Each module should have proper sequencing
      Object.values(moduleGroups).forEach(moduleMigrations => {
        const sortedBySequence = [...moduleMigrations].sort((a, b) => a.sequence - b.sequence);
        
        // Sequences should be continuous từ 1
        sortedBySequence.forEach((migration, index) => {
          expect(migration.sequence).toBe(index + 1);
        });
      });
    });
  });
});