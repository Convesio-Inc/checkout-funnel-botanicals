import { json } from '../common';

const CPAY_API_HOSTS = {
  live: 'https://api.convesiopay.com',
  test: 'https://api-qa.convesiopay.com',
} as const;

export function paymentsEndpoint(environment: 'test' | 'live'): string {
  return `${CPAY_API_HOSTS[environment]}/v1/payments`;
}

export function singlePaymentEndpoint(
  environment: 'test' | 'live',
  paymentId: string,
): string {
  return `${CPAY_API_HOSTS[environment]}/v1/payments/${encodeURIComponent(paymentId)}`;
}

export function storedCardEndpoint(environment: 'test' | 'live'): string {
  return `${CPAY_API_HOSTS[environment]}/v1/payments/stored-card`;
}

export function resolveEnvironment(env: Env): 'test' | 'live' {
  return env.CPAY_ENVIRONMENT === 'live' ? 'live' : 'test';
}

// Intentionally duplicated in src/hooks/useCheckoutPayment.ts and
// src/hooks/useThankYouPayment.ts — the SPA bundles separately and cannot
// import from the worker. Keep all three in sync when adding statuses.
export const SUCCESS_STATUSES = new Set(['Succeeded', 'Authorized']);
export const PENDING_STATUSES = new Set(['Pending']);

export interface PaymentRequestBody {
  paymentToken: string;
  email: string;
  name: string;
  amount: number;
  currency: string;
  orderNumber?: string;
  returnUrl?: string;
  phone?: { number: string; countryCode: string };
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
  lineItems?: Array<Record<string, unknown>>;
  captureMethod?: 'automatic' | 'manual';
  storePaymentMethod?: boolean;
}

export const REQUIRED_FIELDS: Array<keyof PaymentRequestBody> = [
  'paymentToken',
  'email',
  'name',
  'amount',
  'currency',
];

export interface UpstreamActionRequired {
  type?: string;
  redirectUrl?: string;
  [key: string]: unknown;
}

export interface UpstreamPaymentResponse {
  id?: string;
  orderNumber?: string;
  status?: string;
  customerId?: string;
  customer?: { id?: string };
  actionRequired?: UpstreamActionRequired;
  paymentMethodDetails?: { storedPaymentMethodId?: string;[key: string]: unknown };
  error?: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface CardOnFilePaymentRequestBody {
  order_id: number;
  amount: number;
  currency: string;
  lineItems?: Array<Record<string, unknown>>;
}

export function requireSecret(env: Env): Response | string {
  const secret = env.CPAY_SECRET?.trim();
  if (!secret) {
    return json(
      {
        error: true,
        message:
          'Worker is missing CPAY_SECRET. Set it via `wrangler secret put` or your `.env` / `.dev.vars`.',
      },
      { status: 500 },
    );
  }
  return secret;
}