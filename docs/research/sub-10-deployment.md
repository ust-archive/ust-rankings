# Establishing the sub-US$10 deployment envelope

## Decision summary

A production deployment can stay at or below **US$10/month total**, counting the already-paid **US$5/month DigitalOcean Spaces** subscription, only by combining free or entry-level compute with a free database—or by using Cloudflare Workers Paid with D1. The strongest baseline is **Cloudflare Workers Paid + D1 + existing Spaces: US$5 incremental / US$10 total base cost**. It removes the Free plan's 10 ms CPU and daily hard-stop limits while keeping application and relational-data infrastructure managed. It is still not a hard US$10 ceiling because paid usage can incur overages, D1 has SQLite rather than PostgreSQL semantics, and Next.js runs through the unverified OpenNext adapter on `workerd`.

If PostgreSQL and full Node.js behavior are more important, use **one US$5 DigitalOcean App Platform container + Neon Free Postgres + Spaces: US$5 incremental / US$10 total**. This is a credible low-traffic production experiment, not an availability baseline: 512 MiB must be load-tested, one container is not highly available, and Neon Free scales to zero and has no uptime SLA. A **US$4 Basic Droplet + Neon Free + Spaces (US$9 total)** is cheaper but shifts OS patching, TLS/reverse proxy, process supervision, monitoring, and incident response to the project; it is not the preferred topology.

Vercel Hobby can produce the lowest-operations **US$5 total** topology with a free external Postgres database, but it qualifies only if the deployment is genuinely non-commercial personal use. Its ownership rules also make it a poor fit for an organization-owned, contribution-driven project.

## Scope and accounting

The application is assumed to require:

- Next.js 16 with dynamic rendering/server actions rather than a static export;
- application-level OIDC callbacks, cookies/sessions, and outbound HTTPS;
- relational users, contributions, votes, reactions, and reviews;
- direct browser uploads to the existing Spaces bucket; and
- a low-traffic launch profile.

**Total** below includes the existing US$5 Spaces subscription. **Incremental** is new monthly base spend beyond Spaces. Prices exclude tax, domains, optional observability, database/storage overages, and traffic overages. A base price is not a spend cap.

Next.js documents Node.js server and Docker deployments as supporting all framework features. Adapter deployments vary; Vercel is verified, while Cloudflare's integration is not yet a verified Next.js adapter. [Next.js deployment modes](https://nextjs.org/docs/app/getting-started/deploying)

## Qualifying topologies

| Topology | Incremental | Total incl. Spaces | Production judgment | Main stop condition |
|---|---:|---:|---|---|
| **Cloudflare Workers Paid + D1 Paid allowance + Spaces** | **US$5** | **US$10** | **Recommended sub-US$10 base** after `workerd` compatibility/load tests | Paid overages; D1 semantics/concurrency; OpenNext compatibility |
| Cloudflare Workers Free + D1 Free + Spaces | US$0 | US$5 | Trial/very small production only | 10 ms CPU, 100k requests/day, D1 daily hard stops, 3 MB bundle |
| Cloudflare Workers Paid + Neon Free + Spaces | US$5 | US$10 | Viable when PostgreSQL portability outweighs an extra dependency | Neon cold starts/free quotas/no SLA; cross-provider latency |
| Vercel Hobby + Neon Free + Spaces | US$0 | US$5 | Technically strong only if Hobby eligibility and ownership workflow fit | Non-commercial-personal restriction; contribution deploy ownership |
| Vercel Hobby + Supabase Free + Spaces | US$0 | US$5 | Same eligibility caveat; weaker idle availability | Supabase may pause low-activity projects after 7 days |
| DigitalOcean App Platform 512 MiB + Neon Free + Spaces | US$5 | US$10 | **Preferred full-Node alternative**, subject to memory/load test | One container is not HA; 512 MiB; Neon cold start/free limits |
| DigitalOcean App Platform 512 MiB + Supabase Free + Spaces | US$5 | US$10 | Viable if regular activity prevents database pausing | Supabase free-project pausing and free quotas |
| DigitalOcean Basic Droplet 512 MiB + Neon Free + Spaces | US$4 | US$9 | Feasible but operationally inferior | Self-managed host and single point of failure; tight memory |

No DigitalOcean-only managed application-plus-database topology qualifies. App Platform starts at US$5/month, but its development PostgreSQL database adds US$7/month before the existing US$5 Spaces subscription (US$17 total), and it is explicitly a development database. A production Managed PostgreSQL cluster costs more still. [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)

