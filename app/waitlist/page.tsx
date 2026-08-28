import type { Metadata } from "next";
import { WaitlistPage } from "./waitlist-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WL Compass | UST Rankings",
  description: "Compare aggregate HKUST waitlist movement with WL Compass.",
  alternates: { canonical: "/waitlist" },
};

export default function WaitlistRoute() {
  return <WaitlistPage />;
}
