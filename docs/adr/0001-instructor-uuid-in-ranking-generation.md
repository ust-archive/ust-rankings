# Instructor UUID lives in the ranking generation

The app cannot mint Instructor identity. The data pipeline preserves Instructor UUIDs from the previous identity-aware `ust-archive/ust-rankings` Ranking Generation and publishes them in each next generation. Schedule files keep source names only; the app does not mint identity.

Identity is published as Parquet in that ranking generation so it can be joined to the rating files: one row per Instructor UUID, aliases, flattened identity events, and split-affected associations. Instructor rating grain stays Canonical Instructor Name until [#60](https://github.com/ust-archive/ust-rankings/issues/60) changes it to Instructor UUID.

Offered Courses with no samples get the same treatment as schedule-only Instructors: zero samples, Bayesian score equal to their family's prior mean, receive-only, dense term grid.

Merge, split, and ITSC corrections are pipeline input. The app does not overlay a registry at refresh. Schedule resolves a Class source name against the accepted ranking generation at read time; it does not snapshot Instructor UUIDs into a Schedule generation.

Between pipeline runs the full identity snapshot is the previous Ranking Generation on Hugging Face. The identity Parquet carries current identities and the append-only event history.

Every Instructor the pipeline clustered receives an Instructor UUID, including schedule-only names with no rating samples. TBA is not an Instructor. Those Instructors are emitted with zero samples and a Bayesian score equal to the population prior (the mean), so Rank and related measures follow. They compete in Instructor Rankings so a User can open details and publish a Review. The prior is computed only from Instructors with samples; zero-sample Instructors receive that mean and do not change it. Term coverage is the existing dense grid: first coverage through the latest source Term. `is_teaching` still distinguishes current from all-time.

If the pipeline cannot load the previous identity artifacts, it fails and does not publish. It must not mint a parallel registry.
