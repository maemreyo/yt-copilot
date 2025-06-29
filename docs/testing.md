# Testing Guide

This document outlines the testing setup and best practices for the project.

## 🧪 Test Structure

### Unit Tests
- **Location**: `src/modules/*/tests/` and `src/shared/tests/`
- **Purpose**: Test individual functions, components, and modules in isolation
- **Configuration**: `vitest.unit.config.ts`
- **Framework**: Vitest with Node.js environment

### Integration Tests
- **Location**: `src/shared/tests/integration/`
- **Purpose**: Test interactions between modules and external services
- **Configuration**: `vitest.config.ts`
- **Requirements**: Supabase CLI, test database

## 📝 Available Test Scripts

### Quick Commands
```bash
# Run all unit tests
pnpm test:unit

# Run tests with coverage
pnpm test:unit:coverage

# Watch mode for development
pnpm test:unit:watch

# Run all module tests
pnpm test:modules
```

### Module-Specific Testing
```bash
# Test specific module
pnpm test:module billing
pnpm test:module core
pnpm test:module shared

# Watch mode for specific module
pnpm test:module billing --watch

# Coverage for specific module
pnpm test:module billing --coverage

# Test specific file in module
pnpm test:module billing --file create-checkout-session

# Get help and see available modules
pnpm test:module --help
```

### Integration Testing
```bash
# Run all integration tests (requires Supabase)
pnpm test:integration

# Run billing integration tests only
pnpm test:integration:billing
```

### Legacy Commands (Shortcuts)
```bash
# Specific module shortcuts (still available)
pnpm test:billing               # → pnpm test:module billing
pnpm test:billing:watch         # → pnpm test:module billing --watch
```

## 🏗️ Test File Structure

### Billing Module Tests
- **Location**: `src/modules/billing/tests/`
- **Unit Tests**:
  - `billing.test.ts` - General billing functionality (27 tests)
  - `create-checkout-session.test.ts` - Checkout session creation (34 tests)
  - `create-customer-portal.test.ts` - Customer portal management (33 tests)
  - `get-subscription.test.ts` - Subscription retrieval with caching (40 tests)
  - `webhooks-stripe.test.ts` - Stripe webhook processing (34 tests)
- **Integration Tests**:
  - `integration/billing-integration.test.ts` - End-to-end billing workflows (12 scenarios)
- **Total**: 168 unit tests + 12 integration scenarios

### Test Categories
Each test file covers:
- **Happy Path**: Valid inputs and expected outputs
- **Input Verification**: Edge cases, invalid inputs, boundary values
- **Branching**: All possible paths based on conditions
- **Exception Handling**: Error scenarios and error handling
- **Integration**: Complete workflow validation

## 🛠️ Writing New Tests

### Test File Template
```typescript
// Unit tests for [module-name] function
// CREATED: YYYY-MM-DD - Description

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('@supabase/supabase-js');
vi.mock('stripe');

describe('[ModuleName]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup environment variables
    vi.stubEnv('REQUIRED_ENV_VAR', 'test-value');
  });

  describe('[Feature Group]', () => {
    it('should handle valid input', () => {
      // Test implementation
      expect(true).toBe(true);
    });

    it('should reject invalid input', () => {
      // Test implementation
      expect(() => invalidFunction()).toThrow();
    });
  });
});
```

### Best Practices
1. **Isolation**: Each test should be independent
2. **Mocking**: Mock external dependencies (Supabase, Stripe, etc.)
3. **Coverage**: Test happy paths, edge cases, and error scenarios
4. **Naming**: Use descriptive test names that explain the scenario
5. **Grouping**: Group related tests using `describe` blocks
6. **Setup**: Use `beforeEach` for test setup and cleanup

### Mock Patterns
```typescript
// Mock Supabase client
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
};

// Mock Stripe
const mockStripe = {
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  customers: {
    create: vi.fn(),
    retrieve: vi.fn(),
  },
};
```

## 🚀 Continuous Integration

### Environment Setup
Unit tests run in isolated environment with:
- Mock external services
- Test environment variables
- No database dependencies

### Coverage Requirements
- Minimum 80% code coverage for new modules
- All critical paths must be tested
- Edge cases and error scenarios covered

## 🔧 Configuration Files

### `vitest.unit.config.ts`
- Unit test configuration
- Node.js environment
- Mock external dependencies
- Path aliases configured
- Environment variables set

### `vitest.config.ts`
- Integration test configuration
- Database setup required
- Supabase CLI dependency
- Global setup and teardown

## 📊 Test Results

### Recent Results
- **Billing Module**: 168/168 tests passing ✅
- **Coverage**: High coverage across all test categories
- **Performance**: Average test execution < 500ms

### Test Categories Breakdown
- **Request Validation**: URL validation, input sanitization
- **Authentication**: JWT token handling, user verification  
- **Rate Limiting**: Request throttling, abuse prevention
- **Error Handling**: Graceful error responses, logging
- **Integration Flows**: Complete user workflows
- **Security**: Input validation, XSS prevention
- **Performance**: Response times, caching logic

## 🎯 Next Steps

1. **Expand Coverage**: Add tests for additional modules
2. **E2E Testing**: Implement end-to-end test scenarios
3. **Performance Testing**: Add load testing for critical paths
4. **Visual Testing**: Screenshot comparison for UI components
5. **API Testing**: Automated API endpoint testing

## 📚 Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://testing-library.com/docs/guiding-principles)
- [Mocking Strategies](https://vitest.dev/guide/mocking.html)
- [Coverage Reports](https://vitest.dev/guide/coverage.html)