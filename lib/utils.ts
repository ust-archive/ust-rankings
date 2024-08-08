import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const collator = new Intl.Collator(undefined, { numeric: true });
export function naturalSort(a: string, b: string) {
  return collator.compare(a, b);
}

export const groupBy = <T, K extends keyof any>(
  list: T[],
  getKey: (item: T) => K,
) =>
  list.reduce(
    (previous, currentItem) => {
      const group = getKey(currentItem);
      if (!previous[group]) {
        previous[group] = [];
      }

      previous[group].push(currentItem);
      return previous;

      // eslint-disable-next-line @typescript-eslint/prefer-reduce-type-parameter
    },
    {} as Record<K, T[]>,
  );
