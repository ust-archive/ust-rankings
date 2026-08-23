export const REVIEW_ORDERS = ["top", "popular", "recent"] as const;
export type ReviewOrder = (typeof REVIEW_ORDERS)[number];

export function reviewOrder(value: unknown): ReviewOrder {
  return typeof value === "string" &&
    REVIEW_ORDERS.includes(value as ReviewOrder)
    ? (value as ReviewOrder)
    : "top";
}
