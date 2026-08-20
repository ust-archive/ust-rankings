import { expect, test } from "bun:test";
import {
  HKUST_CONNECT_ISSUER,
  HKUST_STAFF_ISSUER,
  normalizePublicDisplayName,
  safeReturnPath,
  validateInstitutionalClaims,
} from "@/lib/auth/policy";

test("Public Display Names are normalized without changing visible identity", () => {
  expect(normalizePublicDisplayName("  A\u0301da\t陳  ")).toBe("Áda 陳");
  expect(normalizePublicDisplayName("👩🏽‍🔬")).toEqual({
    error: "Public Display Name contains a control or invisible character",
  });
  expect(normalizePublicDisplayName("line\nbreak")).toEqual({
    error: "Public Display Name must be on one line",
  });
  expect(normalizePublicDisplayName("a".repeat(17))).toEqual({
    error: "Public Display Name must be 1–16 characters",
  });
  expect(normalizePublicDisplayName("陳".repeat(16))).toBe("陳".repeat(16));
});

test("institutional claims require the exact HKUST issuer and subject", () => {
  expect(
    validateInstitutionalClaims({
      iss: HKUST_CONNECT_ISSUER,
      sub: "student-1",
    }),
  ).toEqual({ issuer: HKUST_CONNECT_ISSUER, subject: "student-1" });
  expect(
    validateInstitutionalClaims({ iss: HKUST_STAFF_ISSUER, sub: "staff-1" }),
  ).toEqual({ issuer: HKUST_STAFF_ISSUER, subject: "staff-1" });
  expect(() =>
    validateInstitutionalClaims({
      iss: "https://login.microsoftonline.com/common/v2.0",
      sub: "student-1",
      email: "student@connect.ust.hk",
    }),
  ).toThrow("Institutional issuer is not allowed");
  expect(() =>
    validateInstitutionalClaims({ iss: HKUST_CONNECT_ISSUER }),
  ).toThrow("Institutional subject is missing");
});

test("safe returns accept only relative application paths and avoid callback loops", () => {
  expect(safeReturnPath("/courses/COMP/1023?term=2510#reviews")).toBe(
    "/courses/COMP/1023?term=2510#reviews",
  );
  for (const unsafe of [
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "javascript:alert(1)",
    "/%2f%2fattacker.example",
    "/path%0d%0aSet-Cookie:x",
    "/path%E2%80%AEtxt",
    "/sign-in?r=/account",
    "/%73ign-in?r=/account",
    "/onboarding?r=/account",
    "/onboard%69ng?r=/account",
    "/api/auth/callback/hkust-connect",
    "/api/%61uth/callback/hkust-connect",
    "/auth/continue?r=/account",
    "/auth/%63ontinue?r=/account",
  ]) {
    expect(safeReturnPath(unsafe)).toBe("/");
  }
  expect(safeReturnPath(undefined)).toBe("/");
});
