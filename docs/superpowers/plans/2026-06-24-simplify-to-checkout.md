# Simplify Funnel to a Stateless Checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert this fulfillment funnel into a simple, stateless ConvesioPay checkout — keeping the rich checkout UI, removing the database, admin, auth, cron, fulfillment, email, and upsells.

**Architecture:** Adopt the proven self-contained worker + `payment_id` hooks from the sibling repo `convesio-spa-checkout-template`, then extend them only to carry the purchased bundle to the thank-you page via the signed JWT (direct path) and `sessionStorage` (3DS-resume path). No server-side state.

**Tech Stack:** React 19 + Vite, React Router 7, Tailwind v4, Cloudflare Workers, `jose` (JWT), ConvesioPay browser SDK.

**Design doc:** `docs/superpowers/specs/2026-06-24-simplify-to-checkout-design.md`

**Sibling repo (transplant source):** `../convesio-spa-checkout-template` (referred to below as `$SPA`). Set once per shell: `SPA=../convesio-spa-checkout-template`

---

## Note on verification (no test framework)

Neither repo has an automated test suite, and this work is a transplant + deletion + targeted edits rather than new feature logic. So each task is verified with the real safety nets this codebase has: **TypeScript typechecking, the production build, content/grep assertions, and a final browser-preview run of the checkout flow**. The worker compiles under its own `tsconfig.worker.json` (isolated from client code), so it can be typechecked independently in Task 2. The client `tsconfig.app.json` compiles all of `src/`, so the first full green client typecheck lands in Task 7 — after dead code is removed. This ordering is intentional.

---

## File map

**Replace / edit:**
- `worker/index.ts` — replace with `$SPA` version, then extend to carry line items in the JWT.
- `worker/jwt.ts` — extend token payload type with optional `amount` / `currency` / `line_items`.
- `worker/env.d.ts` — trim to `CPAY_*` only.
- `src/hooks/useCheckoutPayment.ts` — replace with `$SPA` version, then add bundle `sessionStorage` stash.
- `src/hooks/useThankYouPayment.ts` — replace with `$SPA` version, then widen payload type for line items.
- `src/App.tsx` — checkout + thank-you routes only.
- `src/layouts/ShopLayout.tsx` — drop auth / LoggedInBar.
- `src/pages/CheckoutPage.tsx` — drop `sku` from line items (shape change only).
- `src/pages/ThankYouPage.tsx` — remove upsell + order-context; render receipt from token / sessionStorage.
- `wrangler.jsonc`, `package.json`, `.env.example`, `.dev.vars` — trim.

**Delete (whole directories):** `src/components/{auth,dashboard,login,orders,settings,users,thank-you}`, `src/context`, `src/providers`, `src/mutation-options`, `src/query-options`, `src/utils`, `worker/db`, `worker/services`, `worker/handlers`.

**Delete (individual files):** `src/components/site/LoggedInBar.tsx`, `src/layouts/DashboardLayout.tsx`, `src/pages/{LoginPage,OrderPage,UsersPage}.tsx`, `src/lib/{orders,users}.ts`, `src/hooks/{useAuth,useOrders,useUsers,useOrderDrawer}.ts`.

---

## Task 1: Branch and confirm a green baseline

**Files:** none (git + build only)

- [ ] **Step 1: Create a working branch**

```bash
git checkout -b simplify-to-checkout
```

- [ ] **Step 2: Confirm the current project builds before any changes**

Run: `npm run build`
Expected: `tsc -b` and `vite build` both succeed (exit 0). This is the baseline; if it already fails, stop and report.

- [ ] **Step 3: Pin the transplant source path for later steps**

Run: `ls ../convesio-spa-checkout-template/worker/index.ts ../convesio-spa-checkout-template/src/hooks/useCheckoutPayment.ts ../convesio-spa-checkout-template/src/hooks/useThankYouPayment.ts`
Expected: all three paths exist (these are copied in later tasks).

---

## Task 2: Replace the worker with the stateless version and carry line items

**Files:**
- Replace: `worker/index.ts`
- Modify: `worker/jwt.ts`
- Modify: `worker/env.d.ts`
- Delete: `worker/db/`, `worker/services/`, `worker/handlers/`

- [ ] **Step 1: Delete the database / fulfillment / multi-file handler code**

```bash
git rm -r worker/db worker/services worker/handlers
```

- [ ] **Step 2: Replace the worker entry with the stateless SPA version**

```bash
cp ../convesio-spa-checkout-template/worker/index.ts worker/index.ts
```

