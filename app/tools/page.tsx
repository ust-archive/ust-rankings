import type { Metadata } from "next";
import { DistributionFitting } from "./distribution-fitting";

export const metadata: Metadata = {
  title: "UST Tools | UST Rankings",
  description:
    "Small tools for HKUST students. Fit a grade distribution and estimate where your score stands.",
};

export default function ToolsPage() {
  return (
    <>
      <header className="text-center">
        <h1 className="text-logo-gradient text-5xl font-bold leading-none tracking-tighter sm:text-7xl">
          UST Tools
        </h1>
        <p className="mt-3 text-sm font-semibold tracking-wide text-slate-600">
          Small Tools for Student Life
        </p>
      </header>
      <section
        aria-label="Tools"
        className="grid w-full max-w-2xl gap-6 sm:grid-cols-2"
      >
        <DistributionFitting />
      </section>
    </>
  );
}
