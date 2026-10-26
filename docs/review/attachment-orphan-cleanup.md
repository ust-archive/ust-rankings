# Review demo: abandoned accepted attachment bytes

Draft [PR #201](https://github.com/ust-archive/ust-rankings/pull/201) proposes automatic removal of accepted Stored Files that have no Attachment in any Review Revision. The review decision is the retention policy: **24 hours since the last completed upload or reuse**, followed by the next daily cleanup run. A daily job can add almost another day; this is eligibility, not a strict deletion deadline.

The patch uses a Stored File row lock shared by reuse, Attachment insertion, and cleanup. Once cleanup claims a file, new reuse and association are refused. Historical references, including withdrawn Reviews and earlier Revisions, protect bytes. Legacy rows get a fresh grace period when migration `0012` runs. Quota is released only after origin absence is confirmed.

## Before and after

Fresh local demonstration, 2026-10-06. Before: the eligible-fix baseline `72e2525a71ffaff91537512f924449b702288363`; its attachment implementation matches refreshed master `6600134bcc008b260803c4bbce93964b15351b5c`. After: this draft rebased on that master. Each run used a new isolated PostgreSQL schema on loopback and an in-memory object store. No production database or bucket was used.

Four 46-byte files were seeded; the old reused file was uploaded again, and the historical file was attached to a withdrawn Review Revision. The store first left deletion unconfirmed, then confirmed it.

| Observation | Before | After |
| --- | --- | --- |
| Unreferenced 48-hour-old file, first cleanup | Available; bytes retained | Removal claimed; bytes and quota retained |
| Same file, deletion confirmed on next cleanup | Still available; bytes retained | Tombstone retained; bytes removed |
| Unreferenced 23-hour-old file | Retained | Retained |
| 48-hour-old file reused now | Retained | Retained; grace refreshed |
| File referenced by withdrawn Revision | Retained | Retained |
| Distinct Stored File bytes after confirmation | 184 | 138 |

Recorded state excerpt:

```text
before: abandoned_48h={claimed:false,removed:false,bytesPresent:true}; quota=184→184
after:  abandoned_48h={claimed:true,removed:false,bytesPresent:true} while deletion is unconfirmed
after:  abandoned_48h={claimed:true,removed:true,bytesPresent:false}; quota=184→138 after confirmation
both:   recent_23h, reused_now, withdrawn_revision remain available
```

## Review and reproduction

Approve the grace period and irreversible claim, or choose another retention period/cadence. The current removal queue is unbounded; batching is deferred until volume warrants it. This patch does not remove historical metadata or referenced bytes.

The tracked PostgreSQL contracts exercise reuse, historical protection, confirmed deletion, stale-selected-file rejection, and insertion/cleanup ordering. After refresh over the merged atomic Review writer, selecting a claimed File returns `invalid-review` for both publication and edit, with the full transaction rolled back. The shared Attachment writer uses its existing domain-error mapper for the cleanup trigger's rejection.

If both attachment drafts are approved, their acceptance changes overlap: preserve this patch's last-upload timestamp together with [PR #204](https://github.com/ust-archive/ust-rankings/pull/204)'s fenced lease acceptance. A local integration with that resolution passed all 17 PostgreSQL contracts, including claimed-File Review rollback.

```sh
TEST_CONTRIBUTIONS_POSTGRES_URL=postgres://audit@127.0.0.1:55432/postgres npm run test:contracts
```

Use Node 26.7.0 and npm 12.0.2. Each contract creates and removes its own schema; do not substitute a production URL. Refreshed verification: toolchain, Biome, TypeScript, 187 application tests and 38 data tests; all 11 isolated PostgreSQL contracts; the reconciled #201+#204 integration passes all 17 contracts.
