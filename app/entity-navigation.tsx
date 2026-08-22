"use client";

import { ArrowLeft } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentProps, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

const provenanceKey = "__ustEntityNavigation";
let documentProvenance: string | undefined;
let pendingEntityNavigation = false;

type EntityLinkProps = ComponentProps<typeof Link>;

function NavigationProgress() {
  const { pending } = useLinkStatus();
  if (!pending || typeof document === "undefined") return null;
  const target = document.getElementById("navigation-progress");
  if (!target) return null;
  return createPortal(
    <div
      aria-label="Loading page"
      className="absolute inset-x-0 top-0 h-0.5 overflow-hidden"
      role="progressbar"
    >
      <span className="navigation-progress block h-full w-2/5 bg-[#CC9900]" />
    </div>,
    target,
  );
}

export function EntityLink({
  children,
  onNavigate,
  ref,
  transitionTypes,
  ...props
}: EntityLinkProps) {
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        onNavigate?.(event);
        pendingEntityNavigation = true;
      }}
      ref={ref}
      transitionTypes={transitionTypes ?? ["nav-forward"]}
    >
      {children}
      <NavigationProgress />
    </Link>
  );
}

export function DetailsBack() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pathname) return;
    documentProvenance ??= crypto.randomUUID();
    if (pendingEntityNavigation) {
      window.history.replaceState(
        { ...window.history.state, [provenanceKey]: documentProvenance },
        "",
      );
      pendingEntityNavigation = false;
    }
    setVisible(window.history.state?.[provenanceKey] === documentProvenance);
  }, [pathname]);
  if (!visible) return null;
  return (
    <Button
      // Real traversal preserves Ranking state and intentionally remains unanimated: React skips popstate transitions.
      onClick={() => window.history.back()}
      size="sm"
      type="button"
      variant="ghost"
    >
      <ArrowLeft aria-hidden="true" data-icon="inline-start" />
      Back
    </Button>
  );
}
