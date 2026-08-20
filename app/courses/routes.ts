import { notFound, permanentRedirect } from "next/navigation";

export type RouteSearchParams = Record<string, string | string[] | undefined>;

export function coursePath(
  coursePrefix: string,
  courseNumber: string,
  termCode?: string,
  section?: string,
) {
  return ["/courses", coursePrefix, courseNumber, termCode, section]
    .filter((part): part is string => Boolean(part))
    .join("/");
}

export function normalizeCourseRoute(
  values: {
    prefix: string;
    number: string;
    termCode?: string;
    section?: string;
  },
  searchParams: RouteSearchParams,
) {
  const coursePrefix = values.prefix.trim().toUpperCase();
  const courseNumber = values.number.trim().toUpperCase();
  const termCode = values.termCode?.trim();
  const section = values.section?.trim().toUpperCase();
  if (
    !/^[A-Z]{2,8}$/.test(coursePrefix) ||
    !/^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(courseNumber) ||
    (termCode !== undefined && !/^[0-9]{4}$/.test(termCode)) ||
    (section !== undefined && !/^[A-Z][A-Z0-9-]{0,15}$/.test(section))
  )
    notFound();

  const canonical = coursePath(coursePrefix, courseNumber, termCode, section);
  if (
    values.prefix !== coursePrefix ||
    values.number !== courseNumber ||
    values.termCode !== termCode ||
    values.section !== section
  ) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(searchParams))
      for (const item of Array.isArray(value) ? value : [value])
        if (item !== undefined) query.append(name, item);
    permanentRedirect(`${canonical}${query.size > 0 ? `?${query}` : ""}`);
  }
  return { coursePrefix, courseNumber, termCode, section, canonical };
}
