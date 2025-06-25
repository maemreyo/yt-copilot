# 🏗️ Architecture Overview

This document provides a comprehensive overview of the architecture of the Lean Supabase SaaS Starter, including implementation details, design decisions, and patterns used throughout the system.

## 🌟 Core Architecture Principles

### 1. **API-First is Supreme**
Backend is a standalone, stateless, "headless" API product. All features are exposed through well-defined API endpoints to serve any client (Web, Mobile, Extension, Server-to-Server).

### 2. **Module-First Architecture**
Backend code is organized into independent feature modules. Each module contains its own migrations, functions, and tests, ensuring high cohesion and low coupling.

### 3. **Layer-Based Foundation**
A systematic 6-layer architecture where each layer builds upon the previous ones, ensuring robust foundations and clear separation of concerns.

### 4. **Security by Default**
Row Level Security (RLS) is enabled on all user data tables. No access is granted by default. Every API endpoint includes security headers and proper authentication.

### 5. **Zero-Ops Infrastructure**
No servers, databases, or containers to manage in production. Everything runs on Supabase's managed infrastructure.

## 🏛️ Layer-Based Architecture

The system is built using a **systematic 6-layer architecture** that ensures robust foundations and clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│ 🚀 LAYER 7: DEPLOYMENT & DOCUMENTATION                     │
├─────────────────────────────────────────────────────────────┤
│ 💳 LAYER 6: BILLING MODULE (Stripe Integration)            │
├─────────────────────────────────────────────────────────────┤
│ 🛡️ LAYER 5: AUTH MODULE (API Keys, Profiles, Sessions)     │
├─────────────────────────────────────────────────────────────┤
│ ⚙️ LAYER 4: CORE MODULE (Health, Metrics, Configuration)    │
├─────────────────────────────────────────────────────────────┤
│ 📊 LAYER 3: TESTING INFRASTRUCTURE                         │
├─────────────────────────────────────────────────────────────┤
│ 🔍 LAYER 2: DATABASE & MIGRATION FOUNDATION                │
├─────────────────────────────────────────────────────────────┤
│ 🔧 LAYER 1: FOUNDATION & UTILITIES                         │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: Foundation & Utilities (2000+ lines)

**Purpose**: Provides the foundational utilities that power all other layers.

**Key Components**:
```typescript
// Error handling system
import { createAppError, ErrorType } from '@/errors';
throw createAppError(ErrorType.VALIDATION_ERROR, 'Invalid input', { field: 'email' });

// Structured logging with performance tracking
import { Logger } from '@/logging';
const logger = new Logger({ service: 'billing', enablePerformanceTracking: true });

// Rate limiting with sliding window
import { createRateLimiter } from '@/rate-limiting';
const rateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 100 });

// Security utilities
import { SecurityService } from '@/security';
const security = new SecurityService();
const headers = security.getSecurityHeaders();

// Caching with TTL and invalidation
import { GlobalCaches } from '@/cache';
const cache = GlobalCaches.getCache('api-responses');
await cache.set('user:123', userData, 300000); // 5 minutes

// Validation with Zod schemas
import { ValidationService } from '@/validation';
const validator = new ValidationService();
const result = validator.validateApiRequest(request);
```

**Architectural Patterns**:
- **Factory Pattern**: Middleware factories for rate limiting, security
- **Singleton Pattern**: Global cache instances, logger instances
- **Strategy Pattern**: Different caching strategies (memory, Redis)
- **Decorator Pattern**: Request/response decorators

### Layer 2: Database & Migration Foundation (1500+ lines)

**Purpose**: Provides robust database abstraction and migration management.

**Key Components**:
```typescript
// Database service with connection pooling
import { DatabaseService } from '@/database';
const db = new DatabaseService();
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// Migration system with dependency resolution
import { MigrationManager } from '@/migrations';
const migrator = new MigrationManager();
await migrator.runPendingMigrations();

// Audit logging for compliance
import { AuditLogger } from '@/audit-logging';
await auditLogger.log({
  userId: 'user123',
  action: 'subscription_created',
  resource: 'stripe_subscription',
  details: { subscriptionId: 'sub_123' }
});
```

