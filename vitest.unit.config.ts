import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',

    // Test file patterns for unit tests only
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      'supabase/_internal',
      'packages/db-types/index.ts',
      'src/shared/tests/integration/**', // Exclude integration tests
      'src/**/tests/integration/**', // Exclude all integration tests
      'src/**/integration/**', // Exclude integration test directories
    ],

    // Test execution configuration
    testTimeout: 10000, // 10 seconds for unit tests
    hookTimeout: 5000,
    teardownTimeout: 5000,

    // Mock configuration
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,

    // Environment variables for tests
    env: {
      NODE_ENV: 'test',
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      APP_URL: 'http://localhost:3000',
      LOG_LEVEL: 'error',
      METRICS_ENABLED: 'false',
    },

    // Reporter configuration - simple for unit tests
    reporter: ['default'],
  },

  // Path resolution for imports
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@config': path.resolve(__dirname, './packages/config'),
      '@ui': path.resolve(__dirname, './packages/ui'),
      '@db-types': path.resolve(__dirname, './packages/db-types'),
    },
  },

  // ESBuild configuration for TypeScript
  esbuild: {
    target: 'node18',
  },

  // Define global constants
  define: {
    __TEST__: true,
    __DEV__: false,
    __PROD__: false,
  },
});
