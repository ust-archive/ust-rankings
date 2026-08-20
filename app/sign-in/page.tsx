import Link from "next/link";
import { signIn } from "@/auth";
import { safeReturnPath } from "@/lib/auth/policy";

async function startSignIn(
  provider: "hkust-connect" | "hkust-staff",
  r: string,
) {
  "use server";
  const returnPath = safeReturnPath(r);
  await signIn(provider, {
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
    <section className="w-full max-w-lg space-y-6 rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-950 shadow-sm sm:p-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">
          Sign in to contribute
        </h1>
        <p className="mt-2 text-slate-600">
          Public rankings and Schedule pages remain available without signing
          in.
        </p>
      </header>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          Sign-in could not be completed. No contribution was saved.
        </p>
      ) : null}
      <div className="grid gap-3">
        <form action={startSignIn.bind(null, "hkust-connect", returnPath)}>
          <button
            className="w-full rounded-lg bg-[#003366] px-4 py-3 font-semibold text-white"
            type="submit"
          >
            Student / Connect account
          </button>
        </form>
        <form action={startSignIn.bind(null, "hkust-staff", returnPath)}>
          <button
            className="w-full rounded-lg border border-slate-300 px-4 py-3 font-semibold"
            type="submit"
          >
            Staff / HKUST account
          </button>
        </form>
      </div>
      <p className="text-sm text-slate-600">
        Only the verified institutional issuer and subject identify your
        account. Provider names and email addresses are mutable contact/profile
        data.
      </p>
      <Link className="inline-block text-sm font-semibold" href={returnPath}>
        Continue without signing in
      </Link>
    </section>
  );
}
