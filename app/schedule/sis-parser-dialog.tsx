import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Course, CourseClass, findClass } from "@/data/cq";
import { SisParser, SisUrl } from "@/data/cq/sis-parser";
import { Import } from "lucide-react";
import React, { type HTMLAttributes } from "react";

type SisParserDialogProps = {
  term: string;
  callback: (classNumbers: string[]) => void;
} & HTMLAttributes<HTMLDivElement>;

export function SisParserDialog({
  term,
  callback,
  ...props
}: SisParserDialogProps) {
  const [text, setText] = React.useState("");
  const classNumbers = SisParser.parse(text);
  const classes = classNumbers.map((it) => findClass(term, it));

  function openSis() {
    window.open(SisUrl, "sis", "popup=true");
  }

  function handleSubmit() {
    callback(classNumbers);
    setText("");
  }

  return (
    <Dialog {...props}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-1/2">
          <Import className="mr-2 h-4 w-4" /> Import from SIS
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import from SIS</DialogTitle>
          <DialogDescription>
            <ol className="mt-2 space-y-1">
              <li>
                Go to <a onClick={openSis}>SIS</a>.
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
        <Textarea
          className="w-full"
          placeholder="Paste Here"
          defaultValue={text}
          content={text}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setText(e.target.value);
          }}
        />
        <div className="space-y-2">
          <Label>Class Numbers</Label>
          {classes.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No classes found.
            </p>
          ) : (
            <ul className="font-mono text-sm text-gray-500 dark:text-gray-400">
              {classes
                .filter((it) => it !== undefined)
                .map((it) => it as [Course, CourseClass])
                .map(([course, section]) => (
                  <li key={section.number}>
                    {course.subject} {course.number} {section.section}{" "}
                    <span>({section.number})</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="submit" onClick={handleSubmit}>
              Submit!{" "}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
