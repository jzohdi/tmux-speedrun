# Plan: `tmux-speedrun` CLI (native tmux, GitHub-authenticated leaderboard)

Issue: jzohdi/tmux-speedrun#35

> This plan replaces the previous `.agent/plan.md` (which covered the now-merged issue #34/#36 GitHub
> sign-in work, commit `6e36c0f`). The prior `.agent/interface.md` also belongs to that shipped work;
> the interface stage for this issue will overwrite it.

---

## 1. Goal (restated)

Ship an installable `tmux-speedrun` CLI so users run the challenges and practice flows against **their
own native tmux** instead of the browser-emulated terminal. It must:

- Be installable from a terminal (npm package; `npx tmux-speedrun` / global install).
- Provide `tmux-speedrun help` listing commands.
- Run **practice mode** and **challenges** (0–5) against native tmux (free-play is out of scope).
- Show the **leaderboard** for any challenge.
- Prompt the user with the current step; the user drives their real tmux to complete it; the CLI
  advances the encrypted step chain as steps are solved.
- Run challenges in a **fully isolated tmux server** on a private socket so prompted commands (e.g.
  `kill-session`, `kill-server`) can never touch the user's real tmux. Torn down on exit/interrupt.
  **Hard requirement.**
- Support `tmux-speedrun login` (browser OAuth) attaching the **verified** GitHub username to
  leaderboard entries, matching the web's server-side identity rules (no client-supplied username).
- Add a **CLI documentation page** to the website.

The existing web API (`src/routes/api/**`) remains the **source of truth** for challenge creation,
progression, and the leaderboard. Practice mode ships bundled/offline.

---

## 2. How the existing system works (grounding)

Studied the repo; the CLI must interoperate with these mechanisms exactly.

### 2.1 Challenge crypto protocol (client ↔ server)

- **Start** — `POST /api/challenge/start` `{ challengeId, clientPublicKeyJwk }`. Server does ECDH
  (P-256), generates a fresh randomized instruction sequence (25–100 steps by difficulty,
  `src/lib/server/challenges/generator.ts` + `pools.ts`), derives a key chain, AES-GCM-encrypts each
  step, returns `{ serverPublicKeyJwk, sessionSaltB64, steps[] }` where each step is
  `{ index, nonceB64, ciphertextB64 }`, and sets an httpOnly `tmux_challenge_session` cookie holding
  the encrypted proof (1h TTL). Steps are never stored server-side.
- **Client key chain** (`src/lib/client/challenge.ts`, normative to reproduce):
  - `sharedSecret = ECDH(clientPriv, serverPub)`
  - `K0 = HKDF(sharedSecret, sessionSalt, "k0", 32)`
  - Decrypt step `n` with `Kn` (AES-GCM). Plaintext JSON = `{ prompt, requiredInput?, seedInput? }`.
  - On a correct answer string `a` for step `n`:
    `K(n+1) = HKDF(Kn, SHA256(a), "step-{n+1}", 32)`.
  - Correctness is verified locally by **trial-decrypting** step `n+1` with `K(n+1)`: success ⇒
    answer was right. The last step's derived key is `Kfinal` = the **proof**.
- **Finish** — `POST /api/challenge/finish` `{ proofB64 }` (proof = base64 of `Kfinal`). Server
  validates against the session cookie, computes `durationMs` from the cookie's `startTime`.
  - Signed-in (`locals.user` present) ⇒ inserts leaderboard row immediately, `recorded:true`.
  - Anonymous ⇒ `recorded:false` + provisional rank; stashes a signed `tmux_pending_result` cookie.
- **Record** — `POST /api/challenge/record` (empty body). Single-use "save my time" for a user who
  signs in after finishing. Identity resolved **only** from `locals.user`; body never read for a
  name. Clears the pending cookie (replay ⇒ 400).
- **Leaderboard** — `GET /api/leaderboard` (public, cached 60s): `{ [challengeId]: LeaderboardEntry[] }`,
  `LeaderboardEntry = { rank, username, time, durationMs, verified }`, `verified = githubId != null`.

