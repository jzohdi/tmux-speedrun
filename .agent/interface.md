# Interface Spec: GitHub sign-in + verified username on leaderboard entries

Issue: jzohdi/tmux-speedrun#34 · Plan: `.agent/plan.md`

This spec pins down the exact types, signatures, module boundaries, data shapes, and invariants the
`tdd` and implementation stages build against. Names, paths, and signatures below are normative
unless marked "(illustrative)". Reuse existing crypto (`$lib/crypto`) and env (`$lib/server/env`)
helpers — do not add dependencies.

---

## 0. Core invariants (must hold end-to-end)

1. **Verified-only username.** The `username` (and `githubId`) stamped on a leaderboard row comes
   **only** from a server-verified session (`event.locals.user`), never from the request body. The
   finish request body remains `{ proofB64 }` exactly as today. There is no code path by which a
   client-supplied value reaches `leaderboard.username`.
2. **Secret never reaches the browser.** `GITHUB_CLIENT_SECRET`, token exchange, and the session
   HMAC key live only in `*.server.ts` / `+server.ts` / `hooks.server.ts` modules. Client code must
   never import `$lib/server/*` (type-only imports are the sole exception — see §10).
3. **Session cookie is tamper-proof.** The session cookie is HMAC-signed with the existing
   `SESSION_SECRET`. A modified payload or signature verifies as invalid → treated as anonymous.
   Signature comparison uses `constantTimeEqual`.
4. **CSRF-guarded OAuth.** The authorize step sets a random `state` cookie; the callback rejects
   unless the `state` query param equals the cookie. Sign-out is `POST`-only.
5. **Optional auth / graceful when unconfigured.** Anonymous play and every existing route keep
   working when `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are unset. Only the OAuth routes error, and
   they error gracefully (redirect home with an error signal, never a stack trace / 500).
6. **Cookie flags survive the GitHub redirect.** Session and state cookies use `sameSite: 'lax'`,
   `httpOnly: true`, `secure: !dev`, `path: '/'`.
7. **Clean tree.** No `db:push`/`db:migrate` against a real DB; commit only the generated migration.
   No test artifact churn.

---

## 1. Configuration — `src/lib/server/env.ts` (modify)

Add to the existing module (keep everything currently exported unchanged).

### Constants

```ts
export const SESSION_COOKIE_NAME = 'tmux_session';
export const OAUTH_STATE_COOKIE_NAME = 'tmux_oauth_state';

/** Long-lived auth session cookie (30 days). sameSite 'lax' so it survives the GitHub redirect. */
export const SESSION_COOKIE_OPTIONS = {
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax' as const,
	path: '/',
	maxAge: 60 * 60 * 24 * 30 // 30 days
};

/** Short-lived CSRF state cookie (10 min). */
export const OAUTH_STATE_COOKIE_OPTIONS = {
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax' as const,
	path: '/',
	maxAge: 60 * 10 // 10 minutes
};

/** Fixed OAuth callback path. The GitHub OAuth App callback URL must be `${ORIGIN}` + this. */
export const GITHUB_CALLBACK_PATH = '/api/auth/github/callback';
```

### Getters

```ts
export type GitHubOAuthConfig = { clientId: string; clientSecret: string };

/**
 * Reads GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET from $env/dynamic/private.
 * Throws a clear Error if either is missing/empty. MUST be called only inside OAuth route handlers
 * (lazily), never at module load — so app startup / anonymous play work when unconfigured.
 */
export function getGitHubOAuthConfig(): GitHubOAuthConfig;

/** true when both GitHub OAuth env vars are present (non-empty). Used to short-circuit gracefully. */
export function isGitHubOAuthConfigured(): boolean;

/**
 * Resolve the absolute OAuth redirect URI.
 * Prefer env ORIGIN (trailing '/' trimmed); fall back to the request URL's origin in dev.
 * Returns `${origin}${GITHUB_CALLBACK_PATH}`.
 */
export function getGitHubRedirectUri(requestUrl: URL): string;
```

- `getGitHubOAuthConfig()` treats an empty string as missing.
- `getGitHubRedirectUri`: `env.ORIGIN` if set (trim trailing `/`), else `requestUrl.origin`.

### `.env.example` (modify)

Replace the commented GitHub block with active (empty) entries and document the callback URL:

```
# GitHub OAuth (optional — enables verified sign-in on the leaderboard)
# Callback URL to register in the GitHub OAuth App: ${ORIGIN}/api/auth/github/callback
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
```

---

## 2. Session helper — `src/lib/server/auth/session.ts` (new)

Stateless, signed, cookie-based session. No DB session table.

### Types

```ts
/** The session payload embedded in the signed cookie. */
export type SessionPayload = {
	githubId: number;   // stable numeric GitHub id
	username: string;   // GitHub login (verified)
	iat: number;        // issued-at, epoch ms
};

