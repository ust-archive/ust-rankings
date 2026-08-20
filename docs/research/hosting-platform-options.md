# Hosting platform options for the UST Rankings refactor

## Scope and conclusion

This report compares Vercel, Cloudflare, and DigitalOcean for a planned Next.js 16 application with dynamic server-side reads, application-level OIDC login, relational users/votes/reactions/reviews, Markdown rendering, and direct user uploads. It uses only vendor and framework documentation.

**Recommendation:** start with **DigitalOcean App Platform + DigitalOcean Managed PostgreSQL + the already-paid-for Spaces subscription**, using direct browser-to-Spaces uploads. A 1 GiB fixed App Platform container is currently $10/month and a single-node managed PostgreSQL cluster starts at $15/month, so the new hosting/database floor is about **$25/month**, or about **$30/month including the existing $5 Spaces subscription**. This gives full Node.js/Next.js behavior, conventional PostgreSQL and S3-compatible storage, and a more predictable bill than request-metered serverless infrastructure. It is not highly available at that floor and should be load-tested before launch. [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) [PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/) [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/)

**Strong alternative:** remain on **Vercel** when minimum operational work, native Next.js behavior, and automatic preview deployments are worth more than the lowest/predictable infrastructure bill. Keep PostgreSQL and Spaces provider-neutral rather than adopting Vercel-specific storage.

**Conditional alternative:** use **Cloudflare Workers** only after the exact dependency tree passes production-runtime tests under `workerd`, and only if the project accepts either D1's SQLite model/limits or an external PostgreSQL dependency. Its $5 Workers floor and no Worker egress charge are attractive, but the OpenNext adapter, isolate limits, and Cloudflare-specific bindings add compatibility and migration risk.

## Facts

### Requirement fit at a glance

| Area | Vercel | Cloudflare Workers | DigitalOcean App Platform |
|---|---|---|---|
| Next.js 16 model | Native Next.js deployment; full Node.js Functions | OpenNext adapter on `workerd`; most features supported, but Node.js middleware is not yet supported | Standard Node.js server or Docker container; Next.js says either supports all features |
| Dynamic SSR / server reads | Native | Supported | Supported with `next start`/Docker |
| OIDC login | Full Node.js ecosystem | Feasible with Web APIs/compatible packages; exact auth library must be tested | Full Node.js ecosystem |
| Relational store | Marketplace PostgreSQL providers | D1 (SQLite semantics) or external Postgres/MySQL through Hyperdrive | Managed PostgreSQL; $7 dev DB exists but is not production-equivalent |
| Cache | Next/Vercel caches; Marketplace Redis | Cache API, KV, Durable Objects; OpenNext cache configuration | Next local cache for one instance; Managed Valkey for shared cache |
| Object storage | Vercel Blob or external Spaces | R2 or external Spaces | Existing Spaces integration |
| Direct uploads | Required above 4.5 MB Function payload | Strongly preferred to avoid Worker request/memory limits | Strongly preferred to avoid 600-second timeout/ephemeral disk |
| Billing shape | $20 Pro floor plus metered compute/transfer and third-party database | $5 Workers floor plus request/CPU/storage operations | Fixed container + database sizes; transfer overage |
| Platform coupling | Highest for Vercel cache/Blob/build behavior; lower with external Postgres/Spaces | High when using D1, KV, Durable Objects, bindings, and OpenNext config | Low-to-moderate: Node/Docker + PostgreSQL + S3-compatible Spaces are portable |

### 1. Framework compatibility and runtime limitations

#### Vercel