**Canonical answer strings** (`expectedAction`, from `generator.ts`): simple commands are the bare
command name (`split-vertical`, `new-window`, `kill-session`, …); input commands are
`"<name>:<randomInput>"` (e.g. `rename-window:swift-tiger-42`); the copy-paste step is
`"copy-paste-sequence:<text>"` (`src/lib/utils/tmux-copy-sequence.ts`). The decrypted step delivers
`requiredInput` (the exact string for input commands) and `seedInput` (the copy text), so the CLI
**already knows the input portion** of the answer; only the command-name portion must be inferred
from the user's action. The command pool per challenge is bundled data (`tmux-commands.ts` +
`pools.ts`).

In the browser, `src/routes/challenge/[id]/+page.svelte` receives structured signals from the
emulator (`command-executed` with a ready-made canonical `command` string) and calls
`challenge.submitAnswer(answer)`. **The CLI must synthesize the equivalent canonical answer from
observed native-tmux state changes** — this is the core new work (see §5).

### 2.2 Auth

- `GET /api/auth/github/login` → GitHub authorize (CSRF `state` cookie) → `GET
  /api/auth/github/callback` exchanges code→token server-side, fetches the verified GitHub user, sets
  a signed `tmux_session` cookie, redirects home (or to a sanitized same-origin `return_to`).
- The session cookie is a **stateless HMAC-signed token** (`src/lib/server/auth/session.ts`):
  `base64url(JSON(payload)).base64url(HMAC_SHA256(payloadB64))`, `payload = { githubId, username,
  iat }`, signed with `SESSION_SECRET`. `hooks.server.ts` verifies it per request into `locals.user`.
  `verifySessionToken` only checks signature + field types (no expiry check).
- `sanitizeReturnPath` (`auth/return-to.ts`) restricts `return_to` to same-origin **local paths** —
  absolute URLs and schemes are rejected (open-redirect guard). Loopback URLs are therefore **not**
  expressible via `return_to`; the CLI needs a separate, explicitly-guarded loopback channel (§4).

### 2.3 Crypto reuse in Node

`src/lib/crypto/*` uses only Web Platform APIs available as Node 22 globals: `crypto.subtle`,
`crypto.getRandomValues`, `btoa`/`atob`, `TextEncoder`/`TextDecoder`. No Svelte/browser-only deps.
So the crypto primitives and the client key-chain helpers can be reused **unchanged** by the CLI
(bundled at build time). Node in this repo is v22; tmux is available on the platform.

---

## 3. Approach & architecture

### 3.1 Runtime, language, packaging

- **Node.js + TypeScript**, published as npm package **`tmux-speedrun`** with a `bin` entry
  (`tmux-speedrun`). Node ESM, `engines.node >= 20` (Web Crypto globals; dev/target Node 22).
- Housed **in this repo as a pnpm workspace package** at `cli/`. Add `cli` to
  `pnpm-workspace.yaml` (currently only `onlyBuiltDependencies`; convert to include `packages: ['.',
  'cli']` or the equivalent). This lets the CLI import the app's pure modules directly and keeps them
  in lockstep.
- **Bundler:** `tsup` (esbuild) → single ESM bundle + `bin` shim with `#!/usr/bin/env node`. Bundling
  inlines the reused app modules so the published package is self-contained (no `$lib` alias at
  runtime). Keep runtime deps minimal (ideally zero beyond Node built-ins; a tiny arg parser is
  optional — prefer hand-rolled to avoid deps). `open`-the-browser is done via a 3-line
  platform shim (`open`/`xdg-open`/`start`) rather than a dependency.
