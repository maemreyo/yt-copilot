/**
 * Core Database Utilities
 * 
 * Provides connection management, query helpers, transaction wrappers,
 * and error handling for all database operations across modules.
 * 
 * Uses existing Layer 1 utilities:
 * - Error handling from @/errors
 * - Logging from @/logging
 * - Auth utilities from @/auth for client creation
 * - Environment config from @/environment
 */

import { createClient, SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { env, environment } from '../config/environment';
import { logger } from './logging';
import { 
  ApiError, 
  DatabaseError, 
  ValidationError,
  ErrorCode,
  ErrorContext 
} from './errors';

/**
 * Database operation result interface
 */
export interface DatabaseResult<T = any> {
  data: T | null;
  error: DatabaseError | null;
  count?: number;
  status?: number;
}

/**
 * Query options interface
 */
export interface QueryOptions {
  select?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  ascending?: boolean;
  filters?: Record<string, any>;
  timeout?: number;
}

/**
 * Transaction context interface
 */
export interface TransactionContext {
  client: SupabaseClient;
  operationId: string;
  startTime: number;
}

/**
 * Database connection configuration
 */
export interface DatabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  maxConnections: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

/**
 * Connection pool manager
 */
class ConnectionPool {
  private static instances: Map<string, SupabaseClient> = new Map();
  private static config: DatabaseConfig;

  static initialize(config?: Partial<DatabaseConfig>) {
    this.config = {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      maxConnections: env.DATABASE_MAX_CONNECTIONS,
      timeout: env.DATABASE_TIMEOUT,
      retryAttempts: env.API_RETRY_ATTEMPTS,
      retryDelay: 1000,
      ...config
    };

    logger.info('Database connection pool initialized', {
      url: this.config.url,
      maxConnections: this.config.maxConnections,
      timeout: this.config.timeout
    });
  }

  /**
   * Get anonymous client (for public operations)
   */
  static getAnonClient(): SupabaseClient {
    const key = 'anon';
    
    if (!this.instances.has(key)) {
      const client = createClient(this.config.url, this.config.anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        global: {
          headers: {
            'X-Client-Type': 'database-utility',
            'X-Operation-Timeout': this.config.timeout.toString()
          }
        }
      });

      this.instances.set(key, client);
      logger.debug('Created new anonymous database client');
    }

    return this.instances.get(key)!;
  }

  /**
   * Get service role client (for admin operations)
   */
  static getServiceClient(): SupabaseClient {
    const key = 'service';
    
    if (!this.instances.has(key)) {
      const client = createClient(this.config.url, this.config.serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        global: {
          headers: {
            'X-Client-Type': 'database-utility-service',
            'X-Operation-Timeout': this.config.timeout.toString()
          }
        }
      });

      this.instances.set(key, client);
      logger.debug('Created new service role database client');
    }

    return this.instances.get(key)!;
  }

  /**
   * Get authenticated client for specific user
   */
  static getAuthenticatedClient(token: string): SupabaseClient {
    // Don't cache authenticated clients for security
    const client = createClient(this.config.url, this.config.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Client-Type': 'database-utility-auth',
          'X-Operation-Timeout': this.config.timeout.toString()
        }
      }
    });

    return client;
  }

  /**
   * Health check for database connection
   */
  static async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const client = this.getAnonClient();
      
      // Simple query to test connection
      const { error } = await client
        .from('profiles')
        .select('id')
        .limit(1)
        .single();

      const latency = Date.now() - startTime;

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned, which is ok
        throw new Error(error.message);
      }

      return {
        status: 'healthy',
        latency
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Close all connections (for testing)
   */
  static closeAll(): void {
    this.instances.clear();
    logger.debug('All database connections closed');
  }
}

/**
 * Query helper class with error handling and logging
 */
export class QueryHelper {
  private client: SupabaseClient;
  private context: ErrorContext;

  constructor(client: SupabaseClient, context: ErrorContext = {}) {
    this.client = client;
    this.context = context;
  }

  /**
   * Execute a select query with comprehensive error handling
   */
  async select<T = any>(
    table: string, 
    options: QueryOptions = {}
  ): Promise<DatabaseResult<T[]>> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      logger.debug('Database select operation started', {
        operationId,
        table,
        options: this.sanitizeOptions(options)
      });

      let query = this.client.from(table);

      // Apply select columns
      if (options.select) {
        query = query.select(options.select);
      } else {
        query = query.select('*');
      }

