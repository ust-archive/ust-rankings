# Detail-page prototype

Throwaway UI prototype for the Wayfinder ticket [Prototype detail pages and contribution controls](https://github.com/ust-archive/ust-rankings/issues/27).

Run from this branch:

```bash
corepack pnpm prototype:detail
```

Open <http://127.0.0.1:3100/prototype/detail-page?variant=A>.

Use the floating arrows or keyboard Left/Right to compare:

- `A` — Evidence first: ranking evidence and Reviews in a conventional two-column detail page.
- `B` — Workspace: dense entity rail and Review ledger.
- `C` — Community journal: editorial, community-first reading flow.

The Course/Instructor/Class pills exercise all three entity contexts. Sign out/in, toggle entity signals, report a Review, and open the Review composer. All mutations are in memory.

This is prototype code, not an implementation candidate.
