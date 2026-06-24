import { useCallback, useRef, useState } from "react";

import {
  CustomerInfo,
  type CustomerInfoValue,
} from "@/components/checkout/CustomerInfo";
import { OrderSummaryCard } from "@/components/checkout/OrderSummaryCard";
import { PaymentInfo } from "@/components/checkout/PaymentInfo";
import { PaymentStatusDialog } from "@/components/checkout/PaymentStatusDialog";
import {
  ShippingInfo,
  type ShippingInfoValue,
} from "@/components/checkout/ShippingInfo";
import { BundleSelector } from "@/components/checkout/BundleSelector";
import { BUNDLES, type Bundle } from "@/components/checkout/bundles";
import { ProductHeroCard } from "@/components/checkout/ProductHeroCard";
import { GuaranteeCard } from "@/components/checkout/GuaranteeCard";
import { ReviewsSection } from "@/components/checkout/ReviewsSection";
import { IngredientsPanel } from "@/components/checkout/IngredientsPanel";
import { SectionHead } from "@/components/checkout/form-atoms";
import { Icon } from "@/components/icons";
import { useCheckoutPayment } from "@/hooks/useCheckoutPayment";

const PRODUCT_NAME = "Daily Greens Complex";
const CURRENCY = "USD";

const INITIAL_CUSTOMER: CustomerInfoValue = {
  email: "",
  phoneNumber: "",
};

const INITIAL_SHIPPING: ShippingInfoValue = {
  firstName: "",
  lastName: "",
  street: "",
  aptSuite: "",
  city: "",
  stateOrProvince: "",
  zip: "",
  country: "US",
};

export function CheckoutPage() {
  const [customer, setCustomer] = useState<CustomerInfoValue>(INITIAL_CUSTOMER);
  const [shipping, setShipping] = useState<ShippingInfoValue>(INITIAL_SHIPPING);
  const [isPaymentValid, setIsPaymentValid] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState<Bundle>(
    BUNDLES.find((b) => b.isMostChosen) ?? BUNDLES[0],
  );

  const componentRef = useRef<ConvesioPayComponent | null>(null);
  const handleComponentReady = useCallback((c: ConvesioPayComponent) => {
    componentRef.current = c;
  }, []);

  const { status, error, result, pay, reset } = useCheckoutPayment();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!componentRef.current) return;
    if (status === "processing") return;

    const address = {
      houseNumberOrName: shipping.aptSuite,
      street: shipping.street,
      city: shipping.city,
      stateOrProvince: shipping.stateOrProvince,
      postalCode: shipping.zip,
      country: shipping.country,
    };

    await pay(componentRef.current, {
      email: customer.email,
      name: `${shipping.firstName} ${shipping.lastName}`.trim(),
      amount: selectedBundle.totalAmountMinor,
      currency: CURRENCY,
      phone: {
        number: customer.phoneNumber,
        countryCode: "1",
      },
      billingAddress: address,
      shippingAddress: address,
      lineItems: [
        {
          description: PRODUCT_NAME,
          quantity: selectedBundle.bottleCount,
          amountIncludingTax: selectedBundle.totalAmountMinor,
        },
      ],
    });
  };

  const isProcessing = status === "processing";

  return (
    <main data-page="checkout">
      <div className="max-w-[1180px] mx-auto px-5 py-8">
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-8 items-start">

          {/* LEFT: social-proof column */}
          <section data-region="form-stack" className="space-y-5">
            <ProductHeroCard />
            <BundleSelector value={selectedBundle} onChange={setSelectedBundle} />
            <GuaranteeCard />
            <ReviewsSection />
            <IngredientsPanel />
          </section>

          {/* RIGHT: sticky form column */}
          <aside data-region="summary" className="lg:sticky lg:top-[88px]">
            <div className="rounded-lg">
              {/* Security header */}
              <div className="flex items-center justify-between gap-3 gloss-forest text-bone px-4 py-3 rounded-md">
                <div className="flex items-center gap-2.5">
                  <Icon.Shield className="w-5 h-5" />
                  <div className="leading-tight">
                    <div className="text-[12.5px] font-semibold tracking-[0.06em] uppercase">
                      Safe &amp; Secure Order Form
                    </div>
                    <div className="text-[10.5px] uppercase tracking-[0.18em] text-bone/70">
                      256-bit secure encryption
                    </div>
                  </div>
                </div>
                <div className="num text-[11px] text-bone/80 hidden sm:flex items-center gap-1 gloss-pill px-2 py-1 rounded-[3px]">
                  <Icon.Lock className="w-3.5 h-3.5" /> https
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="gloss-card rounded-md p-5 mt-3 space-y-6">
                <section data-section="customer-info">
                  <SectionHead n="1" title="Contact" sub="So we can send your tracking link." />
                  <CustomerInfo value={customer} onChange={setCustomer} />
                </section>

                <section data-section="shipping-info">
                  <SectionHead n="2" title="Shipping address" sub="U.S. only — free 2–4 day delivery." />
                  <ShippingInfo value={shipping} onChange={setShipping} />
                </section>

                <section data-section="payment-info">
                  <SectionHead n="3" title="Payment" sub="We never store your card." />
                  <PaymentInfo
                    customerEmail={customer.email || undefined}
                    onValidityChange={setIsPaymentValid}
                    onComponentReady={handleComponentReady}
                  />
                </section>

                <OrderSummaryCard
                  selectedBundle={selectedBundle}
                  payDisabled={!isPaymentValid}
                  payLoading={isProcessing}
                />
              </form>
            </div>

            <p className="text-[11px] text-ink3 text-center mt-3 max-w-[44ch] mx-auto leading-relaxed">
              By placing this order you agree to our terms &amp; auto-renewal policy. Demo checkout —
              no real charges are made.
            </p>
          </aside>

        </div>
      </div>

      <PaymentStatusDialog
        status={status}
        error={error}
        result={result}
        onClose={reset}
      />
    </main>
  );
}
