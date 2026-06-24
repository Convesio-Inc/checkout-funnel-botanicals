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