DigitalOcean Functions has a free monthly compute allowance, but DigitalOcean documents Next.js as an App Platform Node.js service and Functions as separate components; it does not document an adapter that converts a full dynamic Next.js application into Functions. A static export plus hand-written APIs would narrow framework behavior and is therefore outside this requirement. [Functions pricing](https://docs.digitalocean.com/products/functions/details/pricing/) [Next.js sample](https://docs.digitalocean.com/products/app-platform/getting-started/sample-apps/next.js/) [Functions features](https://docs.digitalocean.com/products/functions/details/features/)

## Platform findings

### 1. Vercel Hobby: US$5 total only under narrow eligibility

Vercel Hobby is free, native/verified for Next.js, and includes 4 CPU-hours, 360 GB-hours provisioned memory, 1,000,000 function invocations, 1,000,000 edge requests, and 100 deployments/day. When a Hobby quota is exceeded, the resource usually remains unavailable until the rolling period resets; there is no paid on-demand continuation on Hobby. [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

The decisive constraints are organizational rather than technical:

- Hobby is restricted to **non-commercial personal use**. Vercel defines commercial use broadly enough to include a deployment used for anyone's financial gain, including work produced by a paid employee or consultant. If Wayfinder has commercial sponsorship, paid implementation, revenue, or another commercial purpose, Hobby is ineligible. [Vercel fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- Vercel says collaboration is free for public repositories, but also says a commit deployed under a Hobby team must be authored by that Hobby team's owner. Private-repository collaboration is unavailable on Hobby. External contributions therefore need an owner-authored merge/squash/redeploy workflow rather than dependable per-contributor automatic deployments. [Vercel collaboration troubleshooting](https://vercel.com/docs/deployments/troubleshoot-project-collaboration)
- Hobby has no team-collaboration features or spend management and only one hour of runtime logs. [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

**Conclusion:** Vercel Hobby + Neon Free + existing Spaces is the easiest US$5-total stack only if a named individual owns/deploys a public, genuinely non-commercial project and accepts quota suspension. Otherwise Vercel's US$20 Pro floor is outside the envelope before database and Spaces costs.

### 2. Cloudflare: best managed US$10 baseline, but Free is fragile for SSR

Cloudflare deploys Next.js using `@opennextjs/cloudflare` on `workerd`. Cloudflare lists App Router, route handlers, SSR, React Server Components, Server Actions, streaming, ISR, middleware, image optimization, and composable caching as supported, but Node.js middleware is not yet supported. Cloudflare explicitly instructs projects to test with the adapter's preview command because development uses Node.js while production uses `workerd`. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)

#### Workers Free + D1 Free: US$5 total

Workers Free permits 100,000 dynamic requests/day, 10 ms CPU/invocation, 128 MB/isolate, 50 subrequests/invocation, six simultaneous outgoing connections, and a 3 MB compressed Worker. Static-asset requests are free/unlimited. Cloudflare notes that authentication, SSR, and large-payload parsing commonly use **10–20 ms**, so the Free CPU ceiling is directly at odds with this workload; sustained overruns terminate the request. Exceeding 100,000 requests/day produces Error 1027. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

D1 Free provides 5 million rows read/day, 100,000 rows written/day, 5 GB total account storage but only 500 MB per database, 10 databases, 50 queries per Worker invocation, and seven-day Time Travel. Limits reset daily; hitting read/write limits makes queries fail until reset, while hitting storage prevents writes/schema changes until space is freed or the account upgrades. D1 scales to zero without capacity-hour charges. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

This is production-capable only for a very small, indexed workload that has passed a production-runtime test. It has explicit daily failure cliffs and no room for CPU-heavy Markdown rendering, auth libraries, or inefficient SSR.

#### Workers Paid + D1: US$10 total base

Workers Paid has a US$5/month account minimum and includes 10 million dynamic requests and 30 million CPU-ms/month. Overage rates are US$0.30/million requests and US$0.02/million CPU-ms. Per-invocation CPU defaults to 30 seconds and can be configured to five minutes; bundle size rises to 10 MB and subrequests to 10,000. There is no separate Worker egress/bandwidth fee. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

On Paid, D1 includes 25 billion rows read, 50 million rows written, and 5 GB storage/month, with overages of US$0.001/million rows read, US$1/million rows written, and US$0.75/GB-month. A database can be 10 GB and Time Travel is 30 days. There is no D1 egress charge. Each D1 database remains single-threaded and serializes queries; overload can queue and then fail, so peak contribution/voting writes must be tested. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

**Operational judgment:** this is the best managed envelope because compute and database share one platform and do not sleep behind a user-visible container/database wake sequence. The costs are SQLite/ORM migration risk, single-database write serialization, a Cloudflare-specific binding/configuration model, and no guaranteed US$10 cap when metered use grows.

#### Cloudflare + external Postgres

Workers Free and Paid both include Hyperdrive; Free allows 100,000 database queries/day, after which operations fail until daily reset, while Paid permits unlimited Hyperdrive queries (the external database's own limits and cost still apply). [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Neon Free preserves PostgreSQL and supports unlimited organization members, 100 projects, 100 CU-hours/project/month, 0.5 GB/project, and 5 GB/month public transfer. It forcibly scales to zero after five idle minutes; a wake typically adds hundreds of milliseconds and the Free plan cannot disable it. Free has a six-hour restore history, one manual snapshot, community support, and no uptime SLA. [Neon plans](https://neon.com/docs/introduction/plans) [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero) [Neon connection latency](https://neon.com/docs/connect/connection-latency)

Cloudflare Paid + Neon Free remains US$10 total and is the best budget option if future PostgreSQL portability matters more than D1 simplicity. Co-locate regions where possible, use pooled/serverless connections or Hyperdrive, and retry first connection/query after wake. It adds a second provider and a second availability/cold-start dependency.

### 3. DigitalOcean: full Node.js at US$10 total, but not high availability

App Platform's smallest dynamic service is **US$5/month** for one shared vCPU, 512 MiB RAM, and 50 GiB outbound transfer. It is a conventional Node.js/Docker deployment, so it can support all Next.js features. The build has much more memory than the runtime, meaning a successful build does not prove the 512 MiB service can run the application. [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) [Next.js deployment modes](https://nextjs.org/docs/app/getting-started/deploying)

At this tier:

- there is one fixed container, no manual scaling or autoscaling, and DigitalOcean only supports App Platform high availability with two or more containers;
- local storage is ephemeral and limited to 4 GiB; deployments/replacements erase it, so Spaces and the managed external database are mandatory;
- application upload requests time out after 600 seconds, reinforcing direct browser-to-Spaces uploads; and
- shared CPU does not guarantee consistent compute performance. [App Platform limits](https://docs.digitalocean.com/products/app-platform/details/limits/) [App Platform features](https://docs.digitalocean.com/products/app-platform/details/features/)

The practical topology is the US$5 service + Neon Free + Spaces. OIDC and the complete Node package ecosystem are lower risk than on `workerd`; the risks are 512 MiB OOM/restarts, a regional single container, and Neon wake latency. Use `output: "standalone"`, disable in-process image optimization if memory testing requires it, set a real health endpoint, connect lazily to Neon, and load-test login callback, Markdown rendering, contribution writes, and concurrent SSR before treating it as production.

Supabase Free is an alternative external Postgres with two active projects, 500 MB database/project, 5 GB egress, and 50,000 monthly active users. However, Supabase may pause low-activity Free projects after a seven-day period; restoration is a dashboard operation, so the first user cannot transparently wake it. Free quotas stop service rather than charge overages. This is less suitable than Neon for an intermittently visited production site. [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase) [Supabase free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) [Supabase cost control](https://supabase.com/docs/guides/platform/cost-control)

A US$4 Basic Droplet (512 MiB, one shared vCPU, 10 GiB SSD, 500 GiB transfer) plus Neon Free and Spaces totals US$9. It can run full Next.js, but all host lifecycle responsibilities move to the project and one VM is a single failure domain. The US$1 savings over App Platform is not worth the routine security and availability burden unless the maintainer explicitly accepts it. [Droplet pricing](https://docs.digitalocean.com/products/droplets/details/pricing/)

DigitalOcean has a private-preview App Platform Scale to Zero feature charging 10% while asleep, but it is request-only, introduces several-second-or-longer cold starts, drops runtime logs while asleep, requires support access, and DigitalOcean says private previews may be unsuitable for production. It should not be used to justify this envelope. [App Platform Scale to Zero](https://docs.digitalocean.com/products/app-platform/how-to/scale-to-zero/)

### 4. Free database trade-offs

| Store | Free capacity/behavior | Sleep/failure behavior | Availability/operations judgment |
|---|---|---|---|
| **D1 Free** | 500 MB/database; 5 GB/account; 5M reads + 100k writes/day | Scales to zero; quota excess returns errors until reset | Best paired with Workers; SQLite semantics, per-DB serialized queries, seven-day recovery |
| **Neon Free** | 0.5 GB/project; 100 CU-hours; 5 GB transfer | Sleeps after 5 minutes; transparent wake with cold-query latency | Best free PostgreSQL fit; no SLA, short restore window, one manual snapshot |
| **Supabase Free** | 500 MB/project; two active projects; 5 GB egress | May pause after seven days of low activity; owner must resume | Acceptable for active small sites, poor for long idle periods; no downloadable managed backups on Free |

No free managed database should be the only recovery copy for contribution/vote data. Schedule an application-level logical export to a separate Spaces prefix, encrypt it, test restoration, and keep migration files in source control. This is especially important because the free tiers have limited restore windows and no production SLA.

## Spaces integration within every envelope

Spaces remains the sunk US$5/month storage layer: the subscription includes 250 GiB and 1,024 GiB outbound transfer, with the CDN included. [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/)

Use direct browser-to-Spaces presigned uploads. The application should authenticate the OIDC user, authorize an intended object key/type/size, return a short-lived presigned origin request, and record object metadata only after completion/validation. Serve public assets through the Spaces CDN rather than proxying file bytes through Workers, Vercel Functions, or the 512 MiB App Platform service. This preserves compute quotas and avoids buffering untrusted files.

## Availability and operational envelope

None of the qualifying topologies is highly available end-to-end:

- **Cloudflare Paid + D1** has the fewest owner-operated pieces, but the app depends on an unverified Next.js adapter and a single logical D1 database's serialized write path.
- **App Platform + Neon Free** has conventional runtime/database semantics but combines a single regional container with a sleeping free database; either can cause a visible outage/latency spike.
- **Vercel Hobby + free Postgres** has native Next.js operations but is disqualified by many real-world ownership/commercial arrangements and stops at quota limits.
- **Droplet + free Postgres** adds host administration and the most project-owned failure modes.

For every option: preserve database exports in Spaces, configure synthetic checks around `/`, OIDC login/callback, a representative dynamic ranking page, and a write transaction, set quota alerts where available, and document an upgrade trigger before launch.

## Recommendation and upgrade triggers

1. **Default:** Cloudflare Workers Paid + D1 + existing Spaces (**US$5 incremental / US$10 total base**), conditional on a full `workerd` test of the exact OIDC library, ORM/query layer, Markdown/sanitization pipeline, server actions, cache behavior, and upload signing.
2. **Full-Node fallback:** DigitalOcean App Platform 512 MiB + Neon Free + Spaces (**US$5 incremental / US$10 total**), conditional on peak-memory/load testing and acceptance of one container plus database cold starts.
3. **Zero-increment experiment:** Cloudflare Workers Free + D1 Free + Spaces (**US$5 total**) only for prelaunch/low traffic. Upgrade to Workers Paid before announcing traffic or when p95 CPU approaches 10 ms.
4. **Vercel Hobby:** only after documenting non-commercial personal eligibility and an owner-controlled deployment workflow; otherwise reject it without further technical evaluation.

Upgrade out of the envelope when any of these occurs:

- Workers Free p95 CPU nears 10 ms, dynamic traffic nears 100,000/day, or D1 approaches a daily/storage cutoff;
- Paid Workers/D1 forecasts exceed the included allotments enough to threaten the budget;
- Neon exceeds 0.5 GB, 100 CU-hours, or 5 GB transfer, or cold starts violate the latency objective;
- App Platform runtime memory is repeatedly above roughly 70–80% of 512 MiB, the process restarts/OOMs, or availability requires a second container;
- contribution data requires a materially longer recovery window, automated backups, an uptime SLA, or guaranteed support; or
- Vercel Hobby eligibility becomes ambiguous.

## Residual uncertainties requiring measurement or owner decision

- Whether the project is legally/operationally eligible for Vercel Hobby, including paid contributions, sponsorship, or organizational use.
- Exact OIDC provider/library and its `workerd` compatibility and CPU cost.
- Next.js 16 feature use: Node.js middleware, image optimizer, ISR/cache coordination, native modules, and bundle size.
- Peak dynamic requests, SSR/Markdown CPU, response sizes, contribution/vote write concurrency, and desired p95 latency.
- Database growth, recovery-point/recovery-time objectives, and whether SQLite/D1 is acceptable versus PostgreSQL.
- Whether US$10 is only a base-price target or an enforced spend ceiling; Workers Paid and D1 can exceed the base through usage.
- Whether a single compute instance and a free, no-SLA database meet the project's production availability expectations.

## Primary sources retained

- [Next.js deployment documentation](https://nextjs.org/docs/app/getting-started/deploying) — full feature support for Node/Docker and adapter verification status.
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby), [fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines), and [collaboration rules](https://vercel.com/docs/deployments/troubleshoot-project-collaboration) — eligibility, quotas, and contribution restrictions.
- [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — adapter support and compute/request envelope.
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) — free/paid database envelope and failure behavior.
- [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/), [limits](https://docs.digitalocean.com/products/app-platform/details/limits/), and [features](https://docs.digitalocean.com/products/app-platform/details/features/) — US$5 runtime and single-container constraints.
- [DigitalOcean Droplet pricing](https://docs.digitalocean.com/products/droplets/details/pricing/) and [Functions pricing](https://docs.digitalocean.com/products/functions/details/pricing/) — low-cost compute alternatives and why Functions do not directly qualify.
- [Neon plans](https://neon.com/docs/introduction/plans) and [scale-to-zero documentation](https://neon.com/docs/introduction/scale-to-zero) — current free PostgreSQL limits and cold starts.
- [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase) and [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) — free PostgreSQL quotas and idle pausing.
- [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/) — sunk-cost and included capacity assumptions.

No secondary source was used for a retained claim.