- **Reused app modules** (imported by the CLI build; keep them dependency-free):
  - `src/lib/crypto/**` (ECDH, HKDF, AES-GCM, utils).
  - Pure key-chain helpers from `src/lib/client/challenge.ts` — **refactor** the pure functions
    (`deriveK0`, `deriveNextKey`, `decryptStep`, step/types, `formatDuration`) into a new
    `src/lib/client/challenge-core.ts` that both the web `ChallengeSession` and the CLI import. The
    web's `ChallengeSession` keeps its `fetch('/api/…', credentials:'include')` transport; the CLI
    gets its own transport (base-URL + cookie jar, §4.1). No behavior change to the web client.
  - Data: `src/lib/data/tmux-commands.ts`, `src/lib/data/practice-flow.ts`,
    `src/lib/server/challenges/pools.ts` (pure), `src/lib/utils/tmux-copy-sequence.ts`.
    - Note: `practice-flow.ts` currently imports types from `$lib/utils/tmux-commands` and
      `$lib/utils/tmux-conf`. Confirm these transitively pull in no browser-only code; if they do,
      split the needed types into a leaf module. (Risk R7.)

### 3.2 CLI command surface

```
tmux-speedrun help                 # list commands (also default / --help / -h)
tmux-speedrun login                # browser OAuth via loopback; store verified session
tmux-speedrun logout               # clear stored session (best-effort POST /api/auth/logout)
tmux-speedrun whoami               # show signed-in GitHub username (or "anonymous")
tmux-speedrun leaderboard [id]     # GET /api/leaderboard; render table(s)
tmux-speedrun practice [category]  # offline practice against isolated native tmux
tmux-speedrun challenge <id>       # run challenge 0–5 against isolated native tmux
```

Global options / env:
- `--server <url>` or `TMUX_SPEEDRUN_API` — API base URL (default: the production site origin;
  pinned as a constant, overridable for dev/testing).
- `--no-color`, `--json` (for `leaderboard`/`whoami` scripting), `--verbose`.

### 3.3 Local state

- Config dir `~/.config/tmux-speedrun/` (respect `$XDG_CONFIG_HOME`).
  - `session.json` — `{ token, username, githubId, savedAt }`, file mode `0600`. Holds the signed
    session token obtained by `login`.
- Challenge-session cookies (`tmux_challenge_session`, `tmux_pending_result`) are **ephemeral**,
  held only in an in-memory cookie jar for the duration of one `challenge` run.

---

## 4. Session transport (resolving the triage gap)

The whole protocol relies on browser-held httpOnly cookies and `locals.user`. The CLI carries this
state in two ways.

### 4.1 Challenge/anonymous cookies — no server change

`tmux_challenge_session` and `tmux_pending_result` are `httpOnly`; that flag only blocks **browser
JS**, not an HTTP client. The CLI uses a small **cookie jar** that reads `Set-Cookie` from the
`start`/`finish` responses and replays them on `finish`/`record`. This carries the entire challenge
session with **no backend change**.

- Implementation: Node `fetch` (global in Node 22) with manual cookie handling (read
  `response.headers.getSetCookie()`, send `Cookie:` header). Persist only in memory per run.
- `secure` cookies: cookies are marked `secure` in production, so the API base must be `https` in
  prod (it is). For local dev against `http://localhost`, `secure` is false — works.

### 4.2 Auth token — loopback exchange (needs new/adapted endpoints)

The web OAuth sets `tmux_session` in the **user's browser**, which the CLI cannot read. Use a
loopback redirect that hands the signed session token back to the waiting CLI:

1. `tmux-speedrun login` starts a localhost HTTP server bound to **`127.0.0.1:<ephemeral port>`** and
   generates a random `cli_state` (CSRF).
2. CLI opens the browser to a **new** endpoint
   `GET /api/auth/cli/login?port=<port>&state=<cli_state>`. This endpoint:
   - Validates `port` (numeric, in the ephemeral range) and `state` (opaque token, bounded length).
   - Sets the normal OAuth `tmux_oauth_state` cookie (reusing `generateOAuthState` +
     `OAUTH_STATE_COOKIE_*`).
   - Sets a **new signed, short-lived `tmux_cli_login` cookie** carrying `{ port, cli_state }`
     (HMAC-signed with `SESSION_SECRET`, ~10 min TTL), marking this OAuth round-trip as CLI-bound.
   - Redirects to GitHub authorize (reuse `buildAuthorizeUrl`, same fixed callback URL
     `/api/auth/github/callback`).
