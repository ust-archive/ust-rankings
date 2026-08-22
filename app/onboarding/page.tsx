import Link from "next/link";
import { redirect } from "next/navigation";
import { completeOnboarding } from "@/app/account/actions";
import { safeReturnPath } from "@/lib/auth/policy";
import { authenticatedUserId } from "@/lib/auth/user";
import { getAccountService } from "@/lib/contributions/postgres";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "acceptance-required": "Accept both current policies to continue.",
  "invalid-display-name":
    "Enter a valid Public Display Name of 1–16 characters.",
  "policy-unavailable":
    "Onboarding is unavailable until the current policies are published.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; error?: string }>;
}) {
  const { r, error } = await searchParams;
  const returnPath = safeReturnPath(r);
  const userId = await authenticatedUserId();
  if (!userId) redirect(`/auth/login?r=${encodeURIComponent(returnPath)}`);
  const user = await getAccountService().getUser(userId);
  if (!user) redirect(`/auth/login?r=${encodeURIComponent(returnPath)}`);
  if (user.status === "active") redirect(returnPath);
  if (user.status !== "onboarding") redirect("/account");
  const policiesAvailable = Boolean(
    process.env.PRIVACY_POLICY_VERSION && process.env.COMMUNITY_RULES_VERSION,
  );

  return (
    <section className="flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-950 shadow-sm sm:p-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          First login
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Complete onboarding
        </h1>
        <p className="mt-2 text-slate-600">
          Confirm how future Attributed Review Revisions may identify you. This
          is a Public Display Name, not a verified legal name.
        </p>
      </header>
      {error ? (
        <p
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {ERRORS[error] ?? "Onboarding could not be completed."}
        </p>
      ) : null}
      {!policiesAvailable ? (
        <p
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          role="status"
        >
          Account writes remain disabled until approved policy versions are
          configured.
        </p>
      ) : null}
      <form action={completeOnboarding} className="flex flex-col gap-5">
        <input name="r" type="hidden" value={returnPath} />
        <div>
          <label className="font-semibold" htmlFor="publicDisplayName">
            Public Display Name
          </label>
          <input
            aria-describedby="display-name-help"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
            defaultValue={user.publicDisplayName ?? ""}
            id="publicDisplayName"
            name="publicDisplayName"
            required
          />
          <p className="mt-1 text-sm text-slate-600" id="display-name-help">
            1–16 user-perceived characters. Visible case and punctuation are
            preserved; controls and invisible spoofing characters are rejected.
          </p>
        </div>
        <label className="flex items-start gap-3">
          <input
            className="mt-1"
            name="acceptPrivacy"
            required
            type="checkbox"
          />
          <span>
            I accept the current collection notice and{" "}
            <Link href="/privacy">Privacy and Community Policy</Link>. Signing
            in stores an External Identity, Public Display Name, and later
            contribution writes. Identity hidden is not anonymity to UST
            Rankings. Rights requests go through the Privacy Contact on that
            page.
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            className="mt-1"
            name="acceptCommunity"
            required
            type="checkbox"
          />
          <span>
            I accept the current community rules for civil, genuine
            contributions.
          </span>
        </label>
        <button
          className="w-full rounded-lg bg-[#003366] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!policiesAvailable}
          type="submit"
        >
          Activate account
        </button>
      </form>
    </section>
  );
}
