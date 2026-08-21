"use server";

import { signIn } from "@/auth";
import { HKUST_PROVIDER_ID, safeReturnPath } from "@/lib/auth/policy";

export async function startSignIn(r: string) {
  const returnPath = safeReturnPath(r);
  await signIn(HKUST_PROVIDER_ID, {
    redirectTo: `/auth/continue?r=${encodeURIComponent(returnPath)}`,
  });
}