- [ ] **Step 3: Extend the JWT payload type in `worker/jwt.ts`**

Replace the `CheckoutTokenPayload` interface block with one that adds the optional bundle fields. The full new content of `worker/jwt.ts` is:

```typescript
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
```

- [ ] **Step 4: Import the line-item type and add a normalizer in `worker/index.ts`**

At the top of `worker/index.ts`, change the jwt import line:

Old:
```typescript
import { signCheckoutToken, verifyCheckoutToken } from './jwt';
```

New:
```typescript
import {
  signCheckoutToken,
  verifyCheckoutToken,
  type CheckoutLineItem,
} from './jwt';
```

Then, immediately after the `readJson` function definition, add a normalizer that coerces the incoming `lineItems` into the token shape:

```typescript
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
```

- [ ] **Step 5: Bake line items into the marker token (3DS pre-sign) in `handlePayments`**

In `worker/index.ts`, find the marker-token `signCheckoutToken` call inside `handlePayments`.

Old:
```typescript
    returnMarkerToken = await signCheckoutToken(
      {
        payment_id: '',
        customer_id: '',
        order_number: orderNumber,
        status: 'AwaitingAction',
      },
      env.CPAY_SECRET
    );
```

New:
```typescript
    returnMarkerToken = await signCheckoutToken(
      {
        payment_id: '',
        customer_id: '',
        order_number: orderNumber,
        status: 'AwaitingAction',
        amount: body.amount,
        currency: body.currency,
        line_items: toTokenLineItems(body.lineItems),
      },
      env.CPAY_SECRET
    );
```

- [ ] **Step 6: Bake line items into the success/pending token in `handlePayments`**

Find the success-path `signCheckoutToken` call (the one that builds `token` just before `redirectUrl`).

Old:
```typescript
    token = await signCheckoutToken(
      {
        payment_id: parsed.id ?? '',
        customer_id: parsed.customerId ?? parsed.customer?.id ?? '',
        order_number: parsed.orderNumber ?? payload.orderNumber,
        status: upstreamStatus,
      },
      env.CPAY_SECRET
    );
```

New:
```typescript
    token = await signCheckoutToken(
      {
        payment_id: parsed.id ?? '',
        customer_id: parsed.customerId ?? parsed.customer?.id ?? '',
        order_number: parsed.orderNumber ?? payload.orderNumber,
        status: upstreamStatus,
        amount: body.amount,
        currency: body.currency,
        line_items: toTokenLineItems(body.lineItems),
      },
      env.CPAY_SECRET
    );
```

- [ ] **Step 7: Return the line items from `handleVerifyToken`**

Find the success return in `handleVerifyToken`.

Old:
```typescript
    const payload = await verifyCheckoutToken(token, env.CPAY_SECRET);
    return json({
      payment_id: payload.payment_id,
      customer_id: payload.customer_id,
      order_number: payload.order_number,
      status: payload.status,
    });
```

New:
```typescript
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
```

- [ ] **Step 8: Trim `worker/env.d.ts` to the checkout secrets**

Replace the whole file with:

```typescript
/**
 * Augments the generated Cloudflare `Env` interface with the secrets +
 * vars we declare in `wrangler.jsonc`. Keeps the generated
 * `worker-configuration.d.ts` untouched (it gets regenerated by
 * `wrangler types`), while still giving us typed `env.CPAY_*` access.
 */
interface Env {
  CPAY_API_KEY: string;
  CPAY_SECRET: string;
  CPAY_INTEGRATION: string;
  CPAY_ENVIRONMENT?: ConvesioPayEnvironmentValue;
}

type ConvesioPayEnvironmentValue = "test" | "live";
```

- [ ] **Step 9: Typecheck the worker in isolation**

Run: `npx tsc --noEmit -p tsconfig.worker.json`
Expected: exit 0, no errors. (Catches the line-item wiring and the removed `DB` binding.)

- [ ] **Step 10: Commit**

```bash
git add worker/
git commit -m "feat: replace worker with stateless checkout proxy carrying line items"
```

---

## Task 3: Replace the client payment hooks

**Files:**
- Replace: `src/hooks/useCheckoutPayment.ts`
- Replace: `src/hooks/useThankYouPayment.ts`

- [ ] **Step 1: Copy the stateless SPA hooks over the funnel's order_id versions**

```bash
cp ../convesio-spa-checkout-template/src/hooks/useCheckoutPayment.ts src/hooks/useCheckoutPayment.ts
cp ../convesio-spa-checkout-template/src/hooks/useThankYouPayment.ts src/hooks/useThankYouPayment.ts
```

