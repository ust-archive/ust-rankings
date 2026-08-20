import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { AccountService } from "@/lib/contributions/accounts";
import { HKUST_CONNECT_ISSUER, HKUST_STAFF_ISSUER } from "./policy";

const OIDC_SCOPE = "openid profile email";

export function createInstitutionalProviders(credentials: {
  connectClientId?: string;
  connectClientSecret?: string;
  staffClientId?: string;
  staffClientSecret?: string;
}) {
  function provider(
    id: "hkust-connect" | "hkust-staff",
    name: string,
    issuer: string,
    clientId: string | undefined,
    clientSecret: string | undefined,
  ) {
    const configured = MicrosoftEntraID({
      clientId,
      clientSecret,
      issuer,
      authorization: { params: { scope: OIDC_SCOPE } },
    });
    const { options: _, ...base } = configured;
    return {
      ...base,
      id,
      name,
      issuer,
      clientId,
      clientSecret,
      authorization: { params: { scope: OIDC_SCOPE } },
      profile(profile: { sub: string; name?: string; email?: string }) {
        return {
          id: profile.sub,
          name: profile.name ?? null,
          email: profile.email ?? null,
          image: null,
        };
      },
    };
  }

  return [
    provider(
      "hkust-connect",
      "HKUST student / Connect",
      HKUST_CONNECT_ISSUER,
      credentials.connectClientId,
      credentials.connectClientSecret,
    ),
    provider(
      "hkust-staff",
      "HKUST staff",
      HKUST_STAFF_ISSUER,
      credentials.staffClientId,
      credentials.staffClientSecret,
    ),
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
        const expectedIssuer =
          account.provider === "hkust-connect"
            ? HKUST_CONNECT_ISSUER
            : account.provider === "hkust-staff"
              ? HKUST_STAFF_ISSUER
              : undefined;
        if (!expectedIssuer || profile.iss !== expectedIssuer)
          throw new Error("OIDC provider and issuer do not match");
        const user = await accounts.establishUser({
          iss: profile.iss,
          sub: profile.sub,
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
