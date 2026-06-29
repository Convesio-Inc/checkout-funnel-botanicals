/**
 * useThankYouPayment
 * -----------------------------------------------------------------------------
 * Drives the thank-you page's "is the payment done yet?" lifecycle.
 *
 * The hook accepts two inputs — a canonical `?token=<jwt>` read from the URL,
 * and an optional `paymentIdHint` (either a `?paymentId=` query param that
 * ConvesioPay may append when redirecting the user back from a 3DS challenge,
 * or — if neither is present — a value stashed in sessionStorage by
 * `useCheckoutPayment` before the 3DS handoff).
 *
 * Flow:
 *
 *   1. If we have a `token`, POST it to `/verify-token` to decode it.
 *      - If the decoded payload has a `payment_id`, it's a normal thank-you
 *        token: continue with verify + poll.
 *      - If `payment_id` is empty, it's the "marker" JWT the worker pre-
 *        signed into `returnUrl` before the payments call, which means we
 *        just came back from a 3DS challenge. Fall through to step 2.
 *   2. If we need to resume, take the `payment_id` from (in order): a
 *      `?paymentId=` URL param, the sessionStorage bridge written by
 *      `useCheckoutPayment`. POST it to `/issue-token` to mint a proper
 *      thank-you JWT, rewrite the URL to `?token=<jwt>` via
 *      `history.replaceState` (so copy-paste / refresh Just Work), clear the
 *      sessionStorage entry, then run verify + poll as if we had a token
 *      all along.
 *   3. If the decoded status is already terminal (Succeeded / Authorized →
 *      "succeeded", or anything else non-pending → "failed"), we're done.
 *   4. If the status is "Pending", poll `/poll-payment` every 5s with
 *      `{ payment_id }` and map each response's status through the same
 *      sets. Clears the interval on terminal status or unmount.
 *
 * Exposed state:
 *
 *   {
 *     state,    // "verifying" | "pending" | "succeeded" | "failed"
 *     payload,  // decoded JWT body (once verified)
 *     error,    // Error | null — set on verify failure / missing token /
 *               // non-ok poll responses with a failed status
 *   }
 * -----------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from "react";

import {
  PENDING_PAYMENT_MAX_AGE_MS,
  PENDING_PAYMENT_SESSION_KEY,
  type PendingPaymentSessionEntry,
} from "@/hooks/useCheckoutPayment";

export type ThankYouState =
  | "verifying"
  | "pending"
  | "succeeded"
  | "failed";

export interface CheckoutLineItem {
  description: string;
  quantity: number;
  amountIncludingTax: number;
}

export interface CheckoutTokenPayload {
  payment_id: string;
  customer_id: string;
  order_number: string;
  status: string;
  amount?: number;
  currency?: string;
  line_items?: CheckoutLineItem[];
}

export interface UseThankYouPaymentOptions {
  /** The `?token=<jwt>` read from the URL. When present, the hook verifies
   *  it directly. */
  token: string | null;
  /** A `payment_id` found outside the JWT — either a `?paymentId=` URL query
   *  param (if ConvesioPay appends one on the 3DS return) or, as a fallback,
   *  the value stashed in sessionStorage by `useCheckoutPayment`. The hook
   *  exchanges it for a JWT via `/issue-token` before proceeding. */
  paymentIdHint: string | null;
}

export interface UseThankYouPaymentResult {
  state: ThankYouState;
  payload: CheckoutTokenPayload | null;
  error: Error | null;
}

const SUCCESS_STATUSES = new Set(["Succeeded", "Authorized"]);
const PENDING_STATUSES = new Set(["Pending"]);

const POLL_INTERVAL_MS = 5000;

function classify(status: string | undefined): ThankYouState {
  if (status && SUCCESS_STATUSES.has(status)) return "succeeded";
  if (status && PENDING_STATUSES.has(status)) return "pending";
  return "failed";
}

/**
 * Pull the sessionStorage entry written by `useCheckoutPayment` before the
 * 3DS handoff. Returns `null` (and clears the entry) if the payload is
 * malformed or older than `PENDING_PAYMENT_MAX_AGE_MS` — the latter catches
 * the case where the user abandoned the challenge and returned to this page
 * hours or days later via an open tab.
 */
