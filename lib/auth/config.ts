import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { AccountService } from "@/lib/contributions/accounts";
import { HKUST_AUTHORIZE_ISSUER, validateInstitutionalClaims } from "./policy";

const OIDC_SCOPE = "openid profile email";

export function createInstitutionalProviders(credentials: {
  clientId?: string;
  clientSecret?: string;
}) {
  const configured = MicrosoftEntraID({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    issuer: HKUST_AUTHORIZE_ISSUER,
    authorization: { params: { scope: OIDC_SCOPE } },
  });
  const { options: _, ...base } = configured;
  return [
    {
      ...base,
      name: "HKUST",
      issuer: HKUST_AUTHORIZE_ISSUER,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      authorization: { params: { scope: OIDC_SCOPE } },
      profile(profile: { sub: string; name?: string; email?: string }) {
        return {
          id: profile.sub,
          name: profile.name ?? null,
          email: profile.email ?? null,
          image: null,
        };
      },
    },
  ];
}

type MinimalToken = {
  userId?: string;
  displayName?: string;
  onboarded?: boolean;
  iat?: number;
  exp?: number;
  jti?: string;
  [key: string]: unknown;
};

function tokenTimes(token: MinimalToken) {
  return {
    ...(typeof token.iat === "number" ? { iat: token.iat } : {}),
    ...(typeof token.exp === "number" ? { exp: token.exp } : {}),
    ...(typeof token.jti === "string" ? { jti: token.jti } : {}),
  };
}

export function createAuthCallbacks(
  accounts: Pick<AccountService, "establishUser" | "getUser">,
) {
  return {
    async jwt({
      token,
      account,
      profile,
    }: {
      token: MinimalToken;
      account?: { provider?: string; [key: string]: unknown } | null;
      profile?: Record<string, unknown>;
    }) {
      if (account) {
        if (!profile) throw new Error("Verified OIDC profile is missing");
        const identity = validateInstitutionalClaims(profile);
        const user = await accounts.establishUser({
          iss: identity.issuer,
          sub: identity.subject,
          name: profile.name,
          email: profile.email,
        });
        return {
          userId: user.id,
          ...(user.publicDisplayName
            ? { displayName: user.publicDisplayName }
            : {}),
          onboarded: user.status !== "onboarding",
          ...tokenTimes(token),
        };
      }
      if (typeof token.userId === "string") {
        const user = await accounts.getUser(token.userId);
        if (user)
          return {
            userId: user.id,
            ...(user.publicDisplayName
              ? { displayName: user.publicDisplayName }
              : {}),
            onboarded: user.status !== "onboarding",
            ...tokenTimes(token),
          };
      }
      return tokenTimes(token);
    },

    async session({
      session,
      token,
    }: {
      session: { expires: string; user?: unknown };
      token: MinimalToken;
    }) {
      return {
        user: {
          ...(typeof token.displayName === "string"
            ? { displayName: token.displayName }
            : {}),
          onboarded: token.onboarded === true,
        },
        expires: session.expires,
      };
    },
  };
}
