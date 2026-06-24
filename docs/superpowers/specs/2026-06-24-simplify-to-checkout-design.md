# Simplify Fulfillment Funnel to a Stateless Checkout

**Date:** 2026-06-24
**Status:** Approved design — ready for implementation plan

## Goal

Convert this project from a full fulfillment funnel (auth, orders admin, users
admin, settings, D1 database, sync cron, CartRover fulfillment, SendGrid email,
post-purchase upsells) into a simple, stateless checkout — "something like the
SPA checkout" that lives in the sibling repo
`convesio-spa-checkout-template`. The checkout proxies ConvesioPay (CPAY) and
polls it for status. No database, no admin, no background jobs, no fulfillment,
no email, no auth.

The **rich checkout UI is kept** (bundle selector, product hero, reviews,
ingredients panel, guarantee card). Only the backend and admin surface are
removed. **Upsells are removed.**

## Reference Target

The sibling repo `convesio-spa-checkout-template` is the architectural target.
Its `worker/index.ts` is a single self-contained, DB-free file exposing exactly
the five endpoints we need, and its `useCheckoutPayment` / `useThankYouPayment`
hooks poll by `payment_id` straight against CPAY. We adopt those proven files
rather than re-deriving them.

## Architecture (after conversion)

A single-page React checkout served by a stateless Cloudflare Worker.

1. Browser collects customer / shipping / payment; the ConvesioPay SDK
   tokenizes the card.
2. `POST /payments` → worker proxies to CPAY, signs a JWT carrying the payment
   identity **and the purchased line items**, returns a `redirectUrl` to
   `/thank-you?token=<jwt>` (or hands off a 3DS `actionRequired.redirectUrl`).
3. `/thank-you` verifies the JWT (`POST /verify-token`) and, while the status
   is `Pending`, polls `POST /poll-payment` (→ CPAY `GET /v1/payments/:id`)
   every 5s until the status is terminal.

No state is persisted server-side. Polling is keyed by `payment_id` (not a DB
`order_id`).

### Worker endpoints (unchanged set from the SPA template)

- `GET  /config` — public-safe API key + environment for the browser SDK.
- `POST /payments` — proxy to CPAY; sign thank-you / marker JWT.
- `POST /verify-token` — decode a thank-you JWT.
- `POST /issue-token` — mint a JWT from a `payment_id` (3DS resume).
- `POST /poll-payment` — proxy CPAY `GET /v1/payments/:id`.

No `scheduled` handler.

## Carrying the bundle through to the thank-you page (no DB)

The customer picks 1 / 3 / 6 bottles at different prices. We surface the exact
purchase on the thank-you receipt using two stateless mechanisms:

- **Direct success / pending path:** `POST /payments` bakes the request's
  `lineItems` (description, quantity, amount) plus `amount` / `currency` into
  the signed JWT payload (both the success token and the pre-signed 3DS marker
  token). `/verify-token` returns them, and the thank-you receipt renders the
  real bundle.
- **3DS resume path:** after a challenge, the thank-you page resolves a token
  via `/issue-token`, which looks the payment up at CPAY — CPAY does not know
  our display line items. So `useCheckoutPayment` also stashes the selected
  bundle in `sessionStorage` (alongside the existing `payment_id` 3DS bridge)
  before handing off, and the thank-you page falls back to that for display.
- **Fallback:** if neither source is available (e.g. the thank-you URL is
  opened on a different device), the receipt shows the existing static product
  summary. The JWT's `order_number` / `status` always drive the actual state
  machine regardless.

The token payload thus extends the SPA template's
`{ payment_id, customer_id, order_number, status }` with optional
`amount`, `currency`, and `line_items`.

## Changes by area

### Worker (`worker/`)

- **Replace** `worker/index.ts` with the SPA template's self-contained version,
  then extend `handlePayments` + the token-signing helpers to include
  `amount` / `currency` / `line_items` in the JWT (per the bundle section
  above), and `handleVerifyToken` to return them.
- **Keep** `worker/jwt.ts` (extend `signCheckoutToken` / `verifyCheckoutToken`
  payload typing for the new optional fields).
