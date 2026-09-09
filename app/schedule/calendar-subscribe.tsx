"use client";

import { CalendarPlusIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CalendarSubscribe({
  termCode,
  classNumbers,
  disabled,
}: {
  termCode: string;
  classNumbers: number[];
  disabled: boolean;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [feed, setFeed] = useState<{ ready: boolean; error?: string }>({
    ready: false,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry restarts the feed check.
  useEffect(() => {
    if (!open || !url) return;
    const controller = new AbortController();
    setFeed({ ready: false });
    void fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        if (!controller.signal.aborted) setFeed({ ready: true });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setFeed({
            ready: false,
            error:
              error instanceof Error && error.message !== "Failed to fetch"
                ? error.message
                : "Could not check the calendar. Check your connection and try again.",
          });
      });
    return () => controller.abort();
  }, [open, url, attempt]);
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) return;
        setFeed({ ready: false });
        const query = new URLSearchParams({ term: termCode });
        for (const number of [...classNumbers].sort((a, b) => a - b))
          query.append("class", String(number));
        setUrl(`${window.location.origin}/api/calendar?${query}`);
        setError("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          title="Subscribe to calendar"
          aria-label="Subscribe to calendar"
        >
          <CalendarPlusIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subscribe to calendar</DialogTitle>
          <DialogDescription>
            Subscribe to updates for these Classes. If you change your
            selection, replace the subscription with the new link.
          </DialogDescription>
        </DialogHeader>
        {!feed.ready ? (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              {feed.error ?? "Checking calendar…"}
            </p>
            {feed.error ? (
              <Button
                variant="outline"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="calendar-url">Calendar URL</Label>
              <div className="flex gap-2">
                <Input
                  id="calendar-url"
                  value={url}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy calendar URL"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      toast("Calendar link copied.");
                      setError("");
                    } catch {
                      setError("Select and copy the calendar URL above.");
                    }
                  }}
                >
                  <CopyIcon />
                </Button>
              </div>
              {error ? (
                <p role="status" className="text-sm">
                  {error}
                </p>
              ) : null}
            </div>
            <ul className="flex flex-col gap-3 text-sm">
              <li>
                <strong>Outlook web / new Outlook:</strong> Add calendar →
                Subscribe from web → paste the URL.
              </li>
              <li>
                <strong>Classic Outlook:</strong> Open Calendar → From Internet
                → paste the URL.
              </li>
              <li>
                <strong>Google Calendar:</strong> On a computer, Other calendars
                → + → From URL.
              </li>
              <li>
                <strong>Apple Calendar:</strong>{" "}
                <a href={url.replace(/^https?:/, "webcal:")}>
                  Open in your calendar app
                </a>
                , or add a calendar subscription using the URL.
              </li>
            </ul>
            <p className="text-sm text-gray-500">
              Updates follow your calendar app’s refresh schedule.
            </p>
            {url.startsWith("http://localhost") ||
            url.startsWith("http://127.0.0.1") ? (
              <p className="text-sm text-gray-500">
                This local preview link cannot be fetched by Outlook or Google.
                Use the published site’s link when subscribing.
              </p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
