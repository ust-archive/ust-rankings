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

export function instructorPath(
  value: { uuid: string; itsc?: string } | string,
) {
  return `/instructors/${typeof value === "string" ? value : (value.itsc ?? value.uuid)}`;
}
