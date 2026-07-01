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

---
---

# Interface Spec — Iteration 2 (PR #36 feedback)

> Sections 0–12 above describe the **shipped and approved** sign-in feature — do **not** re-implement
> them. This block is the active scope: the reviewer approved sign-in, then asked for a better
> **challenge-completion flow**. See `.agent/plan.md` › "Revision — PR #36 feedback (iteration 2)".
> Names/paths/signatures below are normative unless marked "(illustrative)". Reuse existing crypto
> (`$lib/crypto`), env (`$lib/server/env`), and the HMAC pattern of `src/lib/server/auth/session.ts` —
> no new dependencies.

## I0. Core invariants (iteration 2 — must hold end-to-end)

1. **Verified-username invariant is preserved (must not regress).** When a user records a time while
   signed in, the leaderboard `username`/`githubId` come **only** from `event.locals.user`. Any
   `username` in the record request body is **ignored** whenever `locals.user` is set. A free-text
   body `username` may be used **only** for the anonymous (signed-out) path, and such entries have
   `githubId === null` (i.e. `verified === false`).
2. **Time/challenge cannot be forged between finish and record.** The deferred result (`challengeId`,
   `durationMs`) travels in an **HMAC-signed** pending-result cookie (same signing scheme as the
   session cookie). A tampered/expired/garbage cookie verifies as `null` → nothing to record → `400`.
   The username is **never** stored in this cookie; identity is always resolved at record time.
3. **Single-use recording.** The pending-result cookie is cleared on a successful record. A second
   `POST /api/challenge/record` with no valid pending cookie → `400`. `finish` sets the pending cookie
   **only** for anonymous finishes; a signed-in finish records immediately and sets no pending cookie.
4. **No login required to see the leaderboard or record a time.** The free-text record path works with
   OAuth fully unconfigured; it is independent of `/api/auth/*`.
