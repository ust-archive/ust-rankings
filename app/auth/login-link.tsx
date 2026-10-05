"use client";

import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

export function LoginLink({
  children,
  className = "text-xs font-bold uppercase tracking-[0.16em] text-slate-600",
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  function updateReturnPath(event: MouseEvent<HTMLAnchorElement>) {
    const { pathname, search, hash } = window.location;
    event.currentTarget.href = `/auth/login?r=${encodeURIComponent(`${pathname}${search}${hash}`)}`;
  }
  return (
    <a
      className={className}
      href={`/auth/login?r=${encodeURIComponent(pathname)}`}
      onAuxClick={updateReturnPath}
      onClick={updateReturnPath}
      onContextMenu={updateReturnPath}
    >
      {children}
    </a>
  );
}
