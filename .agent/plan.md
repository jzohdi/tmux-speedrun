# Plan: GitHub sign-in + verified username on leaderboard entries

Issue: jzohdi/tmux-speedrun#34

> **Iteration 3 (PR #36 feedback) — ACTIVE SCOPE.** The sign-in feature (iteration 1) and the
> completion-flow redesign (iteration 2) below are both **implemented and approved** on this branch.
> The reviewer left a new `feedback:` comment (2026-07-01 23:26) asking for two changes: (a) drop the
> free-text username input on completion — the only choices are **Save as Anonymous** or **Sign in with
> GitHub** (already-signed-in users skip the sign-in step), and (b) ensure there is a visible way to
> **log out** everywhere in the app. That work is specified in **"## Revision — PR #36 feedback
> (iteration 3)"** at the end of this file; it is the active scope for this pass. Everything above it is
> already-shipped context — do **not** re-implement it, only the deltas iteration 3 calls out.

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

## Scope flags (iteration 1 — shipped)

- `needs_frontend: true` — terminal commands, signed-in indicator, sign-in/out buttons.
- `needs_backend: true` — OAuth routes, hooks, session helpers, env config, DB column + migration,
  finish-endpoint change.

---

# Revision — PR #36 feedback (iteration 2)

The reviewer approved the sign-in feature, then asked for a better **challenge-completion flow**. The
current completion screen (`src/routes/challenge/[id]/+page.svelte`, the `completion-overlay` card in
the screenshot) shows only Time + Rank and records the time silently — anonymously unless already
signed in. The feedback (verbatim):

1. When completing a challenge and the user is **not** logged in, prompt them to sign in with GitHub
   to record their time.
2. Show the current leaderboard and what place they got for that challenge.
3. Do **not** require login to see the leaderboard / record a time — let them enter a (free-text)
   username and record the time under that name.
4. If they log in **after** finishing, the flow must be seamless: pick up where they left off (cookies)
   and record the just-completed time under their GitHub username.

## What this changes about the current design

Two things in the shipped code block requirement #4:

- **`/api/challenge/finish` records immediately and deletes the challenge cookie.** Once it returns,
  the completion is already written (anonymously) and the crypto session is gone — there is nothing
  left to attach a verified username to after a later login.
- **The completion screen is ephemeral client state.** `challenge/[id]/+page.svelte` starts a *new*
  challenge on `onMount`, so a full-page OAuth round-trip (which we need — GitHub is an external
  origin) destroys the completion view. The result must survive the redirect on the **server** side.

So the core move is: **defer the leaderboard write** behind a short-lived, server-**signed**
"pending result" cookie, and add an explicit **record** step. Recording resolves the identity at
record time — verified GitHub identity if signed in, otherwise the free-text name — which keeps the
approved invariant intact: *a client can never set the username on a **verified** entry* (§0.1 of the
interface spec). Free-text names are, by the reviewer's explicit request, allowed for anonymous
entries and are understood to be unverified; verified entries are visually badged so a free-text name
cannot masquerade as a verified one.

## Approach & architecture (iteration 2)

### A. Signed "pending result" cookie (new helper)

New module `src/lib/server/challenges/pending.ts` (mirrors the HMAC pattern of
`src/lib/server/auth/session.ts`, reusing `$lib/crypto` + `getSessionSecret()` — no new deps):

- Payload: `{ challengeId: number, durationMs: number, iat: number }`.
- `createPendingResultToken(payload)` / `verifyPendingResultToken(raw)` — base64url(json).base64url(hmac),
  `constantTimeEqual` on verify, returns `null` on tamper/garbage, and **null when older than
  `MAX_CHALLENGE_DURATION_MS` (1h)** (single expiry source of truth). `set/clearPendingResultCookie(cookies)`.
- Cookie: `PENDING_RESULT_COOKIE_NAME = 'tmux_pending_result'`, `sameSite: 'lax'` (must survive the
  GitHub redirect), `httpOnly`, `secure: !dev`, `path: '/'`, `maxAge` = 1h. Constants live in
  `src/lib/server/env.ts` alongside the existing cookie constants.
- **Why signed:** the client must not be able to forge/alter `durationMs` or `challengeId` between
  finish and record. The username is *never* in this cookie — it is always derived at record time.

### B. `POST /api/challenge/finish` (modify) — defer when anonymous

- Validate proof + compute `durationMs` exactly as today. Then branch on `locals.user`:
  - **Signed in already** → record immediately (verified `username` + `githubId`, as today), return
    `{ valid: true, durationMs, recorded: true, leaderboardPosition, username }`. Do **not** set a
    pending cookie. (Preserves today's behavior + acceptance criteria for the already-authed path.)
  - **Not signed in** → do **not** insert. Set the signed pending-result cookie, compute the
    **provisional** rank (same "count of faster entries + 1" query, without inserting), and return
    `{ valid: true, durationMs, recorded: false, leaderboardPosition (provisional) }`.
- Keep clearing `CHALLENGE_COOKIE_NAME` (the crypto challenge session is spent either way). The
  pending-result cookie — not the crypto session — is what carries the result forward.
- Invalid proof path unchanged.

### C. `POST /api/challenge/record` (new) — the explicit record step

- Reads + verifies the pending-result cookie → `{ challengeId, durationMs }`; missing/expired/tampered
  → `400` (nothing to record). Body: `{ username?: string }` (see schema below).
- Identity resolution (the invariant):
  - `locals.user` present → insert `{ username: user.username, githubId: user.githubId }`; **ignore any
    body `username`** (verified wins, non-spoofable).
  - else → insert `{ username: sanitized free-text name or null }`, `githubId` null.
- Clear the pending cookie (**single-use** → no double-record; re-POST after clear → 400).
- Compute + return `{ recorded: true, leaderboardPosition, username }` (final rank via the existing
  count query). Preserve the finish endpoint's defensive try/catch around the DB block.

### D. OAuth `return_to` (modify login + callback) — seamless login-after-finish

- `GET /api/auth/github/login` accepts `?return_to=<local-path>`. **Open-redirect guard:** accept only
  same-origin **paths** — must start with a single `/`, reject `//`, `/\`, or anything with a scheme/host;
  otherwise fall back to the default. Stash the sanitized value in a short-lived httpOnly cookie
  (`OAUTH_RETURN_COOKIE_NAME`, lax, ~10 min) set next to the state cookie.
- `GET /api/auth/github/callback` reads + clears that cookie and, on success, `redirect(302, return_to
  ?? '/?signed_in=1')`. Unchanged otherwise (state/CSRF, token exchange, session cookie).
- The completion screen's "Sign in with GitHub" button links to
  `/api/auth/github/login?return_to=/challenge/{index}?completed=1&record=1`. Because the pending-result
  cookie is `lax`, it survives the round-trip; on return `locals.user` is set and the page auto-records.

### E. Re-hydrate the completion screen server-side (modify challenge route)

- `src/routes/challenge/[id]/+page.server.ts`: also return `user: locals.user` and, when the
  pending-result cookie verifies **and its `challengeId` matches this route**, a
  `pendingResult: { durationMs }` (else `null`). This makes the just-finished result durable across the
  OAuth redirect independent of the ephemeral client store.
- `src/routes/challenge/[id]/+page.svelte`:
  - **Guard `onMount` auto-start:** if the URL has `?completed=1` **and** `data.pendingResult` exists,
    do **not** `challenge.start(...)`; render the completion overlay hydrated from `data.pendingResult`
    (time) + `data.user`.
  - If `?record=1` **and** `data.user` is present (returned from OAuth), auto-`POST /api/challenge/record`
    once, then show the confirmed rank + leaderboard.
  - Strip the `completed/record` query params after handling (via `replaceState`) so a refresh/re-visit
    starts a normal challenge.

### F. Completion overlay UI (modify `challenge/[id]/+page.svelte`)

Drive the overlay from a small view-model that unifies "fresh finish" (`challenge.result`) and
"post-OAuth hydration" (`data.pendingResult`). States:

- **Unrecorded (anonymous):** Time + "You'd place **#N**". Then:
  - Free-text **username input** (optional) + **"Save time"** button → `POST /api/challenge/record`
    `{ username }`. Blank name → recorded as Anonymous. One click = low friction (req #3).
  - An **"or"** divider + **"Sign in with GitHub to save a verified ✓ time"** button →
    `/api/auth/github/login?return_to=/challenge/{index}?completed=1&record=1` (req #1, #4).
- **Recorded (either path):** show "Saved as **{username}** {✓ if verified}" and the **final rank**.
- **Leaderboard panel (req #2):** after recording — and immediately for the already-signed-in path —
  fetch `/api/leaderboard`, show the top entries **for this challenge**, and **highlight the user's
  placement** (by rank; if their entry is outside the top 10, show a trailing "… you: #N" row).
- Keep "Back to Home" / "Try Again".

### G. Client store + service (modify)

- `ChallengeResult` (`src/lib/client/challenge.ts`) gains `recorded: boolean` and keeps
  `leaderboardPosition` as provisional-or-final. Add `ChallengeSession.record({ username })` → POST
  `/api/challenge/record`, returning the final `{ recorded, leaderboardPosition, username }`.
- `challenge-store.svelte.ts`: add a `record(username?)` action that calls the service, updates
  `result`/`status`, and exposes `recorded` + the resolved `username`. Add a way to seed the store's
  completion view from server `pendingResult` for the hydration path (or handle hydration purely in the
  page component — implementer's choice; keep the store the single source for `result`).

### H. Leaderboard `verified` flag (modify `/api/leaderboard`)

- Select `githubId` too and add `verified: entry.githubId != null` to each `LeaderboardEntry`. The UI
  badges verified entries (✓ / GitHub mark) so a free-text name cannot visually impersonate a verified
  identity. Existing `username ?? 'Anonymous'` fallback unchanged. Existing consumers (`tsr lb`) ignore
  the new field harmlessly.

### I. Free-text username schema (modify `src/lib/server/challenges/schemas.ts`)

- `recordChallengeRequestSchema = z.object({ username: z.string().trim().min(1).max(32).optional() })`
  plus a sanitize step stripping control characters; empty/whitespace → treated as absent (Anonymous).
  Export `parseRecordRequest`. Svelte auto-escapes on render, so display is XSS-safe; the length cap
  keeps the leaderboard tidy.

## Files to change / add (iteration 2)

Create:
- `src/lib/server/challenges/pending.ts` (signed pending-result cookie helpers)
- `src/routes/api/challenge/record/+server.ts`

Modify:
- `src/routes/api/challenge/finish/+server.ts` (defer when anonymous; record immediately when signed in)
- `src/lib/server/env.ts` (pending-result + OAuth return cookie constants)
- `src/routes/api/auth/github/login/+server.ts` (validated `return_to` → return cookie)
- `src/routes/api/auth/github/callback/+server.ts` (redirect to `return_to`)
- `src/routes/api/leaderboard/+server.ts` (`verified` flag)
- `src/lib/server/challenges/schemas.ts` (`parseRecordRequest`)
- `src/routes/challenge/[id]/+page.server.ts` (return `user` + `pendingResult`)
- `src/routes/challenge/[id]/+page.svelte` (completion overlay: record form, sign-in prompt,
  leaderboard + highlight, OAuth re-hydration + auto-record, guarded auto-start)
- `src/lib/client/challenge.ts` + `src/lib/client/challenge-store.svelte.ts` (`recorded`, `record()`)

## Risks & edge cases (iteration 2)

- **Verified-username invariant (must not regress).** `/api/challenge/record` ignores a body `username`
  whenever `locals.user` is set → the reviewer-praised spoof-resistance holds. Add an explicit test for
  "signed-in + body username → verified used, body ignored".
- **Time forgery.** Pending-result cookie is HMAC-signed; `durationMs`/`challengeId` cannot be altered
  client-side. Username is never in the cookie.
- **Double / replay recording.** Pending cookie is single-use (cleared on record) and expires in 1h;
  finish sets it only for anonymous finishes. Signed-in finishes record once, no pending cookie.
- **Open redirect.** `return_to` accepted only as a same-origin path (leading single `/`, reject `//`,
  `/\`, scheme/host). Test the guard.
- **SPA re-hydration.** Completion survives OAuth via server `pendingResult`; `onMount` must not
  auto-start when `?completed=1` + pending result present. Clear the query params after handling.
- **Free-text safety.** trim + length cap + control-char strip; Svelte escaping prevents XSS; verified
  badge disambiguates impersonation. Blank → Anonymous.
- **Abandoned completion.** Deferring means a user who finishes and leaves without clicking "Save" is
  not recorded (a change from today's silent auto-record). This is the intended trade for letting them
  choose a name / sign in (req #3); "Save time" is one click with an optional name, keeping friction low.
- **Unconfigured OAuth.** The "Sign in" button still routes through `/api/auth/github/login`, which
  already redirects home with `auth_error=not_configured`; the free-text "Save time" path is fully
  independent, so anonymous recording works with OAuth unconfigured.
- **Existing test churn.** `src/routes/api/challenge/finish/finish.test.ts` currently asserts an
  immediate insert for anonymous finishes — that behavior moves to `/record`. The tdd stage must update
  those expectations (finish now defers + sets pending cookie for anonymous; still records for signed-in)
  and add `record`/`pending`/`return_to`/`verified-flag` coverage. Flag this so it isn't read as a
  regression.
- **Clean tree.** No new migration needed (schema already has `username` + `githubId`). No `db:push`.
  Remove any test artifacts before finishing.

## How it will be tested (iteration 2)

- **pending.ts:** sign/verify round-trip; tamper (flipped byte / wrong secret / truncated) → `null`;
  `iat` older than 1h → `null`; garbage/empty → `null`.
- **`/api/challenge/record`:** signed-in → verified `username`/`githubId`, **body username ignored**;
  anonymous → free-text name sanitized (trim/length/blank→Anonymous); missing/expired/tampered pending
  cookie → 400; single-use (cookie cleared, second POST → 400); returns correct final rank.
- **`/api/challenge/finish`:** anonymous → no row inserted, pending cookie set, `recorded:false`,
  provisional rank correct; signed-in → row inserted (verified), `recorded:true`, no pending cookie.
- **login `return_to`:** only local paths accepted (open-redirect guard cases); callback redirects to
  the stashed path and clears the return cookie.
- **`/api/leaderboard`:** `verified` reflects `githubId != null`; anonymous/free-text entries `false`.
- **UI** (browser test if it fits the existing `*.browser.test.ts` pattern; else manual, documented):
  completion overlay shows record form when anonymous, leaderboard + highlighted rank after recording,
  and the seamless login-after-finish path attaches the verified name to the just-completed time.
- Existing `pnpm test` / `check` / `lint` stay green (with the finish-test updates above).

## Scope flags (iteration 2 — shipped)

- `needs_frontend: true` — completion overlay redesign (record form, GitHub prompt, leaderboard +
  placement highlight, OAuth re-hydration), client store/service changes.
- `needs_backend: true` — pending-result cookie helper, `/api/challenge/record`, finish-endpoint
  deferral, OAuth `return_to`, leaderboard `verified` flag, record schema.

---

# Revision — PR #36 feedback (iteration 3)

The reviewer approved iteration 2, then asked for two focused changes (verbatim):

> Overall the changes are good, however there should not be an input for adding any chosen name when
> completing a challenge. The user should only have two choices: 1. Save time as "Anonymous" 2. Login
> to github (save time using username) - they don't need to log in again if they already logged in to
> github.
>
> Also make sure that there is a way to log out on the app.

This walks back the iteration-2 free-text-username affordance and re-tightens the leaderboard toward
issue #34's original intent ("leaderboard identities are trustworthy and not free-text/spoofable"):
the only ways to save a time become **Anonymous** (no name) or a **verified GitHub** identity.

## Requirement mapping

1. **No free-text username on completion.** Remove the username `<input>` + "Save time" affordance.
   The unrecorded/anonymous overlay offers exactly two buttons:
   - **Save as Anonymous** → record with no name (`username` null).
   - **Sign in with GitHub to save a verified time** → the existing OAuth round-trip that returns and
     auto-records under the verified identity.
2. **Already-signed-in users skip the sign-in step.** In normal flow a signed-in finish already
   records immediately (§I5), so they never see the choice. For the rare signed-in-but-unrecorded
   overlay (hydration without `?record=1`), show a single **Save my time** button (records verified) —
   never prompt an already-authenticated user to "sign in with GitHub" again.
3. **Remove the free-text path from the backend too**, not just the UI. Since no client surface can set
   a name anymore, `/api/challenge/record` must stop honoring a body `username` entirely — this closes
   the door on a crafted client injecting an arbitrary (unverified) name, restoring the non-spoofable
   invariant end-to-end. Anonymous record ⇒ `username: null`, `githubId: null`. Signed-in record ⇒
   verified `username`/`githubId` from `locals.user` (unchanged).
4. **Log out anywhere.** A visible sign-out affordance must be reachable from the app, including the
   **challenge page** (where the completion screenshot was taken and no logout exists today). Add a
   signed-in indicator + **Sign out** button to the challenge page header, reusing the existing
   `POST /api/auth/logout` endpoint. (The home page `auth-bar` and terminal `tsr logout` already exist
   and stay.)

## What changes about the current design

The iteration-2 code introduced a free-text name at three layers — schema, endpoint, client/UI — plus
`?record=1` auto-record. Iteration 3 strips the free-text layer and adds a logout affordance to the
challenge page; the deferral / pending-cookie / OAuth-return / verified-badge machinery is unchanged.

## Approach & architecture (iteration 3)

### A. Completion overlay — two choices, no input (`src/routes/challenge/[id]/+page.svelte`)

- Delete the `usernameInput` state and the `<input class="username-input">` + its "Save time" button
  and the `.record-row` wrapper; delete the `handleSaveTime` handler.
- Replace the unrecorded block with a branch on `isSignedIn`:
  - **Anonymous:** two stacked buttons — **"Save as Anonymous"** (`onclick={handleSaveAnonymous}` →
    `challenge.record()` with no name) and, after an "or" divider, the existing **"Sign in with GitHub
    to save a verified time"** button (`handleSignIn`, unchanged `signInHref`).
  - **Signed in (edge):** a single **"Save my time"** button → `challenge.record()` (records verified).
- Recorded state, leaderboard panel, verified badge, "Back to Home" / "Try Again", and the invalid-proof
  branch are **unchanged**.
- Remove now-dead CSS (`.username-input`, `.record-row`); keep `.record-form`, `.or-divider`,
  `.github-button`, and button styles.

### B. Record endpoint — drop free-text (`src/routes/api/challenge/record/+server.ts`)

- Stop reading/parsing the request body for a username. Remove the `parseRecordRequest` import and the
  body-parse try/catch. Identity resolution reduces to:
  - `locals.user` set → insert verified `{ username, githubId }` (unchanged).
  - else → insert `{ username: null }`, `githubId` null.
- Everything else — pending-cookie verify (400 on missing/expired/tampered), single-use clear, rank
  count, defensive DB try/catch, response shape `{ recorded, leaderboardPosition, username }` — stays.
  (`username` in the response is now always the verified name or `null`.)

### C. Record schema — remove the free-text validator (`src/lib/server/challenges/schemas.ts`)

- Remove `recordChallengeRequestSchema`, `parseRecordRequest`, and the `RecordChallengeRequestBody`
  type (all now dead). Keep every other export (`start`/`finish`/session schemas) untouched.

### D. Client service + store — drop the `username` param

- `src/lib/client/challenge.ts`: `ChallengeSession.record()` and the standalone `recordChallenge()`
  take **no** argument; the POST body becomes `{}` (empty). Keep `credentials: 'include'` + non-ok
  throw. `RecordResult` / `ChallengeResult` types are unchanged (`username` can still be `null`).
- `src/lib/client/challenge-store.svelte.ts`: the `record()` action drops its `username` parameter and
  calls `recordChallenge()` with no arg. `recorded` / `recordedUsername` getters unchanged.

### E. Logout on the challenge page (`src/routes/challenge/[id]/+page.svelte`)

- The load already exposes `data.user` (§I9). Add to the `.challenge-header` a compact auth control:
  when `data.user`, render `● signed in as {username}` + a **Sign out** button; when signed out, render
  a small **Sign in** link (`href="/api/auth/github/login"`) for parity/discoverability.
- Sign-out reuses the home page's pattern: `await fetch('/api/auth/logout', { method: 'POST' })` then
  `window.location.reload()` (drops back to the anonymous state). Add a tiny `signOut()` helper in the
  page script and matching header styles that fit the existing terminal aesthetic.

## Files to change (iteration 3)

Modify:
- `src/routes/challenge/[id]/+page.svelte` (remove input; two-choice overlay; header sign-out/-in)
- `src/routes/api/challenge/record/+server.ts` (ignore/stop reading body username)
- `src/lib/server/challenges/schemas.ts` (remove record schema + `parseRecordRequest`)
- `src/lib/client/challenge.ts` (`record()` / `recordChallenge()` take no arg)
- `src/lib/client/challenge-store.svelte.ts` (`record()` drops `username` param)

No new files. No schema/migration change. No new backend routes. Home page + terminal logout unchanged.

## Risks & edge cases (iteration 3)

- **Verified invariant strengthened, not weakened.** Removing the body-username path means the only
  named entries are verified GitHub identities; anonymous entries are `null`/`verified:false`. Re-assert
  the spoof test at `/api/challenge/record` (signed-in + body username → body ignored; and now:
  anonymous + body username → still `null`, name never used).
- **Signed-in-unrecorded edge.** Must render the single "Save my time" button, never the GitHub prompt,
  so an authenticated user is never asked to sign in again (req #2).
- **Anonymous "Save as Anonymous" is one click**, no typing — lower friction than before, still records
  with a provisional→final rank and the leaderboard panel (iteration-2 behavior preserved).
- **Logout reachability.** Sign-out must work from the challenge page without breaking an in-progress
  challenge state expectations — it's a full reload back to anonymous, only meaningful post-completion
  or between challenges; acceptable and matches the home-page affordance.
- **Test churn (flag for tdd).** `record.test.ts` cases that assert a free-text/sanitized username on
  the anonymous path must change to assert `username: null`; `schemas.test.ts` cases for
  `parseRecordRequest` must be removed. Add/keep: anonymous record → `null`; signed-in record → verified;
  body username ignored in **both** branches; pending-cookie 400 + single-use unchanged. Any browser/UI
  test asserting the username input must be updated to the two-button overlay.
- **Clean tree.** Pure edits/removals; no migrations, no artifacts. Ensure `pnpm-workspace.yaml` and
  lockfiles stay unchanged (a prior round flagged accidental workspace churn).

## How it will be tested (iteration 3)

- **`/api/challenge/record`:** anonymous → row inserted with `username: null`, `githubId` null, correct
  final rank; **body `username` is ignored in both anonymous and signed-in branches**; signed-in →
  verified `username`/`githubId`; missing/expired/tampered pending cookie → 400; single-use (replay →
  400) — all unchanged except the anonymous-name expectation.
- **schemas:** the `parseRecordRequest` suite is removed (function no longer exists); other schema tests
  stay green.
- **UI** (browser test if it fits `*.browser.test.ts`; else manual, documented): the completion overlay
  shows **no text input** — only "Save as Anonymous" + "Sign in with GitHub" when anonymous, and a single
  "Save my time" when signed in; the challenge header exposes a working **Sign out**.
- Existing `pnpm test` / `check` / `lint` stay green with the test updates above.

## Scope flags (iteration 3 — active)

- `needs_frontend: true` — completion-overlay two-choice redesign (remove input), challenge-page
  header sign-out/-in, client store/service `record()` signature change.
- `needs_backend: true` — `/api/challenge/record` stops honoring body username, record schema removed.
