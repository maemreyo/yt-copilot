// Common API types

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface PaginationParams {
  page?: number;
  perPage?: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination?: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
  };
}

// Auth types
export interface ApiKey {
  id: string;
  keyPrefix: string;
  name?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name?: string;
  expiresInDays?: number;
}

export interface CreateApiKeyResponse extends ApiResponse<ApiKey> {
  apiKey?: string; // Only returned once when created
}

// Billing types
export interface Subscription {
  id: string;
  status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid';
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  priceId: string;
  customerId: string;
}

export interface CreateCheckoutSessionRequest {
  priceId: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateCheckoutSessionResponse extends ApiResponse<{
  sessionId: string;
  url: string;
}> {}