- [ ] **Step 2: Add the bundle sessionStorage contract to `useCheckoutPayment.ts`**

Immediately after the existing `PendingPaymentSessionEntry` interface, add:

```typescript
/** sessionStorage key holding the purchased bundle for the thank-you receipt.
 *  Written at `pay()` time so it survives a 3DS redirect, where the issued
 *  resume token has no line items (CPAY's lookup doesn't know our display
 *  items). The thank-you page reads it only as a display fallback. */
export const CHECKOUT_BUNDLE_SESSION_KEY = "cpay_checkout_bundle";

export interface CheckoutBundleSessionEntry {
  line_items: LineItem[];
  amount: number;
  currency: string;
  saved_at: number;
}
```

- [ ] **Step 3: Write the bundle entry at the start of `pay()`**

In `useCheckoutPayment.ts`, find the start of the `pay` callback body:

Old:
```typescript
    async (component: ConvesioPayComponent, payload: PaymentPayload) => {
      setStatus("processing");
      setError(null);
      setResult(null);
```

New:
```typescript
    async (component: ConvesioPayComponent, payload: PaymentPayload) => {
      setStatus("processing");
      setError(null);
      setResult(null);

      // Stash the purchased bundle for the thank-you receipt. Display-only —
      // never gates the payment, so any storage failure is swallowed.
      try {
        const bundleEntry: CheckoutBundleSessionEntry = {
          line_items: payload.lineItems ?? [],
          amount: payload.amount,
          currency: payload.currency,
          saved_at: Date.now(),
        };
        window.sessionStorage.setItem(
          CHECKOUT_BUNDLE_SESSION_KEY,
          JSON.stringify(bundleEntry),
        );
      } catch {
        // sessionStorage disabled / quota exceeded — receipt falls back to
        // the JWT line items or the static summary.
      }
```

- [ ] **Step 4: Widen the thank-you payload type for line items in `useThankYouPayment.ts`**

Find the `CheckoutTokenPayload` interface near the top of `src/hooks/useThankYouPayment.ts`.

Old:
```typescript
export interface CheckoutTokenPayload {
  payment_id: string;
  customer_id: string;
  order_number: string;
  status: string;
}
```

New:
```typescript
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
```

- [ ] **Step 5: Carry line items through token verification in `useThankYouPayment.ts`**

Find the `decoded` object built inside `verifyToken`.

Old:
```typescript
      const decoded: CheckoutTokenPayload = {
        payment_id: body.payment_id,
        customer_id: body.customer_id,
        order_number: body.order_number,
        status: body.status,
      };
```

New:
```typescript
      const decoded: CheckoutTokenPayload = {
        payment_id: body.payment_id,
        customer_id: body.customer_id,
        order_number: body.order_number,
        status: body.status,
        amount: body.amount,
        currency: body.currency,
        line_items: body.line_items,
      };
```

- [ ] **Step 6: Confirm the hooks compile standalone**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "useCheckoutPayment|useThankYouPayment" || echo "no errors in payment hooks"`
Expected: `no errors in payment hooks` (the app project still has errors from not-yet-rewritten pages — those are fixed in later tasks; this step only checks the two hooks).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useCheckoutPayment.ts src/hooks/useThankYouPayment.ts
git commit -m "feat: switch checkout hooks to stateless payment_id polling + bundle carry"
```

---

## Task 4: Rewrite the route tree and shop layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/layouts/ShopLayout.tsx`

- [ ] **Step 1: Replace `src/App.tsx` with checkout + thank-you only**

Full new content:

```tsx
import { CheckoutPage } from "@/pages/CheckoutPage";
import { ThankYouPage } from "@/pages/ThankYouPage";
import { BrowserRouter, Route, Routes } from "react-router";

import { ShopLayout } from "@/layouts/ShopLayout";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ShopLayout />}>
          <Route index element={<CheckoutPage />} />
          <Route path="/thank-you" element={<ThankYouPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 2: Replace `src/layouts/ShopLayout.tsx`, dropping auth and the logged-in bar**

Full new content:

```tsx
import { Outlet } from "react-router";

import { SiteFooter, SiteHeader } from "@/components/site";
import { UrgencyRail } from "@/components/site/UrgencyRail";

