# Checkout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the CheckoutPage, ThankYouPage, and ProductPage to match the Meridian Botanicals reference design (forest green + amber + warm cream palette) while keeping the existing React 19 / Vite / Cloudflare Worker architecture intact.

**Architecture:** Two-column checkout layout — left column is social proof (product hero, bundle selector, guarantee, reviews, ingredients), right column is a sticky white form card with a dark green header. Bundle selection is a new state in CheckoutPage that replaces the hardcoded `AMOUNT_MINOR` constant.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Vite, Cloudflare Worker.

---

## File Map

| File | Action |
|---|---|
| `src/index.css` | Update brand tokens + amber `.pay-cta` animations |
| `src/layouts/ShopLayout.tsx` | Add countdown, render AnnouncementBar + UrgencyBanner |
| `src/components/site/AnnouncementBar.tsx` | **New** — dark green bar with viewer count + timer |
| `src/components/site/UrgencyBanner.tsx` | **New** — amber urgency bar with timer |
| `src/components/site/SiteHeader.tsx` | Redesign: logo, nav, secure badge; remove CheckoutTimer |
| `src/components/site/SiteFooter.tsx` | Redesign: white + thin border |
| `src/components/checkout/BundleSelector.tsx` | **New** — Bundle type, BUNDLES const, 3 bundle cards |
| `src/components/checkout/ProductHeroCard.tsx` | **New** — left-column product hero |
| `src/components/checkout/GuaranteeCard.tsx` | **New** — 30-day guarantee |
| `src/components/checkout/ReviewsSection.tsx` | **New** — star header + 3 testimonials |
| `src/components/checkout/IngredientsPanel.tsx` | **New** — dark green panel |
| `src/components/checkout/SecurityBadges.tsx` | **New** — 4-tile trust grid |
| `src/components/checkout/OrderSummaryCard.tsx` | Rewrite — accepts Bundle, amber CTA, SecurityBadges |
| `src/components/checkout/CheckoutHeader.tsx` | **Delete** |
| `src/components/checkout/CheckoutTimer.tsx` | **Delete** (timer lifts to ShopLayout) |
| `src/pages/CheckoutPage.tsx` | Rewrite — new layout, bundle state, selectedBundle→pay() |
| `src/pages/ThankYouPage.tsx` | Minimal: swap `bg-background` → cream; CTA auto-updates |
| `src/pages/ProductPage.tsx` | Minimal: swap background + CTA amber |

---

## Task 1: Update CSS brand tokens and amber pay-cta animations

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Replace brand theme tokens in `:root`**

Open `src/index.css`. In the `:root` block (starts at line 62), replace the top section (lines 63–73) with hex values and add `--brand-muted`:

```css
    --brand: #1a3028;
    --brand-foreground: #ffffff;
    --brand-accent: #3a6a4a;
    --brand-accent-foreground: #ffffff;
    --brand-muted: #a8cdb8;
    --pay-cta-from: #c8620a;
    --pay-cta-to: #a84e08;
    --pay-cta-hover-from: #b55508;
    --pay-cta-hover-to: #963f05;
    --pay-cta-foreground: #ffffff;
    --pay-cta-shadow: 0 12px 20px rgba(200, 98, 10, 0.34);
    --pay-cta-shadow-hover: 0 16px 26px rgba(200, 98, 10, 0.40);
```

- [ ] **Step 2: Add `--color-brand-muted` to `@theme inline`**

Inside the `@theme inline { ... }` block (lines 6–54), after the `--color-brand-accent-foreground` line, add:

```css
    --color-brand-muted: var(--brand-muted);
```

- [ ] **Step 3: Update `@keyframes pay-cta-pulse` glow**

In `@keyframes pay-cta-pulse` (lines 106–115), replace the `50%` box-shadow:

```css
/* OLD */
    box-shadow: 0 16px 28px oklch(0.54 0.13 56 / 0.43);
/* NEW */
    box-shadow: 0 16px 28px rgba(200, 98, 10, 0.43);
```

- [ ] **Step 4: Update `.pay-cta` base shadows and hover/active colors**

In the `.pay-cta` class (lines 118–135), make these three changes:

```css
/* OLD box-shadow inside .pay-cta: */
    0 -2px 0 rgba(8,60,40,0.45) inset,
    0 1px 2px rgba(8,60,40,0.2),
    0 14px 28px -10px rgba(22,155,107,0.55);
/* NEW: */
    0 -2px 0 rgba(100,30,0,0.35) inset,
    0 1px 2px rgba(100,30,0,0.15),
    0 14px 28px -10px rgba(200,98,10,0.50);

/* OLD hover: */
.pay-cta:hover:not(:disabled) { background-color: #1bb37b; }
/* NEW: */
.pay-cta:hover:not(:disabled) { background-color: #b55508; }

/* OLD active: */
  background-color: #0f8559;
/* NEW: */
  background-color: #963f05;
```

- [ ] **Step 5: Update `@keyframes cta-breathe` glow colors**

Replace both lines of the `cta-breathe` keyframes (lines 149–151):

