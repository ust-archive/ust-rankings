"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Rocket } from "lucide-react";
import Link from "next/link";
import { type HTMLAttributes, useEffect, useState } from "react";

type UstRankingsComBannerProps = HTMLAttributes<HTMLDivElement>;

export function NewDomainBanner(props: UstRankingsComBannerProps) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    setHidden(
      window.location.hostname === "ust-rankings.com" ||
        process.env.NODE_ENV === "development",
    );
  }, []);

  if (hidden) {
    return <></>;
  }

  return (
    <Alert {...props} className={cn("text-left", props.className)}>
      <Rocket className="h-4 w-4" />
      <AlertTitle>New Domain Available!</AlertTitle>
      <AlertDescription>
        You can now access UST Rankings at{" "}
        <Link href="https://ust-rankings.com" className="underline">
          ust-rankings.com
        </Link>
        !
      </AlertDescription>
    </Alert>
  );
}