/** The subset exposed to the app as event.locals.user. */
export type SessionUser = {
	githubId: number;
	username: string;
};
```

### Functions

```ts
import type { Cookies } from '@sveltejs/kit';

/**
 * Serialize + sign a session payload into a cookie string value.
 * Format: `${base64url(JSON(payload))}.${base64url(hmacSha256(payloadB64))}`.
 * HMAC key derived from getSessionSecret() (reuse hkdf/sha256 from $lib/crypto — no new deps).
 */
export function createSessionToken(payload: SessionPayload): Promise<string>;

/**
 * Verify signature + parse. Returns the SessionUser on success, or null on any failure
 * (bad format, signature mismatch via constantTimeEqual, malformed JSON, missing/typed-wrong fields).
 * Never throws for invalid input.
 */
export function verifySessionToken(raw: string): Promise<SessionUser | null>;

/** Set the signed session cookie (SESSION_COOKIE_NAME + SESSION_COOKIE_OPTIONS). */
export function setSessionCookie(cookies: Cookies, payload: SessionPayload): Promise<void>;

/** Delete the session cookie (path '/'). */
export function clearSessionCookie(cookies: Cookies): void;
```

Invariants:
- Round-trip: `verifySessionToken(await createSessionToken(p))` resolves to
  `{ githubId: p.githubId, username: p.username }`.
- Flipping any byte of payload or signature, or verifying under a different secret → `null`.
- `verifySessionToken('')`/garbage → `null`, no throw.
- Uses a URL/cookie-safe base64 (base64url: `+/` → `-_`, padding stripped) so the `.` separator is
  unambiguous. Provide small internal encode/decode helpers if reusing `bytesToBase64`.

---

## 3. OAuth state (CSRF) — colocated in `session.ts` or `src/lib/server/auth/state.ts` (new)

```ts
/** Cryptographically-random state token, URL-safe (reuse randomBytes + base64url). */
export function generateOAuthState(): string;

/** Constant-time compare of the callback's state param against the cookie value. */
export function verifyOAuthState(fromQuery: string | null, fromCookie: string | undefined): boolean;
```

`verifyOAuthState` returns `false` if either input is missing/empty, else a constant-time equality.

---

## 4. GitHub OAuth client — `src/lib/server/auth/github.ts` (new)

Thin `fetch` wrappers. **No secret in `buildAuthorizeUrl`** (that URL is client-visible).

```ts
import type { GitHubOAuthConfig } from '$lib/server/env';

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';

/**
 * Build the authorize redirect URL.
 * Query params: client_id, redirect_uri, state, scope (EMPTY — public profile only), allow_signup.
 * MUST NOT include client_secret.
 */
export function buildAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	state: string;
}): string;

/** Verified GitHub identity we care about. */
export type GitHubUser = { id: number; login: string };

/**
 * Exchange the OAuth code for an access token (server-side; uses the secret).
 * POST GITHUB_TOKEN_URL with { client_id, client_secret, code, redirect_uri },
 * Accept: application/json. Returns the access token string.
 * Throws Error on non-200, GitHub error payload, or missing access_token.
 */
export function exchangeCodeForToken(params: {
	config: GitHubOAuthConfig;
	code: string;
	redirectUri: string;
}): Promise<string>;

/**
 * Fetch the authenticated user. GET GITHUB_USER_URL with
 * Authorization: `Bearer ${accessToken}`, Accept: application/vnd.github+json,
 * User-Agent: 'tmux-speedrun' (GitHub requires a UA).
 * Returns { id, login }. Throws on non-200 or missing id/login.
 */
export function fetchGitHubUser(accessToken: string): Promise<GitHubUser>;
```

These functions use only global `fetch` and web APIs (adapter-auto / Neon serverless compatible).
All tests mock `globalThis.fetch`.

---

## 5. Request-scoped user — `src/hooks.server.ts` (new) + `src/app.d.ts` (modify)

### `src/app.d.ts`

```ts
declare global {
	namespace App {
		interface Locals {
			user: import('$lib/server/auth/session').SessionUser | null;
		}
		interface PageData {
			user?: import('$lib/server/auth/session').SessionUser | null;
		}
	}
}
export {};
```

### `src/hooks.server.ts`

```ts
import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME } from '$lib/server/env';
import { verifySessionToken } from '$lib/server/auth/session';