```css
@keyframes cta-breathe {
  0%, 100% { box-shadow: 0 1px 0 rgba(255,255,255,0.18) inset, 0 -2px 0 rgba(100,30,0,0.35) inset, 0 1px 2px rgba(100,30,0,0.15), 0 14px 28px -10px rgba(200,98,10,0.50); }
  50%       { box-shadow: 0 1px 0 rgba(255,255,255,0.18) inset, 0 -2px 0 rgba(100,30,0,0.35) inset, 0 1px 2px rgba(100,30,0,0.15), 0 18px 36px -8px rgba(200,98,10,0.78); }
}
```

- [ ] **Step 6: Update done-state color**

In `.pay-cta[data-state="done"]` (line 193):

```css
/* OLD: */
  background-color: #0d8a55;
/* NEW: */
  background-color: #b55508;
```

- [ ] **Step 7: Commit**

```bash
git add src/index.css
git commit -m "feat: update brand color tokens to forest-green + amber palette"
```

---

## Task 2: Create `AnnouncementBar` component

**Files:**
- Create: `src/components/site/AnnouncementBar.tsx`

- [ ] **Step 1: Create the file**

```tsx
interface AnnouncementBarProps {
  timer: string;
}

export function AnnouncementBar({ timer }: AnnouncementBarProps) {
  return (
    <div
      data-section="announcement-bar"
      className="bg-[#1a3028] text-[#a8cdb8] text-[11px] py-[7px] px-4 flex items-center justify-center gap-7 flex-wrap"
    >
      <span>
        <span className="text-[#c8620a] mr-1">●</span>
        <strong className="text-white">11</strong> others are viewing this offer right now
      </span>
      <span>🚚 Free U.S. shipping on every order</span>
      <span>✓ 3rd-party tested</span>
      <span>
        Reserved for:{" "}
        <strong className="text-white font-mono">{timer}</strong>
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/site/AnnouncementBar.tsx
git commit -m "feat: add AnnouncementBar component with countdown prop"
```

---

## Task 3: Create `UrgencyBanner` component

**Files:**
- Create: `src/components/site/UrgencyBanner.tsx`

- [ ] **Step 1: Create the file**

```tsx
interface UrgencyBannerProps {
  timer: string;
}

export function UrgencyBanner({ timer }: UrgencyBannerProps) {
  return (
    <div
      data-section="urgency-banner"
      className="bg-[#c8620a] text-white text-[12px] font-semibold text-center py-[9px] px-4 tracking-[0.04em]"
    >
      HURRY — Order in the next{" "}
      <strong className="font-mono">{timer}</strong> to guarantee your 2 FREE
      bottles with the 3-bottle bundle.
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/site/UrgencyBanner.tsx
git commit -m "feat: add UrgencyBanner component with amber styling"
```

---

## Task 4: Update `ShopLayout` — lift timer, add announcement + urgency bars

**Files:**
- Modify: `src/layouts/ShopLayout.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the entire file contents with:

```tsx
import { useEffect, useState } from "react";

import { SiteFooter, SiteHeader } from "@/components/site";
import { AnnouncementBar } from "@/components/site/AnnouncementBar";
import { UrgencyBanner } from "@/components/site/UrgencyBanner";
import { LoggedInBar } from "@/components/site/LoggedInBar";
import { useAuth } from "@/hooks/useAuth";
import { Outlet } from "react-router";

