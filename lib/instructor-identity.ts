export const INSTRUCTOR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ITSC_PATTERN = /^[a-z][a-z0-9._-]{1,31}$/;

export function normalizeInstructorKey(value: string) {
  const normalized = value.trim().toLowerCase();
  return INSTRUCTOR_UUID_PATTERN.test(normalized) ||
    ITSC_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

export function normalizeInstructorUuid(value: string) {
  const normalized = value.trim().toLowerCase();
  return INSTRUCTOR_UUID_PATTERN.test(normalized) ? normalized : undefined;
}
