"use client";

import { useEffect } from "react";

export function CanonicalScheduleUrl({ url }: { url: string }) {
  useEffect(() => {
    if (`${window.location.pathname}${window.location.search}` !== url)
      window.history.replaceState(window.history.state, "", url);
  }, [url]);
  return null;
}
