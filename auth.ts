import NextAuth, { type NextAuthConfig } from "next-auth";
import {
  createAuthCallbacks,
  createInstitutionalProviders,
} from "@/lib/auth/config";
import { getAccountService } from "@/lib/contributions/postgres";

const providers = createInstitutionalProviders({
  clientId: process.env.AUTH_HKUST_ID,
  clientSecret: process.env.AUTH_HKUST_SECRET,
});

const callbacks = createAuthCallbacks({
  establishUser(claims) {
    return getAccountService({
      caller: "auth",
      authentication: "authenticated",
      requestClass: "action-api",
    }).establishUser(claims);
  },
  getUser(userId) {
    return getAccountService({
      caller: "auth",
      authentication: "authenticated",
      requestClass: "action-api",
    }).getUser(userId);
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: callbacks as NextAuthConfig["callbacks"],
});