**Database Schema Organization**:
```sql
-- Each module has its own schema namespace
-- Core tables
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Module-specific tables
CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  key_hash TEXT NOT NULL,
  permissions TEXT[] DEFAULT '{}'
);

-- Audit tables for compliance
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT NOT NULL,
  resource TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Layer 3: Testing Infrastructure

**Purpose**: Comprehensive testing framework proving all layers work together.

**Test Categories**:
- **Unit Tests**: Utility functions, validation logic
- **Integration Tests**: End-to-end API testing with real Supabase
- **Security Tests**: Auth bypass prevention, rate limiting
- **Performance Tests**: Load testing, concurrent requests

**Testing Patterns**:
```typescript
// Test utilities for consistent setup
import { TestDatabaseManager } from '@/testing';
const testDb = new TestDatabaseManager();
const testUser = await testDb.createTestUser({
  email: 'test@example.com',
  role: 'user'
});

// Integration test example
describe('Billing Integration', () => {
  it('should complete full billing lifecycle', async () => {
    // 1. Create checkout session
    const checkoutResponse = await request(BASE_URL)
      .post('/billing_enhanced-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ priceId: 'price_test_pro' })
      .expect(200);

    // 2. Simulate webhook
    await simulateStripeWebhook('checkout.session.completed');

    // 3. Verify subscription created
    const subscription = await request(BASE_URL)
      .get('/billing_enhanced-get-subscription')
      .expect(200);
  });
});
```

### Layer 4: Core Module (System Services)

**Purpose**: Provides essential system services for monitoring and health.

**Services**:
```typescript
// Health monitoring with comprehensive checks
GET /functions/v1/core_health-check
{
  "status": "healthy",
  "services": {
    "database": { "status": "ok", "latency": 45 },
    "cache": { "status": "ok", "hit_rate": 0.85 },
    "external_apis": { "stripe": "ok", "resend": "ok" }
  }
}

// Performance metrics collection
GET /functions/v1/core_metrics
{
  "system": { "uptime": 86400, "memory_usage": 0.65 },
  "api": { "requests_per_minute": 150, "error_rate": 0.02 },
  "database": { "active_connections": 12, "query_latency": 25 }
}

// Centralized error reporting
POST /functions/v1/core_error-reporting/report
{
  "message": "Payment processing failed",
  "severity": "high",
  "category": "billing",
  "metadata": { "user_id": "123", "payment_id": "pi_123" }
}
```

### Layer 5: Auth Module (Authentication & Authorization)

**Purpose**: Comprehensive authentication and authorization system.

**Authentication Strategies**:
```typescript
// JWT Bearer Token (User Authentication)
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// API Key Authentication (Machine-to-Machine)
X-API-Key: sk_your_api_key_here

// Auth middleware integration
import { AuthService } from '@/auth';
const auth = new AuthService();
const { user, authType } = await auth.authenticateRequest(request);
```

**Permission System**:
```typescript
// Role-based access control
const permissions = [
  'api-keys:read',
  'api-keys:write', 
  'profile:read',
  'profile:write',
  'billing:read',
  'billing:write'
];

// Permission checks
if (!user.hasPermission('billing:write')) {
  throw createAppError(ErrorType.AUTHORIZATION_ERROR, 'Insufficient permissions');
}
```

### Layer 6: Billing Module (Stripe Integration)

**Purpose**: Complete billing and subscription management with Stripe.

**Service Architecture**:
```typescript
// Enhanced checkout with comprehensive validation
class EnhancedCheckoutService {
  async createCheckoutSession(userId: string, request: CheckoutRequest) {
    // 1. Validate request
    const validation = this.validateRequest(request);
    
    // 2. Apply rate limiting
    await this.rateLimiter(request);
    
    // 3. Create/get Stripe customer
    const customerId = await this.getOrCreateCustomer(userId);
    
    // 4. Create checkout session
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: request.priceId, quantity: 1 }],
      mode: 'subscription'
    });
    
    // 5. Audit log
    await this.auditLogger.log({
      userId,
      action: 'checkout_session_created',
      details: { sessionId: session.id }
    });
    
    return { sessionId: session.id, url: session.url };
  }
}
```

**Caching Strategy**:
```typescript
// Smart caching for subscription data
class EnhancedSubscriptionService {
  async getSubscription(userId: string) {
    const cacheKey = `subscription:${subscriptionId}`;
    
    // Try cache first
    let subscription = await this.cache.get(cacheKey);
    if (subscription) {
      return { subscription, cached: true };
    }
    
    // Fetch from Stripe
    subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    
    // Cache for 5 minutes
    await this.cache.set(cacheKey, subscription, 300000);
    
    return { subscription, cached: false };
  }
}
```

## 🔐 Security Architecture

### Row Level Security (RLS)

**Every table with user data has RLS enabled**:
```sql
-- Enable RLS on all user tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- API keys are user-specific
CREATE POLICY "Users can manage own API keys" ON api_keys
  FOR ALL USING (auth.uid() = user_id);
