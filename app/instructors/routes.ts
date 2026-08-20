import { notFound, permanentRedirect } from "next/navigation";

export type InstructorRouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function instructorPath(
  value: { uuid: string; itsc?: string } | string,
) {
  return `/instructors/${typeof value === "string" ? value : (value.itsc ?? value.uuid)}`;
}

function queryString(searchParams: InstructorRouteSearchParams) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams))
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) query.append(name, item);
  return query.size > 0 ? `?${query}` : "";
}

export function instructorRedirect(
  key: string,
  searchParams: InstructorRouteSearchParams,
): never {
  permanentRedirect(`${instructorPath(key)}${queryString(searchParams)}`);
}

export function normalizeInstructorRoute(
  value: string,
  searchParams: InstructorRouteSearchParams,
) {
  const key = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      key,
    ) &&
    !/^[a-z][a-z0-9._-]{1,31}$/.test(key)
  )
    notFound();
  if (value !== key) instructorRedirect(key, searchParams);
  return key;
}
