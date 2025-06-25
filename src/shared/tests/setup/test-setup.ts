// - Individual test setup and utilities configuration

import { beforeEach, afterEach, vi } from 'vitest';
import { TestDatabaseManager } from '../utils/testing';

/**
 * Test database manager instance for each test
 */
let testDbManager: TestDatabaseManager;

/**
 * Setup before each test
 */
beforeEach(async () => {
  // Initialize fresh database manager for each test
  testDbManager = new TestDatabaseManager();

  // Reset any mocks
  vi.clearAllMocks();

  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.METRICS_ENABLED = 'false';
  
  // Mock console methods to reduce noise in tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  
  // Keep error and debug for important messages
  // vi.spyOn(console, 'error').mockImplementation(() => {});
  // vi.spyOn(console, 'debug').mockImplementation(() => {});
});

/**
 * Cleanup after each test
 */
afterEach(async () => {
  // Clean up test data created during the test
  if (testDbManager) {
    await testDbManager.cleanup();
  }

  // Restore all mocks
  vi.restoreAllMocks();

  // Clear any timers
  vi.clearAllTimers();
});

/**
 * Global test utilities available in all tests
 */
declare global {
  var testDb: TestDatabaseManager;
  
  namespace globalThis {
    var testDb: TestDatabaseManager;
  }
}

// Make test database manager available globally
Object.defineProperty(globalThis, 'testDb', {
  get() {
    return testDbManager;
  },
});

/**
 * Custom matchers for better test assertions
 */
declare module 'vitest' {
  interface Assertion<T = any> {
    toBeValidUuid(): T;
    toBeValidTimestamp(): T;
    toBeValidEmail(): T;
    toHaveProperty(key: string): T;
    toMatchApiResponse(): T;
    toMatchErrorResponse(): T;
  }
}

/**
 * Extend expect with custom matchers
 */
expect.extend({
  toBeValidUuid(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = typeof received === 'string' && uuidRegex.test(received);
    
    return {
      pass,
      message: () => pass
        ? `Expected ${received} not to be a valid UUID`
        : `Expected ${received} to be a valid UUID`,
    };
  },

  toBeValidTimestamp(received: string) {
    const pass = typeof received === 'string' && !isNaN(Date.parse(received));
    
    return {
      pass,
      message: () => pass
        ? `Expected ${received} not to be a valid timestamp`
        : `Expected ${received} to be a valid timestamp`,
    };
  },

  toBeValidEmail(received: string) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = typeof received === 'string' && emailRegex.test(received);
    
    return {
      pass,
      message: () => pass
        ? `Expected ${received} not to be a valid email`
        : `Expected ${received} to be a valid email`,
    };
  },

  toMatchApiResponse(received: any) {
    const hasRequiredFields = received && 
      typeof received === 'object' &&
      ('data' in received || 'error' in received) &&
      'timestamp' in received;
    
    return {
      pass: hasRequiredFields,
      message: () => hasRequiredFields
        ? `Expected response not to match API response format`
        : `Expected response to match API response format (should have 'data' or 'error' and 'timestamp')`,
    };
  },

  toMatchErrorResponse(received: any) {
    const hasErrorStructure = received &&
      typeof received === 'object' &&
      'error' in received &&
      typeof received.error === 'object' &&
      'code' in received.error &&
      'message' in received.error &&
      'timestamp' in received;
    
    return {
      pass: hasErrorStructure,
      message: () => hasErrorStructure
        ? `Expected response not to match error response format`
        : `Expected response to match error response format (should have error.code, error.message, and timestamp)`,
    };
  },
});

/**
 * Mock fetch for external API calls
 */
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/**
 * Helper to mock successful fetch responses
 */
export function mockFetchSuccess(data: any, status: number = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({
      'content-type': 'application/json',
    }),
  });
}

/**
 * Helper to mock failed fetch responses
 */
export function mockFetchError(message: string, status: number = 500) {
  mockFetch.mockRejectedValueOnce(new Error(message));
}

/**
 * Helper to mock network timeouts
 */
export function mockFetchTimeout() {
  mockFetch.mockImplementationOnce(() => 
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Network timeout')), 100)
    )
  );
}

/**
 * Test timeout helpers
 */
export const TEST_TIMEOUTS = {
  UNIT: 5000,      // 5 seconds for unit tests
  INTEGRATION: 15000, // 15 seconds for integration tests
  E2E: 30000,      // 30 seconds for end-to-end tests
} as const;

/**
 * Common test data patterns
 */
export const TEST_PATTERNS = {
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  TIMESTAMP: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
  API_KEY_PREFIX: /^[a-zA-Z0-9]{8}$/,
} as const;

/**
 * Test environment info
 */
export const TEST_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || 'http://localhost:54321',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  IS_CI: Boolean(process.env.CI),
  IS_DEBUG: process.env.DEBUG === 'true',
} as const;

/**
 * Console utilities for tests
 */
export const testConsole = {
  log: (...args: any[]) => {
    if (TEST_ENV.IS_DEBUG) {
      console.log('[TEST]', ...args);
    }
  },
  error: (...args: any[]) => {
    console.error('[TEST ERROR]', ...args);
  },
  warn: (...args: any[]) => {
    if (TEST_ENV.IS_DEBUG) {
      console.warn('[TEST WARN]', ...args);
    }
  },
};