```

### Authentication Architecture

**Multi-layered authentication**:
```typescript
// 1. JWT Token Validation
const validateJWT = async (token: string) => {
  const payload = jwt.verify(token, JWT_SECRET);
  const user = await supabase.auth.getUser(token);
  return { user, tokenType: 'jwt' };
};

// 2. API Key Validation
const validateApiKey = async (apiKey: string) => {
  const keyHash = await bcrypt.hash(apiKey, 10);
  const { data: key } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .single();
  
  return { user: key.user_id, tokenType: 'api_key' };
};

// 3. Unified Auth Middleware
const authMiddleware = async (request: Request) => {
  const authHeader = request.headers.get('Authorization');
  const apiKey = request.headers.get('X-API-Key');
  
  if (authHeader?.startsWith('Bearer ')) {
    return await validateJWT(authHeader.substring(7));
  } else if (apiKey) {
    return await validateApiKey(apiKey);
  } else {
    throw createAppError(ErrorType.AUTHENTICATION_ERROR, 'No authentication provided');
  }
};
```

### Security Headers

**All responses include comprehensive security headers**:
```typescript
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY', 
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
```

## ⚡ Performance Architecture

### Caching Strategy

**Multi-level caching system**:
```typescript
// 1. In-Memory Cache (L1)
const memoryCache = new MemoryCacheStore({
  maxSize: 1000,
  defaultTtl: 300000 // 5 minutes
});

// 2. Redis Cache (L2) - for production
const redisCache = new RedisCacheStore(redisClient, {
  defaultTtl: 1800000 // 30 minutes
});

// 3. Cache Manager with fallback
const cacheManager = new CacheManager(redisCache, memoryCache);

// 4. Smart cache invalidation
const invalidateUserCache = async (userId: string) => {
  const patterns = [
    `user:${userId}:*`,
    `subscription:${userId}:*`,
    `api-keys:${userId}:*`
  ];
  
  for (const pattern of patterns) {
    await cacheManager.invalidatePattern(pattern);
  }
};
```

### Database Optimization

**Connection pooling and query optimization**:
```typescript
// Connection pooling
const database = new DatabaseService({
  maxConnections: 20,
  idleTimeout: 30000,
  connectionTimeout: 10000
});

// Query optimization with prepared statements
const getUserSubscription = database.prepare(`
  SELECT s.*, p.name as product_name
  FROM subscriptions s
  JOIN products p ON s.product_id = p.id  
  WHERE s.user_id = $1 AND s.status = 'active'
`);

