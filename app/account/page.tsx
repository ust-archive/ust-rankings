import { redirect } from "next/navigation";
import { endSession, updateAccount } from "@/app/account/actions";
import { authenticatedUserId } from "@/lib/auth/user";
import { getAccountService } from "@/lib/contributions/postgres";

export const dynamic = "force-dynamic";

const STATUS_COPY = {
  suspended:
    "This User is suspended. Current database status blocks contribution writes.",
  closed: "This User account is closed. Contribution writes remain disabled.",
} as const;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const userId = await authenticatedUserId();
  if (!userId) redirect("/sign-in?r=%2Faccount");
  const user = await getAccountService().getUser(userId);
  if (!user) redirect("/sign-in?r=%2Faccount");
  if (user.status === "onboarding") redirect("/onboarding?r=%2Faccount");

  return (
    <section className="w-full max-w-xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-950 shadow-sm sm:p-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="mt-2 text-slate-600">
          Your account status is resolved from current contribution data, not
          trusted from the sign-in-time session.
        </p>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="font-semibold">Status</dt>
        <dd className="capitalize">{user.status}</dd>
        <dt className="font-semibold">Public Display Name</dt>
        <dd>{user.publicDisplayName ?? "Not set"}</dd>
      </dl>
      {params.saved ? (
        <p
          className="rounded-lg bg-green-50 p-3 text-sm text-green-900"
          role="status"
        >
          Account settings saved.
        </p>
      ) : null}
      {params.error ? (
        <p
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          Account settings could not be saved ({params.error}).
        </p>
      ) : null}
      {user.status === "active" ? (
        <form action={updateAccount} className="space-y-3">
          <label className="font-semibold" htmlFor="accountDisplayName">
            Edit Public Display Name
          </label>
          <input
            aria-describedby="account-name-help"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            defaultValue={user.publicDisplayName ?? ""}
            id="accountDisplayName"
            name="publicDisplayName"
            required
          />
          <p className="text-sm text-slate-600" id="account-name-help">
            Changes apply to future attribution. Existing Review Revisions keep
            the name captured when published.
          </p>
          <button
            className="rounded-lg bg-[#003366] px-4 py-2 font-semibold text-white"
            type="submit"
          >
            Save account settings
          </button>
        </form>
      ) : (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {STATUS_COPY[user.status]}
        </p>
      )}
      <form action={endSession}>
        <button className="text-sm font-semibold underline" type="submit">
          Sign out
        </button>
      </form>
    </section>
  );
}
