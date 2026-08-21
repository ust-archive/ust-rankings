import { signIn } from "@/auth";
import { HKUST_PROVIDER_ID, safeReturnPath } from "@/lib/auth/policy";

export const dynamic = "force-dynamic";

async function startSignIn(r: string) {
  "use server";
  const returnPath = safeReturnPath(r);
  await signIn(HKUST_PROVIDER_ID, {
    redirectTo: `/auth/continue?r=${encodeURIComponent(returnPath)}`,
  });
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; error?: string }>;
}) {
  const { r, error } = await searchParams;
  const returnPath = safeReturnPath(r);
  return (
    <section className="flex w-full max-w-lg flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-950 shadow-sm sm:p-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">
          Sign in to contribute
        </h1>
      </header>
      {error ? (
        <p
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          Sign-in could not be completed. No contribution was saved.
        </p>
      ) : null}
      <form action={startSignIn.bind(null, returnPath)}>
        <button
          className="w-full rounded-lg bg-[#003366] px-4 py-3 font-semibold text-white"
          type="submit"
        >
          Login
        </button>
      </form>
    </section>
  );
}
