# Draft: one ordered production publisher

Audit findings A12 and A13 identified independent production writers and stale publication. This is a concrete proposal for review; it has not been run in production. It preserves ADR0001's order: verified CI, rebuilt Ranking Generation, deployment of that CI image, and activation of the exact paired Delivery generation.

## Proposed writer and order

Keep Update data as the one production workflow; remove the standalone Deploy workflow. Successful trusted master push CI supplies both its tested SHA and its production-image-digest artifact. The writer checks out that SHA, rebuilds and publishes the Ranking archive, downloads that exact resulting revision with pinned Schedule, builds paired Delivery/ServerIndex, downloads the image digest from that same CI run, and deploys it through the existing create-image-app-spec and doctl path. It then uploads the derived canonical generation and mirrors, verifies, activates, and promotes the exact built Delivery directory.

Scheduled and manual publish runs refresh data for the compatible running image; they do not download or deploy a new image. Manual publish is restricted to current master. The Server Index activation contract remains the compatibility gate: failed activation does not promote the new browser pointer. Manual rollback explicitly selects an existing generation and remains exempt from the current-master check. It rolls back data pointers, not the provider image or database migrations.

## Queue and freshness

Keep merged PR #211's master branch filter and eligible-job concurrency scope. The proposed shared group production-publish, queue:max, and cancel-in-progress:false apply to jobs.update, after its existing eligibility guard; skipped CI jobs cannot compete for this queue, including a fork PR whose source branch is named master. GitHub's [job-level primary documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idconcurrency) permits up to 100 pending jobs with queue:max and disallows combining it with cancellation. Queue arrival order is not commit order. A late stale CI run must therefore check freshness even after waiting: queueing alone does not establish authority.

The small check-publication-head CLI verifies the checkout equals the requested tested/current SHA and reads origin's current master freshly. A valid different remote SHA returns false; invalid SHA, checkout mismatch, malformed/missing/duplicate remote output, or Git/network failure aborts. Production Git errors are reduced to a generic message so credential-bearing remote output is not logged.

Check at entry, immediately before the mutable Ranking archive upload, before provider update, before the canonical derived-generation upload, and inside the publisher before preparing storage, before each immutable upload, and after mirroring immediately before paired activation. Once a workflow step detects staleness, all downstream writers are skipped. No stale run begins activation or promotion. The already-started activation/promotion unit completes or restores the previous pair rather than abandoning it midway when master advances.

## Choices and limits requiring review

- One writer makes code/data ordering explicit and uses one lock for publication, provider deployment, and rollback. Retaining independent writers would require a shared lock plus a durable handoff of exact revisions/generation/image and more failure-state coordination.
- No running or pending cancellation avoids interrupting an irreversible write or replacing a newer pending run with late old CI. The queue is bounded at100, and freshness guards handle stale arrivals rather than treating FIFO as commit chronology.
- Manual current-master publication intentionally does not deploy an image; runtime compatibility must remain enforced by activation and operators should prefer the verified CI path for code/schema changes.
- There is no atomic compare-and-swap between GitHub master and Hugging Face, provider update, or activation. Master can move immediately after a guard. A late change during an irreversible upload may leave the canonical HF archive ahead of live pointers. A provider deployment already in progress can complete after master moves; later activation is skipped when detected. An image can therefore be ahead of the active pair until the next verified writer runs.
- Once activation starts, completing or restoring the paired transaction is preferred to leaving active Server Index and browser pointer mismatched. The shared lock prevents a second workflow writer during that recovery, but cannot prevent out-of-band provider/HF/Space writes.
- The exact production image artifact must still be retained and readable when its queued run starts. Missing/expired artifacts fail closed; this proposal does not rebuild an image under a different CI identity.

## Merged diagnostics preserved

The relocated deployment block retains merged PR188's update-response deployment identity for status, digest verification, and logs. Its existing Bash regressions execute the new location, with an additional stale-head case proving that no provider command runs. Merged PR189's authentication preflight and dependency-free revision helper are also retained: fresh publish runs validate authentication before dependency installation; rollback and stale entry skip that preflight. The known diagnostics defects are not reintroduced when removing deploy.yml.

## Evidence and gate

Tests exercise Git command timelines for old/new checkouts and branch advancement, fail-closed parsing/errors, freshness loss during mirror/verification, no writers for stale entry, and the explicit rollback exception. Workflow-spec assertions check queue behavior, one writer, ordered data/image/activation steps, same CI run artifact, current-master restrictions, and fresh mutation checks. Existing paired publication and image-spec tests continue passing. No production workflow was dispatched, no HF/Space/provider writes were performed, and no merges were made.

Before ready status, approve the queue/one-writer/manual policy and partial-state recovery limits, validate GitHub's workflow expression/queue acceptance, and test a non-production full publication/deployment path with exact image and data revisions. Source/unit verification does not establish a successful production cutover.

Drain existing runs of the old Deploy and Update data workflows before cutover: changing concurrency groups cannot serialize old runs that already acquired the previous groups.
