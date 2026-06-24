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
