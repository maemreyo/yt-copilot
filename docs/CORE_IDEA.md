# Bản Đặc Tả Kỹ Thuật Toàn Diện: Lean Supabase SaaS Starter (API-First & Modular)

## 1. Tầm nhìn & Triết lý Thiết kế

**Tầm nhìn**: Cung cấp một bộ khung khởi đầu (starter kit) cấp sản xuất cho các ứng dụng SaaS hiện đại. Bộ khung này phải tinh gọn, cực kỳ dễ vận hành, có khả năng mở rộng cao, và tuân thủ các thông lệ tốt nhất về bảo mật và trải nghiệm lập trình viên (DevEx).

**Triết lý cốt lõi**:

- **API-First là Tối thượng**: Backend là một sản phẩm API độc lập, không trạng thái, và "headless". Mọi tính năng đều được phơi bày qua các API endpoint được định nghĩa rõ ràng để phục vụ bất kỳ client nào (Web, Mobile, Extension, Server-to-Server).

- **Kiến trúc Module-First**: Code backend được tổ chức thành các module tính năng độc lập (ví dụ: billing, auth). Mỗi module chứa migrations, functions, và tests riêng, đảm bảo tính gắn kết cao và phụ thuộc thấp.

- **Supabase-First**: Ưu tiên tối đa việc sử dụng các dịch vụ được quản lý của Supabase (Postgres, Auth, Storage, Edge Functions). Coi Supabase là nền tảng vận hành, không phải là một thư viện đơn thuần.

- **Bảo mật theo Mặc định (Security by Default)**: Chính sách Bảo mật Cấp Hàng (Row Level Security - RLS) phải được BẬT trên tất cả các bảng chứa dữ liệu người dùng. Không có quyền truy cập nào được mặc định cho phép.

- **Trải nghiệm Lập trình viên (DevEx) Ưu việt**: Tự động hóa các tác vụ lặp đi lặp lại thông qua một bộ scripts mạnh mẽ. Cung cấp quy trình làm việc rõ ràng từ phát triển local đến triển khai production.

- **Hạ tầng Tự quản bằng không (Zero-Ops Infrastructure)**: Không yêu cầu lập trình viên phải tự quản lý server, database, hay container trong môi trường production.

## 2. Ngăn xếp Công nghệ (Tech Stack)

| Thành phần | Công nghệ được chỉ định |
|------------|-------------------------|
| Nền tảng Backend | Supabase (Postgres, Auth, Storage, Edge Functions) |
| Frontend Mẫu | Next.js (App Router) |
| Styling & UI Kit | Tailwind CSS & shadcn/ui |
| Quản lý Monorepo | pnpm workspaces |
| Thanh toán | Stripe |
| Gửi Email Giao dịch | Resend |
| Quản lý DB & CLI | Supabase CLI |
| Kiểm thử (Testing) | Vitest & Supertest |
| Linting & Formatting | ESLint & Prettier |
| Pre-commit Hooks | Husky |
| API Documentation | OpenAPI/Swagger |
| Deployment | Vercel (Frontend), GitHub Actions + Supabase CLI (Backend) |

## 3. Kiến trúc & Cấu trúc Thư mục (Bắt buộc)

Dự án phải tuân thủ nghiêm ngặt cấu trúc module-first sau:

```
/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── .husky/
│   ├── pre-commit
│   └── pre-push
├── apps/
│   └── web/
├── packages/
│   ├── ui/
│   ├── config/
│   └── db-types/
│       └── index.ts  # File tự động sinh, không sửa tay
├── docs/
│   ├── README.md
│   ├── API.md
│   ├── SETUP.md
│   ├── ARCHITECTURE.md
│   └── ADRs/
│       ├── 001-module-architecture.md
│       ├── 002-api-first-design.md
│       └── 003-supabase-as-platform.md
└── src/
    ├── shared/
    │   ├── types/
    │   │   ├── api.ts
    │   │   ├── database.ts
    │   │   └── common.ts
    │   ├── utils/
    │   │   ├── auth.ts
    │   │   ├── validation.ts
    │   │   ├── errors.ts
    │   │   └── rate-limiting.ts
    │   ├── constants/
    │   │   ├── api.ts
    │   │   ├── errors.ts
    │   │   └── rate-limits.ts
    │   └── config/
    │       ├── environment.ts
    │       ├── database.ts
    │       └── observability.ts
    └── modules/
        ├── core/
        │   ├── health/
        │   │   ├── functions/
        │   │   │   └── health-check/
        │   │   └── tests/
        │   └── errors/
        │       ├── functions/
        │       └── tests/
        ├── auth/
        │   ├── tests/
        │   ├── migrations/
        │   └── functions/
        └── billing/
            ├── tests/
            ├── migrations/
            └── functions/
├── scripts/
│   ├── sync-supabase.mjs
│   ├── seed-dev-data.mjs
│   ├── health-check.mjs
│   └── generate-api-docs.mjs
├── supabase/
│   ├── _internal/
│   │   ├── migrations/ # Thư mục đích cho migrations đã đồng bộ
│   │   └── functions/  # Thư mục đích cho functions đã đồng bộ
│   ├── seed.sql
│   └── config.toml
├── .env.example
├── package.json
└── ... (các file cấu hình khác)
```