export const handle: Handle = async ({ event, resolve }) => {
	const raw = event.cookies.get(SESSION_COOKIE_NAME);
	event.locals.user = raw ? await verifySessionToken(raw) : null;
	return resolve(event);
};
```

Invariant: absent/invalid cookie → `event.locals.user === null`. The hook never throws on a bad
cookie (relies on `verifySessionToken` returning `null`).

---

## 6. Expose user to UI — `src/routes/+layout.server.ts` (new)

```ts
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async ({ locals }) => {
	return { user: locals.user };
};
```

Returns `{ user: SessionUser | null }`. This makes `data.user` available to `+layout.svelte`,
`+page.svelte`, and (via prop) the `Terminal` component without an extra fetch.

Optional (only if the Terminal needs to re-read after login without full navigation):
`GET /api/auth/session/+server.ts` returning `json({ user: locals.user })`. Prefer the layout load;
implement the endpoint only if needed.

---

## 7. OAuth routes — `src/routes/api/auth/...` (new)

All are SvelteKit `+server.ts` handlers. Redirects use SvelteKit `redirect(302, location)` from
`@sveltejs/kit` (which throws a `Redirect` — do not catch/swallow it).

### `GET /api/auth/github/login/+server.ts`

```ts
export const GET: RequestHandler = async ({ cookies, url }) => { ... };
```

Behavior:
1. If `!isGitHubOAuthConfigured()` → `redirect(302, '/?auth_error=not_configured')`.
2. `state = generateOAuthState()`; set `OAUTH_STATE_COOKIE_NAME` = state with
   `OAUTH_STATE_COOKIE_OPTIONS`.
3. `redirectUri = getGitHubRedirectUri(url)`;
   `authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state })`.
4. `redirect(302, authorizeUrl)`.

### `GET /api/auth/github/callback/+server.ts`

```ts
export const GET: RequestHandler = async ({ url, cookies }) => { ... };
```

Query params read: `code`, `state`. Behavior:
1. `verifyOAuthState(url.searchParams.get('state'), cookies.get(OAUTH_STATE_COOKIE_NAME))` — on
   false → clear state cookie, `redirect(302, '/?auth_error=state')`.
2. Clear the state cookie.
3. Missing `code` → `redirect(302, '/?auth_error=oauth')`.
4. `token = exchangeCodeForToken({ config, code, redirectUri })`;
   `ghUser = fetchGitHubUser(token)`. Wrap the network calls in try/catch → on error
   `redirect(302, '/?auth_error=oauth')`. **Re-throw** any thrown `Redirect` (do not treat it as a
   fetch failure).
5. `setSessionCookie(cookies, { githubId: ghUser.id, username: ghUser.login, iat: Date.now() })`.
6. `redirect(302, '/?signed_in=1')`.

### `POST /api/auth/logout/+server.ts`

```ts
export const POST: RequestHandler = async ({ cookies }) => { ... };
```

`clearSessionCookie(cookies)` then return `json({ ok: true })` (the Terminal issues a `fetch` and
reloads). No `GET` export (POST-only, CSRF-safe). Normative outcome: the session cookie is cleared.

`auth_error` query values (enum): `not_configured` | `state` | `oauth`. The home page may surface
these; minimal handling is acceptable.

---

## 8. Attach verified username on submit — `src/routes/api/challenge/finish/+server.ts` (modify)

- Add `locals` to the handler signature: `async ({ request, cookies, locals }) => { ... }`.
- Request body validation is **unchanged** (`parseFinishRequest` → `{ proofB64 }`).
- At the leaderboard insert, derive identity from `locals.user` only:

```ts
const user = locals.user; // App.Locals.user: SessionUser | null
await db.insert(leaderboard).values({
	challengeId: String(challengeId),
	durationMs,
	...(user ? { username: user.username, githubId: user.githubId } : {})
});
```

Invariants:
- `locals.user === null` → row inserted with `username`/`githubId` null (identical to today).
- `locals.user` set → row carries the verified `username` and `githubId`.
- No request field can influence `username`/`githubId`.
- Existing try/catch around the DB block is preserved (a DB error must not fail a valid run).

---

## 9. Database — `src/lib/server/db/schema.ts` (modify) + new migration

Add one nullable column to `leaderboard`; leave existing columns (incl. `userId` uuid) untouched.

```ts
import { pgTable, uuid, text, integer, timestamp, bigint } from 'drizzle-orm/pg-core';

