# Plan: GitHub sign-in + verified username on leaderboard entries

Issue: jzohdi/tmux-speedrun#34

## Goal (restated)

Let users authenticate with GitHub via OAuth (Authorization Code flow, token exchange
server-side) and attach their **verified** GitHub username to the times they submit to the
leaderboard. Sign-in is **optional** — anonymous submissions keep working exactly as today; signing
in simply stamps a trustworthy, non-spoofable GitHub identity onto the entry. A signed-in state is
visible and the user can sign out.

## Current state of the code (grounding facts)

- **Framework / serverless boundary.** SvelteKit (`@sveltejs/kit`, `adapter-auto`). The
  "backend/serverless boundary" the issue asks about is SvelteKit server endpoints (`+server.ts`)
  and `hooks.server.ts` / `+*.server.ts` load functions. These run server-side only, so the GitHub
  client secret and token exchange live there and are never bundled to the browser. Server-only env
  is read via `$env/dynamic/private` (see `src/lib/server/env.ts`).
- **Leaderboard table already has identity columns but they are unused.**
  `src/lib/server/db/schema.ts` defines `leaderboard` with nullable `userId` (uuid), `username`
  (text), plus `challengeId`, `durationMs`, `createdAt`. Migration:
  `drizzle/0000_absent_black_bolt.sql`.
- **Submissions never attach a name today.** `src/routes/api/challenge/finish/+server.ts` validates
  the crypto proof, then `db.insert(leaderboard).values({ challengeId, durationMs })` — `username`
  is always left null. `/api/leaderboard/+server.ts` renders `entry.username ?? 'Anonymous'`. So the
  entire "attach username" feature reduces to: stamp `username` on that insert **from a
  server-verified session**, never from client input.
- **No auth/session infrastructure exists yet.** There is no `src/hooks.server.ts`, no
  `App.Locals` (`src/app.d.ts` is empty stubs), no `+layout.server.ts`. The only cookie today is the
  unsigned challenge-session JSON cookie (`tmux_challenge_session`) set/read in the challenge start
  and finish endpoints via `src/lib/server/env.ts` (`CHALLENGE_COOKIE_NAME`, `COOKIE_OPTIONS`,
  `getSessionSecret()`). `SESSION_SECRET` (≥32 chars) is already required and available server-side.
- **Env placeholders already anticipate this.** `.env.example` has commented
  `# GITHUB_CLIENT_ID` / `# GITHUB_CLIENT_SECRET` ("for future authenticated leaderboards") and an
  `ORIGIN` var. `ORIGIN` is not referenced in app code today (SvelteKit uses it internally).
- **UI is terminal-centric.** The landing page (`src/routes/+page.svelte`) renders a `Terminal`
  component (`src/lib/components/Terminal.svelte`) with a text command dispatcher (`help`, `clear`,
  `man tmux`, `tsr ls|lb|start|free-play|practice|config`). The leaderboard is viewed in-terminal
  (`tsr lb`) via `createLeaderboardQuery()` → `/api/leaderboard`. Challenge results render on
  `src/routes/challenge/[id]/+page.svelte`. There is no top-level nav/header chrome — `+layout.svelte`
  only wraps children in a TanStack `QueryClientProvider`.
- **Crypto helpers exist** (`src/lib/crypto`: `hkdf`, `sha256`, base64 utils, `stringToBytes`) — reuse
  these to HMAC-sign the session cookie rather than adding a dependency.

## Approach & architecture

Add a minimal, stateless, cookie-based session (no new DB session table) plus three OAuth endpoints,
then wire the verified identity through `hooks.server.ts` → `event.locals.user` so both the UI and
the finish endpoint can read it.

### 1. Configuration (`src/lib/server/env.ts`, `.env.example`)

- Add typed getters that read from `$env/dynamic/private`:
  - `getGitHubOAuthConfig()` → `{ clientId, clientSecret }`, throwing a clear error if either is
    missing **only when the OAuth routes are actually hit** (do not break app startup / anonymous
    play when unconfigured).
  - Resolve the redirect/callback URL from config: prefer an explicit `ORIGIN` env (already present)
    joined with the fixed callback path, with a dev fallback derived from the request URL. Keep the
    id/secret/redirect strictly out of any client-reachable module.
- Add `SESSION_COOKIE_NAME` (e.g. `tmux_session`) and a cookie-options constant mirroring the
  existing `COOKIE_OPTIONS` (`httpOnly`, `secure: !dev`, `sameSite: 'lax'`, `path: '/'`, a longer
  `maxAge`). `sameSite: 'lax'` is required so the cookie survives the top-level GET redirect back
  from GitHub.
