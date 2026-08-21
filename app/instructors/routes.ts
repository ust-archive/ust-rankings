import { notFound, permanentRedirect } from "next/navigation";
import { normalizeInstructorKey } from "@/lib/instructor-identity";
import { instructorPath } from "@/lib/routes";

export { instructorPath } from "@/lib/routes";

export type InstructorRouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

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
  const key = normalizeInstructorKey(value);
  if (!key) notFound();
  if (value !== key) instructorRedirect(key, searchParams);
  return key;
}
