/**
 * Cloudflare Worker entry
 * -----------------------------------------------------------------------------
 * Routes:
 *
 *   GET  /config        — returns the public-safe API key + client key the
 *                         browser SDK needs to boot the checkout component.
 *
 *   POST /payments      — server-side proxy to the ConvesioPay payments API.
 *                         Pre-signs a "marker" JWT (no `payment_id`) and
 *                         bakes it into the outgoing `returnUrl`, so that if
 *                         the payment takes the 3DS branch the user comes
 *                         back to `/thank-you?token=<marker>` and the resume
 *                         flow is gated by a worker-signed token. On
 *                         success/pending, signs a proper JWT with the
 *                         payment details and injects a `redirectUrl`
 *                         pointing at `/thank-you?token=<jwt>`. On an
 *                         `actionRequired` (3DS) response, passes the body
 *                         through untouched so the SPA can hand the user off
 *                         to the challenge URL directly.
 *
 *   POST /verify-token  — verifies a thank-you redirect JWT and returns its
 *                         decoded payload. Used by the thank-you page on load.
 *
 *   POST /issue-token   — takes a `payment_id`, looks it up upstream to make
 *                         sure it exists, and signs a fresh JWT from the
 *                         resulting data. Used by the thank-you page after a
 *                         3DS challenge: the SPA stashes the id in
 *                         sessionStorage before redirecting the user to the
 *                         bank, then calls this on return to hydrate a proper
 *                         `?token=<jwt>` URL.
 *
 *   POST /poll-payment  — proxies `GET /v1/payments/:id` upstream so the
 *                         thank-you page can poll for the latest status of
 *                         a pending payment every few seconds.
 *
 * Secrets are sourced from the Worker environment:
 *   CPAY_API_KEY, CPAY_SECRET, CPAY_INTEGRATION
 *   CPAY_ENVIRONMENT (plain var; defaults to "test")
 *
 * `CPAY_ENVIRONMENT` also selects the upstream host: sandbox secrets must hit
 * the sandbox host and vice-versa, otherwise the API returns 401.
 * -----------------------------------------------------------------------------
 */

import {
  signCheckoutToken,
  verifyCheckoutToken,
  type CheckoutLineItem,
  type CheckoutTokenPayload,
} from './jwt';
import { sendOrderCreated } from './store-manager';

/**
 * ConvesioPay uses separate sandboxes for test vs live. Sandbox API keys are
 * rejected by the live API (and vice-versa) with a 401 "Invalid authentication
 * token" — exactly the error we hit when the worker was unconditionally
 * pointing at the live host while the component was created with
 * `environment: "test"`.
 *
 * The matching hostnames mirror the dashboard split:
 *   live   → https://api.convesiopay.com
 *   test   → https://api-qa.convesiopay.com
 */
const CPAY_API_HOSTS = {
  live: 'https://api.convesiopay.com',
  test: 'https://api-qa.convesiopay.com',
} as const;

function paymentsEndpoint(environment: 'test' | 'live'): string {
  return `${CPAY_API_HOSTS[environment]}/v1/payments`;
}

function singlePaymentEndpoint(
  environment: 'test' | 'live',
  paymentId: string,
): string {
  return `${CPAY_API_HOSTS[environment]}/v1/payments/${encodeURIComponent(paymentId)}`;
}

function resolveEnvironment(env: Env): 'test' | 'live' {
  return env.CPAY_ENVIRONMENT === 'live' ? 'live' : 'test';
}

/**
 * Mirrors the client-side `SUCCESS_STATUSES` / `PENDING_STATUSES` sets in
 * `src/hooks/useCheckoutPayment.ts`. Kept duplicated here (rather than imported)
 * because the worker and SPA compile as separate bundles.
 */
const SUCCESS_STATUSES = new Set(['Succeeded', 'Authorized']);
const PENDING_STATUSES = new Set(['Pending']);

