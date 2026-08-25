export function rankingSearchParams(values: Iterable<[string, string]>) {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of values) {
    const current = result[name];
    result[name] = current
      ? Array.isArray(current)
        ? [...current, value]
        : [current, value]
      : value;
  }
  return result;
}

export function withoutRankingPagination(
  searchParams: string | URLSearchParams,
) {
  const next = new URLSearchParams(searchParams);
  next.delete("cursor");
  next.delete("pages");
  return next;
}
