/**
 * Migration System Utilities
 * 
 * Provides validation, dependency checking, and management for database migrations.
 * Works with the existing sync-supabase.mjs script to ensure migration integrity.
 * 
 * Uses existing Layer 1 utilities:
 * - Database utilities from @/database
 * - Error handling from @/errors
 * - Logging from @/logging
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logging';
import { database, DatabaseResult } from './database';
import { ApiError, ValidationError, DatabaseError, ErrorCode } from './errors';

/**
 * Migration file interface
 */
export interface MigrationFile {
  id: string;
  module: string;
  filename: string;
  fullPath: string;
  sequence: number;
  dependencies: string[];
  description: string;
  content: string;
  checksum: string;
}

/**
 * Migration execution result
 */
export interface MigrationResult {
  id: string;
  success: boolean;
  error?: string;
  executionTime: number;
  appliedAt: Date;
}

/**
 * Migration status interface
 */
export interface MigrationStatus {
  id: string;
  module: string;
  filename: string;
  status: 'pending' | 'applied' | 'failed' | 'skipped';
  appliedAt?: Date;
  checksum?: string;
  error?: string;
}

/**
 * Migration dependency graph
 */
export interface DependencyGraph {
  nodes: Map<string, MigrationFile>;
  edges: Map<string, string[]>;
  order: string[];
}

/**
 * Migration discovery and parsing utilities
 */
export class MigrationDiscovery {
  private static readonly MIGRATION_PATTERN = /^\d{3}_.*\.sql$/;
  private static readonly DEPENDENCY_PATTERN = /--\s*@depends:\s*(.+)$/gm;
  private static readonly DESCRIPTION_PATTERN = /--\s*@description:\s*(.+)$/m;

