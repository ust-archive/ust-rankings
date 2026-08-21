export function withoutRankingPagination(
  searchParams: string | URLSearchParams,
) {
  const next = new URLSearchParams(searchParams);
  next.delete("cursor");
  next.delete("pages");
  return next;
}
