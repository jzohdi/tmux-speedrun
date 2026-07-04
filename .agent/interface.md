# Interface: `tmux-speedrun` CLI (native tmux, GitHub-authenticated leaderboard)

Issue: jzohdi/tmux-speedrun#35 · Plan: `.agent/plan.md`

> This spec **replaces** the previous `.agent/interface.md` (which documented the shipped #34/#36
> GitHub sign-in work). It pins the types, signatures, module boundaries, data shapes, and invariants
> the `tdd` and implementation stages build against. Where an existing module is quoted, its current
> behaviour is normative and must not change unless this spec says "adapt"/"new".

Legend: **NEW** = create · **ADAPT** = modify existing (keep old behaviour on the non-CLI path) ·
**REUSE** = import unchanged.

## 0. Module map

```
cli/                                   NEW pnpm workspace package, name "tmux-speedrun"
  package.json  tsconfig.json  tsup.config.ts  README.md
  src/
    index.ts                           arg routing + dispatch + help
    args.ts                            parseArgs(): GlobalOptions + command + positionals
    config.ts                          runtime config (API base URL, paths, constants)
    commands/{help,login,logout,whoami,leaderboard,practice,challenge}.ts
    api/
      client.ts                        ApiClient: fetch wrapper + in-memory CookieJar
      cookie-jar.ts                    CookieJar: parse Set-Cookie, emit Cookie header
      challenge-session.ts             CliChallengeSession (transport over challenge-core)
    auth/
      token-store.ts                   read/write ~/.config/tmux-speedrun/session.json (0600)
      loopback-server.ts               localhost OAuth callback receiver
    tmux/
      server.ts                        IsolatedTmuxServer: socket lifecycle + teardown
      config.ts                        generate isolated tmux.conf (+ hooks)
      client.ts                        low-level `tmux -L <sock> ...` exec helpers
      observer.ts                      TmuxObserver: query state, diff → StateDelta
      detector.ts                      deriveCandidates(delta, step) → string[]
      controller.ts                    ChallengeController / PracticeController run loops
    engine/types.ts                    TmuxState, PaneInfo, StateDelta, etc.
    ui/{status-line,leaderboard-table,prompts,output}.ts

src/lib/client/challenge-core.ts       NEW pure key-chain/step helpers (extracted)
src/lib/client/challenge.ts            ADAPT to import from challenge-core (no behaviour change)
src/lib/server/auth/cli-login.ts       NEW sign/verify CLI-login state + loopback URL guard
src/routes/api/auth/cli/login/+server.ts   NEW GET endpoint
src/routes/api/auth/github/callback/+server.ts  ADAPT for CLI loopback branch
src/lib/server/env.ts                  ADAPT add CLI_LOGIN_COOKIE_* constants
src/routes/cli/+page.svelte            NEW docs page
src/routes/+layout.svelte              ADAPT add nav link
pnpm-workspace.yaml                    ADAPT add `cli`
```

---

## 1. Shared crypto core — `src/lib/client/challenge-core.ts` (NEW, refactor)

Extract the **pure** key-chain/step functions from `challenge.ts` so both the web `ChallengeSession`
and the CLI import identical logic. **No behaviour change**: `challenge.ts` re-imports these and keeps
its own `fetch(..., credentials:'include')` transport. Existing `challenge.test.ts` and
`crypto.test.ts` must still pass.

Types (moved verbatim from `challenge.ts`):

```ts
export type DecryptedStep = { prompt: string; requiredInput?: string; seedInput?: string };
export type EncryptedStep = { index: number; nonceB64: string; ciphertextB64: string };
```

Functions (exported; signatures preserve current semantics — see `challenge.ts:333-384`):

```ts
// K0 = HKDF(sharedSecret, sessionSalt, "k0", 32)
export function deriveK0(sharedSecret: ArrayBuffer, sessionSalt: Uint8Array): Promise<ArrayBuffer>;

// K(n+1) = HKDF(Kn, SHA256(answer), `step-${stepIndex+1}`, 32)
export function deriveNextKey(currentKey: ArrayBuffer, answer: string, stepIndex: number): Promise<ArrayBuffer>;

// AES-GCM decrypt + JSON.parse → DecryptedStep. Throws on wrong key (auth-tag failure).
export function decryptStep(key: ArrayBuffer, step: EncryptedStep): Promise<DecryptedStep>;

export function formatDuration(ms: number): string; // "12.3s" | "1m 23.4s"
```