- Vercel is a verified Next.js deployment adapter, while the Next.js documentation lists Cloudflare's current integration as an unverified provider integration whose feature support may vary. [Next.js deployment documentation](https://nextjs.org/docs/app/getting-started/deploying)
- Vercel Functions provide full Node.js API coverage. Current limits include 2 GB memory on Hobby, up to 4 GB on Pro/Enterprise, a 250 MB uncompressed function bundle, and a 4.5 MB request **or response** body. Default function duration is 300 seconds; Pro can configure 800 seconds, with an extended 1,800-second beta. [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- These limits comfortably cover dynamic reads, OIDC callbacks, and Markdown-to-HTML rendering in normal use. **Decision-dependent:** a large Markdown plugin chain, native modules, unusually large generated responses, or server-proxied files must be checked against bundle/body/memory limits.

#### Cloudflare

- Cloudflare deploys Next.js through `@opennextjs/cloudflare`, not as a normal Node.js server. Its documentation says App Router, Route Handlers, SSR, Server Components, Server Actions, streaming, ISR, middleware, and `next/after` are supported; **Node.js middleware is not yet supported**, and image optimization uses Cloudflare Images. Development uses Node.js, so Cloudflare explicitly tells users to run the adapter's `preview` command under `workerd` before deployment. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- Workers' `nodejs_compat` offers many Node APIs, but Cloudflare documents a mix of full, partial, and non-functional stub implementations. Runtime-dependent packages therefore require testing; import success alone is not proof that every called method works. [Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- Paid Workers have 128 MB memory per isolate, a 10 MB compressed Worker limit, six simultaneous outgoing connections per request, 10,000 subrequests, and a default 30 seconds of CPU time configurable to five minutes. Request-body limits come from the zone plan: 100 MB on Free/Pro, 200 MB on Business, and 500 MB by default on Enterprise. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- OIDC can be implemented with standard HTTPS, cookies, Web Crypto, and a compatible library, but the chosen authentication package and any database driver must be exercised under `workerd`. Markdown rendering is viable, but CPU-heavy syntax highlighting/sanitization and large bundles must be measured against 128 MB/10 MB.

#### DigitalOcean

- Next.js states that a Node.js server or Docker deployment supports **all** Next.js features. App Platform supports Next.js through its Node.js buildpack and also accepts a Dockerfile/container image. Next.js 16 requires Node.js 20.9 or newer; App Platform's buildpack supports current Node 20/22/24 releases and allows pinning the engine in `package.json`. [Next.js deployment documentation](https://nextjs.org/docs/app/getting-started/deploying) [Next.js 16 upgrade requirements](https://nextjs.org/docs/app/guides/upgrading/version-16) [DigitalOcean Node.js buildpack](https://docs.digitalocean.com/products/app-platform/reference/buildpacks/nodejs/)
- App Platform containers have an ephemeral, 4 GiB local filesystem; deployments/replacements erase it, volumes are unsupported, and uploads to the app time out after 600 seconds. The filesystem is suitable only for temporary work, not user files or a database. [App Platform limits](https://docs.digitalocean.com/products/app-platform/details/limits/)
- A single `next start` container can use Next.js's local cache. If the app later runs multiple instances, Next.js recommends a shared cache/tag-coordination design to avoid per-instance cache divergence. Streaming also depends on the proxy not buffering responses. [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting)

### 2. Database, cache, and object storage choices

#### Vercel

- Vercel no longer supplies a first-party Vercel Postgres or Vercel KV product for new projects. Its Marketplace provisions third-party PostgreSQL providers such as Neon, Supabase, Prisma Postgres, or Aurora, and Redis providers such as Upstash/Redis Cloud; credentials are injected as environment variables. Provider pricing, regions, backup policy, and migration terms remain separate decisions. [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage) [Redis on Vercel](https://vercel.com/docs/redis)
- Vercel Blob is available, but adopting it is unnecessary when Spaces is already paid for. Keeping standard PostgreSQL and S3-compatible Spaces reduces Vercel lock-in.

#### Cloudflare

- D1 is managed serverless SQL with SQLite semantics. Paid-plan limits include 10 GB per database, a 2 MB maximum row/BLOB/string, and 30-day Time Travel. Paid pricing includes 25 billion rows read, 50 million rows written, and 5 GB storage monthly; overages are $0.001/million rows read, $1/million rows written, and $0.75/GB-month. There is no D1 egress charge. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- D1 can represent users, votes, reactions, and reviews, but it is not PostgreSQL. **Decision-dependent:** expected write concurrency, query patterns, future database size, ORM support, and reporting needs determine whether D1 is acceptable.
- If conventional PostgreSQL is preferred, Hyperdrive pools/caches connections to an external PostgreSQL/MySQL database and is included in Workers Paid. That preserves the relational engine but adds a cross-service dependency and does not remove the external database bill. [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- R2 is S3-compatible, includes 10 GB storage, 1 million Class A operations, and 10 million Class B operations, then charges $0.015/GB-month, $4.50/million Class A, and $0.36/million Class B, with no internet egress charge. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

#### DigitalOcean

- Managed PostgreSQL begins at $15/month for a single 1 GiB node. It includes daily backups and point-in-time recovery within the previous seven days; PgBouncer connection pools are available. A single node is not highly available. [PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/) [PostgreSQL features](https://docs.digitalocean.com/products/databases/postgresql/details/features/) [PostgreSQL connection pooling](https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-connection-pools/)
- App Platform's $7/month 512 MB development PostgreSQL database is tied to the app, lacks the managed database's production characteristics, and is destroyed with the app. It should not hold production votes/reviews. [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)
- Managed Valkey starts at $15/month. It is optional: do not add it until measurements show a shared cache/session/rate-limit need. Database correctness data belongs in PostgreSQL, not a cache. [Managed database pricing](https://www.digitalocean.com/pricing/managed-databases)
- Spaces costs $5/month and includes 250 GiB storage and 1,024 GiB outbound transfer across buckets; extra storage is $0.02/GiB-month, extra outbound transfer $0.01/GiB, inbound transfer is free, and the CDN is included. Since the owner already pays this subscription, reusing it has no new base charge. [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/)

### 3. Bandwidth, image delivery, and uploads

- **Use direct browser-to-Spaces uploads on every compute option.** The application should authenticate/authorize the user, validate intended key/type/size metadata, issue a short-lived presigned S3 request, then record the completed object in PostgreSQL. This avoids buffering untrusted files in a Next.js process and avoids paying application-origin transfer for the file body.
- Spaces permits 5 GB single `PUT`s and multipart uploads up to 5 TB. Presigned uploads must target the Spaces origin, not the CDN endpoint: signed `PUT`/multipart requests sent to the CDN have a 7.91 MiB payload limit, and presigned CDN requests are not cached. [Spaces limits](https://docs.digitalocean.com/products/spaces/details/limits/) [Spaces CDN behavior](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/)
- Vercel Function bodies stop at 4.5 MB, so server-proxied image/file uploads are not a general solution. Vercel Blob itself also recommends client upload above that size. [Vercel Function limits](https://vercel.com/docs/functions/limitations) [Vercel Blob](https://vercel.com/docs/vercel-blob)
- Cloudflare's 100 MB Free/Pro zone request limit and 128 MB isolate memory make direct object-store upload safer. If R2 were chosen, presigned `PUT` supports direct client upload; a single part can be up to 5 GiB and multipart objects up to 5 TiB. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) [R2 upload limits](https://developers.cloudflare.com/r2/platform/limits/) [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- App Platform's 600-second upload timeout and ephemeral disk likewise favor direct-to-Spaces upload. [App Platform limits](https://docs.digitalocean.com/products/app-platform/details/limits/)

Bandwidth billing differs materially:

- Vercel Pro includes 1 TB Fast Data Transfer and 10 million Edge Requests, after which regional transfer/request pricing and the $20 monthly credit apply. Function-origin traffic can also incur Fast Origin Transfer. [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan) [Vercel regional pricing](https://vercel.com/docs/pricing/regional-pricing)
- Workers Paid has no separate Worker egress/throughput charge. Requests and CPU are metered. Fetching files from Spaces through a Worker would still consume Spaces outbound transfer, so public files should normally go directly through the Spaces CDN. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- A $10 App Platform container includes 100 GiB outbound transfer; overage is $0.02/GiB. Serving uploads from Spaces keeps those bytes in the separate 1,024 GiB Spaces allowance instead of the smaller app allowance. [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/)

**Decision-dependent:** final bandwidth cost cannot be forecast without monthly page views, dynamic response size, upload/download volume, cache-hit rate, image transformation count, and user geography.

### 4. Deployment model and operational burden

#### Vercel — lowest burden

- Git pushes create immutable deployments; non-production branches get preview deployments and generated URLs, production-branch changes deploy to production, and domains can be rolled back to prior deployments. [Vercel Git deployments](https://vercel.com/docs/git) [Vercel environments](https://vercel.com/docs/deployments/environments)
- Next.js caching, routing, image optimization, and serverless scaling are integrated. The trade-off is several metered resources and behavior that is easiest to reproduce only on Vercel.

#### Cloudflare — low infrastructure burden, medium application-integration burden

- Deployment builds an OpenNext artifact and publishes one Worker with Wrangler. The project owns `wrangler` bindings, `open-next.config.ts`, compatibility dates/flags, and production-runtime tests. Cache/ISR configuration may involve R2, D1, or Durable Objects rather than being transparent. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- The global isolate model scales without managing instances, but diagnosing package/runtime incompatibility is more specialized than debugging a normal Node.js server.

#### DigitalOcean — medium burden

- App Platform builds from Git with a Node buildpack, Dockerfile, or registry image, handles HTTPS and OS/runtime infrastructure, and can roll back among the ten most recent successful deployments. It is a long-running regional container behind DigitalOcean's edge/CDN rather than per-route serverless functions. [App Platform features](https://docs.digitalocean.com/products/app-platform/details/features/) [Managing deployments](https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/)
- The owner must choose/pin Node, size memory/CPU, monitor the process, plan database pools, and coordinate Next caches when adding instances. App Platform manages hosts and replacement, so it is substantially less work than a Droplet, but more work than Vercel's native Next.js service.

### 5. Verifiable pricing snapshot

Prices below are current vendor list prices; taxes, marketplace database plans, paid DNS/security plans, and support are excluded.

| Platform | Plausible low-cost production baseline | Included/overage facts | Important exclusions |
|---|---:|---|---|
| Vercel | **$20/month Pro** + PostgreSQL provider + existing $5 Spaces | $20 monthly usage credit; 1 TB Fast Data Transfer and 10M Edge Requests included; additional resources metered | Hobby is restricted to non-commercial personal use; Marketplace DB pricing varies |
| Cloudflare + D1 | **$5/month Workers Paid** + existing $5 Spaces | 10M dynamic requests and 30M CPU-ms included; $0.30/M requests and $0.02/M CPU-ms above; D1 has large included row allocations | Cloudflare Images, D1 overages, and any external DB are separate |
| Cloudflare + external PostgreSQL | **$5/month Workers Paid** + PostgreSQL + existing $5 Spaces | Hyperdrive included on Paid | External DB cost and cross-provider latency/egress |
| DigitalOcean | **$10/month 1 GiB app + $15/month PostgreSQL + existing $5 Spaces = about $30/month total** | App includes 100 GiB outbound; overage $0.02/GiB; Spaces includes 1 TiB outbound | Single app instance and single DB node are not HA; Valkey adds $15/month if later needed |

Sources: [Vercel Pro pricing](https://vercel.com/docs/plans/pro-plan), [Vercel commercial-use policy](https://vercel.com/docs/limits/fair-use-guidelines), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/), [PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/), and [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/).

### 6. Lock-in and migration implications

- **Most portable architecture:** application-level OIDC, standard PostgreSQL, and Spaces via the S3 API. This data plane can run from all three compute choices. Store object keys/metadata rather than provider URLs where possible, and isolate storage signing behind a small interface.
- **Vercel:** Next.js code is portable, but Vercel Blob, Marketplace automation, image behavior, preview environment assumptions, and proprietary cache APIs increase migration work. Using external PostgreSQL and Spaces limits the data migration to credentials/networking.
- **Cloudflare:** D1 uses SQLite semantics and a 10 GB per-database model, so leaving it may require schema/type/query conversion rather than a PostgreSQL dump/restore. R2's S3 compatibility is more portable, though not every S3 feature is implemented. Wrangler bindings, Durable Objects, KV, Hyperdrive, and OpenNext cache configuration are Cloudflare-specific.
- **DigitalOcean:** `next start`/Docker, PostgreSQL, and S3-compatible Spaces are conventional. App specs, bindable environment variables, and deployment automation are proprietary, but recreating the runtime elsewhere is comparatively straightforward. Spaces documents standard S3-compatible clients and APIs. [Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/)

## Recommendations (interpretation, not platform facts)

### Recommended initial architecture

1. **Compute:** one DigitalOcean App Platform 1 GiB fixed shared container ($10/month), with Node 22 pinned or a reproducible AMD64 Docker image. Start at 1 GiB rather than 512 MiB because Next.js production builds/runtime, Markdown plugins, and image metadata handling need headroom; confirm with a load test.
2. **Database:** one $15/month Managed PostgreSQL node using its PgBouncer endpoint where compatible. Keep all users, external OIDC identities, sessions (unless stateless), votes, reactions, reviews, moderation state, and upload metadata relational. Take an independent periodic logical export because the included PITR window is seven days.
3. **Files:** retain Spaces. Upload directly to the origin endpoint with short-lived presigned requests; serve public images through the Spaces CDN. Enforce authorization, random/non-user-controlled keys, MIME sniffing, byte limits, and post-upload validation. Do not trust browser `Content-Type` alone.
4. **Cache:** add no paid cache initially. Use indexed PostgreSQL queries, HTTP caching only for genuinely public pages, and the single-instance Next cache. Add Managed Valkey or another shared cache only after query/latency measurements or multi-instance deployment justify $15/month and operational complexity.
5. **Rendering/auth:** render and sanitize Markdown on the server or at write time using a pinned, audited pipeline. Choose an OIDC library that supports standard discovery/PKCE/state/nonce and store provider subject identifiers (`iss`, `sub`) rather than provider-specific profile assumptions.
6. **Deployment:** use Git autodeploy for production, a separate App Platform app or CI-created environment for previews, pre-deploy migrations with backward-compatible schema changes, and documented rollback. A code rollback does not roll back database schema/data.

### When to choose another platform

- **Choose Vercel** if the owner prioritizes native Next.js compatibility, preview URLs, effortless rollbacks/scaling, and minimal platform work over a flat bill. Keep Spaces and portable PostgreSQL; use direct uploads. Set spend alerts and model Fast Origin Transfer, image optimization, function CPU/memory, and marketplace DB costs before committing.
- **Choose Cloudflare** if measured traffic is globally distributed, responses are short/compute-light, and free Worker/R2 egress or the $5 floor materially changes the budget. Before choosing it, run the full auth, ORM/driver, Markdown/sanitizer, Server Action, upload-signing, and cache suite with `npm run preview` under `workerd`. Prefer external PostgreSQL through Hyperdrive if PostgreSQL portability matters more than D1's low cost.
- **Do not choose a self-managed Droplet merely to save a few dollars** unless the owner explicitly accepts OS patching, reverse-proxy/TLS configuration, process supervision, backups, monitoring, and incident response. App Platform is the relevant low-operations DigitalOcean comparison.

## Facts that depend on unresolved decisions

The following must be answered before a final cost/HA decision:

1. **Traffic:** monthly dynamic requests, static requests, peak requests/second, response bytes, and geographic distribution.
2. **Files:** maximum upload size, monthly uploaded/downloaded GiB, public versus private delivery, retention policy, and required image variants.
3. **Database:** expected rows and GiB over 1–3 years, peak writes/second during voting, reporting/query complexity, transaction isolation needs, and acceptable recovery-point/recovery-time objectives.
4. **Availability:** whether a single app container and single PostgreSQL node are acceptable. If not, DigitalOcean needs at least two app containers plus a standby database, changing the cost materially.
5. **Next.js features:** whether the refactor will use Node.js middleware/proxy, ISR, `use cache`, image optimization, or multi-instance tag revalidation. These affect Cloudflare compatibility and DigitalOcean cache design.
6. **Auth implementation:** exact OIDC providers/library, session strategy, callback environments, and whether preview deployments need provider redirect URIs.
7. **Commercial status/team size:** Vercel Hobby is limited to non-commercial personal use; Vercel Pro adds $20 for each additional deploying seat.
8. **Compliance/security:** data residency, audit logging, malware scanning, private-object delivery, and any PCI/regulated-data requirement.

## Primary sources retained

- [Next.js: Deploying](https://nextjs.org/docs/app/getting-started/deploying) — authoritative feature-support distinction among Node, Docker, and adapters.
- [Next.js: Self-hosting](https://nextjs.org/docs/app/guides/self-hosting) — cache, proxy, streaming, and multi-instance responsibilities.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations), [Pro plan](https://vercel.com/docs/plans/pro-plan), [Marketplace storage](https://vercel.com/docs/marketplace-storage), and [regional pricing](https://vercel.com/docs/pricing/regional-pricing) — native runtime, storage model, limits, and billing.
- [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 limits/pricing](https://developers.cloudflare.com/d1/platform/limits/), and [R2 limits/pricing](https://developers.cloudflare.com/r2/platform/limits/) — adapter support, isolate constraints, and metering.
- [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/), [limits](https://docs.digitalocean.com/products/app-platform/details/limits/), [Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/), and [Spaces pricing/limits](https://docs.digitalocean.com/products/spaces/details/pricing/) — container, database, storage, upload, and bandwidth facts.

No secondary sources were used where first-party documentation was available.