function readPendingPaymentHint(): PendingPaymentSessionEntry | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_PAYMENT_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { payment_id?: unknown }).payment_id !== "string" ||
    !(parsed as { payment_id: string }).payment_id
  ) {
    return null;
  }

  const entry = parsed as PendingPaymentSessionEntry;

  if (
    typeof entry.saved_at === "number" &&
    Date.now() - entry.saved_at > PENDING_PAYMENT_MAX_AGE_MS
  ) {
    try {
      window.sessionStorage.removeItem(PENDING_PAYMENT_SESSION_KEY);
    } catch {
      // ignore
    }
    return null;
  }

  return entry;
}

function clearPendingPaymentHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_PAYMENT_SESSION_KEY);
  } catch {
    // ignore
  }
}

/**
 * Rewrite the browser URL to `/thank-you?token=<jwt>` without a navigation,
 * so that refreshes, copy-pastes, and share-this-URL flows all behave the
 * same as the non-3DS path. Any other existing query params (e.g. the
 * `?paymentId=` ConvesioPay may have appended) are dropped.
 */
function promoteTokenToUrl(token: string): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    // Drop existing query (paymentId, cache-busting, etc.) so the URL is a
    // clean canonical thank-you URL.
    url.search = "";
    url.searchParams.set("token", token);
    window.history.replaceState(null, "", url.toString());
  } catch {
    // ignore — URL rewriting is purely cosmetic
  }
}

