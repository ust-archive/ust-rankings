"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ScheduleClass } from "@/lib/schedule/server";

export function CalendarDownload({ classes }: { classes: ScheduleClass[] }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  async function download() {
    setPending(true);
    setMessage(undefined);
    try {
      const { createScheduleCalendar } = await import(
        "@/lib/schedule/calendar"
      );
      const calendar = await createScheduleCalendar(classes);
      const url = URL.createObjectURL(
        new Blob([calendar.body], { type: "text/calendar;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "ust-schedule.ics";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        calendar.omitted
          ? `Calendar downloaded. ${calendar.omitted} meeting${calendar.omitted === 1 ? "" : "s"} without complete dates and times could not be exported.`
          : "Calendar downloaded. Download it again if the Schedule changes.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar download failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        className="gap-2"
        disabled={pending}
        onClick={download}
        variant="outline"
      >
        <DownloadIcon data-icon="inline-start" />
        {pending ? "Preparing calendar…" : "Download calendar"}
      </Button>
      {message ? (
        <p className="max-w-sm text-sm text-slate-600" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