const COUNTDOWN_SECONDS = 14 * 60 + 59;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function ShopLayout() {
  const { status } = useAuth();
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(
      () => setRemaining((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [remaining]);

  const mmss = `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`;

  return (
    <div className="min-h-dvh flex flex-col">
      <AnnouncementBar timer={mmss} />
      <UrgencyBanner timer={mmss} />
      {status === "authenticated" && <LoggedInBar />}
      <SiteHeader />
      <div className="flex-1">
        <Outlet />
      </div>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 2: Verify dev server starts without errors**

```bash
npx vite build --mode development 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/ShopLayout.tsx
git commit -m "feat: lift countdown timer to ShopLayout, render AnnouncementBar + UrgencyBanner"
```

---

## Task 5: Redesign `SiteHeader`

**Files:**
- Modify: `src/components/site/SiteHeader.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the entire file contents with:

```tsx
export function SiteHeader() {
  return (
    <header className="bg-white border-b border-[#e4ddd2] sticky top-0 z-10">
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        {/* Logo + brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#1a3028] flex items-center justify-center text-[#7ab89a] text-sm flex-shrink-0">
            🌿
          </div>
          <div>
            <div className="text-[13px] font-bold text-[#1a3028] tracking-[0.1em] leading-none uppercase">
              Your Brand
            </div>
            <div className="text-[9px] text-[#999] tracking-[0.12em] mt-0.5 uppercase">
              Est. 2019
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-5 text-[12px] text-[#555]">
          <a href="/product" className="hover:text-[#1a3028] transition-colors">Science</a>
          <a href="/product" className="hover:text-[#1a3028] transition-colors">Ingredients</a>
          <a href="/product" className="hover:text-[#1a3028] transition-colors">Reviews</a>
          <a href="/product" className="hover:text-[#1a3028] transition-colors">Guarantee</a>
        </nav>

        {/* Secure badge */}
        <span className="text-[11px] text-[#888] flex items-center gap-1">
          🔒 Secure checkout
        </span>
      </div>
    </header>
  );
}
```

Note: `CheckoutTimer` and `useAuth` imports are intentionally removed. Timer is now in ShopLayout.

- [ ] **Step 2: Commit**

```bash
git add src/components/site/SiteHeader.tsx
git commit -m "feat: redesign SiteHeader with brand logo, nav, and secure badge"
```

---

## Task 6: Redesign `SiteFooter`

**Files:**
- Modify: `src/components/site/SiteFooter.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the entire file contents with:

```tsx
export function SiteFooter() {
  return (
    <footer className="bg-white border-t border-[#e4ddd2]">
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-6 py-[18px] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#888]">
        <span>© 2026 Your Brand — All rights reserved.</span>
        <nav className="flex items-center gap-4">
          <a href="#" className="hover:text-[#1a3028] transition-colors">Privacy</a>
          <a href="#" className="hover:text-[#1a3028] transition-colors">Terms</a>
          <a href="#" className="hover:text-[#1a3028] transition-colors">Refunds</a>
          <a href="#" className="hover:text-[#1a3028] transition-colors">Contact</a>
        </nav>
        <span className="flex items-center gap-1">🔒 Secure checkout</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/site/SiteFooter.tsx
git commit -m "feat: redesign SiteFooter with white background and thin border"
```

---

## Task 7: Create `BundleSelector` — defines `Bundle` type and `BUNDLES` constant

**Files:**
- Create: `src/components/checkout/BundleSelector.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from "react";

export type Bundle = {
  id: "one-bottle" | "two-bottle" | "three-bottle";
  bottleCount: number;
  supplyLabel: string;
  freeBonusBottles: number;
  pricePerBottle: number;
  totalAmountMinor: number;
  originalAmountMinor: number;
  savingsMinor?: number;
  isMostChosen?: boolean;
  mostChosenPercent?: number;
};

export const BUNDLES: Bundle[] = [
  {
    id: "three-bottle",
    bottleCount: 3,
    supplyLabel: "90-day supply + 2 free",
    freeBonusBottles: 2,
    pricePerBottle: 33.0,
    totalAmountMinor: 9900,
    originalAmountMinor: 14700,
    savingsMinor: 4800,
    isMostChosen: true,
    mostChosenPercent: 71,
  },
  {
    id: "two-bottle",
    bottleCount: 2,
    supplyLabel: "60-day supply",
    freeBonusBottles: 0,
    pricePerBottle: 39.5,
    totalAmountMinor: 7900,
    originalAmountMinor: 9800,
    savingsMinor: 1900,
  },
  {
    id: "one-bottle",
    bottleCount: 1,
    supplyLabel: "30-day supply",
    freeBonusBottles: 0,
    pricePerBottle: 49.0,
    totalAmountMinor: 4900,
    originalAmountMinor: 4900,
  },
];

function formatDollars(minor: number) {
  return `$${(minor / 100).toFixed(2)}`;
}

function Bottle({ faded = false }: { faded?: boolean }) {
  return (
    <div className={`relative flex-shrink-0 ${faded ? "opacity-35" : ""}`}>
      <div className="w-[9px] h-[6px] bg-[#3a6048] rounded-t-[2px] mx-auto" />
      <div className="w-[22px] h-[30px] bg-gradient-to-b from-[#5a8868] to-[#3a6048] rounded-[3px]" />
    </div>
  );
}

interface BundleCardProps {
  bundle: Bundle;
  selected: boolean;
  onSelect: () => void;
}

function BundleCard({ bundle, selected, onSelect }: BundleCardProps) {
  const totalBottles = bundle.bottleCount + bundle.freeBonusBottles;

  return (
    <div
      data-section="bundle-card"
      data-bundle-id={bundle.id}
      onClick={onSelect}
      className={`relative cursor-pointer rounded-[10px] border px-4 py-3.5 transition-colors ${
        selected
          ? "border-[2.5px] border-[#1a3028] bg-[#f7fdf8]"
          : "border-[1.5px] border-[#e0d9cc] bg-white hover:border-[#1a3028]/40"
      }`}
    >
      {bundle.isMostChosen && (
        <div className="absolute -top-px left-3.5 bg-[#1a3028] text-white text-[9px] font-bold px-2 py-[3px] rounded-b-[4px] tracking-[0.08em]">
          MOST CHOSEN · {bundle.mostChosenPercent}%
        </div>
      )}

      <div
        className={`flex items-start justify-between ${bundle.isMostChosen ? "mt-4" : ""}`}
      >
        {/* Left: radio + label */}
        <div className="flex items-start gap-2.5 flex-1">
          <div
            className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              selected ? "border-[#1a3028] bg-[#1a3028] text-white" : "border-[#ccc]"
            }`}
          >
            {selected && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path
                  d="M1 4l2.5 2.5L9 1"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <div>
            <div className="text-[13px] font-bold text-[#1a3028]">
              {bundle.bottleCount} Bottle{bundle.bottleCount > 1 ? "s" : ""}{" "}
              <span className="text-[#888] font-normal text-[12px]">
                · {bundle.supplyLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-[#3a6a4a] font-medium">
                ✓ Free shipping
              </span>
              {bundle.savingsMinor && (
                <span className="text-[10px] font-bold text-[#2a7a4a] bg-[#e8f5ee] px-[6px] py-[2px] rounded-[4px]">
                  Save ${(bundle.savingsMinor / 100).toFixed(0)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: price */}
        <div className="text-right flex-shrink-0 ml-2">
          <div className="text-[20px] font-extrabold text-[#1a3028] leading-none">
            ${bundle.pricePerBottle.toFixed(2)}
          </div>
          <div className="text-[10px] text-[#999] uppercase tracking-[0.06em] mt-0.5">
            per bottle
          </div>
          {bundle.savingsMinor ? (
            <>
              <div className="text-[11px] text-[#bbb] line-through mt-0.5">
                {formatDollars(bundle.originalAmountMinor)}
              </div>
              <div className="text-[12px] font-semibold text-[#1a3028]">
                {formatDollars(bundle.totalAmountMinor)}
              </div>
            </>
          ) : (
            <div className="text-[12px] font-semibold text-[#1a3028] mt-0.5">
              {formatDollars(bundle.totalAmountMinor)}
            </div>
          )}
        </div>
      </div>

      {/* Bottle illustrations */}
      <div className="flex items-end gap-[3px] mt-3 pt-3 border-t border-[#f0ece4]">
        {Array.from({ length: bundle.bottleCount }).map((_, i) => (
          <Bottle key={`main-${i}`} />
        ))}
        {bundle.freeBonusBottles > 0 && (
          <>
            {Array.from({ length: bundle.freeBonusBottles }).map((_, i) => (
              <Bottle key={`free-${i}`} faded />
            ))}
            <span className="text-[10px] text-[#888] ml-1.5 self-center">
              + {bundle.freeBonusBottles} FREE
            </span>
          </>
        )}
        <span className="text-[10px] text-[#bbb] ml-auto self-center">
          {totalBottles} bottle{totalBottles > 1 ? "s" : ""} total
        </span>
      </div>
    </div>
  );
}

interface BundleSelectorProps {
  value: Bundle;
  onChange: (bundle: Bundle) => void;
}

export function BundleSelector({ value, onChange }: BundleSelectorProps) {
  const [tab, setTab] = useState<"one-time" | "subscribe">("one-time");

  return (
    <div data-section="bundle-selector" className="mb-3">
      {/* One-time / subscribe toggle */}
      <div className="flex bg-[#e8e0d4] rounded-[8px] p-1 mb-2.5">
        <button
          type="button"
          onClick={() => setTab("one-time")}
          className={`flex-1 text-center py-2 rounded-[6px] text-[12px] font-semibold transition-colors ${
            tab === "one-time"
              ? "bg-[#1a3028] text-white"
              : "text-[#666] hover:text-[#333]"
          }`}
        >
          One-time purchase
        </button>
        {/* TODO: subscription flow */}
        <button
          type="button"
          onClick={() => setTab("subscribe")}
          className={`flex-1 text-center py-2 rounded-[6px] text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            tab === "subscribe"
              ? "bg-[#1a3028] text-white"
              : "text-[#666] hover:text-[#333]"
          }`}
        >
          Subscribe &amp; save
          <span className="bg-[#c8620a] text-white text-[9px] font-bold px-1.5 py-[1px] rounded-[3px]">
            -20%
          </span>
        </button>
      </div>

      {/* Shoppers row */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[12px] font-bold text-[#1a3028]">
          Choose your bundle
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[#666]">
          <span className="w-[7px] h-[7px] rounded-full bg-[#c8620a] animate-pulse inline-block" />
          18 shoppers picking now
        </span>
      </div>

      {/* Bundle cards */}
      <div className="flex flex-col gap-2">
        {BUNDLES.map((bundle) => (
          <BundleCard
            key={bundle.id}
            bundle={bundle}
            selected={value.id === bundle.id}
            onSelect={() => onChange(bundle)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checkout/BundleSelector.tsx
git commit -m "feat: add BundleSelector with Bundle type, BUNDLES const, and 3-tier cards"
```

---

## Task 8: Create `ProductHeroCard`

**Files:**
- Create: `src/components/checkout/ProductHeroCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
const TRUST_BADGES = ["NSF Certified", "Non-GMO", "Vegan", "Made in Oregon"];

export function ProductHeroCard() {
  return (
    <div
      data-section="product-hero"
      className="bg-white rounded-[10px] p-[18px] mb-3 flex gap-4 items-start"
    >
      <img
        src="/product-image.jpeg"
        alt="Product photo"
        className="w-[90px] h-[120px] object-cover rounded-[8px] flex-shrink-0"
      />
      <div className="flex-1">
        <div className="text-[10px] text-[#999] uppercase tracking-[0.1em] mb-1.5">
          Step 1 of 1 · Build your order
        </div>
        <h1 className="text-[24px] font-black text-[#1a3028] leading-[1.1] mb-2">
          Vitamin Essentials{" "}
          <em className="font-light italic">Complex</em>
        </h1>
        <p className="text-[13px] text-[#555] leading-[1.6] mb-3">
          One scoop replaces the entire morning supplement stack — 32 organic
          plants, adaptogens, and digestive enzymes clinically dosed for
          daily energy and resilience.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TRUST_BADGES.map((badge) => (
            <span
              key={badge}
              className="text-[11px] text-[#3a6a4a] font-medium flex items-center gap-1"
            >
              ✓ {badge}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checkout/ProductHeroCard.tsx
git commit -m "feat: add ProductHeroCard left-column component"
```

---

## Task 9: Create `GuaranteeCard`

**Files:**
- Create: `src/components/checkout/GuaranteeCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
export function GuaranteeCard() {
  return (
    <div
      data-section="guarantee"
      className="bg-white rounded-[10px] p-4 mb-3 flex gap-3.5 items-start"
    >
      <div className="w-[56px] h-[56px] rounded-full bg-[#c8620a] text-white flex items-center justify-center text-[7.5px] font-bold text-center leading-[1.3] p-1.5 flex-shrink-0">
        30 DAY<br />MONEY<br />BACK
      </div>
      <div>
        <p className="text-[9px] text-[#999] uppercase tracking-[0.1em] mb-1">
          The Empty-Bottle Promise
        </p>
        <h2 className="text-[15px] font-bold italic text-[#1a3028] leading-[1.3] mb-2">
          30-day money-back guarantee — even if the bottle is empty.
        </h2>
        <p className="text-[12px] text-[#666] leading-[1.6]">
          Take it daily for the full thirty days. If you don't feel sharper,
          calmer, more even — ship the bottles back (full, half, or empty)
          and we'll refund every dollar. No restocking fee, no friction, no
          questions.
        </p>
        <div className="flex flex-wrap gap-4 mt-2 text-[11px] text-[#3a6a4a] font-medium">
          <span>✓ Refunds processed in 3 business days</span>
          <span>✓ Keep any free gifts</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checkout/GuaranteeCard.tsx
git commit -m "feat: add GuaranteeCard with amber badge and promise copy"
```

---

## Task 10: Create `ReviewsSection`

**Files:**
- Create: `src/components/checkout/ReviewsSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
const TESTIMONIALS = [
  {
    text: '"I felt sharper by the second week — and I never remember to take vitamins. The subscription cadence is exactly right."',
    author: "Priya R.",
    location: "Austin, TX",
  },
  {
    text: '"Tried three other greens powders before this. This is the first one that doesn\'t taste like pond water."',
    author: "Daniel K.",
    location: "Brooklyn, NY",
  },
  {
    text: '"Customer service refunded me without making it weird when I asked. Then I re-ordered a month later."',
    author: "Lena S.",
    location: "Denver, CO",
  },
];

export function ReviewsSection() {
  return (
    <div data-section="reviews" className="bg-white rounded-[10px] p-4 mb-3">
      {/* Rating header */}
      <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[#f0ece4]">
        <span className="text-[#e8a020] text-[15px] tracking-[1px]">
          ★★★★★
        </span>
        <span className="font-extrabold text-[16px] text-[#1a3028]">4.86</span>
        <span className="text-[11px] text-[#888]">· 12,408 verified reviews</span>
        <span className="text-[9px] text-[#bbb] uppercase tracking-[0.08em] ml-auto">
          Verified by Stamped
        </span>
      </div>

      {/* Testimonial tiles */}
      <div className="grid grid-cols-3 gap-2">
        {TESTIMONIALS.map((t) => (
          <div
            key={t.author}
            className="bg-[#fafaf8] rounded-[8px] p-[11px] text-[11px] text-[#444] leading-[1.55]"
          >
            {t.text}
            <div className="mt-2 font-bold text-[10px] text-[#1a3028]">
              {t.author}{" "}
              <span className="text-[#3a6a4a] font-medium">✓ Verified</span>
            </div>
            <div className="text-[10px] text-[#888]">{t.location}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checkout/ReviewsSection.tsx
git commit -m "feat: add ReviewsSection with star rating header and testimonials"
```

---

## Task 11: Create `IngredientsPanel`

**Files:**
- Create: `src/components/checkout/IngredientsPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
const INGREDIENTS = [
  "Spirulina",
  "Chlorella",
  "Ashwagandha KSM-66",
  "Reishi",
  "Beetroot",
  "Spinach",
  "Kale",
  "Matcha",
  "Turmeric",
  "Ginger",
  "L-Theanine",
  "Probiotic Blend",
];

export function IngredientsPanel() {
  return (
    <div
      data-section="ingredients"
      className="bg-[#1a3028] rounded-[10px] p-4 mb-3"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-white">
          What's Inside
        </span>
        <span className="text-[11px] text-[#7ab89a] uppercase tracking-[0.08em]">
          32 Ingredients
        </span>
      </div>
      <div className="grid grid-cols-3 gap-y-[6px] gap-x-2">
        {INGREDIENTS.map((name) => (
          <span
            key={name}
            className="text-[11px] text-[#a8cdb8] flex items-center gap-1"
          >
            🌿 {name}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-[#7a9a8a] mt-2.5">
        + 20 more — full lab panel on the product page.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checkout/IngredientsPanel.tsx
git commit -m "feat: add IngredientsPanel with dark green styling"
```

---

## Task 12: Create `SecurityBadges`

**Files:**
- Create: `src/components/checkout/SecurityBadges.tsx`

- [ ] **Step 1: Create the file**

```tsx
const BADGES = [
  { icon: "🔒", title: "SSL 256", sub: "ENCRYPT." },
  { icon: "💳", title: "PCI Com.", sub: "LEVEL 1" },
  { icon: "✓", title: "Verified", sub: "SINCE '19" },
  { icon: "🔐", title: "Privacy", sub: "NO RESALE" },
];

export function SecurityBadges() {
  return (
    <div data-section="security-badges" className="grid grid-cols-4 gap-1.5">
      {BADGES.map((b) => (
        <div
          key={b.title}
          className="bg-[#fafaf8] border border-[#e8e0d4] rounded-[6px] p-1.5 text-center"
        >
          <div className="text-[13px]">{b.icon}</div>
          <div className="text-[8px] font-semibold text-[#555] leading-[1.4] mt-0.5">
            {b.title}
            <br />
            {b.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checkout/SecurityBadges.tsx
git commit -m "feat: add SecurityBadges 4-tile trust grid"
```

---

## Task 13: Rewrite `OrderSummaryCard` for dynamic bundle + amber CTA

**Files:**
- Modify: `src/components/checkout/OrderSummaryCard.tsx`

The card no longer wraps itself in `<Card>` — it lives inside the right-column form card in `CheckoutPage`. It receives `selectedBundle: Bundle` and drives the CTA price from it.

- [ ] **Step 1: Rewrite the file**

```tsx
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { LockIcon } from "lucide-react";
import { SecurityBadges } from "@/components/checkout/SecurityBadges";
import type { Bundle } from "@/components/checkout/BundleSelector";

function formatDollars(minor: number) {
  return `$${(minor / 100).toFixed(2)}`;
}

export interface OrderSummaryCardProps {
  selectedBundle: Bundle;
  /** When true the Pay button is non-interactive. Defaults to false. */
  payDisabled?: boolean;
  /** When true the button shows a spinner and stays disabled. */
  payLoading?: boolean;
}

export function OrderSummaryCard({
  selectedBundle,
  payDisabled = false,
  payLoading = false,
}: OrderSummaryCardProps) {
  const disabled = payDisabled || payLoading;

  const [ctaState, setCtaState] = useState<"idle" | "busy" | "done">("idle");
  const prevLoading = useRef(false);

  useEffect(() => {
    if (payLoading) {
      setCtaState("busy");
      prevLoading.current = true;
    } else if (prevLoading.current) {
      prevLoading.current = false;
      setCtaState("done");
      const t = setTimeout(() => setCtaState("idle"), 2000);
      return () => clearTimeout(t);
    }
  }, [payLoading]);

  const totalFormatted = formatDollars(selectedBundle.totalAmountMinor);
  const lineLabel = `${selectedBundle.bottleCount} × Vitamin Essentials Pack`;

  return (
    <div data-section="order-summary" className="border-t border-[#e0d9cc] pt-4 mt-2">
      {/* Line items */}
      <div className="flex justify-between text-[12px] text-[#555] py-1">
        <span>
          {lineLabel}{" "}
          <span className="text-[#aaa] text-[10px]">(one-time)</span>
        </span>
        <span>{totalFormatted}</span>
      </div>
      <div className="flex justify-between text-[12px] text-[#555] py-1">
        <span>Shipping</span>
        <span className="text-[#3a6a4a] font-semibold">FREE</span>
      </div>

      {/* Total */}
      <div className="flex justify-between items-start pt-2.5 mt-1 border-t border-[#e8e0d4]">
        <span className="text-[15px] font-bold text-[#1a3028]">Total Today</span>
        <div className="text-right">
          <div className="text-[15px] font-bold text-[#1a3028]">
            {totalFormatted}
          </div>
          <div className="text-[10px] text-[#aaa]">USD · billed once</div>
        </div>
      </div>

      {/* CTA */}
      <Button
        data-slot="cta-primary"
        data-state={ctaState}
        type="submit"
        disabled={disabled}
        aria-disabled={disabled}
        className="pay-cta mt-3 w-full h-[50px] rounded-[8px] border-0 bg-[#c8620a] text-[13px] font-extrabold tracking-[0.1em] text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span className="cta-main flex items-center gap-1.5">
          <LockIcon className="w-3.5 h-3.5 shrink-0" />
          RUSH MY ORDER — {totalFormatted} →
        </span>

        <span className="cta-overlay cta-overlay-busy">
          <span className="w-4 h-4 rounded-full border-2 border-white/25 border-t-white animate-spin" />
          <span className="text-sm tracking-[0.02em]">Placing your order…</span>
        </span>

        <span className="cta-overlay cta-overlay-done">
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path className="cta-checkmark" d="M5 12.5l4 4 10-10" />
          </svg>
          <span className="text-sm tracking-[0.02em]">Order confirmed</span>
        </span>
      </Button>

      <p className="text-[10px] text-[#999] text-center mt-2">
        Secure 256-bit SSL encryption · You won't be charged until you click above
      </p>

      <div className="mt-3">
        <SecurityBadges />
      </div>

      <p
        data-slot="cta-footnote"
        className="text-[9px] text-[#aaa] text-center mt-3 leading-[1.5]"
      >
        By placing this order you agree to our Terms of Sale and refund policy.
        Demo checkout — no real charges are made.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checkout/OrderSummaryCard.tsx
git commit -m "feat: rewrite OrderSummaryCard with dynamic Bundle prop and amber CTA"
```

---

## Task 14: Rewrite `CheckoutPage` — new layout, bundle state, selectedBundle→pay()

**Files:**
- Modify: `src/pages/CheckoutPage.tsx`

- [ ] **Step 1: Rewrite the file**

```tsx
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
import {
  BundleSelector,
  BUNDLES,
  type Bundle,
} from "@/components/checkout/BundleSelector";
import { ProductHeroCard } from "@/components/checkout/ProductHeroCard";
import { GuaranteeCard } from "@/components/checkout/GuaranteeCard";
import { ReviewsSection } from "@/components/checkout/ReviewsSection";
import { IngredientsPanel } from "@/components/checkout/IngredientsPanel";
import { useCheckoutPayment } from "@/hooks/useCheckoutPayment";
import { LockIcon } from "lucide-react";

const PRODUCT_SKU = "1234567890";
const PRODUCT_NAME = "Vitamin Essentials Pack";
const CURRENCY = "USD";

const INITIAL_CUSTOMER: CustomerInfoValue = {
  email: "",
  phoneNumber: "",
  phoneCountryCode: "",
};

const INITIAL_SHIPPING: ShippingInfoValue = {
  fullName: "",
  houseNumberOrName: "",
  street: "",
  city: "",
  stateOrProvince: "",
  zip: "",
  country: "",
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
      houseNumberOrName: shipping.houseNumberOrName,
      street: shipping.street,
      city: shipping.city,
      stateOrProvince: shipping.stateOrProvince,
      postalCode: shipping.zip,
      country: shipping.country,
    };

    await pay(componentRef.current, {
      email: customer.email,
      name: shipping.fullName,
      amount: selectedBundle.totalAmountMinor,
      currency: CURRENCY,
      phone: {
        number: customer.phoneNumber,
        countryCode: customer.phoneCountryCode,
      },
      billingAddress: address,
      shippingAddress: address,
      lineItems: [
        {
          sku: PRODUCT_SKU,
          description: PRODUCT_NAME,
          quantity: selectedBundle.bottleCount,
          amountIncludingTax: selectedBundle.totalAmountMinor,
        },
      ],
    });
  };

  const isProcessing = status === "processing";

  return (
    <main data-page="checkout" className="bg-[#f5f0e8] pb-12">
      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.65fr_1fr] lg:items-start">

          {/* LEFT: social proof column */}
          <div data-region="form-stack">
            <ProductHeroCard />
            <BundleSelector value={selectedBundle} onChange={setSelectedBundle} />
            <GuaranteeCard />
            <ReviewsSection />
            <IngredientsPanel />
          </div>

          {/* RIGHT: sticky form card */}
          <div data-region="summary" className="lg:sticky lg:top-6">
            <div className="bg-white rounded-[10px] overflow-hidden shadow-sm">
              {/* Form card header */}
              <div className="bg-[#1a3028] text-white px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold tracking-[0.1em] flex items-center gap-1.5">
                    <LockIcon className="w-3 h-3" />
                    SAFE &amp; SECURE ORDER FORM
                  </div>
                  <div className="text-[9px] text-[#7ab89a] tracking-[0.06em] mt-0.5">
                    256-BIT SECURE ENCRYPTION
                  </div>
                </div>
                <span className="bg-white/15 text-[10px] px-2 py-1 rounded-[4px] tracking-[0.06em]">
                  🔒 https
                </span>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="px-4 pb-4">
                {/* Section 1: Contact */}
                <section data-section="customer-info" className="pt-4">
                  <h2 className="text-[13px] font-semibold text-[#1a3028] mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#1a3028] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                      1
                    </span>
                    Contact
                    <span className="text-[10px] text-[#aaa] font-normal ml-auto">
                      Tracking link goes here.
                    </span>
                  </h2>
                  <CustomerInfo value={customer} onChange={setCustomer} />
                </section>

                <div className="h-px bg-[#f0ece4] my-3" />

                {/* Section 2: Shipping */}
                <section data-section="shipping-info">
                  <h2 className="text-[13px] font-semibold text-[#1a3028] mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#1a3028] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                      2
                    </span>
                    Shipping address
                    <span className="text-[10px] text-[#aaa] font-normal ml-auto">
                      U.S. only · free 2–4 day.
                    </span>
                  </h2>
                  <ShippingInfo value={shipping} onChange={setShipping} />
                </section>

                <div className="h-px bg-[#f0ece4] my-3" />

                {/* Section 3: Payment */}
                <section data-section="payment-info">
                  <h2 className="text-[13px] font-semibold text-[#1a3028] mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#1a3028] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                      3
                    </span>
                    Payment
                    <span className="text-[10px] text-[#aaa] font-normal ml-auto">
                      We never store your card.
                    </span>
                  </h2>
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
          </div>

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
```

- [ ] **Step 2: Verify build**

```bash
npx vite build --mode development 2>&1 | grep -E "error|Error|warning" | head -20
```

Expected: zero TypeScript errors. Warnings about unused variables are acceptable.

- [ ] **Step 3: Commit**

```bash
git add src/pages/CheckoutPage.tsx
git commit -m "feat: rewrite CheckoutPage with two-column layout and bundle state"
```

---

## Task 15: Delete `CheckoutHeader` and `CheckoutTimer`

**Files:**
- Delete: `src/components/checkout/CheckoutHeader.tsx`
- Delete: `src/components/checkout/CheckoutTimer.tsx`

Both files are now dead code: `CheckoutHeader` was removed from `CheckoutPage` in Task 14; `CheckoutTimer` was removed from `SiteHeader` in Task 5 (the timer now lives in ShopLayout).

- [ ] **Step 1: Delete the files**

```bash
git rm src/components/checkout/CheckoutHeader.tsx src/components/checkout/CheckoutTimer.tsx
```

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -r "CheckoutHeader\|CheckoutTimer" src/ --include="*.tsx" --include="*.ts"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: delete CheckoutHeader and CheckoutTimer (replaced by new layout and ShopLayout timer)"
```

---

## Task 16: Update `ThankYouPage` — cream background

**Files:**
- Modify: `src/pages/ThankYouPage.tsx`

The `ctaClassName` in ThankYouPage already uses CSS token utility classes (`from-pay-cta-from`, `to-pay-cta-to`, etc.) which automatically pick up the amber values after Task 1. Only the page background needs an explicit change.

- [ ] **Step 1: Change page background class**

In `src/pages/ThankYouPage.tsx`, locate the return statement's root element (line 192):

```tsx
/* OLD: */
<main data-page="thank-you" className="bg-background">
/* NEW: */
<main data-page="thank-you" className="bg-[#f5f0e8]">
```

- [ ] **Step 2: Verify build**

```bash
npx vite build --mode development 2>&1 | grep -E "^.*error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ThankYouPage.tsx
git commit -m "feat: update ThankYouPage background to cream #f5f0e8"
```

---

## Task 17: Update `ProductPage` — cream background + amber CTA

**Files:**
- Modify: `src/pages/ProductPage.tsx`

- [ ] **Step 1: Change page background class**

In `src/pages/ProductPage.tsx`, line 17:

```tsx
/* OLD: */
<main data-page="product" className="bg-background">
/* NEW: */
<main data-page="product" className="bg-[#f5f0e8]">
```

- [ ] **Step 2: Change CTA button color**

In `src/pages/ProductPage.tsx`, line 14, `ctaClassName`:

```tsx
/* OLD: */
"h-12 px-8 w-full rounded-full border-0 bg-[#169b6b] text-base justify-center cursor-pointer gap-4 items-center disabled:opacity-90"
/* NEW: */
"h-12 px-8 w-full rounded-full border-0 bg-[#c8620a] hover:bg-[#b55508] text-base justify-center cursor-pointer gap-4 items-center disabled:opacity-90 transition-colors"
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/ProductPage.tsx
git commit -m "feat: update ProductPage background and CTA to amber palette"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] CSS tokens: `--brand`, `--brand-accent`, `--brand-muted`, `--pay-cta-*` → Task 1
- [x] AnnouncementBar with timer prop → Task 2
- [x] UrgencyBanner with timer prop → Task 3
- [x] ShopLayout countdown lifted from CheckoutTimer → Task 4
- [x] SiteHeader: logo + nav + secure badge, no CheckoutTimer → Task 5
- [x] SiteFooter: white, thin border → Task 6
- [x] BundleSelector: Bundle type, BUNDLES const, 3 tiers, subscribe toggle → Task 7
- [x] ProductHeroCard → Task 8
- [x] GuaranteeCard → Task 9
- [x] ReviewsSection: rating header + 3 testimonials → Task 10
- [x] IngredientsPanel: dark green → Task 11
- [x] SecurityBadges: 4 tiles → Task 12
- [x] OrderSummaryCard: accepts `selectedBundle: Bundle`, amber CTA, SecurityBadges, FREE shipping → Task 13
- [x] CheckoutPage: two-column, `selectedBundle` state, `selectedBundle.totalAmountMinor` → pay() → Task 14
- [x] Delete CheckoutHeader + CheckoutTimer → Task 15
- [x] ThankYouPage: cream background; CTA auto-updates via CSS tokens → Task 16
- [x] ProductPage: cream background, amber CTA → Task 17

**Type consistency:**
- `Bundle` type defined once in `BundleSelector.tsx` (Task 7), imported via `type { Bundle }` in `OrderSummaryCard.tsx` (Task 13) and `CheckoutPage.tsx` (Task 14).
- `BUNDLES` constant defined in `BundleSelector.tsx`, imported in `CheckoutPage.tsx`.
- `selectedBundle.totalAmountMinor` (number) passed as `amount:` to `pay()` — matches `useCheckoutPayment` hook's existing `amount: number` param.
- `selectedBundle.bottleCount` (number) used as `quantity:` in lineItems — matches existing usage.
- `OrderSummaryCardProps.selectedBundle: Bundle` is required (no default) — `CheckoutPage` always passes it.