export function ShopLayout() {
  return (
    <div className="min-h-dvh flex flex-col bg-bone text-ink">
      <UrgencyRail />
      <SiteHeader />
      <div className="flex-1">
        <Outlet />
      </div>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 3: Verify no auth/query references remain in these two files**

Run: `grep -nE "useAuth|AuthProvider|QueryClient|LoggedInBar|ProtectedRoute|DashboardLayout|OrderPage|UsersPage|LoginPage" src/App.tsx src/layouts/ShopLayout.tsx || echo "clean"`
Expected: `clean`

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/layouts/ShopLayout.tsx
git commit -m "feat: reduce routes to checkout + thank-you, drop auth from layout"
```

---

## Task 5: Update CheckoutPage line-item shape

**Files:**
- Modify: `src/pages/CheckoutPage.tsx`

The new `LineItem` type (from the SPA hook) has no `sku`. The checkout otherwise stays identical — bundles, hero, reviews, ingredients, guarantee all remain.

- [ ] **Step 1: Drop `sku` from the line item passed to `pay()`**

In `src/pages/CheckoutPage.tsx`, find the `lineItems` array in `handleSubmit`.

Old:
```tsx
      lineItems: [
        {
          sku: PRODUCT_SKU,
          description: PRODUCT_NAME,
          quantity: selectedBundle.bottleCount,
          amountIncludingTax: selectedBundle.totalAmountMinor,
        },
      ],
```

New:
```tsx
      lineItems: [
        {
          description: PRODUCT_NAME,
          quantity: selectedBundle.bottleCount,
          amountIncludingTax: selectedBundle.totalAmountMinor,
        },
      ],
```

- [ ] **Step 2: Remove the now-unused `PRODUCT_SKU` constant**

Find and delete this line near the top of the file:

```tsx
const PRODUCT_SKU = "1234567890";
```

- [ ] **Step 3: Verify**

Run: `grep -n "PRODUCT_SKU\|sku:" src/pages/CheckoutPage.tsx || echo "clean"`
Expected: `clean`

- [ ] **Step 4: Commit**

```bash
git add src/pages/CheckoutPage.tsx
git commit -m "refactor: drop sku from checkout line item for stateless worker"
```

---

## Task 6: Rewrite ThankYouPage to render from token / sessionStorage

**Files:**
- Modify: `src/pages/ThankYouPage.tsx`

This removes the upsell banner/modal, the DB-backed order `context`, `refreshOrderContext`, and the `orderId` hint. The receipt renders from (1) the verified JWT `line_items`, else (2) the `sessionStorage` bundle, else (3) the existing static summary.

- [ ] **Step 1: Replace `src/pages/ThankYouPage.tsx` with the full content below**

```tsx
/**
 * ThankYouPage
 * -----------------------------------------------------------------------------
 * Landing page after checkout redirects. Reads the `?token=` JWT the worker
 * signed on success/pending, verifies it server-side, and drives a state
 * machine via `useThankYouPayment`:
 *
 *   - "verifying" / "pending"  Amber processing banner + "Processing Your
 *     Payment" copy; the hook polls `/poll-payment` every 5s until terminal.
 *   - "succeeded"  Forest "Order Confirmed" banner + receipt sidebar.
 *   - "failed"     Single failure card pointing back to checkout.
 *
 * The receipt's line items come from the verified JWT (`payload.line_items`),
 * falling back to the sessionStorage bundle written by `useCheckoutPayment`
 * before a 3DS handoff, and finally to a static product summary.
 * -----------------------------------------------------------------------------
 */

import { useSearchParams } from "react-router";

import { Icon } from "@/components/icons";
import { PriceRow } from "@/components/checkout/primitives/PriceRow";
import { SectionCard } from "@/components/checkout/primitives/SectionCard";
import { Spinner } from "@/components/ui/spinner";
import {
  CHECKOUT_BUNDLE_SESSION_KEY,
  type CheckoutBundleSessionEntry,
} from "@/hooks/useCheckoutPayment";
import {
  type CheckoutLineItem,
  useThankYouPayment,
} from "@/hooks/useThankYouPayment";

// Static product used when neither the JWT nor sessionStorage carries items.
const PRODUCT = {
  name: "Daily Greens Complex",
  salePrice: "$49.00",
  image: {
    src: "/product-summary-image.jpeg",
    alt: "Daily Greens Complex product photo",
  },
};

const SUMMARY = {
  includedProductsTitle: "Included Products",
  shipping: { id: "shipping", label: "Shipping", value: "$7.95" },
  tax: { id: "tax", label: "Tax", value: "$0.00" },
  total: { id: "total", label: "Total", value: "$56.95" },
  currency: "USD",
};

const THANK_YOU = {
  nextSteps: { title: "What Happens Next" },
  receipt: {
    title: "Receipt Summary",
    backToHomeLabel: "Return to store",
    backToHomeHref: "/",
    guaranteeNote: "Your 60-day return window starts from the purchase date.",
  },
};

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/** Read the bundle stashed by `useCheckoutPayment` before the 3DS handoff.
 *  Display-only fallback for when the resume token has no line items. */
function readBundleFromSession(): CheckoutBundleSessionEntry | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(CHECKOUT_BUNDLE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CheckoutBundleSessionEntry;
    if (!Array.isArray(parsed.line_items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function ThankYouPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const paymentIdHint = searchParams.get("paymentId");

  const { state, payload, error } = useThankYouPayment({
    token,
    paymentIdHint,
  });

  const isFailed = state === "failed";
  const isProcessing = state === "pending" || state === "verifying";

  // Receipt items: JWT line items first, then the sessionStorage bundle.
  const sessionBundle = readBundleFromSession();
  const items: CheckoutLineItem[] =
    payload?.line_items && payload.line_items.length > 0
      ? payload.line_items
      : sessionBundle?.line_items ?? [];
  const hasItems = items.length > 0;
  const currency = payload?.currency ?? sessionBundle?.currency ?? SUMMARY.currency;
  const itemsSubtotalMinor = items.reduce(
    (sum, item) => sum + item.amountIncludingTax,
    0,
  );
  const formattedTotal = hasItems
    ? formatMoney(itemsSubtotalMinor, currency)
    : SUMMARY.total.value;

  const orderNumber = payload?.order_number
    ? `#${payload.order_number}`
    : "#CV-302948";
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
  const paymentStatus = isProcessing
    ? "Pending — final review in progress"
    : "Paid — preparing shipment";
  const mainCardTitle = isProcessing
    ? "Processing Your Payment"
    : "Thank You for Your Order";
  const mainCardSubtitle = isProcessing
    ? "Hang tight — your payment is going through a final review. This page will update automatically as soon as it clears."
    : "Your payment was processed successfully.";

  const ctaClassName =
    "h-12 w-full rounded-md bg-forest text-bone text-[14px] font-semibold tracking-[0.04em] uppercase flex items-center justify-center gap-2 transition hover:bg-forest2 cursor-pointer";

  return (
    <main data-page="thank-you">
      <div className="max-w-[1180px] mx-auto flex w-full flex-col gap-4 px-5 py-8">
        {isFailed ? (
          <SectionCard
            section="thank-you-failure"
            title="We couldn't confirm your payment"
          >
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rust/10 text-rust">
                <Icon.Alert className="h-6 w-6" />
              </div>
              <p className="text-[13.5px] text-ink2">
                {error?.message ??
                  "Your payment could not be confirmed. You haven't been charged — please try checking out again."}
              </p>
              <a
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-md bg-forest px-6 text-[14px] font-semibold uppercase tracking-[0.04em] text-bone transition hover:bg-forest2"
              >
                Return to checkout
              </a>
            </div>
          </SectionCard>
        ) : (
          <>
            {isProcessing ? (
              <section
                data-section="promo-banner"
                data-status={state}
                aria-label="Payment processing message"
                aria-live="polite"
                className="flex items-start gap-3 rounded-md border border-[#e4d4a5] bg-amber-soft/50 px-5 py-4"
              >
                <Spinner aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber2" />
                <div data-slot="promo-copy" className="space-y-1">
                  <p className="text-[15px] font-semibold text-ink">Processing Payment</p>
                  <p className="text-[13px] text-ink2">
                    We've received your payment and it's going through a final review. No need to
                    pay again — we'll confirm here as soon as it clears.
                  </p>
                </div>
              </section>
            ) : (
              <section
                data-section="promo-banner"
                data-status="succeeded"
                aria-label="Order confirmation message"
                className="flex items-start gap-3 rounded-md border border-[#cfe0d2] bg-[#f4faf4] px-5 py-4"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest text-bone">
                  <Icon.Check className="h-3 w-3" />
                </span>
                <div data-slot="promo-copy" className="space-y-1">
                  <p className="text-[15px] font-semibold text-ink">Order Confirmed</p>
                  <p className="text-[13px] text-ink2">
                    Your checkout is complete and your confirmation email is on the way.
                  </p>
                </div>
              </section>
            )}

            <div
              data-section="thank-you-layout"
              className="grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start"
            >
              <section data-region="thank-you-main" className="flex flex-col gap-4">
                <SectionCard
                  section="thank-you-main-card"
                  data-status={state}
                  title={mainCardTitle}
                  titleClassName="text-[30px] leading-[1.05]"
                >
                  <p className="text-[13.5px] text-ink2">{mainCardSubtitle}</p>

                  <section className="mt-2 rule pt-4">
                    <h3 className="text-[15px] font-semibold tracking-tight text-ink">Order Details</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <p data-slot="order-label" className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink3">
                          Order Number
                        </p>
                        <p data-slot="order-number" className="mt-1 num text-[13.5px] text-ink">{orderNumber}</p>
                      </div>
                      <div>
                        <p data-slot="date-label" className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink3">
                          Date
                        </p>
                        <p data-slot="order-date" className="mt-1 text-[13.5px] text-ink2">{formattedDate}</p>
                      </div>
                      <div>
                        <p data-slot="status-label" className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink3">
                          Status
                        </p>
                        <p data-slot="order-status" className="mt-1 text-[13.5px] text-ink2">{paymentStatus}</p>
                      </div>
                    </div>
                  </section>

                  <section className="mt-2 rule pt-4">
                    <h3 className="text-[15px] font-semibold tracking-tight text-ink">
                      {THANK_YOU.nextSteps.title}
                    </h3>
                    <div className="mt-3 space-y-3">
                      <div>
                        <p data-slot="shipment-label" className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink3">
                          Shipment
                        </p>
                        <p data-slot="shipment-value" className="mt-1 text-[13.5px] text-ink2">
                          You will receive a tracking email within 24 hours.
                        </p>
                      </div>
                      <div>
                        <p data-slot="support-label" className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink3">
                          Support
                        </p>
                        <p data-slot="support-value" className="mt-1 text-[13.5px] text-ink2">
                          Need help? Reply to your confirmation email for priority support.
                        </p>
                      </div>
                    </div>
                  </section>
                </SectionCard>
              </section>

              <aside data-region="thank-you-summary" className="lg:sticky lg:top-[88px] lg:h-max">
                <SectionCard section="receipt-summary" title={THANK_YOU.receipt.title}>
                  <div
                    data-slot="included-products-list"
                    className="rounded-md border border-line bg-bone2/50 p-2.5"
                  >
                    {hasItems ? (
                      items.map((item, index) => {
                        const label =
                          item.quantity > 1
                            ? `${item.description} × ${item.quantity}`
                            : item.description;
                        return (
                          <div
                            key={`${item.description}-${index}`}
                            data-slot="included-product-item"
                            className="my-[7px] flex items-center gap-2.5 text-[13px]"
                          >
                            <img
                              data-slot="included-product-thumb"
                              src={PRODUCT.image.src}
                              alt={PRODUCT.image.alt}
                              className="h-12 w-12 shrink-0 rounded-md border border-line object-cover"
                            />
                            <span className="min-w-0 flex-1 text-ink">{label}</span>
                            <strong data-slot="included-product-price" className="num shrink-0 text-ink">
                              {formatMoney(item.amountIncludingTax, currency)}
                            </strong>
                          </div>
                        );
                      })
                    ) : (
                      <div
                        data-slot="included-product-item"
                        className="my-[7px] flex items-center gap-2.5 text-[13px]"
                      >
                        <img
                          data-slot="included-product-thumb"
                          src={PRODUCT.image.src}
                          alt={PRODUCT.image.alt}
                          className="h-12 w-12 shrink-0 rounded-md border border-line object-cover"
                        />
                        <span className="flex-1 text-ink">{PRODUCT.name}</span>
                        <strong data-slot="included-product-price" className="num text-ink">
                          {PRODUCT.salePrice}
                        </strong>
                      </div>
                    )}
                  </div>

                  <div
                    data-slot="included-products-title"
                    className="mt-1 text-[13px] font-bold text-forest"
                  >
                    {SUMMARY.includedProductsTitle}
                  </div>

                  <div className="flex flex-col gap-2">
                    {hasItems ? (
                      items.map((item, index) => {
                        const label =
                          item.quantity > 1
                            ? `${item.description} × ${item.quantity}`
                            : item.description;
                        return (
                          <PriceRow
                            key={`${item.description}-${index}`}
                            data-slot="product-line"
                            line={{
                              id: `item-${index}`,
                              label,
                              value: formatMoney(item.amountIncludingTax, currency),
                            }}
                            className="my-2 text-[14px]"
                            labelClassName="text-ink2"
                            valueClassName="font-bold text-ink"
                          />
                        );
                      })
                    ) : (
                      <PriceRow
                        data-slot="product-line"
                        line={{
                          id: "product",
                          label: PRODUCT.name,
                          value: PRODUCT.salePrice,
                        }}
                        className="my-2 text-[14px]"
                        labelClassName="text-ink2"
                        valueClassName="font-bold text-ink"
                      />
                    )}
                    <PriceRow
                      data-slot="shipping-line"
                      line={SUMMARY.shipping}
                      className="my-2 text-[14px]"
                      labelClassName="text-ink2"
                    />
                    <PriceRow
                      data-slot="tax-line"
                      line={SUMMARY.tax}
                      className="my-2 text-[14px]"
                      labelClassName="text-ink2"
                    />
                    <PriceRow
                      data-slot="total-line"
                      line={{
                        id: "total",
                        label: SUMMARY.total.label,
                        value: formattedTotal,
                      }}
                      className="mt-3 border-t border-line pt-3 text-[20px]"
                      labelClassName="font-semibold text-ink uppercase tracking-[0.1em] text-[12px]"
                      valueClassName="text-[22px] font-semibold text-ink"
                    />

                    <a href={THANK_YOU.receipt.backToHomeHref} data-slot="cta-primary" className={ctaClassName}>
                      {THANK_YOU.receipt.backToHomeLabel}
                    </a>

                    <div
                      data-slot="guarantee-note"
                      className="rounded-md border border-[#b9e0be] bg-[#eff9f0] p-3 text-[12.5px] font-semibold text-forest"
                    >
                      {THANK_YOU.receipt.guaranteeNote}
                    </div>
                  </div>
                </SectionCard>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify no upsell / order-context references remain**

Run: `grep -nE "Upsell|context|refreshOrderContext|orderId|order_id" src/pages/ThankYouPage.tsx || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/pages/ThankYouPage.tsx
git commit -m "feat: render thank-you receipt from token/sessionStorage, drop upsells"
```

---

## Task 7: Delete all dead code and reach a green client build

**Files:** deletions only (see file map)

- [ ] **Step 1: Delete the admin / auth / fulfillment feature folders and files**

```bash
git rm -r \
  src/components/auth src/components/dashboard src/components/login \
  src/components/orders src/components/settings src/components/users \
  src/components/thank-you \
  src/context src/providers src/mutation-options src/query-options src/utils
git rm \
  src/components/site/LoggedInBar.tsx \
  src/layouts/DashboardLayout.tsx \
  src/pages/LoginPage.tsx src/pages/OrderPage.tsx src/pages/UsersPage.tsx \
  src/lib/orders.ts src/lib/users.ts \
  src/hooks/useAuth.ts src/hooks/useOrders.ts src/hooks/useUsers.ts src/hooks/useOrderDrawer.ts
```

- [ ] **Step 2: Confirm nothing still imports a deleted module**

Run:
```bash
grep -rnE "components/(auth|dashboard|login|orders|settings|users|thank-you)|@/context|@/providers|mutation-options|query-options|@/utils|lib/(orders|users)|useAuth|useOrders|useUsers|useOrderDrawer|LoggedInBar|@tanstack/react-query" src worker || echo "no dangling imports"
```
Expected: `no dangling imports`

- [ ] **Step 3: Full client typecheck + production build**

Run: `npm run build`
Expected: `tsc -b` (all project refs, including the worker) and `vite build` both succeed, exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete admin, auth, fulfillment, and upsell code"
```

---

## Task 8: Trim config, dependencies, and env

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.dev.vars`

- [ ] **Step 1: Trim `wrangler.jsonc`**

Make three edits.

(a) Replace the `assets` block (remove the `run_worker_first` list):

Old:
```jsonc
	"assets": {
		"not_found_handling": "single-page-application",
		"run_worker_first": [
			"/auth/*",
			"/config",
			"/payments",
			"/upsell-payment",
			"/list-payments",
			"/list-orders",
			"/verify-token",
			"/issue-token",
			"/poll-payment",
			"/search-orders",
			"/users",
			"/users/*"
		]
	},
```

New:
```jsonc
	"assets": {
		"not_found_handling": "single-page-application"
	},
```

(b) Restore the required secrets list. Replace the entire `secrets` block (including the multi-line bootstrap comment) with:

```jsonc
	"secrets": {
		"required": ["CPAY_API_KEY", "CPAY_SECRET", "CPAY_INTEGRATION"]
	},
```

(c) Remove the `d1_databases` array and the `triggers` block entirely. Delete these two blocks:

```jsonc
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "fulfillment-checkout-v2",
			"database_id": "6bbbf02d-4b24-4f09-80d2-f53866c8e2e6",
			"migrations_dir": "worker/db/migrations"
		}
	],
	"triggers": {
		"crons": [
			"0 */2 * * *"
		]
	}
```

(Take care with the trailing comma on the property that precedes the removed blocks so the JSONC stays valid.)

- [ ] **Step 2: Remove DB-only dependencies and scripts from `package.json`**

Delete these dependency lines from `"dependencies"`:
```json
    "@tanstack/react-query": "^5.100.5",
    "drizzle-orm": "^0.45.2",
    "vaul": "^1.1.2"
```

Delete this line from `"devDependencies"`:
```json
    "drizzle-kit": "^0.31.10",
```

Delete these two `db:migrate` scripts from `"scripts"`:
```json
    "db:migrate": "wrangler d1 migrations apply fulfillment-checkout-v2 --local",
    "db:migrate:remote": "wrangler d1 migrations apply fulfillment-checkout-v2 --remote",
```

- [ ] **Step 3: Reinstall to update the lockfile**

Run: `npm install`
Expected: completes, `package-lock.json` updated, no peer-dependency errors.

- [ ] **Step 4: Trim `.env.example` to the checkout secrets**

Full new content:
```
CPAY_INTEGRATION=Example
CPAY_API_KEY=12a3-4bc5-6de7-fg89-10h2-3ijk
CPAY_SECRET=ExampleKey
```

- [ ] **Step 5: Trim `.dev.vars` to the checkout secrets**

Remove the `CARTROVER_API_USER` and `CARTROVER_API_KEY` lines, keeping only `CPAY_INTEGRATION`, `CPAY_CLIENT_KEY`, `CPAY_API_KEY`, and `CPAY_SECRET`. (Do not commit `.dev.vars` if it is gitignored — verify with `git check-ignore .dev.vars`.)

- [ ] **Step 6: Rebuild to confirm the dependency trim didn't break anything**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add wrangler.jsonc package.json package-lock.json .env.example
git commit -m "chore: trim wrangler, deps, and env to the checkout-only surface"
```

---

## Task 9: Browser verification of the end-to-end flow

**Files:** none (manual/preview verification)

- [ ] **Step 1: Start the dev server**

Use the preview tooling (`preview_start`) against `npm run dev`. Confirm it boots without console errors.

- [ ] **Step 2: Verify the checkout renders the rich UI**

Load `/`. Confirm via snapshot/screenshot that the bundle selector, product hero, reviews, ingredients panel, and guarantee card all render, and the ConvesioPay card fields mount (the `/config` call succeeds).

- [ ] **Step 3: Complete a test-card payment and confirm the bundle carries through**

Select a non-default bundle (e.g. the 3-bottle), fill contact/shipping, pay with a ConvesioPay test card. Confirm the browser lands on `/thank-you?token=…`, shows "Order Confirmed", and the receipt line reflects the **selected bundle** (description × quantity and its price), not the static fallback.

- [ ] **Step 4: Confirm the pending path polls**

If the test integration produces a `Pending` status, confirm the processing banner shows and the page resolves automatically via `/poll-payment` without a manual refresh. (If the test environment never returns `Pending`, note this as not-exercised rather than passing it.)

- [ ] **Step 5: Confirm no server state was created**

Confirm there is no D1 binding in use and no network calls to `/list-orders`, `/users`, `/auth/*`, or `/upsell-payment` (they no longer exist). Check the network panel shows only `/config`, `/payments`, `/verify-token`, and (if pending) `/poll-payment`.

---

## Self-review notes

- **Spec coverage:** worker replacement + line-item carry (Tasks 2, 3, 6); rich UI kept (Task 5 leaves CheckoutPage intact bar the `sku` field); upsells removed (Task 6); admin/auth/DB/cron/fulfillment/email deleted (Tasks 2, 7); config/deps/env trimmed (Task 8); verification (Task 9). All spec sections map to a task.
- **Type consistency:** `CheckoutLineItem` (`description`/`quantity`/`amountIncludingTax`) is defined identically in `worker/jwt.ts` and `src/hooks/useThankYouPayment.ts`; the `pay()` payload's `LineItem` (from the SPA hook) matches it; `CheckoutBundleSessionEntry` is exported from `useCheckoutPayment.ts` and consumed in `ThankYouPage.tsx`; `CHECKOUT_BUNDLE_SESSION_KEY` is defined and consumed by the same names.
- **No placeholders:** every code step shows full content or an exact old/new edit; every verify step has an exact command and expected output.
