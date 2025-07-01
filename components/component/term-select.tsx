import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cqTerms } from "@/data/cq";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import React, { useState } from "react";

export interface TermSelectProps {
  term: string;
  onTermChange: (term: string) => void;
}

export function TermSelect(props: TermSelectProps) {
  const [comboBoxOpen, setComboBoxOpen] = useState(false);
  return (
    <Popover open={comboBoxOpen} onOpenChange={setComboBoxOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={comboBoxOpen}
          className="w-[200px] justify-between"
        >
          {cqTerms.find((t) => t.term === props.term)?.termName}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder="Search for a term..." />
          <CommandList>
            <CommandEmpty>No term found.</CommandEmpty>
            <CommandGroup>
              {cqTerms.map((t) => (
                <CommandItem
                  key={t.term}
                  value={t.term}
                  onSelect={(currentValue) => {
                    props.onTermChange(currentValue);
                    setComboBoxOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      props.term === t.term ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {t.termName}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