**Quy tắc cho từng thư mục**:

- **src/shared/**: Chứa các utilities, types, constants và configuration dùng chung cho toàn bộ project
- **src/modules/**: Nguồn chân lý cho toàn bộ code backend. Mỗi thư mục con là một module tính năng
- **src/modules/core/**: Module đặc biệt chứa các chức năng cơ bản (health check, error handling)
- **src/modules/{module_name}/migrations/**: Chứa các file SQL migration cho module
- **src/modules/{module_name}/functions/**: Chứa các Edge Functions (API endpoints) cho module
- **src/modules/{module_name}/tests/**: Chứa các bài test (đặc biệt là integration tests) cho module
- **supabase/_internal/**: Thư mục chỉ dành cho Supabase CLI. Nit được tạo và quản lý tự động bởi script sync-supabase.mjs. Không bao giờ chỉnh sửa trực tiếp
- **scripts/sync-supabase.mjs**: Script Node.js đọc tất cả các module trong src/modules/, sau đó sao chép/symlink các file migrations và functions vào thư mục supabase/_internal/
- **packages/db-types/**: Chỉ chứa file index.ts được sinh ra tự động bởi lệnh pnpm db:types:generate
- **docs/**: Chứa toàn bộ documentation của project

## 4. Shared Components & Configuration

### 4.1 Environment Configuration

```typescript
// src/shared/config/environment.ts
import { z } from 'zod'

const environmentSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  
  // Stripe
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  
  // Resend
  RESEND_API_KEY: z.string(),
  
  // App Config
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  
  // Rate Limiting
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().default(60),
  
  // Monitoring
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  METRICS_ENABLED: z.coerce.boolean().default(false),
})

export const env = environmentSchema.parse(process.env)
```

### 4.2 Observability Configuration

```typescript
// src/shared/config/observability.ts
import { env } from './environment'

export const observabilityConfig = {
  logging: {
    level: env.LOG_LEVEL,
    structured: true,
    includeTimestamp: true,
  },
  metrics: {
    enabled: env.METRICS_ENABLED,
    prefix: 'saas_starter_',
  },
  rateLimiting: {
    requestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
    windowMs: 60 * 1000, // 1 minute
  }
}
```

### 4.3 Rate Limiting Utility

```typescript
// src/shared/utils/rate-limiting.ts
import { observabilityConfig } from '../config/observability'

interface RateLimitOptions {
  identifier: string
  limit?: number
  windowMs?: number
}

export async function checkRateLimit(options: RateLimitOptions): Promise<boolean> {
  // Implementation using Supabase or Redis
  // Return true if within limit, false if exceeded
}

export function createRateLimitMiddleware(defaultLimit?: number) {
  return async (req: Request) => {
    const identifier = extractIdentifier(req) // IP, user ID, API key, etc.
    const isAllowed = await checkRateLimit({
      identifier,
      limit: defaultLimit || observabilityConfig.rateLimiting.requestsPerMinute
    })
    
    if (!isAllowed) {
      throw new Error('Rate limit exceeded')
    }
  }
}
```

## 5. Chi tiết Triển khai Module Cốt lõi

### 5.1 Core Module

**Migrations**: N/A (không có database changes)

**Functions**:
- `GET /v1/health`: Health check endpoint trả về status của các services
- `GET /v1/version`: Version và build info

**Tests**: Health check integration tests

### 5.2 Auth Module

**Migrations**:
- `001_create_profiles_table.sql`: Tạo bảng profiles với các cột id (tham chiếu auth.users), stripe_customer_id, stripe_subscription_id, stripe_subscription_status. Phải có chính sách RLS cho phép người dùng đọc/cập nhật profile của chính họ
- `002_create_api_keys_table.sql`: Tạo bảng api_keys với user_id, key_hash, key_prefix. Phải có chính sách RLS cho phép người dùng quản lý key của chính họ

**Functions**:
- `POST /v1/api-keys/create`: Tạo API key mới, hash và lưu vào DB, trả về key gốc cho người dùng một lần duy nhất
- `DELETE /v1/api-keys/revoke`: Xóa một API key dựa trên prefix
- `GET /v1/api-keys`: List API keys của user (chỉ trả về metadata, không trả về key)

**Tests**: Integration test cho việc tạo và thu hồi API key, đảm bảo người dùng A không thể thu hồi key của người dùng B

### 5.3 Billing Module

**Migrations**: Schema đã được tích hợp trong profiles

**Functions**:
- `POST /v1/billing/create-checkout-session`: Input: priceId. Logic: Xác thực JWT, tìm hoặc tạo Stripe customer, tạo Stripe Checkout Session. Output: { sessionId }
- `POST /v1/billing/create-customer-portal`: Logic: Xác thực JWT, lấy Stripe customer ID, tạo link đến Stripe Customer Portal. Output: { url }
- `POST /v1/webhooks/stripe`: Public endpoint. Logic: Bắt buộc phải xác thực chữ ký webhook của Stripe. Xử lý các sự kiện (checkout.session.completed, customer.subscription.updated, etc.) và cập nhật bảng profiles
- `GET /v1/billing/subscription`: Lấy thông tin subscription hiện tại của user

**Tests**:
- Integration test cho việc tạo checkout session
- Unit test cho logic xử lý webhook (có thể mock dữ liệu sự kiện từ Stripe)

## 6. Workflow & Scripts

File package.json ở gốc sẽ chứa các script sau:

```json
{
  "scripts": {
    "dev": "pnpm build:backend && pnpm --parallel --stream dev",
    "dev:full": "concurrently \"pnpm db:start\" \"pnpm functions:serve\" \"pnpm --filter web dev\"",
    "build": "pnpm --filter \"./apps/*\" build",
    "build:backend": "node scripts/sync-supabase.mjs",
    
    "db:start": "supabase start",
    "db:stop": "supabase stop --no-backup",
    "db:reset": "supabase db reset",
    "db:push:prod": "supabase db push",
    "db:types:generate": "supabase gen types typescript --project-id $(grep 'project_id' supabase/config.toml | cut -d '\"' -f 2) --schema public > packages/db-types/index.ts",
    "db:seed:dev": "node scripts/seed-dev-data.mjs",
    
    "functions:serve": "supabase functions serve --no-verify-jwt",
    "functions:deploy:prod": "supabase functions deploy",
    "functions:new": "supabase functions new",
    
    "docs:generate": "node scripts/generate-api-docs.mjs",
    "docs:serve": "npx http-server docs/generated -p 8080",
    
    "lint": "pnpm --filter \"./**/*\" lint",
    "lint:fix": "pnpm lint --fix",
    "format": "prettier --write .",
    
    "test": "vitest",
    "test:integration:backend": "pnpm build:backend && pnpm db:reset && pnpm db:seed:dev && vitest run --dir src/modules",
    "test:unit": "vitest run --dir src/shared",
    
    "typecheck": "pnpm --filter \"./**/*\" typecheck",
    "health:check": "node scripts/health-check.mjs",
    
    "deploy:prod:backend": "echo '⚙️ Syncing backend modules...' && pnpm build:backend && echo '🚀 Deploying Supabase Backend...' && pnpm db:push:prod && pnpm functions:deploy:prod && echo '✅ Backend deployed!'",
    
    "clean:all": "rimraf node_modules '*/node_modules' '*/.next' '*/.turbo'",
    "prepare": "husky install"
  }
}
```

### Script chi tiết:

- **scripts/sync-supabase.mjs**: Đồng bộ các module từ src/modules vào supabase/_internal
- **scripts/seed-dev-data.mjs**: Tạo dữ liệu mẫu cho development
- **scripts/health-check.mjs**: Kiểm tra health của các services
- **scripts/generate-api-docs.mjs**: Tự động generate API documentation từ OpenAPI specs

## 7. Chiến lược Testing

### 7.1 Testing Environment Setup

Việc kiểm thử backend phải độc lập với frontend và chạy trên môi trường Supabase local.

### 7.2 Test Types

**Unit Tests**: 
- Sử dụng vitest để test các hàm logic thuần túy trong src/shared/utils
- Test các utilities như validation, rate limiting, error handling

**Integration Tests** (Quan trọng nhất):
- **Môi trường**: Chạy trên môi trường Supabase local (supabase start)
- **Quy trình**: Script test:integration:backend phải tự động reset database và seed data trước khi chạy test
- **Công cụ**: Dùng vitest làm test runner và supertest để gửi HTTP request thực sự đến các Edge Functions đang chạy local

**Test Structure**:
```typescript
// src/modules/auth/tests/api-keys.integration.test.ts
describe('API Keys Integration Tests', () => {
  let testUser: User
  let authToken: string

  beforeAll(async () => {
    // Setup: Tạo test user và lấy JWT token
    testUser = await createTestUser()
    authToken = await getAuthToken(testUser)
  })

  afterAll(async () => {
    // Teardown: Dọn dẹp test data
    await cleanupTestUser(testUser)
  })

  describe('POST /v1/api-keys/create', () => {
    it('should create new API key for authenticated user', async () => {
      // Act: Gửi request tạo API key
      const response = await request(BASE_URL)
        .post('/v1/api-keys/create')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201)

      // Assert Response: Kiểm tra response structure
      expect(response.body).toHaveProperty('apiKey')
      expect(response.body).toHaveProperty('prefix')

      // Assert Database: Kiểm tra DB state
      const apiKey = await getApiKeyFromDB(response.body.prefix)
      expect(apiKey.user_id).toBe(testUser.id)
    })
  })
})
```

## 8. Security & Rate Limiting

### 8.1 API Security Headers

Tất cả API responses phải include security headers:
```typescript
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
}
```

### 8.2 Rate Limiting Strategy

- **Global Rate Limit**: 1000 requests/hour per IP
- **Authentication Endpoints**: 10 requests/minute per IP
- **API Key Endpoints**: 5 requests/minute per user
- **Billing Endpoints**: 20 requests/minute per user

### 8.3 API Key Security

- API keys phải được hash với bcrypt trước khi lưu DB
- Chỉ trả về plain text API key một lần duy nhất khi tạo
- Support API key rotation
- API key phải có expiration date

## 9. API Documentation

### 9.1 OpenAPI Specification

Mỗi module phải có file `openapi.yaml` define API spec:

```yaml
# src/modules/auth/openapi.yaml
openapi: 3.0.0
info:
  title: Auth Module API
  version: 1.0.0
