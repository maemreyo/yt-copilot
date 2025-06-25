# 🔍 TypeScript Error Detection - Execution Guide

## 📋 Checklist của các lệnh cần chạy

### Phase 1: Environment Setup (5 phút)

```bash
# 1. Kiểm tra Node.js và pnpm version
node --version    # Phải là v20.10.0 (theo volta config)
pnpm --version    # Phải là 8.10.0

# 2. Clean install để đảm bảo dependencies fresh
pnpm clean:all
pnpm install

# 3. Kiểm tra workspace structure
pnpm ls --depth=0
```

**✅ Expected Results:**
- Node.js version v20.10.0
- pnpm version 8.10.0  
- Tất cả dependencies install thành công
- Workspace packages được liệt kê: web, @lean-saas/config, @lean-saas/db-types, @lean-saas/ui

### Phase 2: Global TypeScript Check (10 phút)

```bash
# 1. TypeScript check toàn bộ project
pnpm typecheck

# 2. Nếu có lỗi, chạy individual package checks
pnpm --filter "@lean-saas/config" typecheck
pnpm --filter "@lean-saas/db-types" typecheck  
pnpm --filter "web" typecheck

# 3. Check specific areas có thể có vấn đề
npx tsc --noEmit --project ./tsconfig.json
npx tsc --noEmit --project ./apps/web/tsconfig.json
```

**⚠️ Common Issues to Watch For:**
- `Cannot find module '@/*' or its corresponding type declarations`
- `Cannot find module '@shared/*' or its corresponding type declarations`
- `Cannot find module '@config/*' or its corresponding type declarations`
- `Cannot find module '@db-types/*' or its corresponding type declarations`

### Phase 3: Build Process Validation (10 phút)

```bash
# 1. Test backend build process
pnpm build:backend

# 2. Test frontend build process  
pnpm build

# 3. Kiểm tra generated files
ls -la packages/db-types/index.ts
ls -la supabase/_internal/
```

**✅ Expected Results:**
- `build:backend` chạy thành công (sync modules to Supabase)
- `build` command build tất cả apps thành công
- File `packages/db-types/index.ts` được tạo
- Thư mục `supabase/_internal/` chứa synced modules

### Phase 4: Runtime Validation (10 phút)

```bash
# 1. Chạy health check
pnpm health:check

# 2. Test API docs generation
pnpm docs:generate

# 3. Nếu có database, test seeding
pnpm db:start
pnpm db:reset  
pnpm db:seed:dev
```

**✅ Expected Results:**
- Health check passes
- API docs generate without errors
- Database operations complete successfully

## 🔧 Troubleshooting Common TypeScript Issues

### Issue 1: Path Mapping Problems

**Symptoms:**
```
Cannot find module '@/auth' or its corresponding type declarations
Cannot find module '@shared/utils/validation'
```

**Solution:**
1. Check `tsconfig.json` path mappings:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./src/shared/*"],
      "@/auth": ["./src/shared/utils/auth"],
      "@/validation": ["./src/shared/utils/validation"]
    }
  }
}
```

2. Verify files exist:
```bash
ls -la src/shared/utils/auth/index.ts
ls -la src/shared/utils/validation/index.ts
```

### Issue 2: Workspace Package References

**Symptoms:**
```
Cannot find module 'config' or its corresponding type declarations
Cannot find module '@lean-saas/config'
```

**Solution:**
1. Check workspace configuration in root `package.json`:
```json
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

2. Check package exports in `packages/config/package.json`:
```json
{
  "main": "./index.ts",
  "types": "./index.d.ts",
  "exports": {
    ".": {
      "types": "./index.d.ts",
      "default": "./index.ts"
    }
  }
}
```

3. Rebuild workspace:
```bash
pnpm install
pnpm build:backend
```

### Issue 3: Missing Type Definitions

**Symptoms:**
```
Property 'xyz' does not exist on type 'unknown'
Element implicitly has an 'any' type
```

**Solution:**
1. Check if `packages/db-types/index.ts` exists:
```bash
ls -la packages/db-types/index.ts
```

2. If missing, generate database types:
```bash
pnpm db:types:generate
```

3. Check type imports in modules:
```typescript
import type { Database } from '@db-types';
import type { ApiResponse } from '@config';
```

### Issue 4: Module Resolution Issues

**Symptoms:**
```
Module resolution kind is not specified, using 'NodeJs'
Cannot resolve module specifier
```

**Solution:**
1. Update `tsconfig.json` module resolution:
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler", // or "node"
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  }
}
```

2. Check import statements use correct syntax:
```typescript
// Good
import { validation } from '@/validation';
import config from '@config';

// Bad
import * as validation from '@/validation';
```

## 📊 Validation Checklist

### ✅ Phase 1 - Environment
- [ ] Node.js v20.10.0 installed
- [ ] pnpm 8.10.0 installed  
- [ ] Dependencies installed successfully
- [ ] Workspace packages discovered

### ✅ Phase 2 - TypeScript
- [ ] `pnpm typecheck` passes without errors
- [ ] Individual package typechecks pass
- [ ] No path mapping errors
- [ ] No workspace reference errors

### ✅ Phase 3 - Build Process
- [ ] `pnpm build:backend` succeeds
- [ ] `pnpm build` succeeds
- [ ] Generated files present
- [ ] Supabase sync completed

### ✅ Phase 4 - Runtime
- [ ] Health check passes
- [ ] API docs generate
- [ ] Database operations work

## 🚨 Critical Issues to Report

If you encounter any of these, please report immediately:

1. **Build Failures**: Any build command that fails completely
2. **Type Errors in Core Utilities**: Errors in `src/shared/utils/*`
3. **Workspace Resolution Issues**: Packages not found or misconfigured
4. **Path Mapping Failures**: `@/*` imports not resolving
5. **Database Type Generation Issues**: `db:types:generate` failing

## 📈 Success Metrics

The project is healthy when:
- ✅ All TypeScript checks pass (0 errors)
- ✅ All builds complete successfully
- ✅ All workspace packages resolve correctly
- ✅ Health check reports "All systems operational"
- ✅ API documentation generates without warnings

## 🔄 Next Steps After Validation

Once TypeScript validation is complete:
1. **Document any issues found** in the project issue tracker
2. **Update CI/CD pipeline** to include these checks
3. **Set up pre-commit hooks** for TypeScript validation
4. **Establish monitoring** for ongoing TypeScript health