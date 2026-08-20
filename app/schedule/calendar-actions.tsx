"use client";

import { useEffect, useState } from "react";

export function CalendarActions({ url }: { url: string }) {
  const [subscriptionUrl, setSubscriptionUrl] = useState(url);
  useEffect(() => {
    setSubscriptionUrl(`webcal://${window.location.host}${url}`);
  }, [url]);

  const className =
    "inline-flex min-h-10 items-center rounded-lg border border-[#003366] px-3 py-2 text-sm font-semibold text-[#003366] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]";
  return (
    <div className="flex flex-wrap gap-2">
      <a className={className} href={subscriptionUrl}>
        Subscribe to selected Classes
      </a>
      <a className={className} href={`${url}&download=1`}>
        Download calendar
      </a>
    </div>
  );
}