`challenge.ts` after refactor: imports `deriveK0`/`deriveNextKey`/`decryptStep`/`formatDuration` and
the two types from `./challenge-core`, deletes its local copies, and re-exports the types + the moved
symbols it previously exported (`DecryptedStep`, `EncryptedStep`, `formatDuration`) so no other
importer breaks. `ChallengeState`, `ChallengeResult`, `RecordResult`, `ChallengeSession`,
`recordChallenge` **stay** in `challenge.ts` (browser transport).

Crypto primitives (`src/lib/crypto/**`: `hkdf`, `sha256`, `aesGcmDecrypt`, ECDH, base64 utils) are
**REUSE**d unchanged — all Web-Crypto globals available in Node ≥ 20.

**Invariant CC1 — byte-parity.** The CLI's derived `Kfinal` must equal the server's expected proof
byte-for-byte; achieved solely by reusing these functions + `src/lib/crypto`. Any divergence is a bug.

---

## 2. CLI API client + cookie jar — `cli/src/api/`

### 2.1 `cookie-jar.ts` (NEW)

```ts
export type StoredCookie = { name: string; value: string };

export class CookieJar {
  /** Ingest a response's Set-Cookie headers. Use response.headers.getSetCookie() (Node ≥ 20). */
  storeFromResponse(res: Response): void;
  /** Ingest raw Set-Cookie header lines (testable entry point). */
  storeSetCookies(setCookieLines: string[]): void;
  /** Serialize all live cookies as a single Cookie request-header value, or undefined if empty. */
  header(): string | undefined;
  get(name: string): string | undefined;
  set(name: string, value: string): void;   // manual seed (e.g. tmux_session from token store)
  clear(): void;
}
```

Parsing rules: split each Set-Cookie on `;`; the first `k=v` pair is the cookie. A cookie whose
attributes include `Max-Age=0` or an already-past `Expires` is treated as a **delete** (remove from
jar). Ignore `Domain`/`Path`/`Secure`/`HttpOnly`/`SameSite` for matching (single-origin client). A
later Set-Cookie for the same name overwrites. No persistence — memory only for one command run.

### 2.2 `client.ts` (NEW)

```ts
export type ApiClientOptions = { baseUrl: string; jar?: CookieJar; sessionToken?: string };

export class ApiClient {
  constructor(opts: ApiClientOptions);
  readonly jar: CookieJar;

  /** JSON POST/GET. Attaches Cookie header from jar (+ tmux_session when sessionToken set),
   *  stores Set-Cookie from the response, parses JSON. Throws ApiError on non-2xx. */
  postJson<T>(path: string, body: unknown): Promise<T>;
  getJson<T>(path: string): Promise<T>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage?: string;   // from response body { message } when present
}
```

- `baseUrl` from `resolveConfig` (§10). All paths join onto it (`/api/...`).
- When `sessionToken` is set, the request sends `Cookie: tmux_session=<token>` merged with jar
  cookies — this carries `locals.user` for authenticated `finish`/`record` with **no server change**
  (plan §4.1).
- `secure` cookies require an `https` base in prod; `http://localhost` for dev works (non-secure).

---

## 3. CLI challenge session — `cli/src/api/challenge-session.ts` (NEW)

Node/CLI analogue of the browser `ChallengeSession`, using `challenge-core` + `ApiClient`. Mirrors the
crypto flow in `challenge.ts:121-283` exactly; differs only in transport (explicit base URL + cookie
jar instead of `credentials:'include'`).

