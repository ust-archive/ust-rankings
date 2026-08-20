export const HKUST_CONNECT_ISSUER =
  "https://login.microsoftonline.com/6c1d4152-39d0-44ca-88d9-b8d6ddca0708/v2.0";
export const HKUST_STAFF_ISSUER =
  "https://login.microsoftonline.com/c917f3e2-9322-4926-9bb3-daca730413ca/v2.0";

const ALLOWED_ISSUERS = new Set([HKUST_CONNECT_ISSUER, HKUST_STAFF_ISSUER]);
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;
const INVISIBLE_OR_CONTROL = /\p{C}/u;
const ENCODED_SEPARATOR_OR_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/iu;
const CALLBACK_PATHS = [
  "/sign-in",
  "/onboarding",
  "/api/auth",
  "/auth/continue",
];

export type InstitutionalClaims = {
  iss?: unknown;
  sub?: unknown;
  name?: unknown;
  email?: unknown;
};

export function validateInstitutionalClaims(claims: InstitutionalClaims) {
  if (typeof claims.iss !== "string" || !ALLOWED_ISSUERS.has(claims.iss))
    throw new Error("Institutional issuer is not allowed");
  if (typeof claims.sub !== "string" || claims.sub.length === 0)
    throw new Error("Institutional subject is missing");
  return { issuer: claims.iss, subject: claims.sub };
}

export function normalizePublicDisplayName(
  input: string,
): string | { error: string } {
  if (LINE_BREAK.test(input))
    return { error: "Public Display Name must be on one line" };
  const normalized = input.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (INVISIBLE_OR_CONTROL.test(normalized))
    return {
      error: "Public Display Name contains a control or invisible character",
    };
  const length = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      normalized,
    ),
  ].length;
  if (length < 1 || length > 16)
    return { error: "Public Display Name must be 1–16 characters" };
  return normalized;
}

export function safeReturnPath(value: string | null | undefined) {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    INVISIBLE_OR_CONTROL.test(value) ||
    ENCODED_SEPARATOR_OR_CONTROL.test(value)
  )
    return "/";

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes("\\") || INVISIBLE_OR_CONTROL.test(decoded))
      return "/";
    const parsed = new URL(value, "https://ust-rankings.invalid");
    if (parsed.origin !== "https://ust-rankings.invalid") return "/";
    const path = parsed.pathname.toLowerCase();
    if (
      CALLBACK_PATHS.some(
        (callback) => path === callback || path.startsWith(`${callback}/`),
      )
    )
      return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
