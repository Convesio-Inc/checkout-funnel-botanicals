import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { orders, payments } from '../../db/schema';
import { signCheckoutToken } from '../../jwt';
import { json, readJson } from '../common';
import { aggregateLineItems } from './aggregate-items';
import {
  PENDING_STATUSES,
  type PaymentRequestBody,
  paymentsEndpoint,
  REQUIRED_FIELDS,
  requireSecret,
  resolveEnvironment,
  singlePaymentEndpoint,
  SUCCESS_STATUSES,
  type UpstreamPaymentResponse,
} from './shared';

// Stable JSON serializer used to compare two shipping addresses for equality.
// Plain `JSON.stringify` doesn't sort keys, so two semantically equal objects
// can serialize differently — that would cause us to spuriously create a new
// order when the FE just changed property order.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
    .join(',')}}`;
}

function shippingMatches(
  storedShippingJson: string,
  incoming: Record<string, unknown> | undefined,
): boolean {
  let stored: unknown;
  try {
    stored = JSON.parse(storedShippingJson);
  } catch {
    return false;
  }
  return canonicalize(stored) === canonicalize(incoming ?? null);
}

function buildCustomerPhone(
  phone: PaymentRequestBody['phone'],
): string | null {
  if (!phone) return null;
  const prefix = phone.countryCode?.trim() ?? '';
  const number = phone.number?.trim() ?? '';
  if (!prefix && !number) return null;
  return `${prefix} ${number}`.trim();
}

export async function handlePayments(
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

  const database = db(env);
  const now = Date.now();
  const incomingShippingJson = JSON.stringify(body.shippingAddress ?? null);

  // Find-or-create order: if the most recent order is still pending sync AND
  // its shipping info matches this request, reuse it. Otherwise create a new
  // one. CartRover doesn't allow editing synced orders, so we can only attach
  // to orders that haven't been pushed to CartRover yet.
  const [latestOrder] = await database
    .select()
    .from(orders)
    .orderBy(desc(orders.id))
    .limit(1);

  let orderId: number;
  if (
    latestOrder &&
    latestOrder.crover_synced === 'pending' &&
    shippingMatches(latestOrder.shipping_info, body.shippingAddress) &&
    !latestOrder.stored_payment_method_id
  ) {
    orderId = latestOrder.id;
  } else {
    const orderInsert = await database.insert(orders).values({
      crover_synced: 'pending',
      shipping_info: incomingShippingJson,
      items: '[]',
      created_at: now,
    });
    const insertedOrderId = Number(orderInsert.meta.last_row_id);
    if (!Number.isFinite(insertedOrderId) || insertedOrderId <= 0) {
      return json(
        { error: true, message: 'Failed to allocate order id.' },
        { status: 500 },
      );
    }
    orderId = insertedOrderId;
  }

  // Insert the payment row tied to that order.
  const lineItemsForRow = JSON.stringify(body.lineItems ?? []);
  const paymentInsert = await database.insert(payments).values({
    order_id: orderId,
    cpay_status: 'pending',
    customer_name: body.name,
    customer_email: body.email,
    customer_phone: buildCustomerPhone(body.phone),
    line_items: lineItemsForRow,
    created_at: now,
  });
  const paymentRowId = Number(paymentInsert.meta.last_row_id);

  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const environment = resolveEnvironment(env);
  const origin = new URL(request.url).origin;

  // Pre-sign a marker token so the 3DS return URL has something stable to
  // land on. The marker carries `order_id` (the FE can read it directly) but
  // no `payment_id` yet — that gets minted after the upstream call returns.
  let returnMarkerToken: string;
  try {
    returnMarkerToken = await signCheckoutToken(
      {
        order_id: orderId,
        payment_id: '',
        customer_id: '',
        status: 'AwaitingAction',
      },
      env.CPAY_SECRET,
    );
  } catch (err) {
    return json(
      {
        error: true,
        message: `Failed to sign return marker token: ${err instanceof Error ? err.message : String(err)
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
    orderNumber: `${paymentRowId}-${now}`,
    storePaymentMethod: true,
    lineItems: body.lineItems?.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      amountIncludingTax: item.amountIncludingTax,
    })),
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
        message: `Upstream payment request failed: ${err instanceof Error ? err.message : String(err)
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

  const upstreamOk = upstream.ok && !parsed?.error;
  const upstreamStatus = parsed?.status;

  if (upstreamOk && parsed?.actionRequired?.redirectUrl) {
    if (parsed.id) {
      await database
        .update(payments)
        .set({
          cpay_id: parsed.id,
          cpay_status: 'pending',
          customer_id: parsed.customerId ?? parsed.customer?.id ?? null,
        })
        .where(eq(payments.id, paymentRowId));
    }
    return json({ ...parsed, order_id: orderId }, { status: upstream.status });
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

  const isSuccess = SUCCESS_STATUSES.has(upstreamStatus);
  const customerIdFromUpstream =
    parsed.customerId ?? parsed.customer?.id ?? null;

  await database
    .update(payments)
    .set({
      cpay_id: parsed.id,
      cpay_status: isSuccess ? 'success' : 'pending',
      customer_id: customerIdFromUpstream,
    })
    .where(eq(payments.id, paymentRowId));

  // If the payment is immediately successful, fold its line items into the
  // order's aggregated items column. Pending payments are merged later, when
  // they flip to success via /poll-payment or the sync cron.
  if (isSuccess && body.lineItems && body.lineItems.length > 0) {
    await mergeLineItemsIntoOrder(env, orderId, body.lineItems);
  }

  // The POST response doesn't include paymentMethodDetails — fetch the payment
  // via GET to get the storedPaymentMethodId that ConvesioPay returns there.
  if (isSuccess && parsed.id) {
    try {
      const getResponse = await fetch(singlePaymentEndpoint(environment, parsed.id), {
        method: 'GET',
        headers: { Authorization: secret, Accept: 'application/json' },
      });
      if (getResponse.ok) {
        const getBody = (await getResponse.json()) as UpstreamPaymentResponse;
        const storedMethodId = getBody.paymentMethodDetails?.storedPaymentMethodId ?? null;
        if (storedMethodId) {
          await database
            .update(orders)
            .set({ stored_payment_method_id: storedMethodId })
            .where(eq(orders.id, orderId));
        }
      }
    } catch {
      // Non-fatal: the stored method will remain unset; the upsell won't be
      // available but the main checkout flow is unaffected.
    }
  }

  let token: string;
  try {
    token = await signCheckoutToken(
      {
        order_id: orderId,
        payment_id: parsed.id ?? '',
        customer_id: customerIdFromUpstream ?? '',
        status: upstreamStatus,
      },
      env.CPAY_SECRET,
    );
  } catch (err) {
    return json(
      {
        error: true,
        message: `Failed to sign redirect token: ${err instanceof Error ? err.message : String(err)
          }`,
      },
      { status: 500 },
    );
  }

  const redirectUrl = `${origin}/thank-you?token=${encodeURIComponent(token)}`;

  return json(
    { ...parsed, order_id: orderId, redirectUrl },
    { status: upstream.status },
  );
}

export async function mergeLineItemsIntoOrder(
  env: Env,
  orderId: number,
  newLineItems: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  const database = db(env);
  const [order] = await database
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return;

  let existing: unknown;
  try {
    existing = JSON.parse(order.items);
  } catch {
    existing = [];
  }
  const existingArr = Array.isArray(existing) ? existing : [];
  const merged = aggregateLineItems([
    ...(existingArr as Array<Record<string, unknown>>),
    ...newLineItems,
  ]);

  await database
    .update(orders)
    .set({ items: JSON.stringify(merged) })
    .where(eq(orders.id, orderId));
}