// Performance monitoring
const queryWithMetrics = async (query: string, params: any[]) => {
  const startTime = Date.now();
  const result = await database.query(query, params);
  const duration = Date.now() - startTime;
  
  logger.info('Query executed', {
    query: query.substring(0, 100),
    duration,
    rowCount: result.rows.length
  });
  
  return result;
};
```

### Rate Limiting Strategy

**Adaptive rate limiting based on user type and endpoint**:
```typescript
const rateLimitConfig = {
  // Global limits
  global: { windowMs: 3600000, maxRequests: 1000 }, // 1000/hour
  
  // Endpoint-specific limits
  endpoints: {
    '/auth/login': { windowMs: 60000, maxRequests: 5 },
    '/api-keys/create': { windowMs: 300000, maxRequests: 10 },
    '/billing/checkout': { windowMs: 60000, maxRequests: 3 }
  },
  
  // User-specific limits
  users: {
    'free': { windowMs: 3600000, maxRequests: 100 },
    'pro': { windowMs: 3600000, maxRequests: 1000 },
    'enterprise': { windowMs: 3600000, maxRequests: 10000 }
  }
};
```

## 🧩 Module Interaction Patterns

### Inter-Module Communication

**Modules communicate through well-defined interfaces**:
```typescript
// Event-based communication
interface ModuleEvent {
  type: string;
  source: string;
  data: any;
  timestamp: Date;
}

// Example: Billing module notifies Auth module
const notifySubscriptionCreated = async (userId: string, subscriptionId: string) => {
  const event: ModuleEvent = {
    type: 'subscription.created',
    source: 'billing',
    data: { userId, subscriptionId },
    timestamp: new Date()
  };
  
  // Update user permissions based on subscription
  await updateUserPermissions(userId, 'pro');
  
  // Log audit event
  await auditLogger.log({
    userId,
    action: 'subscription_activated',
    resource: 'user_subscription',
    details: { subscriptionId }
  });
};
```

### Shared Data Patterns

**Consistent data access patterns across modules**:
```typescript
// Standardized response format
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  requestId: string;
}

// Consistent error handling
const handleModuleError = (error: any, context: string) => {
  logger.error(`Module error in ${context}`, {
    error: error.message,
    stack: error.stack,
    context
  });
  
  if (error.type === 'validation') {
    return createAppError(ErrorType.VALIDATION_ERROR, error.message);
  }
  
  return createAppError(ErrorType.INTERNAL_ERROR, 'Module operation failed');
};
```

## 📊 Monitoring & Observability

### Comprehensive Monitoring

**Multi-layered monitoring approach**:
```typescript
// 1. Application Metrics
const metrics = {
  requests: {
    total: 12450,
    per_minute: 150,
    error_rate: 0.02
  },
  performance: {
    avg_response_time: 250,
    p95_response_time: 450,
    p99_response_time: 800
  },
  business: {
    active_subscriptions: 245,
    api_keys_created: 12,
    billing_events: 34
  }
};

// 2. Health Checks
const healthCheck = async () => {
  const checks = await Promise.allSettled([
    checkDatabaseHealth(),
    checkCacheHealth(), 
    checkExternalAPIs(),
    checkSystemResources()
  ]);
  
  return {
    status: checks.every(c => c.status === 'fulfilled') ? 'healthy' : 'unhealthy',
    checks: checks.map(c => ({
      name: c.name,
      status: c.status,
      details: c.value || c.reason
    }))
  };
};

// 3. Alerting Rules
const alertRules = [
  {
    name: 'High Error Rate',
    condition: 'error_rate > 0.05',
    severity: 'critical',
    action: 'notify_oncall'
  },
  {
    name: 'Database Slow',
    condition: 'db_query_time > 1000ms',
    severity: 'warning',
    action: 'log_and_monitor'
  }
];
```

### Audit & Compliance

**Comprehensive audit logging for compliance**:
```typescript
// Audit all significant actions
const auditableActions = [
  'user_created',
  'subscription_created',
  'api_key_created',
  'payment_processed',
  'data_exported',
  'admin_action'
];

// Audit log structure
interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: any;
  ipAddress: string;
  userAgent: string;
  success: boolean;
}