```ts
export type StartResponse = {
  serverPublicKeyJwk: JsonWebKey;
  sessionSaltB64: string;
  steps: EncryptedStep[];
};

// Finish/record shapes mirror the server (finish/+server.ts, record/+server.ts):
export type FinishResponse = {
  valid: boolean; durationMs: number;
  recorded?: boolean; leaderboardPosition?: number; username?: string | null; message?: string;
};
export type RecordResponse = { recorded: true; leaderboardPosition?: number; username: string | null };

export class CliChallengeSession {
  /** POST /api/challenge/start { challengeId, clientPublicKeyJwk }; derive K0; capture cookies. */
  static start(api: ApiClient, challengeId: number): Promise<CliChallengeSession>;

  /** Decrypt the current (not-yet-solved) step for prompting. */
  decryptCurrentStep(): Promise<DecryptedStep>;

  /** Trial-decrypt step n+1 with K(n+1)=deriveNextKey(Kn, answer, n). On success advance + return
   *  true; on the LAST step accept without a trial-decrypt (mirrors challenge.ts:204-210) and store
   *  Kfinal. On failure return false and stay put. Pure-local; no network. */
  submitAnswer(answer: string): Promise<boolean>;

  isComplete(): boolean;
  currentStepIndex(): number;
  totalSteps(): number;

  /** POST /api/challenge/finish { proofB64 = base64(Kfinal) }. Requires isComplete(). */
  finish(): Promise<FinishResponse>;

  /** POST /api/challenge/record (empty body). Identity resolved server-side from tmux_session. */
  record(): Promise<RecordResponse>;
}
```

`challengeId` validity: 0–5 (`isValidChallengeId`; server also enforces zod `min(0).max(5)`).

**Invariant CS1 — server-authoritative timing.** Duration comes only from the server (`start` cookie
`startTime` → `finish`); the CLI never computes or submits a duration.

---

## 4. Auth: loopback OAuth exchange

### 4.1 Server env additions — `src/lib/server/env.ts` (ADAPT)

```ts
export const CLI_LOGIN_COOKIE_NAME = 'tmux_cli_login';
export const CLI_LOGIN_COOKIE_OPTIONS = {
  httpOnly: true, secure: !dev, sameSite: 'lax' as const, path: '/', maxAge: 60 * 10 // 10 min
};
```

### 4.2 CLI-login state helper — `src/lib/server/auth/cli-login.ts` (NEW)

HMAC-signed state carried through the OAuth round-trip, plus the security-critical loopback guard.
Mirror `session.ts`'s sign/verify shape (base64url payload `.` base64url HMAC-SHA256, key
`getSessionSecret()`).

```ts
export type CliLoginState = { port: number; cliState: string };

/** Sign {port, cliState} into the tmux_cli_login cookie value. */
export function signCliLoginState(state: CliLoginState): Promise<string>;

/** Verify + parse. null on bad signature / malformed / wrong field types (never throws). */
export function verifyCliLoginState(raw: string): Promise<CliLoginState | null>;

/**
 * Return the loopback callback URL ONLY when every constraint holds, else null:
 *   host is 127.0.0.1 or localhost, scheme http, path /callback,
 *   port an integer in [1024, 65535].
 * token + cliState are URL-encoded into the query: ?token=<t>&state=<cliState>.
 * A null return means the callback must fall back to the normal home redirect (never open-redirect).
 */
export function buildLoopbackCallbackUrl(args: { port: number; cliState: string; token: string }): string | null;
```

Input validation for `cliState`: opaque, `[A-Za-z0-9_-]{16,128}`; reject control chars. `port`:
integer string only.

### 4.3 New endpoint — `GET /api/auth/cli/login/+server.ts` (NEW)

Query: `?port=<int>&state=<cliState>`. Steps:
1. Validate `port` (integer in `[1024,65535]`) and `state` (matches `cliState` charset/length). Invalid
   → `redirect(302, '/?auth_error=cli')`.
2. `isGitHubOAuthConfigured()` guard → `redirect(302, '/?auth_error=not_configured')` when false.
3. Set `OAUTH_STATE_COOKIE_NAME` = `generateOAuthState()` (reuse existing OAuth CSRF).
4. Set `CLI_LOGIN_COOKIE_NAME` = `await signCliLoginState({ port, cliState })`.
5. `buildAuthorizeUrl({ clientId, redirectUri: getGitHubRedirectUri(url), state })` → `redirect(302,…)`.

Same fixed callback path (`GITHUB_CALLBACK_PATH`) as the web flow — no new GitHub OAuth App entry.

### 4.4 Adapted callback — `src/routes/api/auth/github/callback/+server.ts` (ADAPT)

