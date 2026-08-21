import { afterEach, expect, mock, test } from "bun:test";
import { encode, getToken } from "next-auth/jwt";

mock.module("server-only", () => ({}));

afterEach(() => {
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_URL;
});

import {
  createAuthCallbacks,
  createInstitutionalProviders,
} from "@/lib/auth/config";
import {
  HKUST_AUTHORIZE_ISSUER,
  HKUST_CONNECT_ISSUER,
  HKUST_PROVIDER_ID,
  HKUST_STAFF_ISSUER,
} from "@/lib/auth/policy";
import type { AccountService } from "@/lib/contributions/accounts";

const account = {
  id: "00000000-0000-4000-8000-000000000043",
  status: "onboarding" as const,
  publicDisplayName: "Student Name",
};

function fakeAccounts() {
  const established: unknown[] = [];
  const accounts = {
    async establishUser(claims: unknown) {
      established.push(claims);
      return account;
    },
    async getUser() {
      return account;
    },
  } satisfies Pick<AccountService, "establishUser" | "getUser">;
  return { established, accounts };
}

test("Auth.js uses one organizational Entra login and minimal scopes", () => {
  const providers = createInstitutionalProviders({
    clientId: "shared-id",
    clientSecret: "shared-secret",
  });
  expect(
    providers.map((provider) => ({
      id: provider.id,
      issuer: provider.issuer,
      scope: provider.authorization?.params?.scope,
    })),
  ).toEqual([
    {
      id: HKUST_PROVIDER_ID,
      issuer: HKUST_AUTHORIZE_ISSUER,
      scope: "openid profile email",
    },
  ]);
});

test("Auth.js establishes the verified identity but serializes no provider token or email", async () => {
  const { accounts, established } = fakeAccounts();
  const callbacks = createAuthCallbacks(accounts);
  const token = await callbacks.jwt({
    token: {
      iat: 100,
      exp: 200,
      jti: "jwt-id",
      email: "student@connect.ust.hk",
      access_token: "must-not-leak",
      refresh_token: "must-not-leak",
      id_token: "must-not-leak",
    },
    account: {
      provider: HKUST_PROVIDER_ID,
      access_token: "must-not-leak",
      refresh_token: "must-not-leak",
      id_token: "must-not-leak",
    },
    profile: {
      iss: HKUST_CONNECT_ISSUER,
      sub: "verified-subject",
      name: "Student Name",
      email: "student@connect.ust.hk",
    },
  });

  expect(established).toEqual([
    {
      iss: HKUST_CONNECT_ISSUER,
      sub: "verified-subject",
      name: "Student Name",
      email: "student@connect.ust.hk",
    },
  ]);
  expect(token).toEqual({
    userId: account.id,
    displayName: "Student Name",
    onboarded: false,
    iat: 100,
    exp: 200,
    jti: "jwt-id",
  });

  const session = await callbacks.session({
    session: {
      user: {
        name: "provider name",
        email: "must-not-leak",
        image: "must-not-leak",
      },
      expires: "2030-01-01T00:00:00.000Z",
    },
    token,
  });
  expect(session).toEqual({
    user: { displayName: "Student Name", onboarded: false },
    expires: "2030-01-01T00:00:00.000Z",
  });
  expect(JSON.stringify(session)).not.toMatch(/token|email|subject|issuer/i);
});

test("Auth.js accepts either HKUST issuer and rejects other tenants", async () => {
  const { accounts, established } = fakeAccounts();
  const callbacks = createAuthCallbacks(accounts);
  await callbacks.jwt({
    token: {},
    account: { provider: HKUST_PROVIDER_ID },
    profile: { iss: HKUST_STAFF_ISSUER, sub: "staff-subject" },
  });
  expect(established[0]).toMatchObject({
    iss: HKUST_STAFF_ISSUER,
    sub: "staff-subject",
  });
  await expect(
    callbacks.jwt({
      token: {},
      account: { provider: HKUST_PROVIDER_ID },
      profile: {
        iss: "https://login.microsoftonline.com/common/v2.0",
        sub: "outsider",
      },
    }),
  ).rejects.toThrow("Institutional issuer is not allowed");
});

test("server writes accept only an encrypted Auth.js JWT with an internal User UUID", async () => {
  process.env.AUTH_SECRET = "test-auth-secret-with-at-least-32-bytes";
  const cookieName = "authjs.session-token";
  const jwt = await encode({
    token: {
      userId: account.id,
      displayName: "Student Name",
      onboarded: false,
    },
    secret: process.env.AUTH_SECRET,
    salt: cookieName,
  });
  const { authenticatedUserId } = await import("@/lib/auth/user");
  const request = new Request("http://localhost/account", {
    headers: { cookie: `${cookieName}=${jwt}` },
  });
  expect(await authenticatedUserId(request)).toBe(account.id);

  const tamperedJwt = `${jwt.slice(0, 30)}${jwt[30] === "a" ? "b" : "a"}${jwt.slice(31)}`;
  const tampered = new Request("http://localhost/account", {
    headers: { cookie: `${cookieName}=${tamperedJwt}` },
  });
  expect(
    await getToken({
      req: tampered,
      secret: process.env.AUTH_SECRET,
      secureCookie: false,
    }),
  ).toBeNull();
});
