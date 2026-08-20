"use client";

import { Import } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildScheduleUrl,
  MAX_SIS_TEXT_LENGTH,
  type PlannerState,
  parseSisImport,
} from "@/lib/schedule/planner";

export function SisParserDialog({ state }: { state: PlannerState }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = parseSisImport(text);

  function handleSubmit() {
    if (parsed.classNumbers.length === 0) return;
    window.location.assign(
      buildScheduleUrl({
        ...state,
        classNumbers: [...state.classNumbers, ...parsed.classNumbers],
        view: "cart",
      }),
    );
    setText("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Import aria-hidden="true" className="mr-2 h-4 w-4" /> Import from SIS
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import Classes from SIS</DialogTitle>
          <DialogDescription>
            Copy the text on your SIS Student Center page and paste it below.
            Imported Class Numbers join this public, shareable planner URL.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor="sis-text">SIS page text</Label>
        <Textarea
          aria-describedby="sis-import-status"
          className="max-h-60 w-full"
          id="sis-text"
          maxLength={MAX_SIS_TEXT_LENGTH}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste SIS page text"
          value={text}
        />
        <div aria-live="polite" id="sis-import-status">
          {parsed.classNumbers.length > 0 ? (
            <p className="text-sm text-slate-600">
              Found Class Numbers: {parsed.classNumbers.join(", ")}. They will
              be validated against {state.termCode} after import.
            </p>
          ) : (
            <p className="text-sm text-amber-800">{parsed.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={parsed.classNumbers.length === 0}
            onClick={handleSubmit}
            type="button"
          >
            Add to planner cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