After the **existing** state check + code→token exchange + `fetchGitHubUser` + `setSessionCookie(...)`
(all unchanged), insert a CLI branch **before** the final home/return redirect:

```ts
const cliRaw = cookies.get(CLI_LOGIN_COOKIE_NAME);
if (cliRaw) {
  cookies.delete(CLI_LOGIN_COOKIE_NAME, { path: '/' });        // single-use
  const cli = await verifyCliLoginState(cliRaw);
  if (cli) {
    const token = await createSessionToken({ githubId: ghUser.id, username: ghUser.login, iat: Date.now() });
    const loopback = buildLoopbackCallbackUrl({ port: cli.port, cliState: cli.cliState, token });
    if (loopback) redirect(302, loopback);                     // only path the token leaves over
  }
  // guard failed / invalid → fall through to normal home redirect (NO token leak)
}
```

Notes: the browser session cookie is still set (user is logged into the website too — acceptable).
`token` = the same signed session-token type the site uses; `hooks.server.ts`/`finish`/`record`
already trust it (plan §4.2). The non-CLI path (no `tmux_cli_login` cookie) is **byte-identical** to
today. `ghUser` here is the existing local from the callback's `try` block; the CLI branch must sit
inside that scope (after `setSessionCookie`).

**Invariant AUTH1.** The minted token leaves the server only via `buildLoopbackCallbackUrl` returning
non-null (loopback host + http + /callback + valid port). Any other outcome → home redirect. No
client-supplied username ever reaches the leaderboard (identity is `ghUser` from the verified token
exchange).

### 4.5 CLI loopback receiver — `cli/src/auth/loopback-server.ts` (NEW)

```ts
export type LoopbackResult = { token: string };

export type LoopbackServer = {
  port: number;                          // ephemeral port actually bound
  cliState: string;                      // random CSRF, [A-Za-z0-9_-]{32}
  /** Resolves when GET /callback?token=&state= arrives with state === cliState.
   *  Rejects on timeout (default 300s) or state mismatch. Always closes the socket. */
  waitForToken(timeoutMs?: number): Promise<LoopbackResult>;
  close(): void;
};

/** Bind an http server on 127.0.0.1:<ephemeral>. Only GET /callback is handled;
 *  respond with a friendly "You can close this tab" HTML page, then resolve. */
export function startLoopbackServer(): Promise<LoopbackServer>;
```

Bind to `127.0.0.1` (never `0.0.0.0`). On `/callback`: verify `state` query === `cliState` (else 400 +
reject); read `token`; respond 200 HTML; resolve. Reject any other path with 404.

### 4.6 Token store — `cli/src/auth/token-store.ts` (NEW)

```ts
export type StoredSession = { token: string; username: string; githubId: number; savedAt: number };

export function sessionFilePath(): string;                 // <configDir>/session.json
export function loadSession(): StoredSession | null;       // null if absent/unreadable/malformed
export function saveSession(s: StoredSession): void;       // write mode 0600, mkdir -p configDir
export function clearSession(): void;                       // unlink if present (no error if absent)

/** Decode username/githubId locally from a session token WITHOUT verifying the HMAC
 *  (server verifies on use). Returns null on malformed token. */
export function decodeSessionToken(token: string): { githubId: number; username: string } | null;
```

`login` flow (§9.2): start loopback server → open browser to
`<base>/api/auth/cli/login?port=<port>&state=<cliState>` → `waitForToken()` → `decodeSessionToken` →
`saveSession` → print username. If the browser can't open, print the URL to paste manually.

---

## 5. Isolated tmux — `cli/src/tmux/`

### 5.1 Low-level client — `client.ts` (NEW)

```ts
/** Run `tmux -L <socket> [-f <conf>] <args...>`; resolves { stdout, stderr, code }.
 *  Never throws on non-zero exit (callers decide); throws only if tmux is not spawnable. */
export function tmuxExec(socket: string, args: string[], opts?: { conf?: string }): Promise<{ stdout: string; stderr: string; code: number }>;

/** `tmux -V` → parsed { major, minor, raw }. Throws if tmux missing. */
export function tmuxVersion(): Promise<{ major: number; minor: number; raw: string }>;
```

### 5.2 Isolated server lifecycle — `server.ts` (NEW)

