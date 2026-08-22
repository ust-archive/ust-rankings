"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, ViewTransition } from "react";
import { DetailsBack } from "@/app/entity-navigation";

const pageTransition = {
  "nav-forward": "nav-forward",
  default: "none",
} as const;

export function EntityTitleTransition({
  children,
  name,
}: {
  children: ReactNode;
  name?: string;
}) {
  if (!name) return children;
  return (
    <ViewTransition default="none" name={name} share="text-morph">
      {children}
    </ViewTransition>
  );
}

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition
      default="none"
      enter={pageTransition}
      exit={pageTransition}
      key={pathname}
    >
      {children}
    </ViewTransition>
  );
}

export function DetailsPage({ children }: { children: ReactNode }) {
  return (
    <PageTransition>
      <div className="flex w-full flex-col items-start gap-6">
        <DetailsBack />
        {children}
      </div>
    </PageTransition>
  );
}