      // Apply filters
      if (options.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
          if (Array.isArray(value)) {
            query = query.in(key, value);
          } else if (value !== null && value !== undefined) {
            query = query.eq(key, value);
          }
        }
      }

      // Apply ordering
      if (options.orderBy) {
        query = query.order(options.orderBy, { 
          ascending: options.ascending ?? true 
        });
      }

      // Apply pagination
      if (options.limit || options.offset) {
        const limit = options.limit || 50;
        const offset = options.offset || 0;
        query = query.range(offset, offset + limit - 1);
      }

      const { data, error, count } = await query;

      const duration = Date.now() - startTime;

      if (error) {
        const dbError = this.createDatabaseError(error, operationId, 'SELECT');
        logger.error('Database select operation failed', {
          operationId,
          table,
          error: error.message,
          duration
        });
        return { data: null, error: dbError };
      }

      logger.debug('Database select operation completed', {
        operationId,
        table,
        rowCount: data?.length || 0,
        duration
      });

      return { 
        data: data as T[], 
        error: null, 
        count: count || data?.length || 0 
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const dbError = this.createDatabaseError(error, operationId, 'SELECT');
      
      logger.error('Database select operation error', {
        operationId,
        table,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      return { data: null, error: dbError };
    }
  }

  /**
   * Execute an insert operation
   */
  async insert<T = any>(
    table: string, 
    data: Record<string, any> | Record<string, any>[],
    options: { select?: string; upsert?: boolean } = {}
  ): Promise<DatabaseResult<T>> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      logger.debug('Database insert operation started', {
        operationId,
        table,
        recordCount: Array.isArray(data) ? data.length : 1
      });

      let query = this.client.from(table);

      if (options.upsert) {
        query = query.upsert(data);
      } else {
        query = query.insert(data);
      }

      if (options.select) {
        query = query.select(options.select);
      }

      const { data: result, error } = await query;

      const duration = Date.now() - startTime;

      if (error) {
        const dbError = this.createDatabaseError(error, operationId, 'INSERT');
        logger.error('Database insert operation failed', {
          operationId,
          table,
          error: error.message,
          duration
        });
        return { data: null, error: dbError };
      }

      logger.debug('Database insert operation completed', {
        operationId,
        table,
        duration
      });

      return { data: result as T, error: null };

    } catch (error) {
      const duration = Date.now() - startTime;
      const dbError = this.createDatabaseError(error, operationId, 'INSERT');
      
      logger.error('Database insert operation error', {
        operationId,
        table,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      return { data: null, error: dbError };
    }
  }

  /**
   * Execute an update operation
   */
  async update<T = any>(
    table: string,
    data: Record<string, any>,
    filters: Record<string, any>,
    options: { select?: string } = {}
  ): Promise<DatabaseResult<T>> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      logger.debug('Database update operation started', {
        operationId,
        table,
        filters: this.sanitizeOptions({ filters }).filters
      });

      let query = this.client.from(table).update(data);

      // Apply filters
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value);
      }

      if (options.select) {
        query = query.select(options.select);
      }

      const { data: result, error } = await query;

      const duration = Date.now() - startTime;

      if (error) {
        const dbError = this.createDatabaseError(error, operationId, 'UPDATE');
        logger.error('Database update operation failed', {
          operationId,
          table,
          error: error.message,
          duration
        });
        return { data: null, error: dbError };
      }

      logger.debug('Database update operation completed', {
        operationId,
        table,
        duration
      });

      return { data: result as T, error: null };

    } catch (error) {
      const duration = Date.now() - startTime;
      const dbError = this.createDatabaseError(error, operationId, 'UPDATE');
      
      logger.error('Database update operation error', {
        operationId,
        table,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      return { data: null, error: dbError };
    }
  }

  /**
   * Execute a delete operation
   */
  async delete<T = any>(
    table: string,
    filters: Record<string, any>,
    options: { select?: string } = {}
  ): Promise<DatabaseResult<T>> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      logger.debug('Database delete operation started', {
        operationId,
        table,
        filters: this.sanitizeOptions({ filters }).filters
      });

      let query = this.client.from(table).delete();

      // Apply filters
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value);
      }

      if (options.select) {
        query = query.select(options.select);
      }

      const { data: result, error } = await query;

      const duration = Date.now() - startTime;

      if (error) {
        const dbError = this.createDatabaseError(error, operationId, 'DELETE');
        logger.error('Database delete operation failed', {
          operationId,
          table,
          error: error.message,
          duration
        });
        return { data: null, error: dbError };
      }

      logger.debug('Database delete operation completed', {
        operationId,
        table,
        duration
      });

      return { data: result as T, error: null };

    } catch (error) {
      const duration = Date.now() - startTime;
      const dbError = this.createDatabaseError(error, operationId, 'DELETE');
      
      logger.error('Database delete operation error', {
        operationId,
        table,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      return { data: null, error: dbError };
    }
  }

  /**
   * Execute RPC (stored procedure) call
   */
  async rpc<T = any>(
    functionName: string,
    params: Record<string, any> = {}
  ): Promise<DatabaseResult<T>> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      logger.debug('Database RPC operation started', {
        operationId,
        functionName,
        paramCount: Object.keys(params).length
      });

      const { data, error } = await this.client.rpc(functionName, params);

      const duration = Date.now() - startTime;

      if (error) {
        const dbError = this.createDatabaseError(error, operationId, 'RPC');
        logger.error('Database RPC operation failed', {
          operationId,
          functionName,
          error: error.message,
          duration
        });
        return { data: null, error: dbError };
      }

      logger.debug('Database RPC operation completed', {
        operationId,
        functionName,
        duration
      });

      return { data: data as T, error: null };

    } catch (error) {
      const duration = Date.now() - startTime;
      const dbError = this.createDatabaseError(error, operationId, 'RPC');
      
      logger.error('Database RPC operation error', {
        operationId,
        functionName,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      return { data: null, error: dbError };
    }
  }

  /**
   * Generate unique operation ID for tracking
   */
  private generateOperationId(): string {
    return `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create standardized database error
   */
  private createDatabaseError(
    error: any, 
    operationId: string, 
    operation: string
  ): DatabaseError {
    const code = this.mapErrorCode(error);
    const message = error?.message || 'Database operation failed';
    
    return new DatabaseError(message, {
      code,
      context: {
        ...this.context,
        operationId,
        operation,
        originalError: error
      }
    });
  }

  /**
   * Map database errors to standardized error codes
   */
  private mapErrorCode(error: any): ErrorCode {
    if (!error) return ErrorCode.DATABASE_ERROR;

    // PostgreSQL error codes
    const pgCode = error.code;
    if (pgCode) {
      switch (pgCode) {
        case '23505': return ErrorCode.VALIDATION_ERROR; // unique_violation
        case '23503': return ErrorCode.VALIDATION_ERROR; // foreign_key_violation
        case '23502': return ErrorCode.VALIDATION_ERROR; // not_null_violation
        case '42501': return ErrorCode.UNAUTHORIZED; // insufficient_privilege
        case '42P01': return ErrorCode.DATABASE_ERROR; // undefined_table
        case '08006': return ErrorCode.DATABASE_ERROR; // connection_failure
        default: return ErrorCode.DATABASE_ERROR;
      }
    }

    // Supabase PostgREST error codes
    const restCode = error.details || error.hint;
    if (restCode && restCode.includes('permission')) {
      return ErrorCode.FORBIDDEN;
    }

    return ErrorCode.DATABASE_ERROR;
  }

  /**
   * Sanitize options for logging (remove sensitive data)
   */
  private sanitizeOptions(options: any): any {
    const sanitized = { ...options };
    
    // Remove potentially sensitive filter values
    if (sanitized.filters) {
      sanitized.filters = Object.keys(sanitized.filters).reduce((acc, key) => {
        acc[key] = key.toLowerCase().includes('password') ? '[REDACTED]' : sanitized.filters[key];
        return acc;
      }, {} as Record<string, any>);
    }

    return sanitized;
  }
}

/**
 * Transaction manager for handling database transactions
 */
export class TransactionManager {
  private static readonly MAX_RETRY_ATTEMPTS = 3;
  private static readonly RETRY_DELAY_MS = 1000;

  /**
   * Execute operations within a transaction context
   */
  static async withTransaction<T>(
    operations: (context: TransactionContext) => Promise<T>,
    client?: SupabaseClient
  ): Promise<T> {
    const transactionClient = client || ConnectionPool.getServiceClient();
    const operationId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    const context: TransactionContext = {
      client: transactionClient,
      operationId,
      startTime
    };

    logger.debug('Transaction started', { operationId });

    try {
      // Execute operations
      const result = await operations(context);

      const duration = Date.now() - startTime;
      logger.debug('Transaction completed successfully', {
        operationId,
        duration
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Transaction failed', {
        operationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      throw error;
    }
  }

  /**
   * Execute operation with retry logic
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    attempts: number = TransactionManager.MAX_RETRY_ATTEMPTS
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt === attempts) {
          break;
        }

        // Only retry on specific errors
        if (this.shouldRetry(error)) {
          logger.warn(`Database operation failed, retrying (${attempt}/${attempts})`, {
            error: lastError.message,
            nextRetryDelay: TransactionManager.RETRY_DELAY_MS * attempt
          });

          await this.delay(TransactionManager.RETRY_DELAY_MS * attempt);
        } else {
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if error should trigger a retry
   */
  private static shouldRetry(error: any): boolean {
    if (!error) return false;

    const message = error.message?.toLowerCase() || '';
    const code = error.code;

    // Retry on connection issues
    if (message.includes('connection') || message.includes('timeout')) {
      return true;
    }

    // Retry on specific PostgreSQL errors
    if (code === '40001' || code === '40P01') { // serialization_failure, deadlock_detected
      return true;
    }

    return false;
  }

  /**
   * Delay utility for retry logic
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Database utilities factory and main interface
 */
export const database = {
  // Initialize the connection pool
  init: (config?: Partial<DatabaseConfig>) => {
    ConnectionPool.initialize(config);
  },

  // Connection management
  getAnonClient: () => ConnectionPool.getAnonClient(),
  getServiceClient: () => ConnectionPool.getServiceClient(),
  getAuthenticatedClient: (token: string) => ConnectionPool.getAuthenticatedClient(token),

  // Query helpers
  createQueryHelper: (client: SupabaseClient, context?: ErrorContext) => 
    new QueryHelper(client, context),

  // Transaction management
  withTransaction: TransactionManager.withTransaction,
  withRetry: TransactionManager.withRetry,

  // Health check
  healthCheck: () => ConnectionPool.healthCheck(),

  // Cleanup (for testing)
  closeAll: () => ConnectionPool.closeAll(),

  // Constants
  QueryHelper,
  TransactionManager,
  ConnectionPool,
};

// Auto-initialize on import
database.init();

export default database;