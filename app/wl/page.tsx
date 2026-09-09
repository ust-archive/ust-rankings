import type { Metadata } from "next";
import { WaitlistPage } from "./waitlist-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WL | UST Rankings",
  description: "Compare aggregate HKUST waitlist movement with WL.",
  alternates: { canonical: "/wl" },
};

export default function WaitlistRoute() {
  return <WaitlistPage />;
}
