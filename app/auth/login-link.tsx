"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function LoginLink({
  children,
  className = "text-xs font-bold uppercase tracking-[0.16em] text-slate-600",
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <Link
      className={className}
      href={`/auth/login?r=${encodeURIComponent(pathname)}`}
      prefetch={false}
    >
      {children}
    </Link>
  );
}
