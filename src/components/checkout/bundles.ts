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
