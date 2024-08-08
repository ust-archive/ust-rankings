import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const collator = new Intl.Collator(undefined, { numeric: true });
export function naturalSort(a: string, b: string) {
  return collator.compare(a, b);
}
