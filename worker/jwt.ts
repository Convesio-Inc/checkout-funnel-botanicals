/**
 * JWT helpers for the thank-you redirect flow.
 * -----------------------------------------------------------------------------
 * The worker signs a short-lived HS256 token after a successful/pending
 * payment and appends it to the `redirectUrl` pointing at `/thank-you`. The
 * thank-you page then calls `/verify-token` to read the payload back.
 *
 * The signing secret is the `CPAY_SECRET` — all data in the payload
 * is already visible in the upstream payment response, so the token exists
 * purely to carry it through a browser redirect with a tamper-evident wrapper.
 * -----------------------------------------------------------------------------
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/** A single purchased line, carried through the redirect so the thank-you
 *  receipt can show exactly what was bought without any server-side store. */
export interface CheckoutLineItem {
  description: string;
  quantity: number;
  amountIncludingTax: number;
}

export interface CheckoutTokenPayload extends JWTPayload {
  payment_id: string;
  customer_id: string;
  order_number: string;
  status: string;
  /** Order total in minor units (cents). Optional — absent on resume tokens. */
  amount?: number;
  currency?: string;
  /** Display line items. Optional — absent on 3DS-resume tokens minted from
   *  an upstream lookup, where the SPA falls back to sessionStorage. */
  line_items?: CheckoutLineItem[];
  /** Customer + shipping details captured at `/payments` time and carried
   *  through to the `/order-confirmed` call, so the Store Manager webhook can
   *  be built statelessly on any success path (immediate, polled, or 3DS). All
   *  optional — resume tokens minted purely from an upstream lookup omit them
   *  and the webhook falls back to demo values. */
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  /** Raw shipping address in the ConvesioPay shape (`street`,
   *  `houseNumberOrName`, `city`, `stateOrProvince`, `postalCode`, `country`). */
  shipping_address?: Record<string, unknown>;
}

function keyFromSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signCheckoutToken(
  payload: Omit<CheckoutTokenPayload, keyof JWTPayload>,
  secret: string,
): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(keyFromSecret(secret));
}

export async function verifyCheckoutToken(
  token: string,
  secret: string,
): Promise<CheckoutTokenPayload> {
  const { payload } = await jwtVerify(token, keyFromSecret(secret));
  return payload as CheckoutTokenPayload;
}
