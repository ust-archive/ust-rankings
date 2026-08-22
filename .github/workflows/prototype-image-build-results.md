# PROTOTYPE: prebuilt image benchmark

Question: does building an immutable image concurrently in GitHub Actions remove at least 60 seconds from the current DigitalOcean source-build path?

Production was not changed.

## Baseline

- GitHub CI run [`32596910122`](https://github.com/ust-archive/ust-rankings/actions/runs/32596910122): 133 seconds.
- DigitalOcean deployment `2b032bdf-db65-4fa7-82b4-15055975ba19`: 230 seconds from creation to active.
- Its DigitalOcean build: 129 seconds.
  - `npm ci`: 29 seconds.
  - dependency snapshot and cache push: 46 seconds.
  - Next compilation: 11 seconds.
- Push to active: 397 seconds.

## GitHub image builds

| Run | Image step | Job | Result |
| --- | ---: | ---: | --- |
| [`32597807691`](https://github.com/ust-archive/ust-rankings/actions/runs/32597807691) | 168s | 187s | Cold build pushed after about 51s; exporting the 696 MB cache added 123s. |
| [`32598004094`](https://github.com/ust-archive/ust-rankings/actions/runs/32598004094) | 84s | 101s | Warm cache still lost time restoring and exporting the dependency layer. The later visibility step failed, after the image was pushed. |
| [`32598119356`](https://github.com/ust-archive/ust-rankings/actions/runs/32598119356) | 57s | 78s | Uncached build and push. |

## Verdict

The uncached GitHub image build is 72 seconds faster than the measured DigitalOcean build and can finish concurrently with the 133-second CI run. It clears the agreed 60-second bar without owning a remote build cache.

If adopted, promote the exact image digest only after CI passes. DigitalOcean documents that deploying a container image bypasses App Platform's build. The full rollout saving remains unmeasured because this prototype was intentionally build-only.

The benchmark package is private: the workflow token could push it but could not change organization package visibility. Production should use a public package to avoid a long-lived registry credential; an organization owner must change that setting once if this topology is adopted.

Sources:

- <https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-container-images/>
- <https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-github-actions/>
