import NextAuth, { type NextAuthConfig } from "next-auth";
import {
  createAuthCallbacks,
  createInstitutionalProviders,
} from "@/lib/auth/config";
import { getAccountService } from "@/lib/contributions/postgres";

const providers = createInstitutionalProviders({
  connectClientId: process.env.AUTH_HKUST_CONNECT_ID,
  connectClientSecret: process.env.AUTH_HKUST_CONNECT_SECRET,
  staffClientId: process.env.AUTH_HKUST_STAFF_ID,
  staffClientSecret: process.env.AUTH_HKUST_STAFF_SECRET,
});

const callbacks = createAuthCallbacks({
  establishUser(claims) {
    return getAccountService().establishUser(claims);
  },
  getUser(userId) {
    return getAccountService().getUser(userId);
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  callbacks: callbacks as NextAuthConfig["callbacks"],
});