3. GitHub → `GET /api/auth/github/callback` (existing). **Adapt** it: after the existing state check,
   code→token exchange, user fetch, and `setSessionCookie(...)`, check for the `tmux_cli_login`
   cookie. If present and valid:
   - Delete the `tmux_cli_login` cookie (single-use).
   - Build the loopback URL `http://127.0.0.1:<port>/callback?token=<sessionToken>&state=<cli_state>`
     where `sessionToken` = the same signed token just minted (`createSessionToken(payload)`), and
     redirect (302) there — but **only** after passing a strict loopback guard (§4.3). If the guard
     rejects, fall back to the normal home redirect (never an open redirect).
   - The browser is still logged into the website too (the cookie is set), which is fine.
4. The CLI's loopback server receives `/callback`, checks `state === cli_state`, extracts `token`,
   writes `session.json` (0600), responds with a friendly "You can close this tab" HTML page, and
   shuts the loopback server down. `login` prints the resolved username (decoded locally from the
   token payload, or by calling `whoami`).
5. On subsequent authenticated calls (`finish`, `record`), the CLI sends `Cookie:
   tmux_session=<token>`; `hooks.server.ts` verifies it → `locals.user` populated → verified
   username attached. **No change to finish/record.**

**Why reuse the existing session token** (vs. a new CLI token type): minimal server change, and
`hooks.server.ts`/`finish`/`record` already trust it. The token is non-spoofable (HMAC), and identity
is still server-verified — the CLI cannot inject a username. The token is bearer-capable and
effectively long-lived (no expiry check in `verifySessionToken`); acceptable and consistent with the
web's 30-day cookie. (If reviewers prefer scope-limiting, a dedicated CLI token with an expiry is a
drop-in alternative — noted, not chosen, to keep the change minimal.)

### 4.3 Loopback redirect guard (security-critical)

New helper `src/lib/server/auth/cli-login.ts`:
- `signCliLoginState({port, cli_state})` / `verifyCliLoginState(cookie)` — HMAC via `SESSION_SECRET`,
  mirroring `session.ts`.
- `buildLoopbackCallbackUrl({port, cli_state, token})` returning a URL **only** when host is
  `127.0.0.1` (or `localhost`), scheme `http`, path `/callback`, and `port` is an integer in
  `[1024, 65535]`. Reject everything else → callback falls back to the home redirect. This prevents
  the callback from becoming an open redirect / token-exfiltration vector. `token` and `cli_state` are
  URL-encoded.
- The token only ever leaves over **loopback** to a process on the same machine that proved knowledge
  of `cli_state`.

### 4.4 New/adapted endpoints — summary

- **New:** `GET /api/auth/cli/login` (`src/routes/api/auth/cli/login/+server.ts`).
- **Adapted:** `GET /api/auth/github/callback` — branch to loopback redirect when `tmux_cli_login` is
  present/valid; otherwise unchanged.
- **New env constants** in `src/lib/server/env.ts`: `CLI_LOGIN_COOKIE_NAME = 'tmux_cli_login'` +
  `CLI_LOGIN_COOKIE_OPTIONS` (httpOnly, `sameSite:'lax'`, ~10 min).
- **Unchanged:** `start`, `finish`, `record`, `leaderboard`, `logout`, GitHub `login`.

---

## 5. Native-tmux challenge/practice engine

### 5.1 Environment isolation (hard requirement)

