const COURSE_PREFIX = /^[A-Z]{2,8}$/u;
const COURSE_NUMBER = /^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/u;

export function isSameOriginWrite(origin: string | null, host: string | null) {
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.host === host &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

export function courseReviewPath(prefix: string, number: string) {
  const coursePrefix = prefix.trim().toUpperCase();
  const courseNumber = number.trim().toUpperCase();
  return COURSE_PREFIX.test(coursePrefix) && COURSE_NUMBER.test(courseNumber)
    ? `/courses/${coursePrefix}/${courseNumber}`
    : "/rankings/courses";
}
