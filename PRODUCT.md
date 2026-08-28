# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are the HKUST community: students, instructors, staff, alumni, and other community members who need to understand courses, instructors, schedules, rankings, or community-contributed teaching evidence.

## Product Purpose

UST Rankings helps the HKUST community explore Course and Instructor rankings, teaching details, schedule information, waitlist evidence, and authenticated community contributions. Success means users can make better-informed course planning and teaching-evaluation decisions from fast, transparent, data-backed interfaces without relying on opaque or mutable rankings.

## Positioning

UST Rankings combines independent community contributions with an immutable data pipeline and fast browser-side ranking exploration. Public ranking, catalog, schedule, instructor identity, and waitlist queries run against immutable Delivery Dataset generations in the browser, while the service keeps a paired Server Index for authoritative validation of community writes.

## Operating Context

Users browse public rankings and detail pages, search Courses and Instructors, inspect longitudinal rating evidence, review schedule and waitlist signals, and may sign in to contribute Reviews, Signals, and attachments. Public queries run through DuckDB-Wasm in one Web Worker per browser tab. Production serves immutable browser data from DigitalOcean Spaces CDN generations, with canonical archives on Hugging Face.

## Capabilities and Constraints

- Next.js web application using React, Tailwind CSS, DuckDB-Wasm, and authenticated contribution flows.
- Public ranking data is derived from pinned Catalog, Schedule, UST Space, and SFQ sources through reproducible immutable generations.
- Course and Instructor rankings are selected dynamically by criterion and population; precomputed ranks, percentiles, and population sizes are not stored as facts.
- Instructor identity continuity, merges, splits, and association corrections are controlled by explicit evidence and fail closed when ambiguous.
- Authenticated community contributions require configured Auth, PostgreSQL storage, approved policy versions, validation against the active Server Index, and moderation/operator workflows.
- Attachment handling uses private object storage and must not claim malware scanning.
- Production runs as a Node 26 service on DigitalOcean App Platform in Singapore.

## Brand Commitments

The product name is UST Rankings. No additional durable brand or voice commitments are confirmed.

## Evidence on Hand

- README: `README.md`
- Data pipeline and model semantics: `docs/data-pipeline.md`
- Contribution module and production gates: `contributions/README.md`
- Waitlist evidence documentation: `docs/waitlist-evidence.md`
- Existing interface implementation: `app/`, `components/`, `app/globals.css`
- No testimonials, customer logos, press claims, or legal/policy approval claims should be fabricated.

## Product Principles

- Keep ranking evidence reproducible, immutable, and traceable to pinned data generations.
- Make exploration feel fast enough for real enrolment and teaching-planning sessions.
- Prefer transparent uncertainty and fail-closed identity handling over guessed precision.
- Keep community writes accountable, privacy-preserving, and validated against authoritative product data.
- Preserve independence from official institutional endorsement unless explicitly confirmed.