interface PaymentRequestBody {
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

const REQUIRED_FIELDS: Array<keyof PaymentRequestBody> = [
  'paymentToken',
  'email',
  'name',
  'amount',
  'currency',
];

interface UpstreamActionRequired {
  type?: string;
  redirectUrl?: string;
  [key: string]: unknown;
}

interface UpstreamPaymentResponse {
  id?: string;
  orderNumber?: string;
  status?: string;
  customerId?: string;
  customer?: { id?: string };
  actionRequired?: UpstreamActionRequired;
  error?: boolean;
  message?: string;
  [key: string]: unknown;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...init.headers,
    },
  });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Coerce the request's loosely-typed `lineItems` into the strict shape we
 *  bake into the JWT. Drops unknown fields (e.g. `sku`) and skips malformed
 *  entries so a bad item never blocks a payment. */
function toTokenLineItems(
  items: Array<Record<string, unknown>> | undefined,
): CheckoutLineItem[] | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const mapped = items.flatMap((item) => {
    const description = item.description;
    const quantity = item.quantity;
    const amountIncludingTax = item.amountIncludingTax;
    if (
      typeof description !== 'string' ||
      typeof quantity !== 'number' ||
      typeof amountIncludingTax !== 'number'
    ) {
      return [];
    }
    return [{ description, quantity, amountIncludingTax }];
  });
  return mapped.length > 0 ? mapped : undefined;
}

/** Combine ConvesioPay's split phone (`{ countryCode, number }`) into a single
 *  display string for the Store Manager payload. Undefined when absent. */
function buildCustomerPhone(
  phone: PaymentRequestBody['phone'],
): string | undefined {
  if (!phone) return undefined;
  const combined = `${phone.countryCode?.trim() ?? ''} ${
    phone.number?.trim() ?? ''
  }`.trim();
  return combined || undefined;
}