- Every challenge/practice run creates a **dedicated tmux server on a private socket**:
  `tmux -L tmux-speedrun-<random>` (unique per run; `-L` names a socket under the tmux socket dir).
  Optionally `-S <tmpdir>/sock` for full path isolation. A generated config file is passed with `-f`
  (its own prefix/options; independent of the user's `~/.tmux.conf`).
- **All** challenge commands and the user's attach happen against this socket. The user's default
  tmux server (default socket) is never referenced — a prompted `kill-session`/`kill-server` can only
  affect the isolated server.
- **Teardown:** register handlers for `SIGINT`, `SIGTERM`, `SIGHUP`, normal exit, and uncaught
  errors; always run `tmux -L <sock> kill-server` (ignore "no server" errors) and remove any temp
  config/socket. Use a `try/finally` around the run plus process-level signal handlers so an interrupt
  mid-challenge still cleans up. Idempotent (safe to call twice).
- **Provable separation** (acceptance): the isolated socket name is distinct and logged; an
  integration test asserts that after running `kill-server` inside the isolated server, the user's
  default-socket sessions (created by the test on the default socket) are still present.

### 5.2 Interaction model

The user drives a **real native tmux** (the isolated server) — no emulation. Chosen model:

- The CLI **attaches the user's terminal** into the isolated server (`tmux -L <sock> attach`) so they
  operate real tmux directly.
- The current **step prompt, progress (n/total), and timer** are surfaced via the isolated server's
  **status line** (configured in the generated tmux config: `status-left`/`status-right`, short
  status interval) and updated by the controller as steps advance (`tmux -L <sock> set -g
  status-left …` / `display-message`). A large prompt can also be shown via `display-popup` /
  `display-message` on advance.
- A **controller process** runs alongside (outside the attached client) observing state changes
  (§5.3) and advancing the encrypted chain. When the challenge completes, the controller submits the
  proof, then detaches the user and prints results in the CLI.
- Non-TTY / not-a-real-terminal ⇒ challenge/practice refuse with a clear message; `leaderboard`,
  `whoami`, `login` still work.

### 5.3 Action detection — native tmux → canonical answer (core new work)

The controller must convert what the user does in native tmux into the canonical answer string the
key chain expects. Design: **observe state deltas, generate candidate answer(s), verify by
trial-decrypt.**

**Observation.** The controller maintains a model of the isolated server's state by querying tmux
(cheap, scriptable): `list-sessions`, `list-windows -a`, `list-panes -a`
(`-F` with `#{session_name} #{window_index} #{window_name} #{pane_id} #{pane_active}
#{pane_left} #{pane_top} #{pane_width} #{pane_height} #{window_zoomed_flag} …`),
`show-buffer`/`list-buffers`, and pane mode via `#{pane_in_mode}`. Changes are driven by:
1. **tmux hooks** installed in the generated config that fire `run-shell` to a tiny notifier writing
   an event line to a Unix domain socket / FIFO the controller reads. Install the `after-*` and
   notification hooks that tmux supports for the pool commands, e.g. `after-split-window`,
   `after-new-window`, `after-new-session`, `after-kill-pane`, `after-select-pane`,
   `after-select-window`, `after-rename-window`, `after-rename-session`, `session-closed`,
   `window-renamed`, `pane-focus-in`, `pane-mode-changed`, etc. The hook is only a **trigger** ("state
   may have changed"); the controller re-queries and diffs.
2. A lightweight **poll** fallback (e.g. 100–200ms) as a safety net for anything a hook misses,
   including read-only/informational commands. (tmux hook coverage varies by version; the poll +
   trial-decrypt net guarantees progress without depending on exhaustive hook support — see R1.)

**Delta → candidate answers.** From `(prevState, newState[, bufferState])` derive candidates:

| Observation | Candidate canonical answer(s) |
|---|---|
| pane count +1; new pane to the right of its sibling (`pane_left` increases, same `pane_top`) | `split-vertical` |
| pane count +1; new pane below its sibling (`pane_top` increases, same `pane_left`) | `split-horizontal` |
| window count +1 (same session) | `new-window` (or `break-pane` if a pane left the source window ⇒ `break-pane`) |
| pane count −1 in a window (window remains) | `kill-pane` |
| session count +1 | `new-session` |
| a session disappears (others remain) | `kill-session` |
| all sessions disappear | `kill-server` |
| window name changed to `X` | `rename-window:X` (X should equal the step's `requiredInput`) |
| session name changed to `X` | `rename-session:X` |
| active pane id changed within window | `select-pane` / `last-pane` (both candidates) |
| active window index changed | `select-window` / `next-window` / `previous-window` / `last-window` (candidates) |
| `window_zoomed_flag` toggled | `toggle-zoom` |
| pane content rotated / positions swapped | `rotate-panes` / `swap-pane` (candidates) |
| windows swapped by index | `swap-window` |
| a pane joined from another window (pane count +1 and a window lost a pane / closed) | `join-pane` |
| paste buffer now contains the step's `seedInput` **and** a paste landed in the focused pane | `copy-paste-sequence:<seedInput>` |
| informational (no state delta): `list-*`, `show-time`, `display-panes`, `list-keys`, `show-buffer`, `capture-pane`, `list-buffers`, `delete-buffer` | detected via the specific command's hook/notification or command-prompt echo; candidate = the bare command name |

For **input commands** the required input is known from the decrypted step, so the candidate is fully
formed (`rename-window:<requiredInput>`). For **ambiguous** deltas, emit *all* plausible candidates.

**Verification (the safety net).** For each candidate `a`, compute `K(n+1)=HKDF(Kn,SHA256(a),
"step-{n+1}")` and trial-decrypt step `n+1` (exactly the web `submitAnswer` check). The candidate that
decrypts is correct → advance and update the status line. If none decrypt, it was the wrong action or
wrong input → show "not quite, try again" feedback (the prompt stays). This means detection only needs
to **include** the right candidate, not classify perfectly — robust against tmux-version quirks.

Because the answer's input portion is server-delivered and the command set is a small fixed pool, the
candidate space per step is tiny; trial-decrypt is O(candidates) cheap local AES-GCM.

**Completion.** When the last step's key is derived (all steps consumed), the controller has
`Kfinal`; it POSTs `finish` with `proofB64`, then `record` if applicable (see §6). Duration is
**server-authoritative** (from the `start` cookie's `startTime`), so the CLI cannot fake timing.

### 5.4 Practice mode (offline)

- Uses bundled `practice-flow.ts` items (per-category command drills + the copy/paste sequence). No
  server, no crypto, no leaderboard.
- Same isolated-tmux + status-line prompt + state-diff detection engine as challenges, but "correct"
  is decided by directly matching the observed action to the practice step's `commandName` /
  `CopyModeAction` (no key chain). Advances through the item's steps; no timing/submission.
- Fully functional with no network (acceptance: works offline).

### 5.5 tmux prerequisite handling

- On `challenge`/`practice` start: check `tmux -V`; require a reasonable minimum (e.g. ≥ 3.0 for
  hooks/format coverage). If missing/too old, print an actionable install hint and exit non-zero.
- Document supported platforms: macOS, Linux, WSL. tmux is not native to Windows (WSL required) —
  documented on the CLI page and in `help`.

---

## 6. End-to-end challenge flow in the CLI

1. `tmux-speedrun challenge 0`:
   - Load stored session token (if any) for authenticated submission.
   - `POST /api/challenge/start` `{ challengeId, clientPublicKeyJwk }` (ECDH keypair generated
     locally); capture `tmux_challenge_session` cookie; derive `K0`; decrypt step 0.
   - Spin the isolated tmux server + controller; attach the user; show step 0 in the status line.
   - As the user acts, detect → trial-decrypt → advance (§5.3), updating the prompt each step.
   - On completion: `POST /api/challenge/finish` `{ proofB64 }` (sending `tmux_session` if logged in
     and `tmux_challenge_session`).
     - Signed-in ⇒ `recorded:true` with `username` + rank → print confirmation.
     - Anonymous ⇒ `recorded:false` + provisional rank. Prompt: "Save your time?" → if the user runs
       `tmux-speedrun login` (or is already logged in) then `POST /api/challenge/record` (sends
       `tmux_pending_result` + `tmux_session`) to record under the verified username; else offer to
       save as Anonymous by calling `record` without a session token (server records `username:null`).
   - Tear down the isolated server; print final placement + a link to the web leaderboard.

---

## 7. Website CLI documentation page

- New route `src/routes/cli/+page.svelte` documenting: install (`npm i -g tmux-speedrun` / `npx`),
  the command list, `login` (browser OAuth) flow, the **isolation guarantee** (dedicated tmux server
  on a private socket, torn down on exit; your real sessions are never touched), and supported
  platforms. Match existing page/layout styling (Tailwind; see `tmux-conf/+page.svelte` as a
  structural reference).
- Add a nav link to the CLI page in `src/routes/+layout.svelte` (mirror how existing routes are
  linked). Keep copy consistent with `README.md`.
- Optionally add `+page.ts`/metadata for title/OG; reuse existing patterns. No server data needed
  (static content).

---

## 8. Files to change / add

**New CLI package (`cli/`):**
- `cli/package.json` (name `tmux-speedrun`, `bin`, `type:module`, build/test scripts, `engines`),
  `cli/tsconfig.json`, `cli/tsup.config.ts`.
- `cli/src/index.ts` (arg routing + `help`), `cli/src/commands/{login,logout,whoami,leaderboard,
  practice,challenge}.ts`.
- `cli/src/api/client.ts` (fetch + cookie jar + base URL), `cli/src/api/challenge-session.ts`
  (CLI transport reusing `challenge-core`), `cli/src/auth/{loopback-server,token-store}.ts`.
- `cli/src/tmux/{server.ts (isolated socket lifecycle),config.ts (generated conf+hooks),
  observer.ts (state query+diff),detector.ts (delta→candidates),controller.ts}.ts`.
- `cli/src/ui/{status-line,leaderboard-table,prompts}.ts`.
- `cli/README.md`.

**Shared/refactor (web app):**
- `src/lib/client/challenge-core.ts` — extract pure key-chain/step helpers from `challenge.ts`;
  update `challenge.ts` to import them (no behavior change). Existing `challenge.test.ts` must still
  pass.
- `pnpm-workspace.yaml` — add the `cli` package.

**Backend (auth loopback):**
- `src/routes/api/auth/cli/login/+server.ts` — new.
- `src/routes/api/auth/github/callback/+server.ts` — adapt for CLI loopback redirect.
- `src/lib/server/auth/cli-login.ts` — new (sign/verify CLI-login state; loopback URL guard).
- `src/lib/server/env.ts` — add `CLI_LOGIN_COOKIE_NAME` + options.

**Website:**
- `src/routes/cli/+page.svelte` — new docs page; `src/routes/+layout.svelte` — nav link.

**Docs:**
- Update root `README.md` to mention the CLI + link the docs page.

---

## 9. Risks & edge cases

- **R1 — Action detection completeness (highest risk).** tmux hook availability varies by version and
  some pool commands (informational/read-only) produce no state delta. Mitigation: the poll +
  **trial-decrypt verifier** guarantees correctness of any candidate we produce; the open task is
  ensuring the right candidate is *generated* for every one of the ~40 pool commands. The
  interface/impl stage must build an explicit, empirically-verified mapping table against a real tmux,
  with an integration test per command family. Ambiguous deltas emit multiple candidates.
- **R2 — Isolation teardown must be bulletproof.** Any exit path (signal, crash, completion) must
  `kill-server` the isolated socket and never the default one. Signal handlers + `try/finally` +
  idempotent cleanup; integration test proves the default server is untouched. (Hard requirement.)
- **R3 — Loopback auth security.** Strict loopback guard (127.0.0.1/localhost only), `cli_state`
  CSRF, single-use signed `tmux_cli_login` cookie, token only over loopback. Fall back to home
  redirect (never open-redirect) if the guard fails. Port-in-use / browser-can't-open ⇒ print the URL
  to paste manually; login timeout with a clear message.
- **R4 — Cookie handling.** httpOnly cookies are carried by the CLI's jar (reading
  `getSetCookie()`); `secure` cookies require https in prod (satisfied). Verify Node `fetch`
  `Set-Cookie` parsing (use `headers.getSetCookie()` in Node 22).
- **R5 — Crypto parity.** The CLI's key chain must match the server byte-for-byte. Mitigated by
  reusing `src/lib/crypto` + `challenge-core` unchanged and adding a parity test (start against a
  local dev server, complete a scripted run, assert `finish` accepts the proof).
- **R6 — Duration/anti-cheat.** Timing is server-side (cookie `startTime` → `finish`); the CLI can't
  fake it. The pre-existing property that a client knows `requiredInput` is unchanged (out of scope to
  alter the crypto scheme). The CLI faithfully requires real native-tmux actions.
- **R7 — Importing app modules into a Node bundle.** `practice-flow.ts`/`pools.ts` must not
  transitively pull browser-only code. Verify at build; if needed, split leaf type modules. Bundling
  (tsup) resolves `$lib` aliases at build time so the published package is standalone.
- **R8 — Non-TTY / CI.** Interactive modes require a TTY; detect and degrade gracefully.
- **R9 — Windows.** tmux needs WSL; documented. CLI still installs; `challenge`/`practice` guard on
  `tmux -V`.
- **R10 — Working-tree cleanliness.** Do not commit build output (`cli/dist`), caches, or lockfile
  churn beyond an intentional `cli` dependency addition; add `cli/dist` etc. to `.gitignore`.

---

## 10. Testing

**Unit (fast, no tmux/network):**
- `challenge-core` key-chain parity (reuse/extend existing `crypto.test.ts` / `challenge.test.ts`).
- Detector: feed synthetic `(prevState, newState, buffer)` deltas → assert candidate answer sets
  (all mappings in §5.3, including ambiguous multi-candidate cases and copy-paste).
- Cookie jar: parse `Set-Cookie`, replay, expiry/secure handling.
- Loopback guard (`cli-login.ts`): accept `http://127.0.0.1:<valid port>/callback`; reject absolute
  hosts, non-loopback, bad schemes/ports, control chars (analogous to `return-to.test.ts`).
- Arg parsing / `help` output; leaderboard table + `--json` rendering.

**Server tests (Vitest, existing harness):**
- `GET /api/auth/cli/login` sets `tmux_oauth_state` + signed `tmux_cli_login`, redirects to GitHub.
- Callback: with a valid `tmux_cli_login`, redirects to the loopback URL carrying the token, only for
  allowed loopback targets; with a disallowed target, falls back to home (no open redirect); clears
  the cookie (single-use). State-mismatch → existing error path. Non-CLI flow unchanged.

**Integration (gated on tmux; likely a separate opt-in script/CI job):**
- Isolated-server lifecycle: create socket, run scripted tmux commands, assert detector emits correct
  canonical actions per pool command; teardown kills only the isolated socket (create a default-socket
  session first, assert it survives `kill-server` inside the isolated one — proves R2/acceptance).
- Full challenge E2E against a local dev server + test DB: `start`→scripted actions→`finish`→row
  recorded; anonymous→`record`→row; authenticated path stamps the verified username.

**Website:** `cli/+page.svelte` renders; nav link present (mirror `home-page.browser.test.ts`
patterns as applicable).

---

## 11. Acceptance-criteria mapping

- Installable CLI + working `help` → §3.1/§3.2, packaging, help test.
- `login` completes browser OAuth, stores usable session → §4.2/§4.3.
- Start+complete a challenge end-to-end against native tmux, time recorded under verified username →
  §5/§6 + E2E test.
- Practice works offline → §5.4.
- Leaderboard viewable from CLI → `leaderboard` command (§3.2) via `GET /api/leaderboard`.
- Isolated tmux server, provably separate, torn down on exit; prompted `kill-session` can't touch real
  sessions → §5.1/R2 + isolation test.
- CLI documentation page on the website → §7.

---

## 12. Scope flags

- **needs_backend: true** — the CLI (Node/TypeScript) is backend work; plus new/adapted auth
  endpoints (`/api/auth/cli/login`, GitHub callback), new server auth helper + env constants, and the
  `challenge-core` refactor.
- **needs_frontend: true** — new website CLI documentation page (`src/routes/cli/+page.svelte`) and a
  nav link in `+layout.svelte`.
