# Centralized Edge Functions Shared Utilities

This directory contains shared utilities for all Supabase Edge Functions, providing consistent functionality across all API endpoints.

## 📁 Structure

```
src/shared/edge-functions/_shared/
├── cors.ts         # CORS handling and headers
├── security.ts     # Security utilities and headers  
├── validation.ts   # Request validation and sanitization
├── errors.ts       # Error handling and responses
└── README.md       # This file
```

## 🚀 Usage

### CORS Headers

```typescript
import { corsHeaders, createCorsResponse, addCorsHeaders } from '@/cors';

// Basic CORS headers
const response = new Response(data, {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

// Handle OPTIONS requests
if (request.method === 'OPTIONS') {
  return createCorsResponse();
}

// Add CORS to existing response
return addCorsHeaders(existingResponse);
```

### Security Features

```typescript
import { 
  securityHeaders, 
  generateRequestId, 
  extractAuthToken,
  createSecureResponse 
} from '_shared/security.ts';

// Generate request ID for tracking
const requestId = generateRequestId();

// Extract auth token
const { token, type, error } = extractAuthToken(request);

// Create secure response with all headers
return createSecureResponse(data, 200, { 'X-Request-ID': requestId });
```

### Validation

```typescript
import { 
  validateRequestBody, 
  commonValidations,
  ValidationSchema 
} from '_shared/validation.ts';

// Define validation schema
const schema: ValidationSchema<CreateUserRequest> = {
  email: { 
    required: true, 
    type: 'string', 
    validate: commonValidations.email 
  },
  name: { 
    required: true, 
    type: 'string', 
    validate: commonValidations.nonEmptyString 
  },
};

// Validate request
const validation = validateRequestBody(requestBody, schema);
if (!validation.isValid) {
  return createValidationErrorResponse(validation.errors, requestId);
}
```

### Error Handling

```typescript
import { 
  AppError, 
  ErrorType, 
  createAppError,
  withErrorHandling 
} from '_shared/errors.ts';

// Throw typed errors
if (!user) {
  throw createAppError(
    ErrorType.AUTHENTICATION_ERROR,
    'Invalid credentials',
    { attempted: email },
    requestId
  );
}

// Wrap function with error handling
const handler = withErrorHandling(async (request: Request) => {
  // Your function logic here
}, requestId);
```

## 🔧 Complete Example

```typescript
import { serve } from 'std/http/server.ts';
import { 
  corsHeaders, 
  createCorsResponse,
  createCorsSuccessResponse 
} from '@/cors';
import { 
  generateRequestId,
  extractAuthToken,
  validateHttpMethod 
} from '_shared/security.ts';
import { 
  validateRequestBody,
  commonValidations,
  ValidationSchema 
} from '_shared/validation.ts';
import { 
  ErrorType,
  createAppError,
  withErrorHandling 
} from '_shared/errors.ts';

interface CreateItemRequest {
  name: string;
  description?: string;
}

const schema: ValidationSchema<CreateItemRequest> = {
  name: { 
    required: true, 
    type: 'string', 
    validate: commonValidations.nonEmptyString 
  },
  description: { 
    required: false, 
    type: 'string' 
  },
};

const handler = withErrorHandling(async (request: Request) => {
  const requestId = generateRequestId();

  // Handle CORS
  if (request.method === 'OPTIONS') {
    return createCorsResponse();
  }

  // Validate HTTP method
  if (!validateHttpMethod(request, ['POST'])) {
    throw createAppError(
      ErrorType.VALIDATION_ERROR,
      'Method not allowed',
      { allowedMethods: ['POST'] },
      requestId
    );
  }

  // Extract and validate auth token
  const { token, error } = extractAuthToken(request);
  if (error) {
    throw createAppError(
      ErrorType.AUTHENTICATION_ERROR,
      error,
      undefined,
      requestId
    );
  }

  // Parse and validate request body
  const body = await request.json();
  const validation = validateRequestBody<CreateItemRequest>(body, schema);
  
  if (!validation.isValid) {
    throw createAppError(
      ErrorType.VALIDATION_ERROR,
      'Validation failed',
      { errors: validation.errors },
      requestId
    );
  }

  // Your business logic here
  const item = await createItem(validation.sanitized!);

  // Return success response
  return createCorsSuccessResponse(
    { item, success: true },
    201,
    requestId
  );
}, generateRequestId());

serve(handler);
```

## 🎯 Benefits

- **Consistency**: All functions use the same error handling and validation patterns
- **Security**: Built-in security headers and request sanitization
- **Type Safety**: Full TypeScript support with proper interfaces
- **Monitoring**: Request tracking with unique IDs
- **DRY**: Shared code reduces duplication across functions
- **Maintainability**: Central location for shared utilities

## 🔄 Sync Process

These files are automatically copied to `supabase/_internal/functions/_shared/` by the sync script:

```bash
# Sync all modules including centralized _shared
pnpm build:backend

# Fix import paths for Deno compatibility  
pnpm fix:imports
```

## 📈 Best Practices

1. **Always use request IDs** for tracking and debugging
2. **Validate all inputs** using the validation utilities
3. **Handle CORS properly** for all requests
4. **Use typed errors** for consistent error responses
5. **Apply security headers** on all responses
6. **Log errors appropriately** for monitoring

## 🐛 Troubleshooting

If imports are not working:

1. Ensure sync script has run: `pnpm build:backend`
2. Fix import paths: `pnpm fix:imports`
3. Check Deno configuration: `deno.json` and `import_map.json`
4. Restart Deno language server in VS Code