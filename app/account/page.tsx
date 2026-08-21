import { redirect } from "next/navigation";
import { endSession, updateAccount } from "@/app/account/actions";
import { authenticatedUserId } from "@/lib/auth/user";
import { getAccountService } from "@/lib/contributions/postgres";
import { privacyContactMailto } from "@/lib/privacy/contact";

export const dynamic = "force-dynamic";

const STATUS_COPY = {
  suspended: "This account is suspended. Contribution writes are disabled.",
  closed: "This account is closed. Contribution writes are disabled.",
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
    <section className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-950 shadow-sm sm:p-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-slate-600">
          Email the{" "}
          <a className="underline" href={privacyContactMailto()}>
            Privacy Contact
          </a>{" "}
          to request your data, a correction, a review withdrawal, or to close
          your account.
        </p>
      </header>
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
        <form action={updateAccount} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="font-semibold" htmlFor="accountDisplayName">
              What name do you want people to see?
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              defaultValue={user.publicDisplayName ?? ""}
              id="accountDisplayName"
              name="publicDisplayName"
              required
            />
          </div>
          <button
            className="self-start rounded-lg bg-[#003366] px-4 py-2 font-semibold text-white"
            type="submit"
          >
            Save
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