// Compliance queries
const getComplianceReport = async (startDate: Date, endDate: Date) => {
  return await database.query(`
    SELECT 
      action,
      COUNT(*) as count,
      COUNT(DISTINCT user_id) as unique_users
    FROM audit_logs 
    WHERE created_at BETWEEN $1 AND $2
    GROUP BY action
    ORDER BY count DESC
  `, [startDate, endDate]);
};
```

## 🚀 Deployment Architecture

### Zero-Ops Deployment

**Complete serverless deployment**:
```mermaid
graph TD
    A[GitHub Repository] --> B[GitHub Actions]
    B --> C[Build & Test]
    C --> D[Security Scan]
    D --> E[Deploy to Supabase]
    E --> F[Health Check]
    F --> G[Production Ready]
    
    H[Vercel] --> I[Frontend Deploy]
    J[Stripe] --> K[Webhook Config]
    L[DNS] --> M[Custom Domain]
```

### CI/CD Pipeline

**Production-ready CI/CD with quality gates**:
```yaml
# Parallel execution for speed
jobs:
  quality:        # Code quality & linting
  security:       # Security scanning
  unit-tests:     # Unit tests
  integration:    # Integration tests
  build:          # Build verification
  coverage:       # Test coverage
  
  # Quality gate - all must pass
  quality-gate:
    needs: [quality, security, unit-tests, integration, build, coverage]
    
  # Production deployment
  deploy:
    needs: quality-gate
    environment: production
```

### Environment Management

**Secure environment configuration**:
```bash
# Development
SUPABASE_URL=http://localhost:54321
NODE_ENV=development
LOG_LEVEL=debug

# Staging  
SUPABASE_URL=https://staging-project.supabase.co
NODE_ENV=staging
LOG_LEVEL=info

