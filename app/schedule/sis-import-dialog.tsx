"use client";

import { ImportIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  buildScheduleUrl,
  mergePlannerClassNumbers,
  type PlannerState,
  parseSisImport,
} from "@/lib/schedule/planner";

export function SisImportDialog({ state }: { state: PlannerState }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string>();

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
        <Button variant="outline">
          <ImportIcon data-icon="inline-start" />
          Import from SIS
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from SIS</DialogTitle>
          <DialogDescription>
            Copy the SIS page text and paste it below. Recognized Class Numbers
            will be added to this Term&apos;s planner.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(message)}>
          <FieldLabel htmlFor="sis-text">SIS page text</FieldLabel>
          <Textarea
            aria-invalid={Boolean(message)}
            autoComplete="off"
            id="sis-text"
            onChange={(event) => {
              setText(event.target.value);
              setMessage(undefined);
            }}
            placeholder="Paste SIS page text…"
            rows={10}
            value={text}
          />
          {message ? (
            <FieldError>{message}</FieldError>
          ) : (
            <FieldDescription>
              Your pasted text is not uploaded or stored.
            </FieldDescription>
          )}
        </Field>
        <DialogFooter>
          <Button onClick={submit} type="button">
            Add Classes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