```ts
export type IsolatedTmuxServer = {
  socketName: string;                    // e.g. "tmux-speedrun-<random8>" (private, logged)
  confPath: string;                      // generated conf file in a temp dir
  exec(args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
  /** Attach the user's TTY into the isolated server (blocks until detach). */
  attach(target?: string): Promise<void>;
  /** kill-server on THIS socket + remove temp conf/dir. Idempotent; ignores "no server" errors. */
  teardown(): Promise<void>;
};

/** Create the temp conf (§5.3), a unique socket name, and an initial session.
 *  Register teardown on SIGINT/SIGTERM/SIGHUP/exit/uncaughtException (idempotent). */
export function createIsolatedTmuxServer(opts?: { initialSession?: string }): Promise<IsolatedTmuxServer>;
```

**Invariant ISO1 (hard requirement).** Every tmux invocation for a run uses `-L <socketName>` (unique
per run) — the user's default socket is **never** referenced. A prompted `kill-session`/`kill-server`
can only affect this socket. Teardown runs on every exit path (signal, crash, completion) via signal
handlers + `try/finally`, is idempotent, and never touches the default server. Acceptance test:
create a default-socket session, run the isolated server, `kill-server` inside it, assert the
default-socket session survives (plan §5.1/R2).

### 5.3 Generated config — `config.ts` (NEW)

```ts
export type GeneratedConfig = { text: string }; // full tmux.conf text
/** eventSink = FIFO/socket path the hook notifier writes event lines to (§6.2). */
export function buildIsolatedConfig(opts: { eventSink: string }): GeneratedConfig;
```

The conf is independent of the user's `~/.tmux.conf` (passed via `-f`), configures `status-left`/
`status-right` for the prompt/progress/timer, a short `status-interval`, and installs the observer
hooks (§6.2).

### 5.4 tmux prerequisite — enforced in `challenge`/`practice` commands

Require `tmux -V` ≥ **3.0** (hooks/format coverage). Missing/old → actionable message + non-zero exit.
Non-TTY (`!process.stdout.isTTY`) → `challenge`/`practice` refuse with a clear message; `leaderboard`/
`whoami`/`login` still work.

---

## 6. State observation — `cli/src/tmux/observer.ts` + `engine/types.ts`

### 6.1 State model — `engine/types.ts` (NEW)

```ts
export type PaneInfo = {
  paneId: string;          // #{pane_id}, stable e.g. "%3"
  sessionName: string;     // #{session_name}
  windowIndex: number;     // #{window_index}
  windowName: string;      // #{window_name}
  active: boolean;         // #{pane_active}
  left: number; top: number; width: number; height: number; // #{pane_left/top/width/height}
  zoomed: boolean;         // #{window_zoomed_flag}
  inMode: boolean;         // #{pane_in_mode}
};

export type TmuxState = {
  sessions: string[];                 // session names present
  windows: { session: string; index: number; name: string; active: boolean }[];
  panes: PaneInfo[];
  activePaneId: string | null;        // active pane of the active window/session
  activeWindow: { session: string; index: number } | null;
  buffers: string[];                  // list-buffers buffer names (most-recent first)
  topBufferSample?: string;           // show-buffer of buffer 0 (copy-paste detection)
};

export type StateDelta = {
  prev: TmuxState;
  next: TmuxState;
  paneCountDelta: number;             // next.panes.length - prev.panes.length (whole server)
  sessionCountDelta: number;
  windowCountDelta: number;           // across all sessions
  addedPanes: PaneInfo[];
  removedPaneIds: string[];
  renamedWindow?: { from: string; to: string };
  renamedSession?: { from: string; to: string };
  activePaneChanged: boolean;
  activeWindowChanged: boolean;
  activeSessionChanged: boolean;
  zoomToggled: boolean;
  enteredCopyMode: boolean;           // some pane inMode transitioned false→true
  bufferAdded?: string;               // new/changed top buffer content
  bufferRemoved: boolean;
  pasteObserved?: boolean;            // focused pane content gained the step's seedInput
};
```

### 6.2 Observer — `observer.ts` (NEW)

