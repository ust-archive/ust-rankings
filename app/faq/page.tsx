import { privacyContact, privacyContactMailto } from "@/lib/privacy/contact";
import styles from "./styles.module.css";

const contact = privacyContact();
const Email = privacyContactMailto();
const Issue = "https://github.com/ust-archive/ust-rankings/issues/new";

export default function Faq() {
  return (
    <article className={styles.faq}>
      <h1 className="text-logo-gradient">FAQ – Rankings</h1>

      <section>
        <h2>What Do the Rankings Measure?</h2>
        <p>
          Rankings compare Course and Instructor teaching evidence for a
          selected Term and scoring configuration. They do not measure a
          person&apos;s overall worth or performance outside that evidence.
        </p>
      </section>

      <section>
        <h2>Where Does the Evidence Come From?</h2>
        <p>
          Teaching ratings come from <a href="https://ust.space/">UST Space</a>{" "}
          and HKUST&apos;s Student Feedback Questionnaire (SFQ). Course titles
          and descriptions come from the HKUST Course Catalog, while current
          teaching and offering status comes from Schedule data.
        </p>
      </section>

      <section>
        <h2>Which Criteria Can I Use?</h2>
        <p>
          The available criteria are Content, Teaching, Grading, Workload,
          Course SFQ, and Instructor SFQ. Choose a preset or select Custom to
          assign non-negative weights to each criterion.
        </p>
      </section>

      <section>
        <h2>How Are Scores and Ranks Calculated?</h2>
        <p>
          Each criterion uses a Bayesian-adjusted rating so sparse evidence is
          pulled toward its population mean. The selected weights combine those
          adjusted ratings into one score. Rank is then calculated within the
          selected Term and activity population; Rank of All Time compares all
          known entities with a score by that Term.
        </p>
        <p>
          Thumbs Votes, Emoji Reactions, and community Reviews are displayed
          separately and do not affect the current rankings.
        </p>
      </section>

      <section>
        <h2>What Do the Letter Grades Mean?</h2>
        <p>
          Letter grades summarize percentile position within the ranking
          population. A-range grades cover the top 25%, B-range grades the next
          40%, C-range grades the next 15%, D the next 10%, and F the remaining
          10%.
        </p>
      </section>

      <section>
        <h2>How Should I Interpret a Ranking?</h2>
        <p>
          Treat it as one evidence-based input, not a definitive judgment.
          Samples, confidence, selected criteria, and the comparison population
          all shape the result. Use Course and Instructor Details to inspect the
          underlying context before making a decision.
        </p>
      </section>

      <section>
        <h2>How Do I Request Access, Correction, or Account Closure?</h2>
        <p>
          Email the Privacy Contact at <a href={Email}>{contact.email}</a>. The
          same channel is listed on the{" "}
          <a href="/privacy">Privacy &amp; Community Policy</a> page and in the
          site footer.
        </p>
      </section>

      <section>
        <h2>How Can I Send Feedback?</h2>
        <p>
          Email <a href={Email}>the Privacy Contact</a>, or open an issue on{" "}
          <a href={Issue} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          .
        </p>
      </section>
    </article>
  );
}
