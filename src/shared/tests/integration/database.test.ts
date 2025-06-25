/**
 * Database Utilities Integration Test
 * 
 * Tests the complete database foundation:
 * - Connection management và pooling
 * - Query helpers với error handling
 * - Transaction management
 * - Health checks và monitoring
 * - Integration với Layer 1 utilities (errors, logging)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { database, DatabaseResult, QueryHelper, TransactionManager } from '@/database';
import { logger } from '@/logging';
import { ApiError, DatabaseError, ValidationError } from '@/errors';

describe('Database Utilities Integration', () => {
  let queryHelper: QueryHelper;
  
  beforeAll(async () => {
    // Initialize database connection pool
    database.init({
      maxConnections: 5,
      timeout: 10000,
      retryAttempts: 2
    });
    
    // Create query helper với service client
    const serviceClient = database.getServiceClient();
    queryHelper = database.createQueryHelper(serviceClient, {
      module: 'test',
      operation: 'integration-test'
    });
  });

  afterAll(async () => {
    // Cleanup connections
    database.closeAll();
  });

  describe('Connection Management', () => {
    it('should provide healthy database connection', async () => {
      const health = await database.healthCheck();
      
      expect(health.status).toBe('healthy');
      expect(health.latency).toBeGreaterThan(0);
      expect(health.latency).toBeLessThan(5000); // Should be under 5 seconds
    });

    it('should create different client types', () => {
      const anonClient = database.getAnonClient();
      const serviceClient = database.getServiceClient();
      const authClient = database.getAuthenticatedClient('fake-token');
      
      expect(anonClient).toBeDefined();
      expect(serviceClient).toBeDefined();
      expect(authClient).toBeDefined();
      
      // Clients should be different instances for security
      expect(anonClient).not.toBe(serviceClient);
      expect(serviceClient).not.toBe(authClient);
    });
  });

  describe('Query Helper Integration', () => {
    const testTableName = 'test_integration_table';

    beforeAll(async () => {
      // Create test table for integration tests
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS public.${testTableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          age INTEGER,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      
      await queryHelper.rpc('exec', { sql: createTableSQL });
    });

    afterAll(async () => {
      // Clean up test table
      await queryHelper.rpc('exec', { 
        sql: `DROP TABLE IF EXISTS public.${testTableName}` 
      });
    });

    it('should perform CRUD operations with proper error handling', async () => {
      // CREATE - Insert operation
      const insertData = {
        name: 'Test User',
        email: 'test@example.com',
        age: 30,
        metadata: { role: 'test', preferences: { theme: 'dark' } }
      };

      const insertResult = await queryHelper.insert(testTableName, insertData, {
        select: '*'
      });

      expect(insertResult.error).toBeNull();
      expect(insertResult.data).toBeDefined();
      expect(insertResult.data).toHaveProperty('id');
      expect(insertResult.data.name).toBe('Test User');
      expect(insertResult.data.email).toBe('test@example.com');
      expect(insertResult.data.age).toBe(30);

      const insertedId = insertResult.data.id;

      // READ - Select operation
      const selectResult = await queryHelper.select(testTableName, {
        filters: { id: insertedId },
        limit: 1
      });

      expect(selectResult.error).toBeNull();
      expect(selectResult.data).toHaveLength(1);
      expect(selectResult.data[0].id).toBe(insertedId);
      expect(selectResult.data[0].name).toBe('Test User');

      // UPDATE - Update operation
      const updateData = {
        name: 'Updated Test User',
        age: 31,
        metadata: { role: 'test', updated: true }
      };

      const updateResult = await queryHelper.update(
        testTableName,
        updateData,
        { id: insertedId },
        { select: '*' }
      );

      expect(updateResult.error).toBeNull();
      expect(updateResult.data).toBeDefined();
      expect(updateResult.data.name).toBe('Updated Test User');
      expect(updateResult.data.age).toBe(31);

      // READ - Verify update
      const verifyResult = await queryHelper.select(testTableName, {
        filters: { id: insertedId },
        limit: 1
      });

      expect(verifyResult.data[0].name).toBe('Updated Test User');
      expect(verifyResult.data[0].age).toBe(31);

      // DELETE - Delete operation
      const deleteResult = await queryHelper.delete(
        testTableName,
        { id: insertedId },
        { select: 'id' }
      );

      expect(deleteResult.error).toBeNull();
      expect(deleteResult.data).toBeDefined();
      expect(deleteResult.data.id).toBe(insertedId);

      // Verify deletion
      const verifyDeleteResult = await queryHelper.select(testTableName, {
        filters: { id: insertedId },
        limit: 1
      });

      expect(verifyDeleteResult.data).toHaveLength(0);
    });

    it('should handle query errors properly', async () => {
      // Test với invalid table name
      const invalidResult = await queryHelper.select('non_existent_table');
      
      expect(invalidResult.error).toBeInstanceOf(DatabaseError);
      expect(invalidResult.data).toBeNull();
      expect(invalidResult.error?.message).toContain('non_existent_table');

      // Test với duplicate email
      const firstInsert = await queryHelper.insert(testTableName, {
        name: 'User 1',
        email: 'duplicate@example.com'
      });
      expect(firstInsert.error).toBeNull();

      const secondInsert = await queryHelper.insert(testTableName, {
        name: 'User 2', 
        email: 'duplicate@example.com' // Same email, should fail
      });
      
      expect(secondInsert.error).toBeInstanceOf(DatabaseError);
      expect(secondInsert.data).toBeNull();

      // Cleanup
      await queryHelper.delete(testTableName, { email: 'duplicate@example.com' });
    });

    it('should support advanced querying features', async () => {
      // Insert test data
      const testUsers = [
        { name: 'Alice', email: 'alice@example.com', age: 25 },
        { name: 'Bob', email: 'bob@example.com', age: 30 },
        { name: 'Charlie', email: 'charlie@example.com', age: 35 },
        { name: 'Diana', email: 'diana@example.com', age: 28 }
      ];

      // Bulk insert
      const insertResults = await Promise.all(
        testUsers.map(user => queryHelper.insert(testTableName, user))
      );

      insertResults.forEach(result => {
        expect(result.error).toBeNull();
      });

      // Test filtering
      const filterResult = await queryHelper.select(testTableName, {
        filters: { age: 30 }
      });

      expect(filterResult.error).toBeNull();
      expect(filterResult.data).toHaveLength(1);
      expect(filterResult.data[0].name).toBe('Bob');

      // Test ordering
      const orderResult = await queryHelper.select(testTableName, {
        orderBy: 'age',
        ascending: true
      });

      expect(orderResult.error).toBeNull();
      expect(orderResult.data.length).toBeGreaterThanOrEqual(4);
      expect(orderResult.data[0].age).toBeLessThanOrEqual(orderResult.data[1].age);

      // Test pagination
      const paginationResult = await queryHelper.select(testTableName, {
        limit: 2,
        offset: 1,
        orderBy: 'name',
        ascending: true
      });

      expect(paginationResult.error).toBeNull();
      expect(paginationResult.data).toHaveLength(2);

      // Cleanup test data
      await queryHelper.delete(testTableName, {});
    });
  });

  describe('Transaction Management', () => {
    const testTableName = 'test_transaction_table';

    beforeAll(async () => {
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS public.${testTableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          balance INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;
      
      await queryHelper.rpc('exec', { sql: createTableSQL });
    });

    afterAll(async () => {
      await queryHelper.rpc('exec', { 
        sql: `DROP TABLE IF EXISTS public.${testTableName}` 
      });
    });

    it('should handle successful transactions', async () => {
      const result = await TransactionManager.withTransaction(async (context) => {
        const txHelper = database.createQueryHelper(context.client, {
          operationId: context.operationId
        });

        // Insert user
        const userResult = await txHelper.insert(testTableName, {
          name: 'Transaction User',
          balance: 100
        }, { select: '*' });

        if (userResult.error) {
          throw userResult.error;
        }

        const userId = userResult.data.id;

        // Update balance
        const updateResult = await txHelper.update(
          testTableName,
          { balance: 200 },
          { id: userId },
          { select: '*' }
        );

        if (updateResult.error) {
          throw updateResult.error;
        }

        return {
          userId,
          finalBalance: updateResult.data.balance
        };
      });

      expect(result).toBeDefined();
      expect(result.userId).toBeValidUuid();
      expect(result.finalBalance).toBe(200);

      // Verify transaction was committed
      const verifyResult = await queryHelper.select(testTableName, {
        filters: { id: result.userId }
      });

      expect(verifyResult.data).toHaveLength(1);
      expect(verifyResult.data[0].balance).toBe(200);

      // Cleanup
      await queryHelper.delete(testTableName, { id: result.userId });
    });

    it('should handle transaction rollback on errors', async () => {
      let userId: string | null = null;

      try {
        await TransactionManager.withTransaction(async (context) => {
          const txHelper = database.createQueryHelper(context.client, {
            operationId: context.operationId
          });

          // Insert user
          const userResult = await txHelper.insert(testTableName, {
            name: 'Rollback User',
            balance: 100
          }, { select: '*' });

          if (userResult.error) {
            throw userResult.error;
          }

          userId = userResult.data.id;

          // This should cause the transaction to rollback
          throw new Error('Intentional error for rollback test');
        });

        // Should not reach here
        expect.fail('Transaction should have thrown an error');

      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Intentional error');
      }

      // Verify transaction was rolled back - user should not exist
      if (userId) {
        const verifyResult = await queryHelper.select(testTableName, {
          filters: { id: userId }
        });

        expect(verifyResult.data).toHaveLength(0);
      }
    });

    it('should support retry logic for failed operations', async () => {
      let attemptCount = 0;

      const result = await TransactionManager.withRetry(async () => {
        attemptCount++;
        
        if (attemptCount < 3) {
          // Simulate a retryable error
          throw new Error('Connection timeout');
        }

        // Success on third attempt
        const insertResult = await queryHelper.insert(testTableName, {
          name: 'Retry User',
          balance: 50
        }, { select: '*' });

        if (insertResult.error) {
          throw insertResult.error;
        }

        return insertResult.data;
      }, 3);

      expect(attemptCount).toBe(3);
      expect(result).toBeDefined();
      expect(result.name).toBe('Retry User');
      expect(result.balance).toBe(50);

      // Cleanup
      await queryHelper.delete(testTableName, { id: result.id });
    });
  });

  describe('RPC Operations', () => {
    it('should execute stored procedures successfully', async () => {
      // Test với built-in PostgreSQL function
      const result = await queryHelper.rpc('current_timestamp', {});
      
      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
      expect(typeof result.data).toBe('string');
      expect(new Date(result.data)).toBeInstanceOf(Date);
    });

    it('should handle RPC errors properly', async () => {
      const result = await queryHelper.rpc('non_existent_function', {});
      
      expect(result.error).toBeInstanceOf(DatabaseError);
      expect(result.data).toBeNull();
    });
  });

  describe('Performance and Monitoring', () => {
    it('should track query performance', async () => {
      const startTime = Date.now();

      // Execute a simple query
      const result = await queryHelper.select('profiles', {
        limit: 1
      });

      const endTime = Date.now();
      const queryDuration = endTime - startTime;

      // Query should complete reasonably quickly
      expect(queryDuration).toBeLessThan(5000); // Less than 5 seconds
      expect(result.error).toBeNull();
    });

    it('should handle connection pooling correctly', async () => {
      // Execute multiple queries concurrently để test connection pooling
      const promises = Array.from({ length: 10 }, (_, i) => 
        queryHelper.select('profiles', {
          limit: 1,
          filters: { id: `test-${i}` } // Different filters to avoid caching
        })
      );

      const results = await Promise.all(promises);

      // All queries should complete without connection errors
      results.forEach((result, index) => {
        // Even if no data found, error should be null
        expect(result.error).toBeNull();
      });
    });
  });

  describe('Integration với Layer 1 Utilities', () => {
    it('should properly integrate với error handling system', async () => {
      // Test error creation và formatting
      const invalidResult = await queryHelper.select('invalid_table_name');

      expect(invalidResult.error).toBeInstanceOf(DatabaseError);
      expect(invalidResult.error?.code).toBeDefined();
      expect(invalidResult.error?.context).toBeDefined();
      expect(invalidResult.error?.context.operation).toBe('SELECT');
    });

    it('should integrate với logging system', async () => {
      // Spy on logger to verify integration
      const logSpy = vi.spyOn(logger, 'debug');

      await queryHelper.select('profiles', { limit: 1 });

      // Verify that database operations are being logged
      expect(logSpy).toHaveBeenCalled();
      
      logSpy.mockRestore();
    });

    it('should work với existing test utilities', async () => {
      // Test that database utilities work với global test utilities
      const testUser = await globalThis.testDb.createTestUser({
        email: 'db-integration@example.com',
        name: 'DB Integration User'
      });

      expect(testUser).toBeDefined();
      expect(testUser.id).toBeValidUuid();
      expect(testUser.email).toBe('db-integration@example.com');

      // Verify user exists in database using our query helper
      const userResult = await queryHelper.select('profiles', {
        filters: { id: testUser.id }
      });

      expect(userResult.error).toBeNull();
      expect(userResult.data).toHaveLength(1);
      expect(userResult.data[0].id).toBe(testUser.id);
    });
  });
});