- Uncomment/expand `.env.example`: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and document that the
  GitHub OAuth App callback URL must be `${ORIGIN}/api/auth/github/callback`. **All values via env,
  nothing hardcoded** (acceptance criterion).

### 2. Session helper (`src/lib/server/auth/session.ts` — new)

- Session payload: `{ githubId: number, username: string, iat: number }` (the "lightweight session:
  GitHub username + id" the issue asks for).
- `createSessionCookieValue(payload)` / `readSessionCookieValue(raw)`: serialize as
  `base64(json).base64(hmac)` where the HMAC is `SHA-256`/HKDF over the payload keyed by
  `getSessionSecret()`. Verify the signature on read and reject on mismatch → tamper-proof, so a
  client cannot forge a username. Use constant-time-ish comparison.
- Export `SESSION_COOKIE_NAME` and helpers to set/clear via SvelteKit `cookies`.

### 3. OAuth provider helper (`src/lib/server/auth/github.ts` — new)

Thin wrappers around `fetch` (available in the SvelteKit server runtime / Neon serverless):
- `buildAuthorizeUrl({ clientId, redirectUri, state, scope })` → GitHub
  `https://github.com/login/oauth/authorize`. Use **empty scope** (public profile only — issue says
  no extra scopes; no repo access).
- `exchangeCodeForToken(code)` → POST `https://github.com/login/oauth/access_token` with
  `client_id`, `client_secret`, `code`, `redirect_uri`, `Accept: application/json`. **Server-side
  only** — this is where the secret is used.
- `fetchGitHubUser(accessToken)` → GET `https://api.github.com/user` (Bearer + a User-Agent header,
  which GitHub requires), returning `{ id, login }`. `login` is the verified username; `id` is the
  stable numeric identity.

### 4. OAuth routes (`src/routes/api/auth/...` — new)

- `GET /api/auth/github/login/+server.ts`: generate a random `state`, store it in a short-lived
  httpOnly cookie (CSRF protection), then 302-redirect to the GitHub authorize URL. If OAuth env is
  missing, return a clear error/redirect rather than a stack trace.
- `GET /api/auth/github/callback/+server.ts`: verify `state` param equals the state cookie (reject on
  mismatch/missing → CSRF guard), clear the state cookie, `exchangeCodeForToken`, `fetchGitHubUser`,
  build + set the signed session cookie, then 302-redirect back to `/` in a signed-in state. On any
  failure (bad state, token/user fetch error) redirect home with a lightweight error signal (query
  param) and no session.
- `POST /api/auth/logout/+server.ts`: clear the session cookie and redirect/return to the anonymous
  state. (POST to avoid trivial CSRF sign-out via `<img>`; the client button issues a POST.)

### 5. Request-scoped user (`src/hooks.server.ts` — new, `src/app.d.ts`)

- `handle` hook: read + verify the session cookie, set
  `event.locals.user = { githubId, username } | null`. Invalid/absent cookie → `null`.
- `src/app.d.ts`: declare `App.Locals { user: { githubId: number; username: string } | null }` and
  `App.PageData { user: ... | null }`.

### 6. Expose user to the UI (`src/routes/+layout.server.ts` — new)

- `load` returns `{ user: locals.user }` so every page/component (Terminal) can render signed-in
  state without an extra fetch. (A tiny `GET /api/auth/session` may be added if the Terminal needs to
  re-read after login without a full navigation; prefer the layout load first.)

### 7. Attach verified username on submission (`src/routes/api/challenge/finish/+server.ts`)

- After proof validation, read `event.locals.user`. If present, insert
  `{ challengeId, durationMs, username: user.username, githubId: user.githubId }`; otherwise insert
  as today (anonymous). **The client body still only carries `proofB64`** — username is never taken
  from the request, satisfying "cannot be set to an arbitrary value by the client." Keep the existing
  try/catch so a DB hiccup never fails a valid run. (Add `locals` to the handler signature.)

### 8. Database (`src/lib/server/db/schema.ts` + new drizzle migration)

- The existing `username` column carries the GitHub login (server-stamped). To store the stable
  verified identity alongside it, **add a nullable `githubId` column** (`bigint`/`text` — GitHub ids
  are numeric and do not fit the existing `userId` uuid column, so leave `userId` untouched).
- Run `pnpm db:generate` to produce a new migration under `drizzle/`; commit the generated SQL +
  meta. Do **not** run `db:push`/`db:migrate` against any real DB here. No backfill of historical
  rows (out of scope). If adding the column proves unnecessary for acceptance, `username`-only is a
  viable fallback — but `githubId` is cheap and makes identity durable across username changes.

### 9. Sign-in UI (`Terminal.svelte`, `+page.svelte`/`+layout.svelte`)

Fit the terminal aesthetic and keep it minimal:
- Add terminal commands to the dispatcher in `src/lib/components/Terminal.svelte`:
  `tsr login` (navigate to `/api/auth/github/login`), `tsr logout` (POST `/api/auth/logout`),
  `tsr whoami` (print current GitHub username or "not signed in"). Add them to `help`.
- Add a small visible signed-in indicator (e.g. `● signed in as <username>` with a sign-out
  affordance) — placed in the hero/header area of `src/routes/+page.svelte` or a shared spot in
  `+layout.svelte`, fed by the `+layout.server.ts` `user` data. Provide a "Sign in with GitHub"
  button for discoverability in addition to the terminal command.
- The leaderboard rendering already shows `username`; verified entries now display the real GitHub
  login. (Optional, low-risk: mark verified entries visually — keep minimal unless trivial.)

## Files to change / add

Create:
- `src/lib/server/auth/session.ts`, `src/lib/server/auth/github.ts` (+ maybe `state.ts`)
- `src/routes/api/auth/github/login/+server.ts`
- `src/routes/api/auth/github/callback/+server.ts`
- `src/routes/api/auth/logout/+server.ts`
- `src/hooks.server.ts`
- `src/routes/+layout.server.ts`
- new `drizzle/00xx_*.sql` + meta (from `db:generate`)

Modify:
- `src/lib/server/env.ts` (OAuth config getters, session cookie constants)
- `src/app.d.ts` (`App.Locals`, `App.PageData`)
- `src/lib/server/db/schema.ts` (add `githubId`)
- `src/routes/api/challenge/finish/+server.ts` (stamp verified username/id from `locals.user`)
- `src/lib/components/Terminal.svelte` (login/logout/whoami commands + help)
- `src/routes/+page.svelte` and/or `src/routes/+layout.svelte` (signed-in indicator + sign-in button)
- `.env.example` (document GitHub OAuth vars + callback URL)

## Risks & edge cases

- **Secret exposure** — token exchange and secret use must stay in `*.server.ts` / `+server.ts`
  only; never import auth/github or env secret getters into client code. Verify no secret leaks into
  the client bundle.
- **CSRF on OAuth** — always send + verify `state`; reject callback on mismatch/missing.
- **Cookie tampering** — session cookie is HMAC-signed with `SESSION_SECRET`; reject bad signatures
  so username stays non-spoofable.
- **SameSite** — session + state cookies must be `sameSite: 'lax'` (not `strict`) so they survive the
  GitHub redirect; `secure` only in prod (`!dev`), matching existing `COOKIE_OPTIONS`.
- **Unconfigured OAuth** — with no `GITHUB_CLIENT_ID/SECRET`, anonymous play and existing routes must
  keep working; only the auth routes should error, and gracefully.
- **Redirect URL correctness** — `${ORIGIN}/api/auth/github/callback` must match the GitHub OAuth
  App config; document in `.env.example`.
- **Username drift / snapshot** — store `username` (and `githubId`) at submission time; no backfill,
  no dedup (out of scope).
- **Runtime** — adapter-auto + Neon serverless in prod: use standard `fetch` and web APIs only.
- **Clean tree** — do not run `db:push`; commit only the generated migration. Remove any
  vitest screenshot/attachment churn before finishing.

## How it will be tested

- **Unit (vitest `server` project):**
  - session sign/verify round-trip; tamper (flipped byte / wrong secret) is rejected.
  - `buildAuthorizeUrl` includes client_id/redirect_uri/state and no secret; scope is empty.
  - callback logic with **mocked `fetch`** (stub token + `/user` responses): success sets a valid
    session cookie; state mismatch / token failure yields no session.
  - finish endpoint: with `locals.user` set, the inserted row carries `username`/`githubId`; without
    it, stays anonymous — and `proofB64`-only body cannot inject a username.
- **Existing suites** (`pnpm test`, `pnpm check`, `pnpm lint`) stay green; add browser test coverage
  for the signed-in indicator only if it fits the existing `*.browser.test.ts` pattern.
- **Manual** (documented, not run in CI): create a GitHub OAuth App, set env, sign in, submit a
  time, confirm the verified username shows on `tsr lb`, then sign out → anonymous.

## Scope flags

- `needs_frontend: true` — terminal commands, signed-in indicator, sign-in/out buttons.
- `needs_backend: true` — OAuth routes, hooks, session helpers, env config, DB column + migration,
  finish-endpoint change.
