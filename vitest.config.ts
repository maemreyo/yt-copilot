import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',
    
    // Global setup and teardown
    globalSetup: ['./src/shared/tests/setup/global-setup.ts'],
    setupFiles: ['./src/shared/tests/setup/test-setup.ts'],
    
    // Test file patterns
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'src/**/__tests__/**/*.{js,ts}',
    ],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      'supabase/_internal',
      'packages/db-types/index.ts',
    ],
    
    // Test execution configuration
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 10000, // 10 seconds for setup/teardown
    teardownTimeout: 10000,
    
    // Parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
        minThreads: 1,
      },
    },
    
    // File watching configuration
    watchExclude: [
      'node_modules/**',
      'dist/**',
      '.next/**',
      'supabase/_internal/**',
      'docs/generated/**',
    ],
    
    // Test retry configuration
    retry: {
      // Retry failed tests up to 2 times
      count: 2,
    },
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'json'],
      reportsDirectory: './coverage',
      
      // Coverage thresholds
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
      
      // Include patterns for coverage
      include: [
        'src/shared/**/*.ts',
        'src/modules/**/*.ts',
      ],
      
      // Exclude patterns from coverage
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/**/tests/**',
        'src/shared/tests/**',
        'src/**/*.d.ts',
        'src/**/types/**',
        'src/**/constants/**',
      ],
      
      // File extensions to include
      extension: ['.ts', '.js'],
      
      // Skip coverage for files with no tests
      skipFull: false,
      
      // Clean coverage directory before running
      clean: true,
    },
    
    // Reporter configuration
    reporter: [
      'default', // Console output
      'json', // JSON report for CI
      'html', // HTML report for local development
    ],
    outputFile: {
      json: './test-results/results.json',
      html: './test-results/index.html',
    },
    
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
      LOG_LEVEL: 'error', // Reduce noise in tests
      METRICS_ENABLED: 'false',
    },
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