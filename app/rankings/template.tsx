import type { ReactNode } from "react";
import { PageTransition } from "@/app/page-transition";

export default function RankingsTemplate({
  children,
}: {
  children: ReactNode;
}) {
  return <PageTransition>{children}</PageTransition>;
}
