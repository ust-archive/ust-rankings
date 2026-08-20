export default function PrivacyPage() {
  return (
    <article className="w-full max-w-3xl space-y-8 text-left">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">
          Privacy and Community Policy
        </h1>
        <p className="mt-3 text-slate-600">
          Public rankings and Schedule pages do not require an account.
        </p>
      </header>
      <section>
        <h2 className="text-2xl font-bold">Pre-launch community notice</h2>
        <p className="mt-2">
          Community contributions and account writes are not available yet. A
          complete versioned collection notice, community rules, retention
          terms, rights channels, and approved Privacy Contact details must be
          published before those features launch.
        </p>
      </section>
      <section>
        <h2 className="text-2xl font-bold">Contact</h2>
        <p className="mt-2">
          For current site questions, email{" "}
          <a href="mailto:ust-rankings@flandia.dev">ust-rankings@flandia.dev</a>
          . This general channel is not presented as the future approved Privacy
          Contact.
        </p>
      </section>
    </article>
  );
}