function requireSecret(env: Env): Response | string {
  // Trimmed defensively — when secrets come in via `.env` on Windows /
  // some editors, stray `\r` / whitespace gets appended and CP rejects
  // the header with "Invalid authentication token".
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

async function handleConfig(env: Env): Promise<Response> {
  return json(
    {
      apiKey: env.CPAY_API_KEY,
      environment: env.CPAY_ENVIRONMENT ?? 'test',
    },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}

async function handlePayments(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<PaymentRequestBody>(request);
  if (!body) {
    return json({ error: true, message: 'Invalid JSON body.' }, { status: 400 });
  }

  const missing = REQUIRED_FIELDS.filter((key) => {
    const value = body[key];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) {
    return json(
      { error: true, message: `Missing required field(s): ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const environment = resolveEnvironment(env);
  const origin = new URL(request.url).origin;
  const orderNumber = body.orderNumber ?? crypto.randomUUID();

  // Order data captured here is baked into the signed token(s) so the
  // `/order-confirmed` call can build the Store Manager payload statelessly on
  // any success path — including a 3DS return, where the worker no longer has
  // the original request body.
  const orderTokenFields = {
    amount: body.amount,
    currency: body.currency,
    line_items: toTokenLineItems(body.lineItems),
    customer_name: body.name,
    customer_email: body.email,
    customer_phone: buildCustomerPhone(body.phone),
    shipping_address: body.shippingAddress,
  };

  // Pre-sign a "marker" JWT that we'll bake into the `returnUrl` we hand to
  // ConvesioPay. If the payment takes the 3DS branch, the bank will send
  // the user back to this exact URL — so the thank-you page will receive
  // the marker verbatim and can use its presence as proof that the user
  // really came through our checkout (rather than e.g. browsing directly
  // to `/thank-you`).
  //
  // The marker intentionally carries no `payment_id` — we don't have one
  // yet at this point in the flow. The thank-you page uses the empty
  // `payment_id` as the signal to fall through to its resume path, which
  // reads the id from sessionStorage (or a ConvesioPay-appended
  // `?paymentId=`) and exchanges it for a real thank-you token via
  // `/issue-token`.
  let returnMarkerToken: string;
  try {
    returnMarkerToken = await signCheckoutToken(
      {
        payment_id: '',
        customer_id: '',
        order_number: orderNumber,
        status: 'AwaitingAction',
        ...orderTokenFields,
      },
      env.CPAY_SECRET
    );
  } catch (err) {
    return json(
      {
        error: true,
        message: `Failed to sign return marker token: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }

  const defaultReturnUrl = `${origin}/thank-you?token=${encodeURIComponent(
    returnMarkerToken,
  )}`;

  const payload = {
    ...body,
    integration: env.CPAY_INTEGRATION,
    returnUrl: body.returnUrl ?? defaultReturnUrl,
    orderNumber,
  };

  let upstream: Response;
  try {
    upstream = await fetch(paymentsEndpoint(environment), {
      method: 'POST',
      headers: {
        Authorization: secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json(
      {
        error: true,
        message: `Upstream payment request failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let parsed: UpstreamPaymentResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as UpstreamPaymentResponse) : null;
  } catch {
    parsed = null;
  }

  // Pass the upstream response straight through on failure — client's existing
  // failed-state handling uses `error` / `message` / non-2xx identically.
  const upstreamOk = upstream.ok && !parsed?.error;
  const upstreamStatus = parsed?.status;

  // ConvesioPay flagged the payment for a 3DS (or similar) challenge. We pass
  // the body through untouched — the SPA navigates the user to
  // `actionRequired.redirectUrl`, and on return hits `/issue-token` to mint
  // a thank-you JWT from the payment id it stashed in sessionStorage. Do this
  // before the terminal-ok check so a `Pending`+`actionRequired` response
  // doesn't accidentally short-circuit into the signed-redirect branch.
  if (upstreamOk && parsed?.actionRequired?.redirectUrl) {
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const isTerminalOk =
    upstreamOk &&
    !!upstreamStatus &&
    (SUCCESS_STATUSES.has(upstreamStatus) ||
      PENDING_STATUSES.has(upstreamStatus));

  if (!isTerminalOk || !parsed) {
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Success or pending → sign a JWT and inject a redirectUrl. All the payload
  // fields are already present on the response body we're about to return, so
  // the token exists purely to carry them through a browser redirect with a
  // tamper-evident wrapper.
  let token: string;
  try {
    token = await signCheckoutToken(
      {
        payment_id: parsed.id ?? '',
        customer_id: parsed.customerId ?? parsed.customer?.id ?? '',
        order_number: parsed.orderNumber ?? payload.orderNumber,
        status: upstreamStatus,
        ...orderTokenFields,
      },
      env.CPAY_SECRET
    );
  } catch (err) {
    return json(
      {
        error: true,
        message: `Failed to sign redirect token: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }

  const redirectUrl = `${origin}/thank-you?token=${encodeURIComponent(token)}`;

  return json(
    { ...parsed, redirectUrl },
    { status: upstream.status },
  );
}

interface VerifyTokenBody {
  token?: string;
}

async function handleVerifyToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<VerifyTokenBody>(request);
  const token = body?.token?.trim();
  if (!token) {
    return json(
      { error: true, message: 'Missing `token` in request body.' },
      { status: 400 },
    );
  }

  try {
    const payload = await verifyCheckoutToken(token, env.CPAY_SECRET);
    return json({
      payment_id: payload.payment_id,
      customer_id: payload.customer_id,
      order_number: payload.order_number,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      line_items: payload.line_items,
    });
  } catch (err) {
    return json(
      {
        error: true,
        message: `Invalid or expired token: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 },
    );
  }
}

interface IssueTokenBody {
  payment_id?: string;
  /** The "marker" JWT the worker pre-signed into the 3DS `returnUrl`. Carries
   *  the order data (line items, customer, shipping) captured at `/payments`
   *  time, which CPAY's payment lookup doesn't know about. Optional — absent
   *  when the SPA only recovered a bare `payment_id`. */
  token?: string;
}

/**
 * Mint a thank-you JWT for a previously-created payment.
 *
 * Used by the thank-you page after a 3DS challenge: on the initial
 * `/payments` call, the SPA stashed the payment id in sessionStorage and
 * redirected the user to the bank's `verify-customer` page. When the bank
 * redirects the user back to `/thank-you`, the SPA reads the id back out and
 * calls this endpoint to get a token it can feed into the normal verify +
 * poll flow.
 *
 * Authorization: we trust the caller's claim to the `payment_id` only to the
 * extent that the upstream API confirms the payment exists. The tokens minted
 * here are functionally equivalent to what `/poll-payment` already exposes
 * (payment status, which the id-holder could query directly), so this is not
 * a privilege upgrade — just a way to normalize the URL back to the canonical
 * `?token=<jwt>` shape that the rest of the thank-you flow expects.
 */
async function handleIssueToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<IssueTokenBody>(request);
  const paymentId = body?.payment_id?.trim();
  if (!paymentId) {
    return json(
      { error: true, message: 'Missing `payment_id` in request body.' },
      { status: 400 },
    );
  }

  // Recover the order data the worker stashed in the marker token at
  // `/payments` time, so the minted thank-you token still carries it through
  // to `/order-confirmed`. A bad/absent marker is non-fatal: the token is
  // still minted, the Store Manager payload just falls back to demo values.
  const markerToken = body?.token?.trim();
  let marker: CheckoutTokenPayload | null = null;
  if (markerToken) {
    try {
      marker = await verifyCheckoutToken(markerToken, env.CPAY_SECRET);
    } catch {
      marker = null;
    }
  }

  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const environment = resolveEnvironment(env);

  let upstream: Response;
  try {
    upstream = await fetch(singlePaymentEndpoint(environment, paymentId), {
      method: 'GET',
      headers: {
        Authorization: secret,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    return json(
      {
        error: true,
        message: `Upstream payment lookup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let parsed: UpstreamPaymentResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as UpstreamPaymentResponse) : null;
  } catch {
    parsed = null;
  }

  if (!upstream.ok || !parsed || parsed.error) {
    return json(
      {
        error: true,
        message:
          parsed?.message ??
          `Payment not found (${upstream.status} ${upstream.statusText})`,
      },
      { status: upstream.status === 200 ? 404 : upstream.status },
    );
  }

  let token: string;
  try {
    // Right after a 3DS challenge, upstream frequently still reports a
    // transitional status ("AwaitingAction", "AuthenticationPending", etc.)
    // until the webhook settles the payment. We only preserve the status
    // when it's a known terminal success — for everything else we write
    // "Pending" so the thank-you page starts polling instead of classifying
    // the in-between status as a failure. The client's immediate first poll
    // then fetches the authoritative status, so a payment that's genuinely
    // already terminal only costs one extra round trip.
    const statusForToken =
      parsed.status && SUCCESS_STATUSES.has(parsed.status)
        ? parsed.status
        : 'Pending';
    token = await signCheckoutToken(
      {
        payment_id: parsed.id ?? paymentId,
        customer_id: parsed.customerId ?? parsed.customer?.id ?? marker?.customer_id ?? '',
        order_number: parsed.orderNumber ?? marker?.order_number ?? '',
        status: statusForToken,
        amount: marker?.amount,
        currency: marker?.currency,
        line_items: marker?.line_items,
        customer_name: marker?.customer_name,
        customer_email: marker?.customer_email,
        customer_phone: marker?.customer_phone,
        shipping_address: marker?.shipping_address,
      },
      env.CPAY_SECRET
    );
  } catch (err) {
    return json(
      {
        error: true,
        message: `Failed to sign redirect token: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }

  return json({ token });
}

interface PollPaymentBody {
  payment_id?: string;
}

async function handlePollPayment(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<PollPaymentBody>(request);
  const paymentId = body?.payment_id?.trim();
  if (!paymentId) {
    return json(
      { error: true, message: 'Missing `payment_id` in request body.' },
      { status: 400 },
    );
  }

  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const environment = resolveEnvironment(env);

  let upstream: Response;
  try {
    upstream = await fetch(singlePaymentEndpoint(environment, paymentId), {
      method: 'GET',
      headers: {
        Authorization: secret,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    return json(
      {
        error: true,
        message: `Upstream payment poll failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

interface OrderConfirmedBody {
  token?: string;
}

/**
 * Fire the Store Manager `order.created` notification for a confirmed payment.
 *
 * Called by the thank-you page the first time its state machine reaches a
 * terminal success (immediate, polled, or post-3DS). It is intentionally
 * authoritative-by-recheck: the token's `status` can be stale (e.g. "Pending"
 * on the polled path) and could in principle be replayed, so we always re-`GET`
 * the payment upstream and only notify when CPAY itself reports success. The
 * customer / shipping / line-item display data comes from the (tamper-evident)
 * token. Best-effort: a missing `STORE_MANAGER_CAMPAIGN_URL` is a silent no-op.
 */
async function handleOrderConfirmed(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<OrderConfirmedBody>(request);
  const token = body?.token?.trim();
  if (!token) {
    return json(
      { error: true, message: 'Missing `token` in request body.' },
      { status: 400 },
    );
  }

  let payload: CheckoutTokenPayload;
  try {
    payload = await verifyCheckoutToken(token, env.CPAY_SECRET);
  } catch (err) {
    return json(
      {
        error: true,
        message: `Invalid or expired token: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 },
    );
  }

  const paymentId = payload.payment_id?.trim();
  if (!paymentId) {
    return json(
      { error: true, message: 'Token carries no payment to confirm.' },
      { status: 400 },
    );
  }

  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const environment = resolveEnvironment(env);

  let upstream: Response;
  try {
    upstream = await fetch(singlePaymentEndpoint(environment, paymentId), {
      method: 'GET',
      headers: { Authorization: secret, Accept: 'application/json' },
    });
  } catch (err) {
    return json(
      {
        error: true,
        message: `Upstream payment lookup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let parsed: UpstreamPaymentResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as UpstreamPaymentResponse) : null;
  } catch {
    parsed = null;
  }

  if (!upstream.ok || !parsed || parsed.error) {
    return json(
      {
        error: true,
        message:
          parsed?.message ??
          `Payment not found (${upstream.status} ${upstream.statusText})`,
      },
      { status: upstream.status === 200 ? 404 : upstream.status },
    );
  }

  // Only notify on a genuinely successful payment. Pending / failed are a
  // no-op (not an error — the poller may simply call us a touch early).
  if (!parsed.status || !SUCCESS_STATUSES.has(parsed.status)) {
    return json({ ok: false, status: parsed.status ?? null });
  }

  await sendOrderCreated(env, {
    externalId: parsed.orderNumber ?? payload.order_number ?? paymentId,
    customerId:
      parsed.customerId ?? parsed.customer?.id ?? payload.customer_id ?? null,
    customerName: payload.customer_name ?? null,
    customerEmail: payload.customer_email ?? null,
    customerPhone: payload.customer_phone ?? null,
    shippingAddress: payload.shipping_address ?? null,
    lineItems: payload.line_items ?? [],
    currency: payload.currency ?? null,
  });

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/config' && request.method === 'GET') {
      return handleConfig(env);
    }

    if (url.pathname === '/payments' && request.method === 'POST') {
      return handlePayments(request, env);
    }

    if (url.pathname === '/verify-token' && request.method === 'POST') {
      return handleVerifyToken(request, env);
    }

    if (url.pathname === '/issue-token' && request.method === 'POST') {
      return handleIssueToken(request, env);
    }

    if (url.pathname === '/poll-payment' && request.method === 'POST') {
      return handlePollPayment(request, env);
    }

    if (url.pathname === '/order-confirmed' && request.method === 'POST') {
      return handleOrderConfirmed(request, env);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
