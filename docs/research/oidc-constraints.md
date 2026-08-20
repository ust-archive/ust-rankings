# Reusable OIDC integration constraints

Research resolution for [Wayfinder ticket #17](https://github.com/ust-archive/ust-rankings/issues/17). This note compares the local CRS implementation with the official Auth.js and Microsoft Entra guidance. No secret values were inspected or reproduced intentionally; configuration is named only by variable.

## Decision

UST Rankings should use Auth.js's Microsoft Entra ID provider as a **server-side confidential web client**, using the OIDC authorization-code flow implemented by the library. Pin a tenant-scoped v2 issuer, register exact Web callback URLs, request only `openid profile email`, and identify accounts by the verified `(iss, sub)` pair. Establish an app-local user record and authorization policy on the server, then issue a minimal Auth.js session cookie. Every mutation must repeat authentication and authorization at the write boundary; browser code must never receive an Entra access token, ID token, refresh token, client secret, or the Auth.js JWT payload.

## Safe reusable flow

1. Register a confidential **Web** application in Entra, preferably single-tenant unless a documented product requirement needs more tenants. Configure Auth.js with `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER`, and `AUTH_SECRET` through the deployment secret store. A tenant-scoped issuer has the form documented by Auth.js; omitting it defaults to `common`, which permits a broader account population. [Auth.js Entra provider](https://authjs.dev/getting-started/providers/microsoft-entra-id)
2. Let Auth.js perform discovery, authorization-code exchange, issuer/audience/signature/time/nonce validation, state/CSRF handling, and secure cookie management. Do not hand-roll token parsing or refresh. Microsoft recommends authorization code plus PKCE for modern applications and recommends using a supported library rather than crafting protocol requests. [Microsoft authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
3. Request only `openid profile email`. `openid` establishes OIDC sign-in; `profile` supplies display claims and stable Entra identifiers; `email` is optional presentation/contact data. Do **not** request `offline_access`, Graph scopes, or an app API scope unless a later, separately reviewed feature actually calls that resource on the user's behalf.
4. At successful sign-in, take identity only from the library-validated profile/token. Persist a unique provider key `(issuer, subject)` and map it to an app-local user ID. Enforce an allowlisted issuer/tenant in configuration, not an email-domain suffix.
5. Create an Auth.js application session. For the current app, use the default encrypted JWT session with a deliberately short, documented `maxAge`; no adapter is otherwise needed. If immediate server-side revocation, concurrent-session control, or centrally disabled sessions become requirements, switch to a database session rather than inventing a JWT revocation mechanism. Auth.js explains that JWT sessions are encrypted in an `HttpOnly` cookie but cannot normally be revoked before expiry, while database sessions can be modified server-side. [Auth.js session strategies](https://authjs.dev/concepts/session-strategies)

Auth.js is currently not a project dependency, so implementation should pin a reviewed stable version rather than copying CRS's beta-version assumptions without review.

## Provider identity and claims

### Identity key

Use the exact verified OIDC tuple:

```text
provider = "microsoft-entra-id"
provider_identity_key = (iss, sub)
```

OIDC defines `sub` in an issuer's namespace, so the reusable key is issuer plus subject. In Entra, `sub` is immutable and pairwise to an application ID. This means it is suitable for this app but can change if UST Rankings is moved to a different app registration/client ID. If future services registered as different Entra applications must correlate the same tenant account, make that a new design decision and use verified `(tid, oid)` for the shared server-side directory key; Microsoft documents that `oid` is stable across applications within a tenant. Never join or authorize by `email`, `preferred_username`, `upn`, or `name`: they are mutable, may be absent, and can be reassigned. [Microsoft ID-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference#use-claims-to-reliably-identify-a-user)

### Required validation and use

Auth.js/the OIDC library must validate signature through discovery/JWKS, exact issuer, audience/client ID, expiry/not-before, nonce, and authorization response state. Application code then uses:

- `iss` + `sub`: durable provider account key;
- `tid`: enforce/routinely audit the expected tenant when Entra is the provider;
- `name`: optional display only;
- `email` or `preferred_username`: optional display/contact hint only, never identity or authorization;
- app-local roles/permissions: authorization, loaded or derived server-side rather than trusted from browser input.

Do not decode an unverified token first to select which issuer/JWKS or policy should validate it. If multi-tenant access is ever required, validate through the documented multi-tenant issuer rules and then apply an explicit tenant allowlist.

## Callback URLs and environments

For Next.js/Auth.js the callback is exactly:

```text
https://<production-origin>/api/auth/callback/microsoft-entra-id
```

Register it as a **Web** redirect URI. Register a development callback with the same exact path (HTTP is acceptable only for local development). Entra redirect paths are case-sensitive, production redirects require HTTPS, and wildcard redirect URIs should be avoided. Use separate Entra app registrations and separate credentials for production, preview/staging, and local development; remove unused callbacks. [Auth.js callback setup](https://authjs.dev/getting-started/providers/microsoft-entra-id#callback-url) [Microsoft redirect URI restrictions](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)

Set `AUTH_URL` only where proxy/host inference requires it, to the canonical deployment base path expected by Auth.js. Trust forwarded host headers only from a controlled proxy. Keep Auth.js's same-origin redirect policy; any post-login return target must be a relative path or an allowlisted same-origin URL, not an arbitrary URL supplied by a request.

## Session and minimal browser surface

The encrypted Auth.js JWT and provider material remain server-side/`HttpOnly`. The `jwt` callback may retain only what server-side session validation needs, such as the app-local user ID, provider identity, authorization version, and expiry. The `session` callback is a disclosure boundary: its return value is exposed by the session endpoint and must be reduced deliberately.

A sufficient browser-visible session is:

```ts
{
  user: {
    displayName?: string
  },
  expires: string
}
```

If client UI needs permission hints, expose coarse non-authoritative flags only; the server must still authorize the operation. Do not return the Auth.js token, raw provider profile, `account`, `access_token`, `id_token`, `refresh_token`, tenant/object identifiers, email, or app-local authorization records unless a concrete UI requirement and privacy review justify the field. Auth.js explicitly warns that the `session` callback return is exposed to the client, while values retained only in the JWT callback stay off the frontend. [Auth.js core callbacks](https://authjs.dev/reference/core#callbacks)

Use default secure cookie behavior (`HttpOnly`, `Secure` on HTTPS, appropriate `SameSite`) and a high-entropy `AUTH_SECRET`. Do not override cookie options or enable trusted-host behavior unless the deployment proxy is understood and tested.

## Route and write protection

Protection must be layered and fail closed:

1. **Pages/layouts:** call server-side `auth()` for private pages and redirect unauthenticated browsers to sign-in. Proxy/middleware may provide early routing but is defense in depth only.
2. **Route handlers/API:** call `auth()` inside every protected handler. Return `401` when no valid session exists and `403` when the authenticated app user lacks permission. Do not redirect API callers to HTML login.
3. **Server actions:** call the same `requireUser()`/`authorize()` helper inside every action immediately before the mutation. Never trust a page guard, hidden button, client flag, supplied user ID, or middleware match as authorization.
4. **Data/service layer:** sensitive mutations should accept an authenticated principal from server context and enforce object/role ownership at the transaction boundary. Prefer a deny-by-default protected write router/helper so a new endpoint cannot silently omit checks.
5. **CSRF/origin:** keep Auth.js's built-in protections. For application cookie-authenticated unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`), enforce same-origin `Origin`/host policy and the framework's CSRF mechanism; never enable permissive cross-origin credentials. Validate input separately from authentication.
6. **Audit:** record app-local actor ID, action, target, result, and request correlation metadata. Do not log claims wholesale, session cookies, authorization headers, or tokens.

Thus browser writes carry only the `HttpOnly` application-session cookie. The server resolves that session to an app principal and authorizes the operation. No Entra bearer or refresh token is needed for UST Rankings' own API.

## Secret handling

Use these variable names (values only in local ignored files and deployment secret stores):

- `AUTH_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ID` (identifier, not confidential)
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `AUTH_URL` only if deployment topology requires it

Commit a `.env.example` containing names and blank/placeholders only. Never prefix confidential variables with `NEXT_PUBLIC_`, serialize them into client components, return them from APIs, place them in logs/errors, or reuse them across environments. Restrict secret-store access, rotate credentials on a schedule and on suspected disclosure, and use Auth.js's supported `AUTH_SECRET` rotation mechanism where continuity is required. Prefer a certificate/federated credential over a long-lived client secret if the hosting platform and Auth.js/provider support are verified first; otherwise use a short-lived Entra client secret with an expiry alert. [Auth.js environment variables](https://authjs.dev/guides/environment-variables) [Auth.js deployment](https://authjs.dev/getting-started/deployment)

## CRS findings: reusable behavior vs local assumptions

Primary local files inspected were `packages/site/lib/auth.ts`, `packages/site/lib/microsoft-entra-id.ts`, `packages/site/proxy.ts`, `packages/site/app/api/auth/[...nextauth]/route.ts`, `packages/server/auth.ts`, `packages/server/index.ts`, and the package/example configuration files under `D:/Projects/CRS`.

### Reusable ideas

- Use the Auth.js Microsoft Entra provider and standard Auth.js route handlers.
- Keep the development bypass fail-closed in production (but UST Rankings should omit the bypass until it has a test-only design).
- Verify issuer and audience before trusting claims.
- Authenticate the backend context before executing protected procedures.
- Avoid an unnecessary Graph profile call when validated ID-token claims meet the actual need.

### CRS-specific assumptions — do not generalize

- Accepted university/debug email domains and multiple tenant IDs.
- The `${CLIENT_ID}/.default` delegated API scope, a separate tRPC server, browser-to-API bearer tokens, token refresh, and `offline_access`.
- `upn`, family/given-name formatting, and CRS's user synchronization keyed by email.
- Reverse-proxy routing of `/api/trpc`, CRS's local development user, and its database/role model.

UST Rankings has no demonstrated need for a downstream Entra-protected API, Graph, or offline delegated access. Its own writes should use its Auth.js application session directly.

## Security defects and hazards in CRS not to copy

1. **Provider tokens disclosed to browser code:** CRS stores the entire provider `account` in the Auth.js JWT and returns it from the `session` callback. That object can include access, ID, and refresh tokens. An encrypted `HttpOnly` cookie does not make fields returned by `/api/auth/session` secret. Return a strict session projection instead.
2. **Overbroad issuer:** the site provider does not pin an issuer, so the Auth.js Entra provider defaults to `common`. An email-domain callback check is not a substitute for tenant/issuer restriction.
3. **Mutable identity/authorization key:** the server derives identity from `upn`/email and synchronizes users by email. Microsoft explicitly says these values are mutable and unsuitable as durable keys or authorization facts.
4. **Policy selected from unverified data:** CRS decodes `upn` before signature verification and uses its domain to choose issuer/JWKS, with a debug-tenant fallback. Policy/verification configuration must not be selected from an attacker-controlled unverified claim, and no debug tenant should be accepted in production.
5. **Unnecessary offline token handling:** CRS requests `offline_access`, refreshes against `common`, and retains refresh tokens. UST Rankings does not need this attack surface without a downstream delegated API requirement.
6. **Sensitive error propagation:** the custom refresh error incorporates the token endpoint response body. Token endpoint bodies and provider errors can contain sensitive material and must be redacted before logging or surfacing.
7. **API gap risk:** CRS's site proxy explicitly excludes all `api` paths. Its tRPC server authenticates context, but the blanket exclusion is unsafe as a reusable convention because a newly added write API could bypass page middleware. Every write needs an in-handler guard.
8. **Permissive cross-origin API posture:** the standalone server enables generic CORS while bearer credentials are handled in browser code. Do not combine permissive CORS with browser-held bearer tokens.
9. **PII logging:** sign-in, request, and error logs include user names/emails and sometimes rich error objects. Use minimal structured audit identifiers and token-safe redaction.
10. **Committed private signing material:** CRS's example configuration includes a value for `JWK_PRIVATE` even though it is labelled development-only. Private key material should never be committed as an example; replace with an empty placeholder and rotate any credential that has been committed.

## Implementation checklist

- [ ] Add a reviewed stable Auth.js version and the Microsoft Entra provider.
- [ ] Create separate Entra Web app registrations per environment.
- [ ] Configure the exact callback URL and tenant-scoped v2 issuer.
- [ ] Request only `openid profile email`; no `offline_access` or resource scope.
- [ ] Persist `(iss, sub)` -> app-local user ID with a uniqueness constraint.
- [ ] Project only minimal display state from `session()`; add a regression test proving token fields are absent.
- [ ] Centralize `requireUser()` and authorization, but invoke it inside every write handler/action.
- [ ] Test unauthenticated (`401`), unauthorized (`403`), authorized write, CSRF/cross-origin rejection, wrong issuer/tenant, callback mismatch, expiry, and sign-out.
- [ ] Add blank variable names to `.env.example` and configure real values only in secret stores.
- [ ] Review deployment proxy host handling and production HTTPS cookie behavior.

## Residual uncertainty

The intended Entra tenant, permitted guest-account policy, production/staging origins, required session lifetime, and whether immediate revocation is a product requirement are not yet specified. Those choices determine the exact issuer, redirect registrations, and whether JWT or database sessions are preferable; they do not change the constraints that identity is verified `(iss, sub)`, browser sessions are minimal, and every write is authorized server-side without exposing provider tokens.
