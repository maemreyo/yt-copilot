// Comprehensive test utilities for user creation, data factories, and database helpers

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

/**
 * Test user interface
 */
export interface TestUser {
  id: string;
  email: string;
  password: string;
  authToken: string;
  profile?: any;
}

/**
 * Test API key interface
 */
export interface TestApiKey {
  id: string;
  key: string;
  prefix: string;
  userId: string;
  name: string;
}

/**
 * Test database manager
 */
export class TestDatabaseManager {
  private supabase: SupabaseClient;
  private createdUsers: string[] = [];
  private createdApiKeys: string[] = [];

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || 'http://localhost:54321',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key'
    );
  }

  /**
   * Create a test user with authentication
   */
  async createTestUser(
    overrides: Partial<{
      email: string;
      password: string;
      name: string;
      role: string;
    }> = {}
  ): Promise<TestUser> {
    const email = overrides.email || `test-${randomBytes(8).toString('hex')}@example.com`;
    const password = overrides.password || 'TestPassword123!';
    const name = overrides.name || 'Test User';

    // Create user via Supabase Auth
    const { data: authData, error: signUpError } = await this.supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: overrides.role || 'user',
      },
    });

    if (signUpError || !authData.user) {
      throw new Error(`Failed to create test user: ${signUpError?.message}`);
    }

    this.createdUsers.push(authData.user.id);

    // Create user profile
    const { error: profileError } = await this.supabase.from('profiles').insert({
      id: authData.user.id,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_subscription_status: null,
    });

    if (profileError) {
      console.warn('Failed to create profile for test user:', profileError);
    }

    // Generate auth token
    const { data: sessionData, error: sessionError } = await this.supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    if (sessionError) {
      throw new Error(`Failed to generate session for test user: ${sessionError.message}`);
    }

    // Extract token from the magic link (this is a simplified approach for testing)
    const token = sessionData.properties?.access_token || 'test-token';

    return {
      id: authData.user.id,
      email,
      password,
      authToken: token,
      profile: authData.user,
    };
  }

  /**
   * Create test API key for user
   */
  async createTestApiKey(
    userId: string,
    overrides: Partial<{
      name: string;
      permissions: string[];
      expiresInDays: number;
    }> = {}
  ): Promise<TestApiKey> {
    const apiKey = randomBytes(32).toString('hex');
    const prefix = apiKey.substring(0, 8);
    const name = overrides.name || 'Test API Key';

    // In a real implementation, this would be hashed
    const keyHash = `hashed_${apiKey}`;

    const expiresAt = overrides.expiresInDays
      ? new Date(Date.now() + overrides.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data, error } = await this.supabase
      .from('api_keys')
      .insert({
        user_id: userId,
        key_hash: keyHash,
        key_prefix: prefix,
        name,
        expires_at: expiresAt,
        permissions: overrides.permissions ? JSON.stringify(overrides.permissions) : null,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create test API key: ${error.message}`);
    }

    this.createdApiKeys.push(data.id);

    return {
      id: data.id,
      key: apiKey,
      prefix,
      userId,
      name,
    };
  }

  /**
   * Create test subscription for user
   */
  async createTestSubscription(userId: string, status: string = 'active'): Promise<void> {
    const customerId = `cus_test_${randomBytes(8).toString('hex')}`;
    const subscriptionId = `sub_test_${randomBytes(8).toString('hex')}`;

    const { error } = await this.supabase
      .from('profiles')
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_subscription_status: status,
      })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to create test subscription: ${error.message}`);
    }
  }

  /**
   * Clean up all created test data
   */
  async cleanup(): Promise<void> {
    try {
      // Delete API keys
      if (this.createdApiKeys.length > 0) {
        await this.supabase.from('api_keys').delete().in('id', this.createdApiKeys);
      }

      // Delete users (this will cascade to profiles)
      if (this.createdUsers.length > 0) {
        for (const userId of this.createdUsers) {
          await this.supabase.auth.admin.deleteUser(userId);
        }
      }

      // Reset tracking arrays
      this.createdUsers = [];
      this.createdApiKeys = [];
    } catch (error: any) {
      console.error('Error during test cleanup:', error);
    }
  }

  /**
   * Reset database to clean state
   */
  async reset(): Promise<void> {
    await this.cleanup();

    // Additional cleanup if needed
    // This could include truncating specific tables or resetting sequences
  }

  /**
   * Get Supabase client
   */
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }
}

