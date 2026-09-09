"use client";

import { ImportIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { querySchedulePage } from "@/lib/browser-query/client";
import {
  buildScheduleUrl,
  mergePlannerClassNumbers,
  type PlannerState,
  parseSisImport,
} from "@/lib/schedule/planner";
import type { ScheduleClass } from "@/lib/schedule/server";

export function SisImportDialog({ state }: { state: PlannerState }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string>();

  const [classes, setClasses] = useState<ScheduleClass[]>([]);
  const [previewMessage, setPreviewMessage] = useState("No classes found.");
  useEffect(() => {
    let current = true;
    const parsed = parseSisImport(text);
    setClasses([]);
    if (!parsed.classNumbers.length || parsed.message) {
      setPreviewMessage("No classes found.");
      return;
    }
    setPreviewMessage("Finding classes…");
    void querySchedulePage({
      termCode: state.termCode,
      classNumbers: parsed.classNumbers,
    })
      .then((result) => {
        if (!current) return;
        setClasses(result.plannerClasses);
        setPreviewMessage(
          result.invalidClassNumbers.length
            ? `Unknown Class Numbers: ${result.invalidClassNumbers.join(", ")}`
            : "",
        );
      })
      .catch(() => {
        if (current)
          setPreviewMessage(
            "Class preview is unavailable. You can still import and review the Class Numbers in your cart.",
          );
      });
    return () => {
      current = false;
    };
  }, [text, state.termCode]);

  function submit() {
    const parsed = parseSisImport(text);
    if (parsed.message) {
      setMessage(parsed.message);
      return;
    }
    const merged = mergePlannerClassNumbers(
      state.classNumbers,
      parsed.classNumbers,
    );
    if (merged.error) {
      setMessage(merged.error);
      return;
    }
    router.push(
      buildScheduleUrl({
        ...state,
        classNumbers: merged.classNumbers,
        view: "cart",
      }),
    );
    setOpen(false);
    setText("");
    setMessage(undefined);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-1/2 gap-2" variant="outline">
          <ImportIcon data-icon="inline-start" />
          Import from SIS
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import from SIS</DialogTitle>
          <DialogDescription asChild>
            <ol className="mt-2 list-decimal pl-4 space-y-1">
              <li>
                Go to{" "}
                <a
                  href="https://sisprod.psft.ust.hk/psp/SISPROD/EMPLOYEE/HRMS/c/SA_LEARNER_SERVICES.SSS_STUDENT_CENTER.GBL"
                  target="sis"
                  rel="noopener noreferrer"
                >
                  SIS
                </a>
                .
              </li>
              <li>
                Press <kbd>Ctrl/⌘</kbd> + <kbd>A</kbd> to select all text on the
                page.
              </li>
              <li>
                Press <kbd>Ctrl/⌘</kbd> + <kbd>C</kbd> to copy the text.
              </li>
              <li>
                Press <kbd>Ctrl/⌘</kbd> + <kbd>V</kbd> to paste the text here.
              </li>
            </ol>
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(message)}>
          <FieldLabel className="sr-only" htmlFor="sis-text">
            SIS page text
          </FieldLabel>
          <Textarea
            aria-invalid={Boolean(message)}
            autoComplete="off"
            id="sis-text"
            onChange={(event) => {
              setText(event.target.value);
              setMessage(undefined);
            }}
            placeholder="Paste Here"
            rows={3}
            value={text}
          />
          {message ? <FieldError>{message}</FieldError> : null}
        </Field>
        <section
          aria-label="Class Numbers"
          aria-live="polite"
          className="space-y-2"
        >
          <h3 className="text-sm font-medium">Class Numbers</h3>
          <ul className="font-mono text-sm text-slate-600">
            {classes.map((clazz) => (
              <li key={clazz.classNumber}>
                {clazz.courseCode} {clazz.section} ({clazz.classNumber})
              </li>
            ))}
          </ul>
          {previewMessage ? (
            <p className="text-sm text-slate-600">{previewMessage}</p>
          ) : null}
        </section>
        <DialogFooter>
          <Button onClick={submit} type="button">
            Submit!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
