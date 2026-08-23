# Instructor UUID lives in the ranking generation

The app cannot mint Instructor identity. The data pipeline preserves Instructor UUIDs from the previous identity-aware `ust-archive/ust-rankings` Ranking Generation and publishes them in each next generation. Schedule files keep source names only; the app does not mint identity.

Identity is published in four Parquet relations in that Ranking Generation: one current row per Instructor UUID, Instructor Aliases, flattened identity events, and split-affected associations. Instructor ratings use Instructor UUID as their identity grain; Canonical Instructor Name remains display data.

Offered Courses with no samples get the same treatment as schedule-only Instructors: zero samples, Bayesian score equal to their family's prior mean, receive-only, dense term grid.

Merge, split, and ITSC corrections are idempotent, version-controlled pipeline input. Two Instructors may share one Canonical Instructor Name: split history and its affected Course Offering associations keep their evidence on distinct Instructor UUIDs, while an unqualified same-name collision fails publication. Complete Schedule history carries resolved Course Offerings forward but does not justify guessing a new same-name association in another Term. The app does not overlay a registry at refresh. Schedule resolves a Class source name against the accepted ranking generation at read time; it does not snapshot Instructor UUIDs into a Schedule generation.

Between pipeline runs the full identity snapshot is the previous Ranking Generation on Hugging Face. The identity relations carry current identities and append-only event history.

Every Instructor the pipeline clustered receives an Instructor UUID, including schedule-only names with no rating samples. TBA is not an Instructor. Those Instructors are emitted with zero samples and a Bayesian score equal to the population prior (the mean), so Rank and related measures follow. They compete in Instructor Rankings so a User can open details and publish a Review. The prior is computed only from Instructors with samples; zero-sample Instructors receive that mean and do not change it. Term coverage is the existing dense grid: first coverage through the latest source Term. `is_teaching` still distinguishes current from all-time.

Normal publication requires all four previous identity relations and fails without them. For the first identity-history publication only, an operator may pass `--init`; current identities and aliases remain required, while absent event and split-association relations start empty. The pipeline must not mint a parallel registry.
