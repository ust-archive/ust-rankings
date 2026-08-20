import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/auth/policy";
import { authenticatedUserId } from "@/lib/auth/user";
import { getAccountService } from "@/lib/contributions/postgres";

export default async function ContinueAfterSignIn({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const returnPath = safeReturnPath((await searchParams).r);
  const userId = await authenticatedUserId();
  if (!userId) redirect(`/sign-in?r=${encodeURIComponent(returnPath)}`);
  const user = await getAccountService().getUser(userId);
  if (!user) redirect(`/sign-in?r=${encodeURIComponent(returnPath)}`);
  if (user.status === "onboarding")
    redirect(`/onboarding?r=${encodeURIComponent(returnPath)}`);
  if (user.status !== "active") redirect("/account");
  redirect(returnPath);
}