```ts
export class TmuxObserver {
  constructor(server: IsolatedTmuxServer);

  /** Query current state via list-sessions / list-windows -a / list-panes -a (-F formats above),
   *  list-buffers, show-buffer, #{pane_in_mode}. */
  snapshot(): Promise<TmuxState>;

  /** Diff two snapshots into a StateDelta. Pure; testable with synthetic states. */
  diff(prev: TmuxState, next: TmuxState, ctx?: { seedInput?: string }): StateDelta;

  /** Change source: (1) tmux hooks (conf §5.3) write event lines to eventSink;
   *  (2) a 100–200ms poll fallback. Each trigger → snapshot → diff → callback. */
  watch(onDelta: (d: StateDelta) => void): { stop(): void };
}
```

Hooks installed in the generated conf are **triggers only** ("state may have changed"); the observer
always re-queries and diffs — so exhaustive hook coverage is not required (plan §5.3, R1). Poll is the
safety net for informational/read-only commands that emit no hook.

---

## 7. Action detection — `cli/src/tmux/detector.ts` (NEW, core new work)

Convert an observed `StateDelta` into the **candidate canonical answer strings** the key chain expects.
The detector need only **include** the correct candidate; `CliChallengeSession.submitAnswer`'s
trial-decrypt is the source of truth (plan §5.3, "detection only needs to include the right candidate").

```ts
/**
 * Produce candidate canonical answers for a delta, given the current decrypted step.
 * For input commands, `step.requiredInput` is known → candidates are fully formed
 * (`rename-window:<requiredInput>`). For the copy-paste step, `step.seedInput` seeds
 * `copy-paste-sequence:<seedInput>`. Ambiguous deltas emit ALL plausible candidates.
 * Order best-guess first (optimization only; correctness is via trial-decrypt).
 */
export function deriveCandidates(delta: StateDelta, step: DecryptedStep): string[];
```

Canonical answer forms (authoritative — from `generator.ts` + `tmux-copy-sequence.ts`):
- simple command → bare `cmd.name` (e.g. `split-vertical`, `kill-session`).
- input command → `` `${cmd.name}:${requiredInput}` `` (e.g. `rename-window:swift-tiger-42`).
- copy-paste step → `` `copy-paste-sequence:${seedInput}` `` (`COPY_PASTE_SEQUENCE_ACTION`).

Delta → candidate mapping (the pool is the ~40 commands in `TMUX_COMMANDS`):

| Observation | Candidate(s) |
|---|---|
| pane +1; new pane right of sibling (`left` increases, same `top`) | `split-vertical` |
| pane +1; new pane below sibling (`top` increases, same `left`) | `split-horizontal` |
| window +1, same session, no pane left source | `new-window` |
| window +1 **and** a pane left/closed in the source window | `break-pane` |
| pane −1 in a window that remains | `kill-pane` |
| window −1 (window closed, session remains) | `kill-window` |
| session +1 | `new-session` |
| one session disappears (others remain) | `kill-session` |
| all sessions disappear (server empty) | `kill-server` |
| window name changed to `X` | `rename-window:<requiredInput>` (X == requiredInput) |
| session name changed to `X` | `rename-session:<requiredInput>` |
| active pane changed within window | `select-pane`, `last-pane` |
| active window index changed | `select-window`, `next-window`, `previous-window`, `last-window` |
| active session changed | `next-session`, `previous-session` |
| `zoomed` toggled | `toggle-zoom` |
| pane positions rotated | `rotate-panes` |
| two panes swapped positions | `swap-pane` |
| two windows swapped indices | `swap-window` |
| pane +1 and another window lost a pane / closed (pane moved in) | `join-pane` |
| entered copy mode (`inMode` false→true) | `copy-mode` |
| buffer added / top buffer changed | `paste-buffer`, `capture-pane`, `show-buffer`, `list-buffers` |
| buffer removed | `delete-buffer` |
| focused pane gained `seedInput` after a paste (copy step) | `copy-paste-sequence:<seedInput>` |
| detach observed (client detached) | `detach` |
| no state delta (informational) | the specific command name via its hook/echo: `list-sessions`, `list-windows`, `list-keys`, `show-time`, `display-panes`, `capture-pane`, `command-prompt`, `attach-session`, `reload-config` |

