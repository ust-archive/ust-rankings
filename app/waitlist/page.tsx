import type { Metadata } from "next";
import { WaitlistPage } from "./waitlist-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Waitlist Evidence | UST Rankings",
  description:
    "Compare aggregate HKUST waitlist movement without estimating individual enrollment outcomes.",
  alternates: { canonical: "/waitlist" },
};

export default function WaitlistRoute() {
  return <WaitlistPage />;
}
