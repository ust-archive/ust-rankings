# Instructor UUID lives in the ranking generation

The app can no longer mint or fall back to an image seed, but Instructor UUID must stay immutable across deploys. The data pipeline assigns Instructor UUIDs and publishes them in each `ust-archive/ust-rankings` ranking generation, starting from the registry already served as seed commit `0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d`. Schedule files keep source names only; the app does not mint identity.

Identity is published as Parquet in that ranking generation so it can be joined to the rating files: one row per Instructor UUID, aliases, flattened identity events, and split-affected associations. Instructor rating grain stays Canonical Instructor Name until [#60](https://github.com/ust-archive/ust-rankings/issues/60) changes it to Instructor UUID.

Offered Courses with no samples get the same treatment as schedule-only Instructors: zero samples, Bayesian score equal to their family's prior mean, receive-only, dense term grid.

Merge, split, and ITSC corrections are pipeline input. The app does not overlay a registry at refresh. Schedule resolves a Class source name against the accepted ranking generation at read time; it does not snapshot Instructor UUIDs into a Schedule generation.

Between pipeline runs the full identity snapshot is the previous ranking generation on Hugging Face. Git holds only corrections. The identity Parquet carries current identities and the append-only event history. The first pipeline run bootstraps from the seed registry already served.

Every Instructor the pipeline clustered receives an Instructor UUID, including schedule-only names with no rating samples. TBA is not an Instructor. Those Instructors are emitted with zero samples and a Bayesian score equal to the population prior (the mean), so Rank and related measures follow. They compete in Instructor Rankings so a User can open details and publish a Review. The prior is computed only from Instructors with samples; zero-sample Instructors receive that mean and do not change it. Term coverage is the existing dense grid: first coverage through the latest source Term. `is_teaching` still distinguishes current from all-time.

After bootstrap, if the pipeline cannot load the previous identities artifact it fails and does not publish. It must not mint a parallel registry.
