"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function ReviewNotice({
  published,
  withdrawn,
  error,
}: {
  published?: boolean;
  withdrawn?: boolean;
  error?: string;
}) {
  useEffect(() => {
    if (published) {
      toast.success("Review Revision published.", { id: "review-notice" });
    } else if (withdrawn) {
      toast.success("Review withdrawn from public display.", {
        id: "review-notice",
      });
    } else if (error) {
      toast.error(`Review could not be published (${error}).`, {
        id: "review-notice",
      });
    }
  }, [error, published, withdrawn]);

  return null;
}