5. **`return_to` is same-origin only (open-redirect guard).** OAuth `return_to` accepts only a
   local path (leading single `/`; reject `//`, `/\`, any scheme/host/backslash tricks); otherwise
   fall back to the default.
6. **Pending-result + return cookies survive the GitHub redirect.** Both use `sameSite: 'lax'`,
   `httpOnly: true`, `secure: !dev`, `path: '/'`.
7. **Clean tree.** No schema/migration change needed — `leaderboard` already has `username` +
   `githubId`. No `db:push`/`db:migrate`. No test-artifact churn.

---

## I1. Configuration — `src/lib/server/env.ts` (modify)

Add alongside the existing cookie constants (keep everything currently exported unchanged):

```ts
/** Deferred (anonymous) challenge result cookie name. */
export const PENDING_RESULT_COOKIE_NAME = 'tmux_pending_result';

/** OAuth post-login return-path cookie name. */
export const OAUTH_RETURN_COOKIE_NAME = 'tmux_oauth_return';

/**
 * Pending-result cookie (1h). sameSite 'lax' so it survives the GitHub redirect,
 * matching the existing challenge-session TTL.
 */
export const PENDING_RESULT_COOKIE_OPTIONS = {
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax' as const,
	path: '/',
	maxAge: 60 * 60 // 1 hour
};

/** Short-lived return-path cookie (10 min). */
export const OAUTH_RETURN_COOKIE_OPTIONS = {
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax' as const,
	path: '/',
	maxAge: 60 * 10 // 10 minutes
};
```

---

## I2. Signed pending-result cookie — `src/lib/server/challenges/pending.ts` (new)

Mirrors `src/lib/server/auth/session.ts` (base64url payload + HMAC-SHA-256 over the payload keyed by
`getSessionSecret()`, `constantTimeEqual` on verify). Reuse `$lib/crypto` helpers — no new deps.

### Types & constants

```ts
/** Payload embedded in the signed pending-result cookie. */
export type PendingResultPayload = {
	challengeId: number; // challenge index (0-based), matches the route param
	durationMs: number;
	iat: number;         // issued-at, epoch ms
};

/** What verify returns to callers (iat dropped). */
export type PendingResult = {
	challengeId: number;
	durationMs: number;
};

/** Single source of truth for pending-result expiry (1h) — equals the challenge TTL. */
export const MAX_PENDING_RESULT_AGE_MS = 60 * 60 * 1000;
```

### Functions

```ts
import type { Cookies } from '@sveltejs/kit';

/** Serialize + sign: `${base64url(JSON(payload))}.${base64url(hmacSha256(payloadB64))}`. */
export function createPendingResultToken(payload: PendingResultPayload): Promise<string>;

/**
 * Verify signature + parse. Returns { challengeId, durationMs } on success, else null.
 * Returns null for: bad format, signature mismatch, malformed JSON, wrong field types,
 * and when `now - iat > MAX_PENDING_RESULT_AGE_MS`. Never throws on invalid input.
 * (Reads the current time internally, e.g. Date.now(), to enforce expiry.)
 */
export function verifyPendingResultToken(raw: string): Promise<PendingResult | null>;

/** Set the signed pending-result cookie (PENDING_RESULT_COOKIE_NAME + PENDING_RESULT_COOKIE_OPTIONS). */
export function setPendingResultCookie(cookies: Cookies, payload: PendingResultPayload): Promise<void>;

/** Delete the pending-result cookie (path '/'). */
export function clearPendingResultCookie(cookies: Cookies): void;
```

Invariants: round-trip returns `{ challengeId, durationMs }`; flipping any byte of payload or
signature, wrong secret, truncation, empty/garbage, or `iat` older than 1h → `null`.

---

## I3. Return-path guard — `src/lib/server/auth/return-to.ts` (new)

Small, pure, unit-testable helper (kept separate from routes so tdd can test it directly).

```ts
/**
 * Sanitize an OAuth `return_to` value. Returns the path only when it is a safe,
 * same-origin local path; otherwise null.
 * Accept: starts with a single '/', is not '//' or '/\', contains no scheme (no ':'),
 *   no backslashes, no whitespace/control chars. Reject everything else.
 * Callers fall back to a default ('/?signed_in=1') when this returns null.
 */
export function sanitizeReturnPath(raw: string | null | undefined): string | null;
```

Test cases (normative): `'/challenge/2?completed=1&record=1'` → returned as-is;
`'//evil.com'`, `'/\\evil.com'`, `'https://evil.com'`, `'javascript:alert(1)'`, `'foo'` (no leading
slash), `''`, `null` → `null`.

---

## I4. Free-text record schema — `src/lib/server/challenges/schemas.ts` (modify)

Add to the existing schema module (keep all current exports):

```ts
/** Request body for POST /api/challenge/record. */
export const recordChallengeRequestSchema = z.object({
	username: z.string().max(64).optional()
});

export type RecordChallengeRequestBody = z.infer<typeof recordChallengeRequestSchema>;

/**
 * Parse + sanitize the record request. Trims, strips control chars, caps length at 32.
 * An empty/whitespace-only name normalizes to `undefined` (→ Anonymous).
 * Returns `{ username: string | undefined }`. Throws ZodError on shape violations.
 */
export function parseRecordRequest(data: unknown): { username: string | undefined };
```

- `username` displayed length cap: **32** chars after trim (the `.max(64)` on the raw schema just
  bounds input size; the sanitizer enforces the final 32-char cap).
- Sanitize = trim → strip control characters (`/[ -]/g`) → collapse to `undefined`
  if empty. Svelte auto-escapes on render, so display is XSS-safe.

---

## I5. `POST /api/challenge/finish` (modify) — defer when anonymous

Signature unchanged (`async ({ request, cookies, locals })`). Body validation unchanged
(`parseFinishRequest` → `{ proofB64 }`). Proof validation + `durationMs` computation unchanged. After a
**valid** proof and clearing `CHALLENGE_COOKIE_NAME`, branch on `locals.user`:

- **Signed in** (`locals.user` set): insert immediately with verified `username`/`githubId` (exactly
  as today), compute final rank, **set no pending cookie**, return:
  ```ts
  { valid: true, durationMs, recorded: true, leaderboardPosition, username: user.username }
  ```
- **Anonymous** (`locals.user === null`): **do not insert**. Call
  `setPendingResultCookie(cookies, { challengeId, durationMs, iat: Date.now() })`, compute the
  **provisional** rank with the existing "count of faster entries + 1" query (no insert), return:
  ```ts
  { valid: true, durationMs, recorded: false, leaderboardPosition /* provisional */ }
  ```

Invalid-proof path unchanged: `{ valid: false, durationMs: 0, message }`. Preserve the existing
try/catch around the DB block. `recorded` is **required** in the valid-proof response.

Normative response type (shared with the client `ChallengeResult`, §I8):
```ts
type FinishResponse = {
	valid: boolean;
	durationMs: number;
	recorded?: boolean;              // present on the valid path
	leaderboardPosition?: number;    // provisional (anon) or final (signed-in)
	username?: string | null;        // present when recorded === true & signed-in
	message?: string;                // present on the invalid path
};
```

---

## I6. `POST /api/challenge/record` (new) — `src/routes/api/challenge/record/+server.ts`

```ts
export const POST: RequestHandler = async ({ request, cookies, locals }) => { ... };
```

Behavior:
1. `verifyPendingResultToken(cookies.get(PENDING_RESULT_COOKIE_NAME) ?? '')` →
   `{ challengeId, durationMs }`. Missing/expired/tampered → `error(400, { message: 'No result to record.' })`.
2. Parse body with `parseRecordRequest` → `{ username }` (may be `undefined`). Missing/empty body is
   allowed (treated as `{}`); malformed JSON → `400`.
3. **Identity resolution (invariant I0.1):**
   - `locals.user` set → insert `{ challengeId: String(challengeId), durationMs, username: user.username, githubId: user.githubId }`; the body `username` is **ignored**.
   - else → insert `{ challengeId: String(challengeId), durationMs, username: body.username ?? null }`; `githubId` stays null.
4. `clearPendingResultCookie(cookies)` (single-use).
5. Compute final rank via the existing count query (faster entries + 1) and return:
   ```ts
   { recorded: true, leaderboardPosition, username: <inserted username or null> }
   ```
   Preserve a defensive try/catch around the DB block (a DB hiccup must not throw a 500 at the user;
   still return `recorded: true` with a best-effort/undefined position, matching the finish endpoint's
   resilience) — but the cookie is cleared regardless so recording stays single-use.

Response type:
```ts
type RecordResponse = {
	recorded: true;
	leaderboardPosition?: number;
	username: string | null;
};
```

---

## I7. OAuth `return_to` — login + callback (modify)

### `GET /api/auth/github/login/+server.ts`
- Read `url.searchParams.get('return_to')`; `const safe = sanitizeReturnPath(raw)`.
- When `safe` is non-null, set `OAUTH_RETURN_COOKIE_NAME = safe` with `OAUTH_RETURN_COOKIE_OPTIONS`
  (next to the existing state cookie). Everything else (config check, state cookie, authorize
  redirect) unchanged.

### `GET /api/auth/github/callback/+server.ts`
- After successfully setting the session cookie, read + **clear** `OAUTH_RETURN_COOKIE_NAME`, run its
  value through `sanitizeReturnPath` again (defense-in-depth), and
  `redirect(302, safeReturn ?? '/?signed_in=1')`. State/CSRF, token exchange, and error handling
  (`auth_error=state|oauth`) are otherwise unchanged. On any error path, clear the return cookie too.

The completion overlay's "Sign in with GitHub" button links to
`/api/auth/github/login?return_to=/challenge/{challengeIndex}?completed=1&record=1` (URL-encoded).
Because the pending-result cookie is `lax`, it survives the round-trip; on return `locals.user` is set
and the page auto-records (§I9).

---

## I8. Leaderboard `verified` flag — `src/routes/api/leaderboard/+server.ts` (modify)

- Also `select({ ..., githubId: leaderboard.githubId })`.
- Add `verified: entry.githubId != null` to each mapped entry. `username ?? 'Anonymous'` fallback
  unchanged.

```ts
export type LeaderboardEntry = {
	rank: number;
	username: string;
	time: string;
	durationMs: number;
	verified: boolean; // NEW: true iff githubId != null (a verified GitHub identity)
};
```

Existing consumers (`tsr lb`) ignore the new field harmlessly. The UI badges verified entries so a
free-text name cannot visually impersonate a verified identity.

---

## I9. Challenge route — hydrate + auto-record (modify)

### `src/routes/challenge/[id]/+page.server.ts`
Extend the load to also return `user` and (when a pending result matches this route) `pendingResult`.
`ChallengePageData` gains:

```ts
user: import('$lib/server/auth/session').SessionUser | null;
pendingResult: { durationMs: number } | null;
```

Load logic (added to the existing validation):
- `const user = locals.user;`
- Verify the pending-result cookie; if it verifies **and** its `challengeId === numericId`, set
  `pendingResult = { durationMs }`, else `null`. (Add `cookies`/`locals` to the load signature.)

### `src/routes/challenge/[id]/+page.svelte`
- **Guard `onMount` auto-start:** if `new URL(location.href).searchParams.get('completed') === '1'`
  **and** `data.pendingResult` exists, do **not** `challenge.start(...)`; instead render the completion
  overlay hydrated from `data.pendingResult.durationMs` + `data.user`.
- **Auto-record after OAuth:** if `?record=1` **and** `data.user` is present, `POST /api/challenge/record`
  once (empty body — the server uses the verified identity), then show the confirmed rank + leaderboard.
- **Strip query params** (`completed`, `record`) after handling via `replaceState`/`goto(..., { replaceState:true })`
  so a refresh/re-visit starts a normal challenge.
- Normal (fresh finish, no query params) flow is unchanged except the completion overlay now uses the
  states below.

---

## I10. Completion overlay UI — `src/routes/challenge/[id]/+page.svelte` (modify)

Drive the overlay from a small view-model unifying "fresh finish" (`challenge.result`) and "post-OAuth
hydration" (`data.pendingResult`). Overlay shows when there is a result to display (fresh finish
complete, or hydrated pending result). States:

- **Unrecorded / anonymous** (`result.valid && !result.recorded`, or hydrated pending result while
  signed-out): show **Time** + "You'd place **#N**" (provisional). Then two affordances:
  1. Free-text **username `<input>`** (optional, maxlength 32) + **"Save time"** button →
     `challenge.record(username)` → `POST /api/challenge/record { username }`. Blank → Anonymous. One
     click, low friction (req #3).
  2. An **"or"** divider + **"Sign in with GitHub to save a verified ✓ time"** button (anchor) →
     `href="/api/auth/github/login?return_to=/challenge/{challengeIndex}?completed=1&record=1"` (req #1, #4).
     If OAuth is unconfigured the login route already redirects home with `auth_error=not_configured`;
     the free-text path is independent and still works.
- **Recorded** (either path, `recorded === true`): show "Saved as **{username || 'Anonymous'}**"
  with a **✓ verified** badge iff signed-in, plus the **final rank**.
- **Leaderboard panel (req #2):** after recording — and immediately for the already-signed-in path —
  fetch `/api/leaderboard`, show this challenge's top entries (`data[String(challengeIndex)]`), and
  **highlight the user's placement** by rank. If the user's rank is outside the shown top-10, append a
  trailing "… you: #N" row. Verified entries render a ✓ badge (from `entry.verified`).
- Keep **"Back to Home"** / **"Try Again"**.

Invalid-proof state (`result.valid === false`) is unchanged (message + actions).

---

## I11. Client store + service (modify)

### `src/lib/client/challenge.ts`
- Extend `ChallengeResult`:
  ```ts
  export type ChallengeResult = {
  	valid: boolean;
  	durationMs: number;
  	recorded?: boolean;           // NEW: false for a deferred anonymous finish
  	leaderboardPosition?: number; // provisional (anon finish) or final
  	username?: string | null;     // NEW: present when recorded by the server
  	message?: string;
  };
  ```
- Add a record result type + a session method:
  ```ts
  export type RecordResult = {
  	recorded: true;
  	leaderboardPosition?: number;
  	username: string | null;
  };

  // On ChallengeSession — POST /api/challenge/record with the optional free-text name.
  // The server ignores `username` when the user is signed in (verified identity wins).
  async record(username?: string): Promise<RecordResult>;
  ```
  `record` uses `fetch('/api/challenge/record', { method: 'POST', credentials: 'include', headers:
  { 'Content-Type': 'application/json' }, body: JSON.stringify(username ? { username } : {}) })` and
  throws on non-ok (mirroring `finish()`).

### `src/lib/client/challenge-store.svelte.ts`
- Add a `record(username?: string)` action that calls the service, updates `result` (set
  `recorded: true`, `leaderboardPosition`, `username`) and status, and exposes `recorded` +
  the resolved `username` via getters.
- Provide a way to seed the completion view from server `pendingResult` for the hydration path
  (either a small `hydratePending({ challengeId, durationMs })` action on the store, or handle
  hydration in the page component — implementer's choice; the store remains the single source for
  `result`). The pending finish that seeds hydration is `{ valid: true, recorded: false, durationMs }`.

---

## I12. Files summary (iteration 2)

Create:
- `src/lib/server/challenges/pending.ts` (§I2)
- `src/lib/server/auth/return-to.ts` (§I3)
- `src/routes/api/challenge/record/+server.ts` (§I6)

Modify:
- `src/lib/server/env.ts` (§I1 — pending + return cookie constants)
- `src/lib/server/challenges/schemas.ts` (§I4 — `parseRecordRequest`)
- `src/routes/api/challenge/finish/+server.ts` (§I5 — defer when anonymous)
- `src/routes/api/auth/github/login/+server.ts` (§I7 — `return_to` cookie)
- `src/routes/api/auth/github/callback/+server.ts` (§I7 — redirect to `return_to`)
- `src/routes/api/leaderboard/+server.ts` (§I8 — `verified` flag)
- `src/routes/challenge/[id]/+page.server.ts` (§I9 — `user` + `pendingResult`)
- `src/routes/challenge/[id]/+page.svelte` (§I9, §I10 — overlay redesign, hydration, auto-record)
- `src/lib/client/challenge.ts` + `src/lib/client/challenge-store.svelte.ts` (§I11)

No DB/migration change (`leaderboard` already has `username` + `githubId`).

---

## I13. Test surface (for the tdd stage)

> **Existing-test churn (not a regression):** `src/routes/api/challenge/finish/finish.test.ts`
> asserts an immediate insert for anonymous finishes. That behavior **moves to `/record`**. Update
> those expectations: anonymous finish now **defers** (no insert, sets pending cookie, `recorded:false`,
> provisional rank), signed-in finish still records immediately (`recorded:true`, no pending cookie).

Unit (vitest `server` project):
- **pending.ts:** sign/verify round-trip returns `{ challengeId, durationMs }`; tamper (flipped byte /
  wrong secret / truncated), empty/garbage, and `iat` older than 1h → `null`.
- **return-to.ts:** `sanitizeReturnPath` accepts a leading-single-slash local path; rejects `//`, `/\`,
  scheme URLs, `javascript:`, no-leading-slash, empty, null (§I3 cases).
- **schemas:** `parseRecordRequest` trims/strips control chars/caps at 32; blank/whitespace →
  `undefined`.
- **`/api/challenge/finish`:** anonymous → **no** row inserted, pending cookie set, `recorded:false`,
  provisional rank correct; signed-in → row inserted (verified `username`/`githubId`), `recorded:true`,
  **no** pending cookie.
- **`/api/challenge/record`:** signed-in → verified `username`/`githubId`, **body `username` ignored**
  (explicit spoof test); anonymous → sanitized free-text name (blank → Anonymous/null, `githubId`
  null); missing/expired/tampered pending cookie → `400`; **single-use** (cookie cleared, second POST →
  `400`); returns correct final rank.
- **login `return_to`:** safe path stashed in the return cookie; unsafe values not stashed. **callback**
  redirects to the stashed path and clears the return cookie; falls back to `/?signed_in=1` when absent.
- **`/api/leaderboard`:** `verified` reflects `githubId != null`; anonymous/free-text entries `false`.

UI (browser test only if it fits the existing `*.browser.test.ts` pattern; else manual, documented):
completion overlay shows the record form + provisional rank when anonymous, the leaderboard + highlighted
rank after recording, and the seamless login-after-finish path attaching the verified name to the
just-completed time.

Existing `pnpm test` / `check` / `lint` stay green (with the finish-test updates above).
