"use client";

import { ArrowLeft } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

const provenanceKey = "__ustEntityNavigation";
let documentProvenance: string | undefined;
let pendingEntityNavigation = false;

type EntityLinkProps = ComponentProps<typeof Link> & {
  navigationHref?: string;
};

function NavigationProgress({ preloading = false }: { preloading?: boolean }) {
  const { pending } = useLinkStatus();
  if ((!pending && !preloading) || typeof document === "undefined") return null;
  const target = document.getElementById("navigation-progress");
  if (!target) return null;
  return createPortal(
    <div
      aria-label="Loading page"
      className="absolute inset-x-0 top-0 h-1 overflow-hidden"
      role="progressbar"
    >
      <span className="navigation-progress block h-full w-2/5 bg-[#CC9900]" />
    </div>,
    target,
  );
}

export function EntityLink({
  children,
  onFocus,
  navigationHref,
  onMouseEnter,
  onNavigate,
  onPointerDown,
  ref,
  transitionTypes,
  ...props
}: EntityLinkProps) {
  const router = useRouter();
  const preparation = useRef<{
    href: string;
    promise: Promise<string>;
  } | null>(null);
  const [preloading, setPreloading] = useState(false);
  const types = transitionTypes ?? ["nav-forward"];

  function prepare() {
    if (
      typeof props.href !== "string" ||
      (!props.href.startsWith("/courses/") &&
        !props.href.startsWith("/instructors/") &&
        !props.href.startsWith("/rankings/courses") &&
        !props.href.startsWith("/rankings/instructors"))
    )
      return undefined;
    if (preparation.current?.href === props.href)
      return preparation.current.promise;
    router.prefetch(navigationHref ?? props.href);
    const promise = import("@/lib/browser-query/client")
      .then(({ preloadPublicQuery }) =>
        preloadPublicQuery(props.href as string),
      )
      .then((destination) => {
        router.prefetch(destination);
        return destination;
      });
    preparation.current = { href: props.href, promise };
    return promise;
  }

  return (
    <Link
      {...props}
      onFocus={(event) => {
        onFocus?.(event);
        void prepare()?.catch(() => undefined);
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        void prepare()?.catch(() => undefined);
      }}
      onNavigate={(event) => {
        onNavigate?.(event);
        pendingEntityNavigation = true;
        void prepare()?.catch(() => undefined);
        if (!navigationHref) return;
        event.preventDefault();
        setPreloading(true);
        router.push(navigationHref, {
          scroll: props.scroll,
          transitionTypes: [...types],
        });
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        void prepare()?.catch(() => undefined);
      }}
      prefetch={props.prefetch === undefined ? false : props.prefetch}
      ref={ref}
      transitionTypes={types}
    >
      {children}
      <NavigationProgress preloading={preloading} />
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
