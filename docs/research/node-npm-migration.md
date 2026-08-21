# Node/npm migration notes

Checked 2026-08-21 against first-party documentation and package metadata.

- Next.js 16 requires Node 20.9 or newer; this repository pins the current Node 24 LTS line for local, CI, and Docker execution. [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- `npm ci` is the reproducible CI/install command: it requires the lockfile to match `package.json`, removes an existing install, and does not rewrite manifests or the lockfile. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
- npm workspaces are the native way to run the `data` package from the root, so no separate package-manager setup is needed. [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)
- Node can strip erasable TypeScript syntax, but it ignores `tsconfig.json` features such as path aliases and does not transform every TypeScript construct. The repository therefore uses `tsx` for TypeScript utility entry points and retains `tsc --noEmit` for checking. [Node.js TypeScript support](https://nodejs.org/api/typescript.html)
- Vitest 4 runs on Node 20+ and provides the Jest-compatible assertions and module mocking needed by the backend tests. Bun-specific matchers and mocks were migrated to Vitest's documented `vi` API. [Vitest guide](https://vitest.dev/guide/) · [Vitest migration guide](https://vitest.dev/guide/migration.html)
- Auth.js's current Next.js installation documentation still specifies `next-auth@beta`; `5.0.0-beta.32` is therefore intentional rather than a downgrade to the older v4 `latest` npm tag. [Auth.js installation](https://authjs.dev/getting-started/installation)
- The Vercel CLI remains pinned to the current release in the deployment workflow and is invoked ephemerally, following the documented `vercel build` and `vercel deploy --prebuilt` flow. It is not shipped in the application dependency tree. [Vercel CLI](https://vercel.com/docs/cli) · [Deploying from the CLI](https://vercel.com/docs/cli/deploying-from-cli)
- GitHub workflows use `actions/setup-node`, npm caching, and `npm ci`, matching GitHub's Node.js workflow guidance. [Building and testing Node.js](https://docs.github.com/en/actions/guides/building-and-testing-nodejs)

After updating the manifests, `npm outdated --workspaces --include-workspace-root` reported no outdated direct dependencies and `npm audit` reported no known vulnerabilities.