export const leaderboard = pgTable('leaderboard', {
	id: uuid('id').primaryKey().defaultRandom(),
	challengeId: text('challenge_id').notNull(),
	userId: uuid('user_id'),
	username: text('username'),
	githubId: bigint('github_id', { mode: 'number' }), // NEW: nullable, GitHub numeric id
	durationMs: integer('duration_ms').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

- Import `bigint` from `drizzle-orm/pg-core` (alongside existing imports).
- `mode: 'number'` so it maps to a JS `number` (GitHub ids fit in JS safe-integer range).
- Generate the migration with `pnpm db:generate`; commit the new `drizzle/00xx_*.sql` and updated
  `drizzle/meta/*`. Do **not** run `db:push`/`db:migrate`. No backfill.
- Fallback if adding a column proves problematic: `username`-only (drop `githubId` from schema and
  the finish insert). `githubId` is preferred but not required for acceptance.

---

## 10. UI — `Terminal.svelte`, `+page.svelte` / `+layout.svelte` (modify)

### `src/lib/components/Terminal.svelte`

Extend the command dispatcher (the `if (command === 'tsr')` block near line 196) with three new
subcommands; add them to `showHelp()`:

- `tsr login` → `addOutput('Redirecting to GitHub...')` then full navigation
  `window.location.href = '/api/auth/github/login'` (not SvelteKit `goto` — it's a server redirect to
  an external origin).
- `tsr logout` → `await fetch('/api/auth/logout', { method: 'POST' })`, then reflect signed-out state
  (`window.location.reload()` or invalidate layout data) and print `Signed out.`.
- `tsr whoami` → print `Signed in as <username>` when a user is present, else `Not signed in.`.

Help lines to add (mirroring existing formatting):
```
tsr login           Sign in with GitHub
tsr logout          Sign out
tsr whoami          Show your signed-in GitHub username
```

**User source for the Terminal.** Add an optional prop so the component stays testable:
```ts
let { user = null /* , ...existing props */ } = $props<{ user?: SessionUser | null }>();
```
`+page.svelte` passes `data.user` down. `SessionUser` may be a **type-only** import
(`import type { SessionUser } from '$lib/server/auth/session'`) — safe because types are erased and
pull no server code into the bundle. If a type-only import from `$lib/server` is undesirable, define
a local `type SessionUser = { githubId: number; username: string }` in the component.

### `src/routes/+page.svelte` (and/or `+layout.svelte`)

- Receive `data.user` (`+page.svelte` gets it from `+layout.server.ts` via `$props()` `data`).
- Render a minimal signed-in indicator when `data.user`: e.g. `● signed in as {data.user.username}`
  with a sign-out affordance (button → `POST /api/auth/logout`, then reload).
- When signed out, render a "Sign in with GitHub" link/button → `href="/api/auth/github/login"`.
- Pass `user={data.user}` into `<Terminal ... />`.

Keep styling within the existing terminal aesthetic. Leaderboard rendering already displays
`username` (`entry.username ?? 'Anonymous'` in `/api/leaderboard`) — no change needed there; verified
entries now show the real GitHub login. Marking verified entries visually is optional and out of the
required scope.

---

## 11. Files summary

Create:
- `src/lib/server/auth/session.ts`
- `src/lib/server/auth/github.ts`
- (optional) `src/lib/server/auth/state.ts` (else colocate state helpers in `session.ts`)
- `src/routes/api/auth/github/login/+server.ts`
- `src/routes/api/auth/github/callback/+server.ts`
- `src/routes/api/auth/logout/+server.ts`
- (optional) `src/routes/api/auth/session/+server.ts`
- `src/hooks.server.ts`
- `src/routes/+layout.server.ts`
- `drizzle/00xx_*.sql` + `drizzle/meta/*` (generated)

Modify:
- `src/lib/server/env.ts`
- `src/app.d.ts`
- `src/lib/server/db/schema.ts`
- `src/routes/api/challenge/finish/+server.ts`
- `src/lib/components/Terminal.svelte`
- `src/routes/+page.svelte` and/or `src/routes/+layout.svelte`
- `.env.example`

---

## 12. Test surface (for the tdd stage)

Unit (vitest `server` project):
- **session**: round-trip `createSessionToken`→`verifySessionToken` returns the user; tamper (flipped
  byte, wrong secret, truncated) → `null`; garbage/empty input → `null`.
- **state**: `verifyOAuthState` true only when both present and equal; false on missing/empty/mismatch.
- **github**: `buildAuthorizeUrl` includes `client_id`, `redirect_uri`, `state`, empty `scope`, and
  **no** `client_secret`. `exchangeCodeForToken` / `fetchGitHubUser` with mocked `fetch` — success
  path returns token / `{ id, login }`; non-200 or error payload throws.
- **env**: `isGitHubOAuthConfigured()` reflects presence; `getGitHubRedirectUri` prefers `ORIGIN`,
  falls back to request origin; `getGitHubOAuthConfig` throws when unset.
- **finish endpoint**: with `locals.user` set, inserted row carries `username`/`githubId`; with
  `locals.user` null, row is anonymous; a body carrying an extra `username` field cannot inject it.

Existing suites (`pnpm test`, `pnpm check`, `pnpm lint`) stay green. Browser test for the signed-in
indicator only if it fits the existing `*.browser.test.ts` pattern. Manual OAuth flow is documented,
not run in CI.
