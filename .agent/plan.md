# Plan: Make CLI challenge runs playable end-to-end (issue #45)

Issue: jzohdi/tmux-speedrun#45

> This plan replaces the previous `.agent/plan.md` (which covered the now-merged issue #35/#41 CLI
> work, commit `5cca21f`). The existing `.agent/interface.md` also belongs to that shipped work; the
> interface stage for this issue will overwrite it. All work is in `cli/` — the web app, API, and
> challenge generator are **not** changed (the encrypted step chain and canonical answer strings are
> shared with the web and must stay byte-identical).

---

## 1. Goal (restated)

`tmux-speedrun challenge <id>` (added in #41) is currently unwinnable. Three reported defects plus
several same-kind blockers make every run fail:

1. **Stacked prompts** — multiple step prompts visible at the bottom of the screen at once instead
   of exactly one, replaced in place.
2. **"Switch to window by number" never completes** — pressing `prefix + <n>` does not advance.
3. **Run dies on `detach` / `kill-session`** — any step that exits the tmux attach tears the run
   down or leaves it in limbo.

Fix these so challenge (and practice) runs are reliably completable end-to-end: one visible prompt
at all times, every pool command detectable, and a run lifecycle decoupled from any single tmux
attach — with no orphaned private servers on any exit path.

## 2. Root-cause analysis (verified against the code)

### 2.1 Defect 3 — lifecycle is coupled to a single attach (fix first; the others live inside it)

- `server.attach()` (`cli/src/tmux/server.ts:83`) resolves whenever the tmux client process exits —
  for **any** reason. `ChallengeController.run()` (`cli/src/tmux/controller.ts:76-87`) treats that
  as end-of-run, stops the watcher, and returns; `challenge.ts` then tears the server down in
  `finally`. So a `detach` or `kill-session` step ends the run instead of advancing it.
- The generated config (`cli/src/tmux/config.ts`) does **not** set `exit-empty off`, so killing the
  last session kills the private server (tmux default). After that every observer exec fails and is
  silently swallowed (`observer.ts:180` catch), so the kill can never even be *observed*: the
  detector's `kill-session` candidate requires a post-kill snapshot showing fewer sessions, which
  requires a running server.
- The detector has **no candidate at all for `detach`** (`#{session_attached}` is fetched but
  unused), so even a surviving run could not advance a detach step.

### 2.2 Defect 2 — select-window by number is undetectable in the common case

- The run starts with a single window (index 0). The step prompt is generic ("Select a window by
  number" — `prompt-variations.ts`), so the natural action is `prefix + 0`, which runs
  `select-window -t :=0` on the already-active window → **no state change** → `hasChange()` is
  false (`observer.ts:208`) → no delta → no candidate → the step can never advance. The existing
  `select-window` candidate (`detector.ts:91-96`) only fires on `activeWindowChanged`.
- The config already installs an `after-select-window` hook that writes to the event sink — but
  **nothing ever reads the sink** (`observer.watch` is poll-only; the sink file only grows).
  Reading it gives exact, targeted discrimination for free: `prefix + 0-9` runs the
  `select-window` command (own after-hook) while `prefix + n/p/l` run `next-window` /
  `previous-window` / `last-window` (distinct commands, distinct after-hooks).

### 2.3 Defect 1 — prompt rendering is race-prone and never re-asserted

- The prompt is rendered by re-running `set -g status-left '<text>'` from an outside command client
  on every advance (`cli/src/ui/status-line.ts:15-18`), driven by a watcher that can fire several
  deltas per action; there is no re-assertion after client exit/re-attach, and nothing enforces a
  single status row. The exact visual mechanism of the stacking must be pinned by reproduction
  (mandated in §5, step 0), but the fix is structural regardless: make tmux itself own the render
  from a single source of truth (a user option referenced once by `status-left`), update only that
  option per step, serialize updates, and re-apply the current prompt on every re-attach/recovery
  in the new lifecycle loop.

### 2.4 Same-kind blockers ("possibly more" — confirmed by auditing the pool against the detector)

Challenge 0's generator guarantees **every** beginner command appears at least once
(`generator.ts` step 2; pool = all 16 beginner commands), so every challenge-0 run contains steps
that today emit **no candidate ever**:

| Step (canonical answer) | How the user performs it | Why undetected today |
|---|---|---|
| `detach` | `prefix + d` | no state change; no candidate; kills attach (§2.1) |
| `attach-session` | re-attach after detach (runner does it), or `switch-client -t` | no candidate; in-pane `tmux attach` is refused (nested `$TMUX`) |
| `list-sessions` | `tmux ls` typed in a pane (targets the isolated server via `$TMUX`) | no state change |
| `list-windows` | `prefix + w` (runs `choose-tree -Zw`) or `tmux lsw` | tree mode sets `pane_in_mode` → wrongly emits only `copy-mode` |
| `show-time` | `prefix + t` (runs `clock-mode`) | clock mode → wrongly emits only `copy-mode` |
| `kill-session` (last session) | `tmux kill-session` | server exits (no `exit-empty off`) → unobservable (§2.1) |
| `select-window` (no-op case) | `prefix + 0` | §2.2 |

Higher pools add more of the same kind: `list-keys`, `display-panes`, `command-prompt`,
`reload-config` (`source-file`), `kill-server` (server death — currently fatal), and silent-state
commands `swap-pane`, `swap-window`, `rotate-panes`, and `join-pane` (join **moves** an existing
pane — pane ids don't change, so the current heuristic at `detector.ts:82` never fires). These all
need the same command-event detection channel; fix them in this pass since it's the same code path
(the issue explicitly asks to fix same-kind blockers found here).

## 3. Approach & architecture

Three coordinated changes, lifecycle-first (they share the attach/watch loop):

### 3.1 Run-loop lifecycle (defect 3)

Replace "attach once → teardown when the client exits" with a **run loop** that owns recovery and
only ends on completion, explicit abort, or launcher death:

```
while (!complete && !aborted):
    ensure private server alive        # restart on same socket via `new-session -d` (re-sources conf) if kill-server happened
    ensure ≥1 session exists           # create fresh session if kill-session emptied the server
    re-apply current step prompt       # idempotent
    observer.resetBaseline()           # never diff across a recovery boundary (runner-made sessions must not look like user actions)
    attach → wait for client exit
    drain sink events + one snapshot/diff pass   # classify WHY the client exited, BEFORE recovering infra
    submit resulting candidates        # 'detach', 'kill-session', 'kill-server', … may advance the step
    if !complete: print one-line notice + ~1s pause before re-attach ("Ctrl-C to quit")
```

Key mechanics:

- **`set -g exit-empty off`** in the generated config so the private server survives zero sessions;
  `kill-session` becomes observable (`sessions → []`) and recovery is just `new-session -d`.
- **Server death = a signal, not an error**: when execs fail with "no server running" (or the
  socket vanishes), synthesize a `kill-server` (+ `kill-session`) candidate, submit, then restart
  the server **on the same private socket** with the same conf (`-f` is passed on every exec, so a
  restart re-sources hooks). Never touch the default socket (preserves invariant ISO1).
- **Abort semantics** (matches the issue exactly): SIGINT/SIGTERM/SIGHUP handlers already tear down
  (`server.ts:56-73`) — closing the launching terminal SIGHUPs Node → `kill-server` → no orphans.
  The ~1s pre-re-attach pause is the deliberate window where Ctrl-C reaches the Node process for an
  explicit abort. Guard against tight loops: N consecutive attach failures without progress → abort
  with a clear error.
- **Completion path unchanged in spirit**: on final step the controller detaches the client
  (suppressed from detection, see §3.2), loop sees `isComplete()`, `finish()` runs, `finally`
  teardown as today.
- Extract the loop so **`ChallengeController` and `PracticeController` share it** (practice has the
  identical defect — `createPracticeItems` covers `detach`/`kill-session` drills; practice.ts:60
  currently treats any detach as "stop the run"). Keep practice's per-item server; put the loop
  inside each item. Design the loop against injected `server`/`observer`/`clock` so it is unit
  testable with fakes.

### 3.2 Command-event detection channel (defect 2 + §2.4)

The sink becomes a real channel instead of a write-only file:

- **Config** (`config.ts`): expand `HOOK_EVENTS` to cover every pool command's underlying tmux
  command: `after-select-window`, `after-next/previous/last-window`, `after-select-pane`,
  `after-last-pane`, `after-list-sessions/-windows/-keys/-buffers`, `after-show-buffer`,
  `after-delete-buffer`, `after-capture-pane`, `after-display-panes`, `after-clock-mode`,
  `after-choose-tree`, `after-command-prompt`, `after-source-file`, `after-swap-window/-pane`,
  `after-rotate-window`, `after-join-pane`, `after-kill-session/-window/-pane`,
  `after-attach-session`, `after-switch-client`, plus notification hooks `client-attached` /
  `client-detached`. Each writes its hook name as a line to the sink (as today).
- **Observer** (`observer.ts`): tail the sink (byte-offset reads on each tick + a drain call the
  run loop invokes at exit-classification time, with a short settle retry since `run-shell` is
  async). Expose new `StateDelta.commandEvents: string[]`. Add `#{pane_mode}` to `PANE_FORMAT` so
  copy / clock / tree / view modes are distinguishable. Add `resetBaseline()`.
- **Runner self-suppression** (critical): the observer's own poll runs `list-sessions`,
  `list-panes`, `list-buffers`, `show-buffer` every 150ms, and the controller runs `detach-client`
  and recovery `new-session` — with the new hooks these would spuriously satisfy `list-sessions` /
  `show-buffer` / `detach` / `new-session` steps instantly. Primary mechanism: an exec-accounting
  suppression queue — every runner exec of a hooked command pushes its expected event name(s); sink
  reading skips one matching entry. This is deterministic and tmux-version-independent (do **not**
  rely on `#{client_tty}`/`#{hook_client}` expansion in hook commands; may be used later as
  refinement only). Note tmux does not fire `after-` hooks for commands run *from* hooks, so the
  hooks' own `run-shell`s don't recurse.
- **Detector** (`detector.ts`): add a pure event→candidate table on top of the existing state-diff
  candidates (over-emission is always safe — trial-decrypt in `challenge-session.ts` is the
  authority): `after-select-window → select-window` (fixes defect 2 for the no-op case, keeps the
  targeted-vs-generic distinction), `after-choose-tree → list-windows, list-sessions`,
  `after-clock-mode → show-time`, `after-list-keys → list-keys`, `client-detached → detach`,
  `client-attached / after-attach-session / after-switch-client → attach-session`,
  `after-join-pane → join-pane`, `after-swap-pane → swap-pane`, `after-swap-window → swap-window`,
  `after-rotate-window → rotate-panes`, `after-source-file → reload-config`,
  `after-display-panes → display-panes`, `after-command-prompt → command-prompt`, etc.
  Also from state: use `pane_mode` so `copy-mode` is emitted only for real copy/view mode (clock
  and tree modes map to `show-time` / `list-windows`+`list-sessions`); on cascade kills
  (session/window disappeared) additionally emit `kill-window` / `kill-pane` / `kill-session` /
  `kill-server` together — the key chain filters. Synthetic events from the run loop
  (`server-died → kill-server`) enter through the same table.
- **Verification & fallback**: generic `after-<command>` hooks are expected on tmux ≥ 3.0
  (preflight minimum), but the implementer must verify each mapped hook actually fires on a real
  tmux 3.x (script it: run command → assert sink line). For any that don't (interactive commands
  like `display-panes`/`command-prompt` are candidates for gaps), fall back to explicit key
  **rebinds in the generated config** that run the default command plus the sink logger — the
  isolated config owns the server, so rebinds are safe and invisible to the user. State-diff
  candidates remain as a safety net throughout.

### 3.3 Prompt rendering (defect 1)

- Config declares `set -g status-left '#{@speedrun_prompt}'` **once**, statically (plus existing
  `status on`, `status-left-length`; sanitize length cap aligned to the configured 120 — today's
  code slices at 160). `StatusLine.setPrompt` becomes a single `set -g @speedrun_prompt '<text>'`;
  tmux owns the redraw. `clear()` likewise sets the option.
- The run loop **re-applies the current prompt** before every (re-)attach and after every recovery,
  so a recreated server/session always shows exactly the current step.
- Prompt updates stay inside the watcher's `advancing` critical section (already the case) so they
  are ordered; the loop's drain-then-recover sequencing removes the poll/hook double-fire races the
  triage note points at.
- **Reproduction is step 0 of implementation** (see §5): reproduce the stacking on challenge 0
  before the fix, confirm exactly-one-prompt after, and record what the mechanism was. If the
  observed mechanism is something this restructure does not cover (e.g. terminal-emulator redraw
  artifact), address it then — but the single-source-of-truth render is wanted regardless.

## 4. Files to change

| File | Change |
|---|---|
| `cli/src/tmux/config.ts` | `exit-empty off`; static `status-left '#{@speedrun_prompt}'`; expanded hook list (+ any fallback rebinds) |
| `cli/src/tmux/server.ts` | `isAlive()`/restart-on-same-socket primitive; `attach()` exit info; keep teardown + signal handlers (unchanged semantics) |
| `cli/src/tmux/observer.ts` | sink tailing + drain; suppression queue; `commandEvents` in deltas; `#{pane_mode}` in `PANE_FORMAT`; `resetBaseline()` |
| `cli/src/engine/types.ts` | `StateDelta.commandEvents`; `PaneInfo.mode` |
| `cli/src/tmux/detector.ts` | event→candidate table; mode-kind mapping; cascade-kill and moved-pane over-emission |
| `cli/src/tmux/controller.ts` | run-loop refactor shared by challenge + practice; exit classification; synthetic `kill-server`; prompt re-assertion; re-attach notice + abort window; loop-failure guard |
| `cli/src/ui/status-line.ts` | write `@speedrun_prompt` instead of `status-left`; align sanitize cap |
| `cli/src/commands/challenge.ts`, `cli/src/commands/practice.ts` | adapt to loop results/messaging; practice keeps per-item servers with in-item loop |
| `cli/src/tmux/detector.test.ts` + new tests | see §6 |

No web (`src/`) changes. No API or generator changes.

## 5. Implementation order

0. **Reproduce first**: play challenge 0 in a real terminal (and scripted practice drills for
   `detach`/`kill-session`/`select-window`); capture the prompt-stacking mechanism and the exact
   failure of each defect. Also empirically verify which `after-*` hooks fire on the dev machine's
   tmux (small scripted harness against an isolated server — no TTY needed for hook checks).
1. Config + observer channel: `exit-empty off`, hook expansion, sink tailing, suppression queue,
   `pane_mode`, `resetBaseline()` (§3.2 infrastructure).
2. Lifecycle run loop in controller + server primitives (§3.1); wire challenge + practice.
3. Detector event table + state-diff refinements (§3.2 mapping; fixes defect 2).
4. Prompt rendering via `@speedrun_prompt` + re-assertion in the loop (§3.3; fixes defect 1).
5. Tests (§6), then full manual E2E: complete challenge 0, 1, and one of 3–5 end-to-end; kill the
   terminal mid-run and verify no `tmux -L tmux-speedrun-*` processes remain; Ctrl-C during the
   re-attach notice aborts cleanly.

## 6. Testing

- **Unit (vitest, `cd cli && npm test`)**:
  - detector: event→candidate mapping (incl. `after-select-window` with *no* state change → defect 2
    regression test); mode-kind mapping (clock/tree ≠ copy); cascade-kill over-emission; join/swap
    /rotate via events.
  - observer: sink parsing + offset tailing; suppression queue (runner poll events dropped, user
    events kept); `diff` with `pane_mode`; `resetBaseline` yields no delta across recovery.
  - run loop with fake server/observer: detach step → re-attach + advance; kill-session (last
    session) → recover + advance; kill-server → synthetic candidate + restart + advance; complete →
    loop exits; abort during pause; N-failure guard.
  - config: generated text contains `exit-empty off`, static status-left indirection, all hooks.
- **Live-server integration (no TTY required — guard/skip when tmux is unavailable)**: against a
  real isolated server, assert kill-session with `exit-empty off` leaves a queryable 0-session
  server; assert hook lines appear in the sink for `select-window`, `kill-session`, etc.
- **Manual acceptance** (issue checklist): exactly one prompt at all times, updated in place;
  `prefix + <n>` completes a window-by-number step; runs containing `detach`/`kill-session`
  complete end-to-end regardless of position; terminal close leaves no orphan servers; existing CLI
  tests pass; `npm run typecheck` clean.

## 7. Risks & edge cases

- **`after-*` hook coverage varies** by command/version → verified empirically in step 0; rebind
  fallback; state-diff candidates always retained as safety net.
- **`run-shell` sink writes are async** → drain with a short settle window at exit-classification;
  the poll keeps providing state deltas regardless.
- **Runner-origin events masquerading as user actions** → exec-accounting suppression (§3.2) +
  `resetBaseline()` after recovery; test both explicitly. The one intentional exception: the
  runner's re-attach may satisfy an `attach-session` step (that *is* the user's post-detach flow).
- **Auto re-attach can trap the user** in an unwinnable run → the ~1s Ctrl-C window + notice each
  cycle, and the consecutive-failure guard.
- **Isolation (ISO1)**: recovery must only ever use the run's private socket; teardown/exit
  handlers already reference the socket name and stay valid across server restarts (verify the
  temp dir isn't removed until final teardown).
- **Ordering races** between poll, sink, and recovery → the loop serializes: drain/diff *before*
  recovery, reset baseline *after*, single `advancing` critical section for submits.
- **Shared canonical answers**: no changes to answer strings or the crypto chain — the CLI must
  keep matching the server generator exactly; all fixes are detection-side over-emission, which
  trial-decrypt filters by design.