Rules:
- Emit **every** plausible candidate for ambiguous deltas; trial-decrypt selects the right one.
- Never invent input for input commands — always use `step.requiredInput`; if the step has
  `requiredInput` but the delta shows no matching rename, emit nothing (wrong input typed).
- Informational commands with no observable delta are the residual risk (R1): the impl stage must
  build an empirically-verified table against real tmux ≥ 3.0, with an integration test per family.

**Invariant DET1.** `deriveCandidates` is pure and deterministic over `(delta, step)` — unit-testable
with synthetic states, no tmux/network.

---

## 8. Controllers — `cli/src/tmux/controller.ts` (NEW)

```ts
export type ChallengeRunResult = { completed: boolean; finish?: FinishResponse; aborted?: boolean };

export class ChallengeController {
  constructor(args: { server: IsolatedTmuxServer; observer: TmuxObserver; session: CliChallengeSession; ui: StatusLine });

  /** Decrypt step 0, render prompt, attach user, and on each delta:
   *  candidates = deriveCandidates(delta, currentStep); for each, session.submitAnswer(c);
   *  first true → advance, decrypt next step, update status line. When isComplete():
   *  session.finish(); detach; return result. Teardown handled by caller (finally). */
  run(): Promise<ChallengeRunResult>;
}

export class PracticeController {
  constructor(args: { server: IsolatedTmuxServer; observer: TmuxObserver; item: PracticeItem; ui: StatusLine });
  /** Same detect loop, but "correct" = observed action matches the practice step's
   *  commandName / CopyModeAction directly (no key chain, no network). Advances through steps. */
  run(): Promise<{ completed: boolean; aborted?: boolean }>;
}
```

The controller runs alongside the attached client (outside it), observing and advancing. On
completion it submits the proof, detaches, and returns; the command layer prints results and runs
teardown in `finally`.

---

## 9. CLI commands + entry — `cli/src/`

### 9.1 Arg parsing — `args.ts` (NEW)

```ts
export type GlobalOptions = { server?: string; noColor: boolean; json: boolean; verbose: boolean };
export type ParsedArgs = { command: string; positionals: string[]; options: GlobalOptions };

/** Hand-rolled (no deps). Recognizes --server <url>, --no-color, --json, --verbose, --help/-h.
 *  Unknown command or --help → command "help". Default (no args) → "help". */
export function parseArgs(argv: string[]): ParsedArgs;
```

### 9.2 Command surface (`index.ts` dispatch)

```
tmux-speedrun help                 list commands (also default / --help / -h)
tmux-speedrun login                browser OAuth via loopback; store verified session
tmux-speedrun logout               clearSession() + best-effort POST /api/auth/logout
tmux-speedrun whoami               print stored username or "anonymous" (--json supported)
tmux-speedrun leaderboard [id]     GET /api/leaderboard; render table(s) (--json supported)
tmux-speedrun practice [category]  offline practice vs isolated native tmux
tmux-speedrun challenge <id>       run challenge 0–5 vs isolated native tmux
```

Each command module exports `run(ctx, positionals): Promise<number>` returning a process exit code:

```ts
export type CommandContext = { api: ApiClient; options: GlobalOptions; session: StoredSession | null };
export type Command = { run(ctx: CommandContext, positionals: string[]): Promise<number> };
```

- `challenge <id>`: `id` must parse to 0–5 (`isValidChallengeId`) else usage error (exit 2). Loads the
  stored session token → seeds `api` with `sessionToken`. On finish: signed-in → print recorded rank;
  anonymous → prompt "Save your time?"; if the user is/becomes logged in → `session.record()`, else
  offer Anonymous `record()` (server records `username:null`). Teardown in `finally`.
- `leaderboard [id]`: no `id` → all challenges; with `id` → that block. `--json` prints raw
  `LeaderboardResponse`.
- Exit codes: `0` success, `1` runtime error, `2` usage error.

### 9.3 `help` output must list all commands above and note the tmux/WSL prerequisite (acceptance: `help`).

---

## 10. Config & local state — `cli/src/config.ts` (NEW)