# Production
SUPABASE_URL=https://prod-project.supabase.co
NODE_ENV=production
LOG_LEVEL=warn
SENTRY_DSN=https://...
```

## 🔄 Data Flow Architecture

### Request Lifecycle

**Complete request processing flow**:
```typescript
// 1. Request arrives at Edge Function
const handleRequest = async (request: Request) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  try {
    // 2. Apply security middleware
    await securityMiddleware(request);
    
    // 3. Rate limiting
    await rateLimitMiddleware(request);
    
    // 4. Authentication
    const user = await authMiddleware(request);
    
    // 5. Validation
    const validatedData = await validateRequest(request);
    
    // 6. Business logic
    const result = await processBusinessLogic(validatedData, user);
    
    // 7. Audit logging
    await auditLogger.log({
      userId: user.id,
      action: 'api_request',
      resource: request.url,
      success: true,
      duration: Date.now() - startTime
    });
    
    // 8. Response with security headers
    return createSecureResponse(result, requestId);
    
  } catch (error) {
    // Error handling with proper logging
    await logError(error, requestId, request);
    return createErrorResponse(error, requestId);
  }
};
```

### Data Consistency

**ACID transactions and consistency patterns**:
```typescript
// Database transactions for consistency
const createSubscriptionWithAudit = async (userId: string, subscriptionData: any) => {
  const transaction = await database.beginTransaction();
  
  try {
    // 1. Update user subscription
    await transaction.query(
      'UPDATE profiles SET stripe_subscription_id = $1 WHERE id = $2',
      [subscriptionData.id, userId]
    );
    
    // 2. Create audit log
    await transaction.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [userId, 'subscription_created', subscriptionData]
    );
    
    // 3. Invalidate cache
    await cacheManager.invalidate(`user:${userId}:subscription`);
    
    await transaction.commit();
    
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
```

## 🎯 Design Decisions & Trade-offs

### Key Architectural Decisions

#### 1. **Supabase as Platform vs. Self-Managed**
- **Decision**: Use Supabase as complete platform
- **Reasoning**: Zero-ops, faster development, managed security
- **Trade-off**: Vendor lock-in vs. operational simplicity

#### 2. **Edge Functions vs. Traditional Server**
- **Decision**: Edge Functions for API endpoints
- **Reasoning**: Auto-scaling, global distribution, pay-per-use
- **Trade-off**: Cold starts vs. infinite scalability

#### 3. **Module-First vs. Layered Architecture**
- **Decision**: Module-first with shared utilities
- **Reasoning**: Better code organization, team scalability
- **Trade-off**: Potential duplication vs. clear boundaries

#### 4. **TypeScript Everywhere**
- **Decision**: Full TypeScript adoption
- **Reasoning**: Type safety, better developer experience
- **Trade-off**: Build complexity vs. runtime safety

#### 5. **Comprehensive Testing**
- **Decision**: 95% test coverage requirement
- **Reasoning**: Reliability, confidence in changes
- **Trade-off**: Development time vs. code quality

### Performance Trade-offs

#### Caching Strategy
```typescript
// Trade-off: Consistency vs. Performance
const cacheStrategy = {
  // High consistency, lower performance
  user_profile: { ttl: 60000 },    // 1 minute
  
  // Medium consistency, good performance  
  subscription: { ttl: 300000 },   // 5 minutes
  
  // Low consistency, high performance
  product_catalog: { ttl: 3600000 } // 1 hour
};
```

#### Database Optimization
```sql
-- Trade-off: Storage vs. Query Performance
-- Denormalized for read performance
CREATE TABLE user_subscription_view AS
SELECT 
  u.id,
  u.email,
  s.status,
  s.current_period_end,
  p.name as product_name
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id
LEFT JOIN products p ON s.product_id = p.id;

-- Indexes for performance
CREATE INDEX idx_user_subscription_status ON subscriptions(user_id, status);
CREATE INDEX idx_audit_logs_user_action ON audit_logs(user_id, action);
```

## 📈 Scalability Considerations

### Horizontal Scaling

**Design for scale from day one**:
```typescript
// Stateless design - no server-side sessions
const statelessAuth = {
  // JWT contains all necessary info
  validateToken: (token: string) => {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload; // No database lookup needed
  },
  
  // API keys are cached for performance
  validateApiKey: async (key: string) => {
    const cached = await cache.get(`api-key:${key}`);
    if (cached) return cached;
    
    const result = await database.query(
      'SELECT * FROM api_keys WHERE key_hash = $1',
      [hashApiKey(key)]
    );
    
    await cache.set(`api-key:${key}`, result, 300000);
    return result;
  }
};
```

### Performance Monitoring

**Continuous performance optimization**:
```typescript
// Performance budgets
const performanceBudgets = {
  api_response_time: 500,        // 500ms max
  database_query_time: 100,     // 100ms max
  cache_hit_rate: 0.8,          // 80% minimum
  error_rate: 0.01,             // 1% maximum
  uptime: 0.999                 // 99.9% minimum
};

// Auto-scaling triggers
const scalingTriggers = {
  scale_up: {
    cpu_usage: 70,
    memory_usage: 80,
    request_rate: 1000
  },
  scale_down: {
    cpu_usage: 30,
    memory_usage: 40,
    request_rate: 100
  }
};
```

## 🔧 Development Workflow

### Local Development

**Optimized development experience**:
```bash
# Complete local setup
pnpm dev:full    # Starts Supabase + Functions + Frontend

# Modular development
pnpm dev:backend # Backend only
pnpm dev:frontend # Frontend only

# Testing workflow
pnpm test:unit   # Fast unit tests
pnpm test:integration # Full integration tests
pnpm test:watch  # Watch mode for TDD
```

### Code Quality Gates

**Automated quality enforcement**:
```bash
# Pre-commit hooks
pnpm lint        # ESLint + Prettier
pnpm typecheck   # TypeScript validation
pnpm test:unit   # Unit tests

# CI/CD gates
pnpm security:scan   # Security vulnerabilities
pnpm test:coverage   # Coverage requirements
pnpm docs:generate   # Documentation sync
```

This architecture provides a solid foundation for a scalable, maintainable, and secure SaaS application while maintaining development velocity and operational simplicity.