export function useThankYouPayment(
  options: UseThankYouPaymentOptions,
): UseThankYouPaymentResult {
  const { token: initialToken, paymentIdHint } = options;

  // The effective token may arrive synchronously (from the URL) or after a
  // `/issue-token` roundtrip. Either way, once set, the rest of the hook
  // treats it as the source of truth.
  const [state, setState] = useState<ThankYouState>(() => {
    if (initialToken) return "verifying";
    if (paymentIdHint) return "verifying";
    if (readPendingPaymentHint()) return "verifying";
    return "failed";
  });
  const [payload, setPayload] = useState<CheckoutTokenPayload | null>(null);
  const [error, setError] = useState<Error | null>(() => {
    if (initialToken) return null;
    if (paymentIdHint) return null;
    if (readPendingPaymentHint()) return null;
    return new Error("Missing confirmation token.");
  });

  // Keep the latest payload available to the poller without re-arming the
  // effect on every status change (which would leak intervals).
  const payloadRef = useRef<CheckoutTokenPayload | null>(null);

  // The canonical thank-you token (the URL token, or the one minted on a 3DS
  // resume). Forwarded to `/order-confirmed` so the worker can fire the Store
  // Manager `order.created` notification statelessly.
  const tokenRef = useRef<string | null>(null);
  // Guards the fire-once `/order-confirmed` call for this page lifetime.
  const orderConfirmedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    // Notify the worker (which notifies Store Manager) the first time this
    // payment is observed as successful — on every success path: immediate,
    // polled, or post-3DS. Best-effort and fire-once: a ref guards the page
    // lifetime, and a sessionStorage flag keyed by payment id suppresses a
    // re-fire across a refresh. Never blocks or affects what the user sees.
    const confirmOrder = () => {
      if (orderConfirmedRef.current) return;
      orderConfirmedRef.current = true;

      const token = tokenRef.current;
      const paymentId = payloadRef.current?.payment_id;
      if (!token || !paymentId) return;

      const flagKey = `cpay_order_confirmed:${paymentId}`;
      try {
        if (window.sessionStorage.getItem(flagKey)) return;
        window.sessionStorage.setItem(flagKey, "1");
      } catch {
        // sessionStorage unavailable — still fire once for this page lifetime.
      }

      void fetch("/order-confirmed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ token }),
      }).catch(() => {
        // Notification is best-effort; the worker logs delivery failures.
      });
    };

    const poll = async () => {
      const current = payloadRef.current;
      if (!current) return;

      let response: Response;
      try {
        response = await fetch("/poll-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            payment_id: current.payment_id,
          }),
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setState("failed");
        stopPolling();
        return;
      }

      let body:
        | { status?: string; error?: boolean; message?: string }
        | null = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (cancelled) return;

      if (!response.ok || body?.error) {
        setError(
          new Error(
            body?.message ??
              `Payment status check failed (${response.status} ${response.statusText})`,
          ),
        );
        setState("failed");
        stopPolling();
        return;
      }

      const next = classify(body?.status);
      if (next === "pending") return; // keep polling
      setState(next);
      if (next === "succeeded") {
        confirmOrder();
      }
      if (next === "failed") {
        setError(
          new Error(
            `Payment ${(body?.status ?? "failed").toLowerCase()}.`,
          ),
        );
      }
      stopPolling();
    };

    const verifyToken = async (tokenToVerify: string) => {
      let response: Response;
      try {
        response = await fetch("/verify-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ token: tokenToVerify }),
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setState("failed");
        return;
      }

      let body:
        | (CheckoutTokenPayload & { error?: boolean; message?: string })
        | null = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (cancelled) return;

      if (!response.ok || body?.error || !body) {
        setError(
          new Error(
            body?.message ??
              `Could not verify confirmation token (${response.status} ${response.statusText})`,
          ),
        );
        setState("failed");
        return;
      }

      const decoded: CheckoutTokenPayload = {
        payment_id: body.payment_id,
        customer_id: body.customer_id,
        order_number: body.order_number,
        status: body.status,
        amount: body.amount,
        currency: body.currency,
        line_items: body.line_items,
      };

      // Marker token: the worker pre-signed this into `returnUrl` before
      // calling ConvesioPay, so we're definitely on a 3DS return. It
      // carries no `payment_id` (the payment didn't exist yet at signing
      // time), so we resolve one from the URL or sessionStorage and swap
      // it for a real thank-you token via `/issue-token`.
      if (!decoded.payment_id) {
        const hint =
          paymentIdHint ?? readPendingPaymentHint()?.payment_id ?? null;
        if (!hint) {
          setError(
            new Error(
              "Could not resolve a payment id to resume verification.",
            ),
          );
          setState("failed");
          return;
        }
        await resumeFromPaymentId(hint, tokenToVerify);
        return;
      }

      payloadRef.current = decoded;
      setPayload(decoded);
      tokenRef.current = tokenToVerify;

      const next = classify(decoded.status);
      setState(next);

      if (next === "succeeded") {
        confirmOrder();
      }

      if (next === "pending") {
        // Immediate refresh before the first 5s tick so slow-webhook cases
        // resolve as quickly as possible when the user lands.
        void poll();
        intervalId = setInterval(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      }
    };

    const resumeFromPaymentId = async (
      paymentId: string,
      markerToken?: string | null,
    ) => {
      let response: Response;
      try {
        response = await fetch("/issue-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          // Forward the marker token (when we have one) so the worker can
          // recover the order data it carries and bake it into the minted
          // token — keeping the eventual `/order-confirmed` payload faithful
          // across the 3DS handoff.
          body: JSON.stringify(
            markerToken
              ? { payment_id: paymentId, token: markerToken }
              : { payment_id: paymentId },
          ),
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setState("failed");
        return;
      }

      let body: { token?: string; error?: boolean; message?: string } | null =
        null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (cancelled) return;

      if (!response.ok || body?.error || !body?.token) {
        setError(
          new Error(
            body?.message ??
              `Could not resume payment verification (${response.status} ${response.statusText})`,
          ),
        );
        setState("failed");
        return;
      }

      // Normalize the URL to the canonical `?token=<jwt>` shape and drop
      // the sessionStorage bridge — from here on the flow is identical to
      // the non-3DS path.
      promoteTokenToUrl(body.token);
      clearPendingPaymentHint();

      await verifyToken(body.token);
    };

    (async () => {
      if (initialToken) {
        await verifyToken(initialToken);
        return;
      }

      const hint = paymentIdHint ?? readPendingPaymentHint()?.payment_id ?? null;
      if (hint) {
        await resumeFromPaymentId(hint);
        return;
      }

      if (cancelled) return;
      setState("failed");
      setError(new Error("Missing confirmation token."));
    })();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [initialToken, paymentIdHint]);

  return { state, payload, error };
}
