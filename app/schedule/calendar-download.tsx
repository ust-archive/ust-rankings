"use client";

import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ScheduleClass } from "@/lib/schedule/server";

export function CalendarDownload({
  classes,
  disabled = false,
}: {
  classes: ScheduleClass[];
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const selection = classes
    .map((item) => `${item.termCode}:${item.classNumber}`)
    .join(",");
  const toastId = `schedule-calendar-download:${selection}`;
  useEffect(
    () => () => {
      toast.dismiss(toastId);
    },
    [toastId],
  );
  async function download() {
    setPending(true);
    toast.dismiss(toastId);
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
      if (calendar.omitted)
        toast.warning(
          `${calendar.omitted} meeting${calendar.omitted === 1 ? "" : "s"} without complete dates and times could not be exported.`,
          { id: toastId },
        );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Calendar download failed. Try again.",
        { id: toastId },
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Button
      aria-label={pending ? "Preparing calendar…" : "Download calendar"}
      title="Download calendar"
      size="icon"
      disabled={pending || disabled}
      onClick={download}
      variant="ghost"
    >
      <DownloadIcon data-icon="inline-start" />
      <span className="sr-only">
        {pending ? "Preparing calendar…" : "Download calendar"}
      </span>
    </Button>
  );
}