```ts
export type ResolvedConfig = { baseUrl: string; configDir: string };

/** baseUrl precedence: --server flag > TMUX_SPEEDRUN_API env > pinned production origin constant.
 *  configDir: $XDG_CONFIG_HOME/tmux-speedrun or ~/.config/tmux-speedrun. */
export function resolveConfig(options: GlobalOptions): ResolvedConfig;

export const DEFAULT_API_ORIGIN: string;   // pinned production site origin
```

`session.json` shape = `StoredSession` (§4.6), file mode `0600`. Challenge/pending cookies are
in-memory only (CookieJar), never persisted.

---

## 11. Website docs page

- `src/routes/cli/+page.svelte` (NEW): install (`npm i -g tmux-speedrun` / `npx tmux-speedrun`),
  command list, `login` (browser OAuth) flow, the **isolation guarantee** (dedicated tmux server on a
  private socket, torn down on exit; real sessions never touched), supported platforms (macOS, Linux,
  WSL). Match existing Tailwind page structure (reference `src/routes/tmux-conf/+page.svelte`).
- `src/routes/+layout.svelte` (ADAPT): add a nav link to `/cli` mirroring existing route links.

---

## 12. Practice data (REUSE / verify leaf imports)

`src/lib/data/practice-flow.ts` (`PracticeStep`, `PracticeItem`, `createCopyPastePracticeItem`, the
exported items array), `src/lib/data/tmux-commands.ts` (`TMUX_COMMANDS`, `TmuxCommand`),
`src/lib/server/challenges/pools.ts`, `src/lib/utils/tmux-copy-sequence.ts` are imported by the CLI
build. **R7 check:** `practice-flow.ts` imports types from `$lib/utils/tmux-commands` (`CommandIdType`)
and `$lib/utils/tmux-conf` (`CopyModeAction`). Confirm these transitively pull **no** browser-only code
into the Node bundle; if they do, split the needed leaf types into a dependency-free module. `tsup`
resolves `$lib` aliases at build time so the published package is standalone.

---

## 13. Packaging & tree cleanliness

- `cli/package.json`: `name: "tmux-speedrun"`, `type: "module"`,
  `bin: { "tmux-speedrun": "./dist/index.js" }` (shebang `#!/usr/bin/env node`), `engines.node >= 20`,
  build (`tsup`) + test scripts. Runtime deps minimal (ideally zero beyond Node built-ins; browser-open
  is a 3-line `open`/`xdg-open`/`start` shim).
- `pnpm-workspace.yaml`: add `cli` to `packages`.
- `.gitignore`: add `cli/dist`, coverage, tmux temp artifacts. **Do not** commit build output or
  lockfile churn beyond an intentional `cli` dependency addition (plan §R10).

---

## 14. Invariant summary (must hold end-to-end)

- **CC1** crypto byte-parity via reuse of `challenge-core` + `src/lib/crypto`.
- **CS1** duration is server-authoritative (never CLI-supplied).
- **AUTH1** minted session token leaves the server only over the loopback guard; no client-supplied
  username; non-CLI OAuth path unchanged.
- **ISO1** all tmux ops on a unique private socket; bulletproof idempotent teardown on every exit
  path; user's default server provably untouched (hard requirement).
- **DET1** `deriveCandidates` pure/deterministic; trial-decrypt is the correctness authority.
- **NOSPOOF** no request body ever supplies a leaderboard username (mirrors existing finish/record
  server behaviour — unchanged).

---

## 15. Test surface handed to `tdd`

Unit (no tmux/network): `challenge-core` key-chain parity; `deriveCandidates` over synthetic deltas
(every §7 mapping incl. ambiguous multi-candidate + copy-paste); `CookieJar` parse/replay/delete;
`buildLoopbackCallbackUrl` accept 127.0.0.1/localhost + valid port, reject absolute host / non-loopback
/ bad scheme / bad port / control chars (analogous to `return-to.test.ts`); `parseArgs`; leaderboard
table + `--json`; `decodeSessionToken`. Server (Vitest): `GET /api/auth/cli/login` sets both cookies +
redirects to GitHub; callback with a valid `tmux_cli_login` → loopback redirect carrying the token,
only for allowed targets, clears the cookie (single-use), disallowed target → home; non-CLI flow
unchanged. Integration (tmux-gated): isolated-server lifecycle + teardown proves ISO1; detector per
pool-command family; full challenge E2E against a local dev server.
