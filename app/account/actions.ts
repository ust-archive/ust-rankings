"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { safeReturnPath } from "@/lib/auth/policy";
import { authenticatedUserId } from "@/lib/auth/user";
import { AccountWriteError } from "@/lib/contributions/accounts";
import { getAccountService } from "@/lib/contributions/postgres";

function errorRedirect(
  path: string,
  error: unknown,
  returnPath?: string,
): never {
  if (!(error instanceof AccountWriteError)) throw error;
  const query = new URLSearchParams({ error: error.code });
  if (returnPath) query.set("r", safeReturnPath(returnPath));
  redirect(`${path}?${query}`);
}

export async function completeOnboarding(formData: FormData) {
  const returnPath = safeReturnPath(String(formData.get("r") ?? "/"));
  const userId = await authenticatedUserId();
  if (!userId) redirect(`/auth/login?r=${encodeURIComponent(returnPath)}`);
  try {
    await getAccountService().completeOnboarding(userId, {
      publicDisplayName: String(formData.get("publicDisplayName") ?? ""),
      acceptPrivacy: formData.get("acceptPrivacy") === "on",
      acceptCommunity: formData.get("acceptCommunity") === "on",
    });
  } catch (error) {
    errorRedirect("/onboarding", error, returnPath);
  }
  redirect(returnPath);
}

export async function updateAccount(formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) redirect("/auth/login?r=%2Faccount");
  try {
    await getAccountService().updateAccount(userId, {
      publicDisplayName: String(formData.get("publicDisplayName") ?? ""),
    });
  } catch (error) {
    errorRedirect("/account", error);
  }
  redirect("/account?saved=1");
}

export async function endSession() {
  await signOut({ redirectTo: "/" });
}
