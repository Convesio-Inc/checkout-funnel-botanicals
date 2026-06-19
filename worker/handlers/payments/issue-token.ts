import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { payments } from '../../db/schema';
import { signCheckoutToken } from '../../jwt';
import { json, readJson } from '../common';
import { applyParsedUpstreamToPaymentRow } from './apply-upstream-to-payment';
import {
  requireSecret,
  resolveEnvironment,
  singlePaymentEndpoint,
  SUCCESS_STATUSES,
  type UpstreamPaymentResponse,
} from './shared';

interface IssueTokenBody {
  order_id?: number | string;
}

export async function handleIssueToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<IssueTokenBody>(request);
  const orderId = Number(body?.order_id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return json(
      { error: true, message: 'Missing or invalid `order_id` in request body.' },
      { status: 400 },
    );
  }

  const [latestPayment] = await db(env)
    .select()
    .from(payments)
    .where(
      and(eq(payments.order_id, orderId), isNotNull(payments.cpay_id)),
    )
    .orderBy(desc(payments.id))
    .limit(1);

  if (!latestPayment) {
    return json(
      { error: true, message: 'No payment found for the given order.' },
      { status: 404 },
    );
  }

  const cpayId = latestPayment.cpay_id;
  if (!cpayId) {
    return json(
      { error: true, message: 'No payment found for the given order.' },
      { status: 404 },
    );
  }

  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const environment = resolveEnvironment(env);

  let upstream: Response;
  try {
    upstream = await fetch(
      singlePaymentEndpoint(environment, cpayId),
      {
        method: 'GET',
        headers: {
          Authorization: secret,
          Accept: 'application/json',
        },
      },
    );
  } catch (err) {
    return json(
      {
        error: true,
        message: `Upstream payment lookup failed: ${err instanceof Error ? err.message : String(err)
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

  // Apply the upstream status to our payment row (merges line items into the
  // order and saves the stored payment method id when the payment has already
  // succeeded by the time the user returns from the 3DS challenge).
  await applyParsedUpstreamToPaymentRow(
    env,
    db(env),
    orderId,
    latestPayment,
    parsed,
  );

  let token: string;
  try {
    const statusForToken =
      parsed.status && SUCCESS_STATUSES.has(parsed.status)
        ? parsed.status
        : 'Pending';
    token = await signCheckoutToken(
      {
        order_id: orderId,
        payment_id: parsed.id ?? cpayId,
        customer_id: parsed.customerId ?? parsed.customer?.id ?? '',
        status: statusForToken,
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

  return json({ token });
}