paths:
  /v1/api-keys/create:
    post:
      summary: Create new API key
      security:
        - bearerAuth: []
      responses:
        '201':
          description: API key created successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  apiKey:
                    type: string
                  prefix:
                    type: string
```

### 9.2 Documentation Generation

Script `generate-api-docs.mjs` sẽ:
1. Đọc tất cả file `openapi.yaml` từ các module
2. Merge thành một spec hoàn chỉnh
3. Generate HTML documentation với Swagger UI
4. Lưu vào `docs/generated/`

## 10. Developer Experience (DevEx)

### 10.1 Pre-commit Hooks

```bash
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm lint
pnpm typecheck
pnpm test:unit
```

### 10.2 Hot Reload cho Development

Trong development mode, Edge Functions sẽ tự động reload khi file thay đổi:
```bash
# Package.json script sẽ watch cho file changes
pnpm dev:full
```

### 10.3 Environment Variables

File `.env.example` đầy đủ:
```bash
# Supabase
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Resend
RESEND_API_KEY=re_...

# App Configuration
APP_URL=http://localhost:3000
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_MINUTE=60

# Monitoring
LOG_LEVEL=info
METRICS_ENABLED=false
```

## 11. CI/CD Pipeline

### 11.1 GitHub Actions - CI (.github/workflows/ci.yml)

```yaml
name: CI
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build:backend
      
      # Setup Supabase for integration tests
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: pnpm test:integration:backend
```

### 11.2 GitHub Actions - Deploy (.github/workflows/deploy.yml)

```yaml
name: Deploy to Production
on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm deploy:prod:backend
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
```

## 12. CORS Configuration

Trong `supabase/config.toml`:

```toml
[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[api.cors]
enabled = true
# Chỉ định chính xác các origins, tuyệt đối không dùng "*"
allowed_origins = ["http://localhost:3000", "https://yourdomain.com"]
allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
allowed_headers = ["authorization", "content-type", "x-client-info"]
```

## 13. Architecture Decision Records (ADRs)

Trong thư mục `docs/ADRs/`, cần có các file:

- **001-module-architecture.md**: Quyết định sử dụng module-first architecture
- **002-api-first-design.md**: Quyết định thiết kế API-first
- **003-supabase-as-platform.md**: Quyết định sử dụng Supabase làm platform chính
- **004-rate-limiting-strategy.md**: Chiến lược rate limiting
- **005-testing-approach.md**: Phương pháp testing được chọn

Mỗi ADR phải follow format:
```markdown
# ADR-XXX: Title

## Status
Accepted/Proposed/Deprecated

## Context
Tình huống và vấn đề cần giải quyết

## Decision
Quyết định được đưa ra

## Consequences
Hậu quả tích cực và tiêu cực của quyết định
```