import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { orders, payments } from '../../db/schema';
import { verifyCheckoutToken } from '../../jwt';
import { json, readJson } from '../common';
import {
  aggregateLineItems,
  type AnyLineItem,
} from './aggregate-items';
import { CPAY_STATUS_SCHEDULED } from './payment-status';

interface VerifyTokenBody {
  token?: string;
}

export async function handleVerifyToken(
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

  let payload;
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

  // Hydrate the response with the order's customer + shipping context plus
  // the aggregated item list, so follow-on flows (the upsell modal and the
  // thank-you receipt summary) don't need to ferry those fields through
  // sessionStorage or fetch them separately.
  let customerEmail: string | null = null;
  let customerName: string | null = null;
  let customerPhone: string | null = null;
  let shippingAddress: unknown = null;
  type ReceiptLineItem = ReturnType<typeof aggregateLineItems>[number] & {
    chargePending?: boolean;
  };

  let items: ReceiptLineItem[] = [];

  if (typeof payload.order_id === 'number') {
    const database = db(env);
    const [order] = await database
      .select()
      .from(orders)
      .where(eq(orders.id, payload.order_id))
      .limit(1);
    if (order) {
      try {
        shippingAddress = JSON.parse(order.shipping_info);
      } catch {
        shippingAddress = null;
      }

      let rawPaid: AnyLineItem[] = [];
      try {
        const parsedItems = JSON.parse(order.items);
        if (Array.isArray(parsedItems)) {
          rawPaid = parsedItems as AnyLineItem[];
        }
      } catch {
        rawPaid = [];
      }
      const paidAggregated = aggregateLineItems(rawPaid);

      const scheduledRows = await database
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.order_id, payload.order_id),
            eq(payments.cpay_status, CPAY_STATUS_SCHEDULED),
          ),
        );

      const scheduledRaw: AnyLineItem[] = [];
      for (const row of scheduledRows) {
        try {
          const arr = JSON.parse(row.line_items);
          if (Array.isArray(arr)) {
            scheduledRaw.push(...(arr as AnyLineItem[]));
          }
        } catch {
          // ignore malformed row
        }
      }
      const scheduledAggregated = aggregateLineItems(scheduledRaw);

      const paidSkus = new Set(paidAggregated.map((i) => i.sku));
      items = [
        ...paidAggregated.map((i) => ({ ...i })),
        ...scheduledAggregated
          .filter((s) => !paidSkus.has(s.sku))
          .map((s) => ({ ...s, chargePending: true })),
      ];
    }
    const [latestPayment] = await database
      .select()
      .from(payments)
      .where(eq(payments.order_id, payload.order_id))
      .orderBy(desc(payments.id))
      .limit(1);
    if (latestPayment) {
      customerEmail = latestPayment.customer_email;
      customerName = latestPayment.customer_name;
      customerPhone = latestPayment.customer_phone;
    }
  }

  return json({
    order_id: payload.order_id,
    payment_id: payload.payment_id,
    customer_id: payload.customer_id,
    status: payload.status,
    customer_email: customerEmail,
    customer_name: customerName,
    customer_phone: customerPhone,
    shipping_address: shippingAddress,
    items,
  });
}
