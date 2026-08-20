import { expect, test } from "bun:test";
import { courseReviewPath, isSameOriginWrite } from "@/lib/contributions/http";

test("Review writes fail closed for missing, malformed, or cross-origin requests", () => {
  expect(isSameOriginWrite(null, "rankings.example")).toBe(false);
  expect(isSameOriginWrite("https://evil.example", "rankings.example")).toBe(
    false,
  );
  expect(isSameOriginWrite("not a URL", "rankings.example")).toBe(false);
  expect(
    isSameOriginWrite("https://rankings.example", "rankings.example"),
  ).toBe(true);
  expect(isSameOriginWrite("http://localhost:3000", "localhost:3000")).toBe(
    true,
  );
});

test("Review mutation redirects cannot be injected through Course fields", () => {
  expect(courseReviewPath("comp", "2000")).toBe("/courses/COMP/2000");
  expect(courseReviewPath("../account", "2000")).toBe("/rankings/courses");
  expect(courseReviewPath("COMP", "2000?x=1")).toBe("/rankings/courses");
});
