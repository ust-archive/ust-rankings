import type { ReactNode } from "react";
import { DetailsPage } from "@/app/page-transition";

export default function DetailsTemplate({ children }: { children: ReactNode }) {
  return <DetailsPage>{children}</DetailsPage>;
}