/**
 * HTTP test helpers
 */
export class HttpTestHelpers {
  /**
   * Create authorization header with JWT token
   */
  static createAuthHeader(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create API key header
   */
  static createApiKeyHeader(apiKey: string): Record<string, string> {
    return {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create request ID header
   */
  static createRequestIdHeader(): Record<string, string> {
    return {
      'X-Request-ID': randomBytes(16).toString('hex'),
    };
  }

  /**
   * Combine headers
   */
  static combineHeaders(...headerObjects: Record<string, string>[]): Record<string, string> {
    return Object.assign({}, ...headerObjects);
  }
}

/**
 * Data factories for creating test data
 */
export class TestDataFactory {
  /**
   * Generate fake email
   */
  static generateEmail(domain: string = 'example.com'): string {
    return `test-${randomBytes(8).toString('hex')}@${domain}`;
  }

  /**
   * Generate fake name
   */
  static generateName(): string {
    const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana'];
    const lastNames = ['Smith', 'Johnson', 'Brown', 'Davis', 'Wilson', 'Moore'];

    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

    return `${firstName} ${lastName}`;
  }

  /**
   * Generate API key creation payload
   */
  static generateApiKeyPayload(overrides: any = {}): any {
    return {
      name: 'Test API Key',
      expiresInDays: 30,
      permissions: ['api-keys:read', 'profile:read'],
      ...overrides,
    };
  }

  /**
   * Generate checkout session payload
   */
  static generateCheckoutSessionPayload(overrides: any = {}): any {
    return {
      priceId: 'price_test_12345',
      successUrl: 'http://localhost:3000/success',
      cancelUrl: 'http://localhost:3000/cancel',
      ...overrides,
    };
  }

  /**
   * Generate customer portal payload
   */
  static generateCustomerPortalPayload(overrides: any = {}): any {
    return {
      returnUrl: 'http://localhost:3000/billing',
      ...overrides,
    };
  }
}

/**
 * Test environment helpers
 */
export class TestEnvironment {
  /**
   * Check if we're in test environment
   */
  static isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Get test Supabase URL
   */
  static getSupabaseUrl(): string {
    return process.env.SUPABASE_URL || 'http://localhost:54321';
  }

  /**
   * Wait for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry a function until it succeeds or max attempts reached
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error as Error;

        if (attempt < maxAttempts) {
          await this.wait(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Generate unique test ID
   */
  static generateTestId(): string {
    return `test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }
}

/**
 * Assertion helpers
 */
export class TestAssertions {
  /**
   * Assert that response has expected structure
   */
  static assertApiResponse(response: any, expectedFields: string[]): void {
    for (const field of expectedFields) {
      if (!(field in response)) {
        throw new Error(`Expected field '${field}' not found in response`);
      }
    }
  }

  /**
   * Assert that error response has expected structure
   */
  static assertErrorResponse(response: any): void {
    this.assertApiResponse(response, ['error', 'timestamp']);
    this.assertApiResponse(response.error, ['code', 'message']);
  }

  /**
   * Assert that paginated response has expected structure
   */
  static assertPaginatedResponse(response: any): void {
    this.assertApiResponse(response, ['data', 'pagination']);
    this.assertApiResponse(response.pagination, ['page', 'limit', 'total', 'totalPages']);
  }

  /**
   * Assert UUID format
   */
  static assertUuid(value: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      throw new Error(`Expected UUID format, got: ${value}`);
    }
  }

  /**
   * Assert ISO timestamp format
   */
  static assertTimestamp(value: string): void {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error(`Expected valid ISO timestamp, got: ${value}`);
    }
  }
}

/**
 * Global test utilities instance
 */
export const testUtils = {
  db: TestDatabaseManager,
  http: HttpTestHelpers,
  factory: TestDataFactory,
  env: TestEnvironment,
  assert: TestAssertions,
};