  /**
   * Discover all migration files from modules
   */
  static async discoverMigrations(modulesDir: string): Promise<MigrationFile[]> {
    const migrations: MigrationFile[] = [];

    try {
      if (!fs.existsSync(modulesDir)) {
        logger.warn('Modules directory not found', { modulesDir });
        return migrations;
      }

      const modules = fs.readdirSync(modulesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const module of modules) {
        const moduleMigrations = await this.discoverModuleMigrations(modulesDir, module);
        migrations.push(...moduleMigrations);
      }

      logger.info('Migration discovery completed', {
        totalMigrations: migrations.length,
        modules: modules.length
      });

      return migrations;

    } catch (error) {
      logger.error('Migration discovery failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        modulesDir
      });
      throw new ValidationError('Failed to discover migrations', {
        context: { modulesDir, error }
      });
    }
  }

  /**
   * Discover migrations for a specific module
   */
  private static async discoverModuleMigrations(
    modulesDir: string, 
    module: string
  ): Promise<MigrationFile[]> {
    const migrations: MigrationFile[] = [];
    const migrationsDir = path.join(modulesDir, module, 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      logger.debug('No migrations directory found for module', { module });
      return migrations;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(file => this.MIGRATION_PATTERN.test(file))
      .sort(); // Sort by filename to ensure correct order

    for (const filename of files) {
      try {
        const migration = await this.parseMigrationFile(migrationsDir, module, filename);
        migrations.push(migration);
      } catch (error) {
        logger.error('Failed to parse migration file', {
          module,
          filename,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Continue with other migrations even if one fails
      }
    }

    logger.debug('Module migrations discovered', {
      module,
      count: migrations.length
    });

    return migrations;
  }

  /**
   * Parse a single migration file
   */
  private static async parseMigrationFile(
    migrationsDir: string,
    module: string,
    filename: string
  ): Promise<MigrationFile> {
    const fullPath = path.join(migrationsDir, filename);
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    // Extract sequence number from filename
    const sequenceMatch = filename.match(/^(\d{3})/);
    const sequence = sequenceMatch ? parseInt(sequenceMatch[1], 10) : 999;
    
    // Extract dependencies
    const dependencies = this.extractDependencies(content);
    
    // Extract description
    const description = this.extractDescription(content) || filename;
    
    // Generate checksum
    const checksum = this.generateChecksum(content);
    
    // Generate unique ID
    const id = `${module}_${filename.replace('.sql', '')}`;

    return {
      id,
      module,
      filename,
      fullPath,
      sequence,
      dependencies,
      description,
      content,
      checksum
    };
  }

  /**
   * Extract dependencies from migration content
   */
  private static extractDependencies(content: string): string[] {
    const dependencies: string[] = [];
    let match;

    while ((match = this.DEPENDENCY_PATTERN.exec(content)) !== null) {
      const deps = match[1].split(',').map(dep => dep.trim());
      dependencies.push(...deps);
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Extract description from migration content
   */
  private static extractDescription(content: string): string | null {
    const match = content.match(this.DESCRIPTION_PATTERN);
    return match ? match[1].trim() : null;
  }

  /**
   * Generate checksum for migration content
   */
  private static generateChecksum(content: string): string {
    // Simple checksum using hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Migration dependency resolver
 */
export class DependencyResolver {
  /**
   * Build dependency graph from migrations
   */
  static buildDependencyGraph(migrations: MigrationFile[]): DependencyGraph {
    const nodes = new Map<string, MigrationFile>();
    const edges = new Map<string, string[]>();

    // Build nodes map
    for (const migration of migrations) {
      nodes.set(migration.id, migration);
      edges.set(migration.id, migration.dependencies);
    }

    // Calculate execution order
    const order = this.topologicalSort(nodes, edges);

    return { nodes, edges, order };
  }

  /**
   * Topological sort for dependency resolution
   */
  private static topologicalSort(
    nodes: Map<string, MigrationFile>,
    edges: Map<string, string[]>
  ): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (nodeId: string) => {
      if (visiting.has(nodeId)) {
        throw new ValidationError(`Circular dependency detected involving migration: ${nodeId}`);
      }

      if (visited.has(nodeId)) {
        return;
      }

      visiting.add(nodeId);

      const dependencies = edges.get(nodeId) || [];
      for (const depId of dependencies) {
        if (!nodes.has(depId)) {
          logger.warn('Missing dependency', { nodeId, dependency: depId });
          continue;
        }
        visit(depId);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      order.push(nodeId);
    };

    // Sort by module and sequence before processing
    const sortedNodes = Array.from(nodes.values()).sort((a, b) => {
      if (a.module !== b.module) {
        return a.module.localeCompare(b.module);
      }
      return a.sequence - b.sequence;
    });

    for (const node of sortedNodes) {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    }

    return order;
  }

  /**
   * Validate dependencies
   */
  static validateDependencies(graph: DependencyGraph): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const [nodeId, dependencies] of graph.edges) {
      for (const depId of dependencies) {
        if (!graph.nodes.has(depId)) {
          errors.push(new ValidationError(
            `Migration ${nodeId} depends on missing migration ${depId}`,
            { context: { nodeId, dependency: depId } }
          ));
        }
      }
    }

    return errors;
  }
}

/**
 * Migration status tracker
 */
export class MigrationTracker {
  private client = database.getServiceClient();

  /**
   * Initialize migration tracking table
   */
  async initializeTracking(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS public.migration_history (
        id TEXT PRIMARY KEY,
        module TEXT NOT NULL,
        filename TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER,
        success BOOLEAN NOT NULL DEFAULT true,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS migration_history_module_idx ON public.migration_history(module);
      CREATE INDEX IF NOT EXISTS migration_history_applied_at_idx ON public.migration_history(applied_at);
    `;

    const helper = database.createQueryHelper(this.client);
    const result = await helper.rpc('exec', { sql: createTableSQL });

    if (result.error) {
      throw new DatabaseError('Failed to initialize migration tracking', {
        context: { error: result.error }
      });
    }

    logger.info('Migration tracking table initialized');
  }

  /**
   * Get migration status for all migrations
   */
  async getMigrationStatus(migrations: MigrationFile[]): Promise<MigrationStatus[]> {
    const helper = database.createQueryHelper(this.client);
    
    // Get applied migrations
    const appliedResult = await helper.select<any>('migration_history');
    
    if (appliedResult.error) {
      throw new DatabaseError('Failed to get migration history', {
        context: { error: appliedResult.error }
      });
    }

    const appliedMap = new Map<string, any>();
    for (const applied of appliedResult.data || []) {
      appliedMap.set(applied.id, applied);
    }

    // Build status for each migration
    const statuses: MigrationStatus[] = [];
    
    for (const migration of migrations) {
      const applied = appliedMap.get(migration.id);
      
      if (applied) {
        // Check if checksum matches
        if (applied.checksum !== migration.checksum) {
          statuses.push({
            id: migration.id,
            module: migration.module,
            filename: migration.filename,
            status: 'failed',
            appliedAt: new Date(applied.applied_at),
            checksum: applied.checksum,
            error: 'Checksum mismatch - migration content has changed'
          });
        } else {
          statuses.push({
            id: migration.id,
            module: migration.module,
            filename: migration.filename,
            status: applied.success ? 'applied' : 'failed',
            appliedAt: new Date(applied.applied_at),
            checksum: applied.checksum,
            error: applied.error_message
          });
        }
      } else {
        statuses.push({
          id: migration.id,
          module: migration.module,
          filename: migration.filename,
          status: 'pending'
        });
      }
    }

    return statuses;
  }

  /**
   * Record migration execution
   */
  async recordMigration(result: MigrationResult): Promise<void> {
    const helper = database.createQueryHelper(this.client);
    
    const insertResult = await helper.insert('migration_history', {
      id: result.id,
      module: result.id.split('_')[0],
      filename: result.id.substring(result.id.indexOf('_') + 1) + '.sql',
      checksum: 'calculated', // TODO: Pass actual checksum
      applied_at: result.appliedAt.toISOString(),
      execution_time_ms: result.executionTime,
      success: result.success,
      error_message: result.error
    });

    if (insertResult.error) {
      logger.error('Failed to record migration result', {
        migrationId: result.id,
        error: insertResult.error.message
      });
    }
  }
}

/**
 * Main migration manager
 */
export class MigrationManager {
  private tracker = new MigrationTracker();

  /**
   * Validate all migrations in the project
   */
  async validateMigrations(modulesDir: string): Promise<{
    success: boolean;
    migrations: MigrationFile[];
    errors: ValidationError[];
    graph: DependencyGraph;
  }> {
    try {
      logger.info('Starting migration validation', { modulesDir });

      // Initialize tracking
      await this.tracker.initializeTracking();

      // Discover migrations
      const migrations = await MigrationDiscovery.discoverMigrations(modulesDir);

      // Build dependency graph
      const graph = DependencyResolver.buildDependencyGraph(migrations);

      // Validate dependencies
      const errors = DependencyResolver.validateDependencies(graph);

      // Get current status
      const statuses = await this.tracker.getMigrationStatus(migrations);

      // Check for failed migrations
      const failedMigrations = statuses.filter(s => s.status === 'failed');
      for (const failed of failedMigrations) {
        errors.push(new ValidationError(
          `Migration ${failed.id} has failed: ${failed.error}`,
          { context: failed }
        ));
      }

      const success = errors.length === 0;

      logger.info('Migration validation completed', {
        success,
        totalMigrations: migrations.length,
        pendingMigrations: statuses.filter(s => s.status === 'pending').length,
        appliedMigrations: statuses.filter(s => s.status === 'applied').length,
        failedMigrations: statuses.filter(s => s.status === 'failed').length,
        errors: errors.length
      });

      return {
        success,
        migrations,
        errors,
        graph
      };

    } catch (error) {
      logger.error('Migration validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new ValidationError('Migration validation failed', {
        context: { error }
      });
    }
  }

  /**
   * Get migration summary for reporting
   */
  async getMigrationSummary(modulesDir: string): Promise<{
    modules: Record<string, {
      total: number;
      pending: number;
      applied: number;
      failed: number;
    }>;
    overall: {
      total: number;
      pending: number;
      applied: number;
      failed: number;
    };
  }> {
    const { migrations } = await this.validateMigrations(modulesDir);
    const statuses = await this.tracker.getMigrationStatus(migrations);

    const modules: Record<string, any> = {};
    const overall = { total: 0, pending: 0, applied: 0, failed: 0 };

    for (const status of statuses) {
      if (!modules[status.module]) {
        modules[status.module] = { total: 0, pending: 0, applied: 0, failed: 0 };
      }

      modules[status.module].total++;
      modules[status.module][status.status]++;
      
      overall.total++;
      overall[status.status]++;
    }

    return { modules, overall };
  }
}

// Export singleton instance
export const migrationManager = new MigrationManager();

// Export utilities
export const migrationUtils = {
  discovery: MigrationDiscovery,
  resolver: DependencyResolver,
  tracker: MigrationTracker,
  manager: migrationManager,
};