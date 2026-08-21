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
        <h2 className="text-2xl font-bold">Community rules</h2>
        <p className="mt-2">
          Critical but civil genuine teaching and Course experience is allowed.
          Reviews are published immediately; there is no premoderation queue or
          automatic content moderation.
        </p>
        <p className="mt-2">The following are prohibited:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            Third-party personal data except necessary public professional
            information
          </li>
          <li>Doxxing</li>
          <li>Threats</li>
          <li>Harassment</li>
          <li>Slurs</li>
          <li>Discriminatory abuse</li>
          <li>Impersonation</li>
          <li>Spam, advertising, or manipulation</li>
          <li>Deceptive links</li>
          <li>Confidential or unlawfully shared materials</li>
          <li>Unsupported crime or serious-misconduct allegations</li>
          <li>Irrelevant personal attacks</li>
          <li>Malicious files</li>
          <li>
            Credentials, government or student identifiers, financial or health
            information, and similarly high-risk data
          </li>
        </ul>
        <p className="mt-2">
          Deliberate self-disclosure of non-sensitive personal data is permitted
          after warning. Identity hidden is not anonymity to UST Rankings.
        </p>
      </section>
      <section>
        <h2 className="text-2xl font-bold">Reports and reconsideration</h2>
        <p className="mt-2">
          Signed-in Users may report a Review. Reporter identity stays private
          and is never shown to the reported author or the public. There is no
          public moderation log and no website Moderator or Administrator role.
        </p>
        <p className="mt-2">
          Affected Users are notified when practical and have one
          reconsideration channel through the contact below.
        </p>
      </section>
      <section>
        <h2 className="text-2xl font-bold">Pre-launch community notice</h2>
        <p className="mt-2">
          A complete versioned collection notice, retention terms, rights
          channels, and approved Privacy Contact details must still be published
          before production launch. This page is an implementation draft and
          does not claim legal approval.
        </p>
      </section>
      <section>
        <h2 className="text-2xl font-bold">Contact</h2>
        <p className="mt-2">
          For current site questions and reconsideration requests, email{" "}
          <a href="mailto:ust-rankings@flandia.dev">ust-rankings@flandia.dev</a>
          . This general channel is not presented as the future approved Privacy
          Contact.
        </p>
      </section>
    </article>
  );
}