- **Delete** `worker/db/`, `worker/services/`, and all of `worker/handlers/`
  (auth, orders, users, config, the multi-file payments split).
- **Trim** `worker/env.d.ts` to `CPAY_API_KEY`, `CPAY_SECRET`,
  `CPAY_INTEGRATION`, `CPAY_ENVIRONMENT?`. Remove `DB`, `AUTH_SALT`,
  `GOOGLE_OAUTH_*`, `SENDGRID_API_KEY`, `CARTROVER_*`.

### Client (`src/`)

- **`App.tsx`:** keep only `/` (checkout) and `/thank-you`, both under a
  simplified `ShopLayout`. Remove `AuthProvider`, `QueryClientProvider`,
  `ProtectedRoute`, `DashboardLayout`, and the login / orders / users routes.
- **Hooks:** replace `useCheckoutPayment.ts` and `useThankYouPayment.ts` with
  the SPA template's `payment_id` versions, then add the bundle-carrying
  extensions (JWT line items on the thank-you side; sessionStorage bundle stash
  on the checkout side). Delete `useAuth`, `useOrders`, `useUsers`,
  `useOrderDrawer`. Keep `useConvesioPayCheckout` (powers the SDK mount via
  `/config`) and `useStorefrontUrgency` (cosmetic).
- **`CheckoutPage.tsx`:** layout unchanged — bundles, hero, reviews,
  ingredients, guarantee all stay. Adjust the `lineItems` it passes to the new
  hook's `LineItem` shape, and have it stash the selected bundle for the
  thank-you page.
- **`ThankYouPage.tsx`:** drop the upsell banner + modal, `refreshOrderContext`,
  and `orderId` handling. Render the receipt from the JWT/ sessionStorage
  bundle, falling back to the existing static summary. Order number comes from
  the JWT `order_number`.
- **`ShopLayout.tsx`:** drop `useAuth` and `LoggedInBar`; keep `UrgencyRail`,
  `SiteHeader`, `SiteFooter`.
- **Delete** feature folders/files: `components/{orders,users,settings,login,
  auth,dashboard}`, `components/thank-you/Upsell*`, `context/`, `providers/`,
  `layouts/DashboardLayout.tsx`, `mutation-options/`, `query-options/`,
  `lib/{orders,users}.ts`, `utils/orders.ts`, and pages `LoginPage`,
  `OrderPage`, `UsersPage`.

### Config & dependencies

- **`wrangler.jsonc`:** remove `d1_databases`, `triggers.crons`, and the large
  `assets.run_worker_first` list (the stateless worker matches the SPA
  template's simpler asset config). Restore
  `secrets.required = ["CPAY_API_KEY","CPAY_SECRET","CPAY_INTEGRATION"]`.
  Keep the existing worker `name` (`fulfillment-checkout-v2`) so the deployed
  Worker is not orphaned.
- **`package.json`:** drop `@tanstack/react-query`, `drizzle-orm`,
  `drizzle-kit`, `vaul` (drawer; admin-only), and the `db:migrate*` scripts.
- **`.env.example` / `.dev.vars`:** reduce to `CPAY_*` only.

## Error handling

Inherited from the proven SPA template worker + hooks: failed SDK tokenization,
network failure, non-2xx upstream, upstream `error: true`, the 3DS
`actionRequired` handoff (with the sessionStorage `payment_id` bridge), and the
`Pending` poll loop all map onto the existing `failed` / `pending` / `succeeded`
states. The bundle-carrying additions are display-only and degrade to the
static summary; they never affect the payment state machine.

## Testing / verification

Neither repo has an automated test suite. Verification is:

1. `tsc -b` typecheck passes (catches dangling imports from deleted modules).
2. `vite build` succeeds.
3. Run the dev server and exercise the flow in the browser preview:
   - Checkout renders with bundles/hero/reviews/ingredients/guarantee.
   - A test-card payment reaches `/thank-you`, shows the **selected bundle** on
     the receipt, and confirms success.
   - A `Pending` payment shows the processing state and resolves via polling.

## Out of scope / explicitly removed

Order management, orders/users admin panels, settings, login + Google OAuth,
D1 database and migrations, the sync cron, CartRover fulfillment, SendGrid
email, and post-purchase upsells.
