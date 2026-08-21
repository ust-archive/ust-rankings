# Node/npm migration notes

Checked 2026-08-21 against first-party documentation and package metadata.

- Next.js 16 requires Node 20.9 or newer. The repository now pins Node 26.7.0, the latest Current release. Node's release policy recommends Active or Maintenance LTS for production, so this deliberate Current-line pin should move to Node 26 LTS when that status is published. [Node.js releases](https://nodejs.org/en/about/previous-releases) · [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- `npm ci` is the reproducible CI/install command: it requires the lockfile to match `package.json`, removes an existing install, and does not rewrite manifests or the lockfile. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
- npm workspaces are the native way to run the `data` package from the root, so no separate package-manager setup is needed. [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)
- Node 26 executes erasable TypeScript syntax without a runtime package. Node still ignores `tsconfig.json`, requires file extensions for relative imports, does not support path aliases, and performs no type checking; utility entry points follow those constraints while `tsc --noEmit` remains the static check. [Node.js TypeScript support](https://nodejs.org/api/typescript.html)
- Vitest 4 runs on Node 20+ and provides the Jest-compatible assertions and module mocking needed by the backend tests. Bun-specific matchers and mocks were migrated to Vitest's documented `vi` API. [Vitest guide](https://vitest.dev/guide/) · [Vitest migration guide](https://vitest.dev/guide/migration.html)
- Auth.js's current Next.js installation documentation still specifies `next-auth@beta`; `5.0.0-beta.32` is therefore intentional rather than a downgrade to the older v4 `latest` npm tag. [Auth.js installation](https://authjs.dev/getting-started/installation)
- DigitalOcean is the sole deployment target; Node and npm versions are pinned in the Dockerfile and CI rather than delegated to a provider runtime. See [ADR-0002](../adr/0002-digitalocean-sole-deployment-target.md).
- GitHub workflows use `actions/setup-node`, npm caching, and `npm ci`, matching GitHub's Node.js workflow guidance. [Building and testing Node.js](https://docs.github.com/en/actions/guides/building-and-testing-nodejs)
- The installed Next.js version is 16.3.2, which is also the current npm `latest` release. Apply patch and minor releases after the normal check/build/browser gate; adopt a new major only after reading its versioned upgrade guide, applying the official codemod where relevant, and validating runtime behavior. [Next.js package metadata](https://registry.npmjs.org/next/latest) · [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)

After updating the manifests, `npm outdated --workspaces --include-workspace-root` reported no outdated direct dependencies and `npm audit` reported no known vulnerabilities.
