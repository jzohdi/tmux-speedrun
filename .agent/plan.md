# Plan: Make CLI challenge runs playable end-to-end (issue #45)

Issue: jzohdi/tmux-speedrun#45 · PR: #46

> This plan replaces the previous `.agent/plan.md` (which covered the now-merged issue #35/#41 CLI
> work, commit `5cca21f`). The existing `.agent/interface.md` also belongs to that shipped work; the
> interface stage for this issue will overwrite it. All work is in `cli/` — the web app, API, and
> challenge generator are **not** changed (the encrypted step chain and canonical answer strings are
> shared with the web and must stay byte-identical).
>
> **Revision 2 (2026-07-05, PR #46 feedback round).** §1–§7 describe the work already implemented
> and reviewed on this branch (commit `ce38036`) — they are kept as the record the shipped code
> follows; do not re-do them. The reviewer feedback on PR #46 is addressed by **§8**, which is the
> work remaining: three more reproducible ways a step can get stuck (nested `new-session`, nested
> `attach`, single-pane `select-pane`) plus the general mandate that **no challenge step may ever
> require multiple actions or be impossible to progress**. §8 amends the §3.2 detection channel and
> the §4 file list; where §8 contradicts an earlier section or `.agent/interface.md`, §8 wins.
>
> **Revision 3 (2026-07-05, PR #46 second feedback round).** §1–§8 are implemented, reviewed, and
> merged on this branch (through commit `7f3785f`); do not re-do them. The new PR #46 feedback
> (comment of 2026-07-05T16:26) reports four more problems, addressed by **§9**: (1) a
> **rename-window step gets stuck** whenever more than one window exists or windows share a name;
> (2) **practice mode shows no hint** telling the user how to perform each command; (3) **`tmux new`
> must create _and switch to_ a neighbouring session** (still surfacing the nested-session error /
> not switching, in challenge and practice); and (4) a request for a **`debug` command** that dumps
> game state to help diagnose stuck commands. §9 amends the observer rename logic (§3.2/interface
> §4), the config's `after-new-session` hook (§8.3a/interface §2), the practice prompt composition,
> and adds a new CLI command. Where §9 contradicts an earlier section or `.agent/interface.md`, §9
> wins. All work stays inside `cli/` except a CLI-only prompt-composition change (no web/API/
> generator/canonical-answer changes).
>
> **Revision 4 (2026-07-05, PR #46 third feedback round).** §1–§9 are implemented, reviewed, and
> merged on this branch (through commit `e34ed99`); challenge 0 is now completable end-to-end (the
> user confirmed). The new PR #46 feedback (comment of 2026-07-05T21:29) reports two remaining
> issues, addressed by **§10**: (1) **practice mode detaches/re-attaches between almost every
> drill** — it should instead behave like challenge mode (one continuous attached session that
> cycles through every command once, each producing real tmux results), keeping the already-shipped
> hotkey hints; and (2) the **`login` command uses the wrong origin** — the GitHub-login redirect
> must go through `https://tmux-speedrun.xyz`, not the pinned Vercel preview origin. §10 amends the
> practice run structure (§3.1's "keep practice's per-item server" decision and §9.2) and the pinned
> API origin. Where §10 contradicts an earlier section or `.agent/interface.md`, §10 wins. All work
> stays inside `cli/` (no web/API/generator/canonical-answer changes).

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
  silently swallowed (`observer.ts:180` catch), so the kill can never even be _observed_: the
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

| Step (canonical answer)       | How the user performs it                                            | Why undetected today                                            |
| ----------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `detach`                      | `prefix + d`                                                        | no state change; no candidate; kills attach (§2.1)              |
| `attach-session`              | re-attach after detach (runner does it), or `switch-client -t`      | no candidate; in-pane `tmux attach` is refused (nested `$TMUX`) |
| `list-sessions`               | `tmux ls` typed in a pane (targets the isolated server via `$TMUX`) | no state change                                                 |
| `list-windows`                | `prefix + w` (runs `choose-tree -Zw`) or `tmux lsw`                 | tree mode sets `pane_in_mode` → wrongly emits only `copy-mode`  |
| `show-time`                   | `prefix + t` (runs `clock-mode`)                                    | clock mode → wrongly emits only `copy-mode`                     |
| `kill-session` (last session) | `tmux kill-session`                                                 | server exits (no `exit-empty off`) → unobservable (§2.1)        |
| `select-window` (no-op case)  | `prefix + 0`                                                        | §2.2                                                            |

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
  refinement only). Note tmux does not fire `after-` hooks for commands run _from_ hooks, so the
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
  _Revision 2:_ fallback coverage must be driven by the documented input forms, not by hook
  liveness alone — §8 extends this channel with nested-context shims, more rebinds/aliases, and
  liveness-aware suppression accounting.

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

| File                                                            | Change                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli/src/tmux/config.ts`                                        | `exit-empty off`; static `status-left '#{@speedrun_prompt}'`; expanded hook list (+ any fallback rebinds)                                                                |
| `cli/src/tmux/server.ts`                                        | `isAlive()`/restart-on-same-socket primitive; `attach()` exit info; keep teardown + signal handlers (unchanged semantics)                                                |
| `cli/src/tmux/observer.ts`                                      | sink tailing + drain; suppression queue; `commandEvents` in deltas; `#{pane_mode}` in `PANE_FORMAT`; `resetBaseline()`                                                   |
| `cli/src/engine/types.ts`                                       | `StateDelta.commandEvents`; `PaneInfo.mode`                                                                                                                              |
| `cli/src/tmux/detector.ts`                                      | event→candidate table; mode-kind mapping; cascade-kill and moved-pane over-emission                                                                                      |
| `cli/src/tmux/controller.ts`                                    | run-loop refactor shared by challenge + practice; exit classification; synthetic `kill-server`; prompt re-assertion; re-attach notice + abort window; loop-failure guard |
| `cli/src/ui/status-line.ts`                                     | write `@speedrun_prompt` instead of `status-left`; align sanitize cap                                                                                                    |
| `cli/src/commands/challenge.ts`, `cli/src/commands/practice.ts` | adapt to loop results/messaging; practice keeps per-item servers with in-item loop                                                                                       |
| `cli/src/tmux/detector.test.ts` + new tests                     | see §6                                                                                                                                                                   |

No web (`src/`) changes. No API or generator changes.

_Revision 2:_ the PR #46 feedback round adds further changes to `config.ts`, `server.ts`,
`observer.ts`, `detector.ts`, `controller.ts` and the test files — see §8.4.

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
  - detector: event→candidate mapping (incl. `after-select-window` with _no_ state change → defect 2
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
  runner's re-attach may satisfy an `attach-session` step (that _is_ the user's post-detach flow).
- **Auto re-attach can trap the user** in an unwinnable run → the ~1s Ctrl-C window + notice each
  cycle, and the consecutive-failure guard.
- **Isolation (ISO1)**: recovery must only ever use the run's private socket; teardown/exit
  handlers already reference the socket name and stay valid across server restarts (verify the
  temp dir isn't removed until final teardown).
- **Ordering races** between poll, sink, and recovery → the loop serializes: drain/diff _before_
  recovery, reset baseline _after_, single `advancing` critical section for submits.
- **Shared canonical answers**: no changes to answer strings or the crypto chain — the CLI must
  keep matching the server generator exactly; all fixes are detection-side over-emission, which
  trial-decrypt filters by design.

---

## 8. Revision 2 — PR #46 feedback: one-action completability (ONESHOT)

Reviewer feedback on PR #46 (comment of 2026-07-05) reports three more steps that get stuck, and
mandates: _"Make sure that all commands work similar to above and do not require multiple steps.
Make sure no challenge step can cause a challenge to get stuck."_ Two non-blocking review comments
(missing `q`/`?` fallbacks; suppression-balance drift when a hook and an interceptor both write)
belong to the same defect class and are fixed here by the same mechanisms.

### 8.1 New invariant — ONESHOT

> Every pool command's step must be completable by performing **any one** of its documented input
> forms (the `shortcut` strings in `src/lib/data/tmux-commands.ts`: the `prefix + <key>` presses
> and the `tmux <command>` typed forms, plus canonical full names and tmux's builtin short aliases)
> **exactly once, from any reachable run state** — including the minimal state (1 session, 1
> window, 1 pane, attached, 0 buffers). Detection must therefore be **input-based** (the input
> itself writes its sink event _before_ the underlying command runs, via rebind or alias), so an
> invocation that no-ops or errors in the current state still advances the step.

The only exception is the copy-paste sequence step, whose prompt documents a multi-action
procedure by design (type the seed text, copy it in copy mode, paste it) — it stays as shipped.

### 8.2 Root causes of the three reported cases

1. **`new-session` step stuck** — prompt e.g. "Start a new tmux session", documented form
   `tmux new -s <name>`, typed in a pane. The pane's `$TMUX` points at the private server (good —
   ISO1), but tmux's client nested-session guard refuses `new-session` when `$TMUX` is set
   ("sessions should be nested with care, unset $TMUX to force"). The command **never executes**:
   no `after-new-session` hook, no `sessionCountDelta` — and there is no alias interceptor for
   `new-session`/`new` to write an input event. Stuck.
2. **`select-pane` step stuck with a single pane** — prompt e.g. "Move to a different pane",
   documented form `prefix + Arrow`. The arrow keys got **no write-first rebind** (unlike
   n/p/l/0-9); the installed `after-select-pane` hook is one of the `after-*` names real tmux
   rejects/never fires here, and the state-diff channel (`activePaneChanged`) needs a second pane
   to exist. With one pane, all channels are silent. Stuck (the user currently has to split first —
   exactly the "multiple steps" the feedback forbids).
3. **`attach-session` step stuck** — prompt e.g. "Attach to an existing session", documented forms
   `tmux attach -t <name>` / `tmux a`. Same nested guard refuses `attach-session` from inside;
   nothing happens. Today the step is only completable by detaching and letting the runner
   re-attach (multi-step and undiscoverable). Stuck in practice.

Common shape: the shipped §3.2 channel covered _hook-or-fallback per command_, but coverage was
driven by which hooks the dev tmux accepted, not by the documented input forms — and the two
nested-guard commands need their default in-challenge behavior **overridden**, not just observed.

### 8.3 Fixes

All inside `cli/`; no web, API, generator, or canonical-answer changes. All new interception uses
the two already-shipped, review-verified patterns in `config.ts` (write-first key rebinds and
command-alias interceptors; aliases resolve before builtin names on the verified tmux and are
exercised per-machine by the integration suite, §8.5).

**(a) Nested-context command shims** — override tmux's nested guard inside the run, per feedback:

- `new-session`, `new` → alias to `run-shell "<write after-new-session>" ; new-session -d`.
  `-d` legitimately bypasses the nested guard, so a **real (detached, non-nested) session is
  created on the private server** and the step advances via the alias event (plus
  `sessionCountDelta > 0` as a net). Trailing user args attach to the final command
  (`tmux new -s foo` → `new-session -d -s foo`; a duplicated `-d` is accepted by tmux).
  Optionally chain `display-message 'new session created in the background'` (unhooked, safe) so
  the user sees feedback.
- `attach-session`, `attach`, `a` → alias to `run-shell "<write after-attach-session>" ;
switch-client`. Inside the attach, "attach to a session" morally _is_ switching this client:
  `tmux attach -t <name>` becomes `switch-client -t <name>`; the bare forms are a harmless
  current-session switch. Even if the trailing command errors, the write-first event has already
  advanced the step.
- **Runner-attach collision (critical):** the runner itself invokes `attach-session` in **two**
  places, and the new alias would rewrite both into a non-attaching `switch-client`:
  1. `server.attach()` (`server.ts:156`) — every user attach would die.
  2. `absorbConfigErrors()` (`server.ts:79-93`) — the throwaway `-C attach-session ;
detach-client` control client would never attach, so the config errors that `SINK_HOOKS`
     deliberately queues (the `after-*` names the running tmux rejects) would no longer be
     absorbed and would be shown on the user's first real attach after **every** server start and
     every `ensureRunning()` restart (`server.ts:171` absorbs too) — violating the
     exactly-one-prompt criterion on every run.

  Both call sites therefore go through a **private alias** `speedrun-attach=attach-session`
  defined in the generated conf (exact-name alias lookup; expansion does not recurse), and both
  spawns **strip `TMUX`/`TMUX_PANE` from the child env** so the real `attach-session` never trips
  the nested guard when the CLI itself is launched from inside a user's tmux (a latent same-kind
  blocker: preflight does not forbid that, and today such a launch would break `attach()` via the
  rapid-exit guard and break the absorb the same way). Hook events are unchanged — the private
  alias runs the real command — so first-attach suppression (loop step 6) keeps expecting
  `client-attached`/`after-attach-session`, and the absorb client's own sink writes stay harmless:
  at server creation the observer is constructed after the absorb and starts reading at the sink's
  then-current size (`observer.ts:90`), and on an `ensureRunning` restart the loop's drain →
  recover → `resetBaseline()` ordering (already load-bearing per (d)) fast-forwards past them.

**(b) Write-first key rebinds** for every documented `prefix + <key>` that lacked one — same shape
as the shipped n/p/l/number rebinds (sink write **before** the default command, so no-op/failing
invocations still advance):

| key(s)                                             | writes                                                                                | then runs                 | unblocks                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `Up` `Down` `Left` `Right` (keep `-r` repeat flag) | `after-select-pane`                                                                   | `select-pane -U/-D/-L/-R` | **feedback case 2** (single pane)                                                 |
| `o` (default next-pane key, common muscle memory)  | `after-select-pane`                                                                   | `select-pane -t :.+`      | same                                                                              |
| `z`                                                | new trigger constant (e.g. `ZOOM_KEY_EVENT = 'zoom-key'`, WINDOW_NAV_TRIGGER pattern) | `resize-pane -Z`          | `toggle-zoom` with a single pane (zoom is impossible → no `zoomToggled`, no hook) |
| `]`                                                | `after-paste-buffer`                                                                  | `paste-buffer`            | `paste-buffer` with zero buffers (command errors)                                 |
| `q`                                                | `after-display-panes`                                                                 | `display-panes`           | review comment: no fallback if hook dead                                          |
| `?`                                                | `after-list-keys`                                                                     | `list-keys`               | review comment: no fallback if hook dead                                          |

Detector: one new `EVENT_CANDIDATES` entry — `ZOOM_KEY_EVENT → toggle-zoom`. All other events
above already have entries.

**(c) Typed-form alias interceptors** for the remaining documented typed forms (write-first, then
the real command; trailing args attach):

| alias names                | writes                | unblocks in minimal state                     |
| -------------------------- | --------------------- | --------------------------------------------- |
| `list-sessions`, `ls`      | `after-list-sessions` | typed form on a tmux where the hook is dead   |
| `list-windows`, `lsw`      | `after-list-windows`  | same                                          |
| `list-buffers`, `lsb`      | `after-list-buffers`  | same                                          |
| `delete-buffer`, `deleteb` | `after-delete-buffer` | command errors with zero buffers              |
| `capture-pane`, `capturep` | `after-capture-pane`  | hook-dead machines (bufferAdded stays as net) |
| `join-pane`, `joinp`       | `after-join-pane`     | command errors with a single window           |
| `swap-window`, `swapw`     | `after-swap-window`   | command errors with a single window           |
| `list-keys`, `lsk`         | `after-list-keys`     | hook-dead machines                            |

`kill-server` needs no alias (SERVER_DIED_EVENT synthesis already covers it); `list-panes`,
`show-options`, `set-option`, `display-message`, `refresh-client` must stay hook-free AND
alias-free (SUP1 — the poll and `isAlive` need guaranteed-silent commands).

**(d) Liveness-aware suppression accounting** — aliasing `list-sessions`/`list-buffers` full names
makes the reviewer's balance caveat a real bug: the observer's poll execs those every 150 ms, and
on a tmux where the `after-*` hook is _also_ live, one exec writes **two** sink lines against one
suppression entry — leaking a spurious user event per tick that could **self-complete** steps (the
opposite failure of "stuck", equally forbidden). Fix structurally, closing both review caveats:

- After config load at server start (in/next to `absorbConfigErrors`) and after every
  `ensureRunning` restart, run `show-hooks -g` once and parse which `SINK_HOOKS` entries the
  running tmux actually accepted → `liveHooks: ReadonlySet<string>` exposed on the server. On
  parse failure, fall back to the current static SINK_HOOKS-membership behavior (documented).
- `expectedSinkEventsFor(args, liveHooks)` returns the **exact multiset** of sink lines a runner
  exec produces: alias-origin writes (static — derived from the same alias table `config.ts` owns,
  keyed by the full command names the runner uses) **plus** the live-hook write (`after-<cmd>` only
  if in `liveHooks`; `after-select-window`'s live line is `WINDOW_NAV_TRIGGER`) **plus**
  notification writes (`detach-client` → `client-detached`; `attach-session` → `client-attached` +
  `after-attach-session`; `kill-session` → `session-closed` — each gated on liveness uniformly).
  The observer threads the server's `liveHooks` into every accounting call.
- Recovery-path execs (`ensureRunning`'s `new-session` now hits the new alias) stay safe without
  accounting: they run between drain and the next loop-top `resetBaseline()`, which fast-forwards
  the sink past their lines — note this ordering as load-bearing in the code.

**(e) Full-pool ONESHOT audit** — the response to "…more". Every `TMUX_COMMANDS` entry, its
documented forms, and its channel **after** this round, from the minimal state:

| commands                                                                                                                                                                                                                                 | channel from minimal state                                                                                                                                                          | status                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `new-session`, `attach-session`                                                                                                                                                                                                          | nested-context shims (a)                                                                                                                                                            | **fixed this round**    |
| `select-pane`                                                                                                                                                                                                                            | arrow/`o` rebinds (b)                                                                                                                                                               | **fixed this round**    |
| `toggle-zoom`, `paste-buffer`, `display-panes`, `list-keys`                                                                                                                                                                              | new rebinds (b)                                                                                                                                                                     | **fixed this round**    |
| `join-pane`, `swap-window`, `delete-buffer`, `list-buffers`, `capture-pane`, typed `list-sessions`/`list-windows`/`list-keys` forms                                                                                                      | new aliases (c)                                                                                                                                                                     | **fixed this round**    |
| `detach`, `kill-session`, `kill-server`                                                                                                                                                                                                  | client-detached / cascade+recovery / SERVER_DIED (§3.1)                                                                                                                             | OK as shipped           |
| `select-window`, `next-window`, `previous-window`, `last-window`, `last-pane`, `swap-pane`, `rotate-panes`, `break-pane`, `command-prompt`, `show-time`, `list-windows` (key), `list-sessions` (key), `next-session`, `previous-session` | shipped write-first rebinds                                                                                                                                                         | OK as shipped           |
| `show-buffer`, `reload-config`, `kill-session` (typed)                                                                                                                                                                                   | shipped aliases (+ (d) accounting)                                                                                                                                                  | OK as shipped           |
| `new-window`, `split-vertical`, `split-horizontal`, `kill-window`, `kill-pane`, `rename-window`, `rename-session`, `copy-mode`                                                                                                           | always performable from minimal state; state-diff/cascade channels fire (kill-window/kill-pane on the last window/pane cascade into the session kill and recover via the §3.1 loop) | OK as shipped           |
| copy-paste sequence step                                                                                                                                                                                                                 | documented multi-action procedure                                                                                                                                                   | exempt by design (§8.1) |

### 8.4 Files to change (delta on §4)

| File                         | Change                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli/src/tmux/config.ts`     | shims (a); rebinds (b); aliases (c); `speedrun-attach`; `ZOOM_KEY_EVENT`; `expectedSinkEventsFor(args, liveHooks)`; export the rebind/alias tables so tests can assert coverage                  |
| `cli/src/tmux/server.ts`     | capture `liveHooks` via `show-hooks -g` at start + after restart; `attach()` **and** `absorbConfigErrors()` both spawn via `speedrun-attach` with `TMUX`/`TMUX_PANE` stripped from the child env |
| `cli/src/tmux/observer.ts`   | thread `liveHooks` into accounting calls                                                                                                                                                         |
| `cli/src/tmux/detector.ts`   | `ZOOM_KEY_EVENT → toggle-zoom` entry                                                                                                                                                             |
| `cli/src/tmux/controller.ts` | first-attach `expectEvents` goes through the liveness-aware helper (minor)                                                                                                                       |
| tests (§8.5)                 | `config.test.ts`, `observer.test.ts`, `detector.test.ts`, `live-server.integration.test.ts`                                                                                                      |

No changes: `status-line.ts`, `engine/types.ts`, `challenge.ts`/`practice.ts` (practice drills gain
the same fixes for free — its `commandName` matching consumes the same candidates), web `src/`.
`.agent/interface.md` §2.2/§2.3 are amended by this section where they conflict (notably the
`expectedSinkEventsFor` signature).

### 8.5 Testing (delta on §6)

- **Unit — ONESHOT completeness (the "never again" net)**: a pure test that parses every
  `TMUX_COMMANDS.shortcut` string and asserts each documented input form is covered by a rebind
  table entry, an alias table entry, or an explicit named exemption (state-diff-guaranteed
  commands and the copy-paste sequence). A future pool command added without a channel fails CI.
- **Unit**: `expectedSinkEventsFor` liveness matrix (alias+live-hook double count — the
  `show-buffer` case from review; dead-hook alias-only; `WINDOW_NAV_TRIGGER` rewrite; notification
  gating); detector `ZOOM_KEY_EVENT` mapping; config text contains the new rebinds/aliases/shims
  and `speedrun-attach`.
- **Integration (tmux-gated, no TTY)**: (1) per aliased typed form, one scripted exec produces
  **exactly** the `expectedSinkEventsFor` multiset of sink lines — pins per-machine hook/alias
  balance (the reviewer's requested assertion, generalized); (2) `list-keys` output shows every
  rebound key running the sink write plus the right final command; (3) `show-hooks -g` parsing
  works and every SINK_HOOKS entry is live **or** its dependent documented forms are covered by
  rebind/alias (liveness drift fails tests instead of stranding a step); (4) nested-shim behavior:
  a scripted client with `TMUX` set in its env runs `new-session` → a real detached session
  appears (no nested error) and the sink got `after-new-session`; (5) config-error absorption
  still works with the attach aliases installed: after server start **and** after a scripted
  `ensureRunning` restart, a fresh control client attaching via `speedrun-attach` sees no queued
  config-error output.
- **Manual acceptance (feedback verbatim)**: in a live run — `tmux new` on a "start a new session"
  step creates a session and advances; `prefix + Arrow` advances a "select a different pane" step
  with a single pane; `tmux a` advances an "attach to a session" step; plus one full end-to-end
  run of challenge 0 and one of 3–5 with no stuck step. `cd cli && npm test` and
  `npm run typecheck` green on a machine **with tmux installed** (review caveat: the integration
  suite skips silently without tmux — CI/verification must run where tmux exists).

### 8.6 Risks & edge cases (delta on §7)

- **Alias-shadow behavior across tmux versions**: interception of builtin names/aliases is
  verified on 3.6a and now pinned per-machine by integration test (1); if a version resolves
  builtins first, the typed-form channel degrades to the hook channel — test (3) surfaces that as
  a failure rather than a silent stuck step.
- **Self-completion (over-detection)** is now a first-class risk alongside stuck steps: the
  liveness-aware accounting (d) plus integration test (1) guard it; never add a hook or alias for
  commands the runner polls without updating `expectedSinkEventsFor`'s tables.
- **Shim semantics**: `new-session -d` leaves the user in their current session (the new one is
  visible via `tmux ls`/status); `switch-client` with a bad `-t` errors after the event write —
  both acceptable: the step advances on the documented input, which is the contract the feedback
  sets.
- **Runner attach must never be intercepted**: `server.attach()` and `absorbConfigErrors()` may
  only use `speedrun-attach`; add a regression test asserting both spawns use it (and strip
  `TMUX`/`TMUX_PANE`).
- ISO1/DET1/LIFE1/PR1/SUP1 and the canonical-answer/crypto invariants are unchanged.

---

## 9. Revision 3 — PR #46 second feedback: rename-stuck, practice hints, new-session switch, debug

The second PR #46 feedback comment (2026-07-05T16:26) reports four issues. Each is scoped below with
its verified root cause and fix. Nothing here touches canonical answers, the crypto chain, the
generator, the API, or the web app; the one edit outside `cli/` is discussed in §9.2 and is avoided.

### 9.1 Rename-window step gets stuck with >1 window or duplicate names (reported case 1) — BUG

**Report:** on challenge 0, the step "Change the window name to 'fast-orbit-69'" would not advance;
the user had two windows and renaming either did nothing, and it only worked after
`tmux kill-session` respawned a fresh single-window session.

**Root cause (verified):** `observer.ts`'s `detectRename(prev, next)` (`observer.ts:413`) compares
the two windows' **name multisets** by set membership:

```
removed = prev.filter(n => !next.includes(n));   // present-before, absent-after
added   = next.filter(n => !prev.includes(n));   // absent-before, present-after
return removed.length === 1 && added.length === 1 ? { from: removed[0], to: added[0] } : undefined;
```

With two windows this is broken two ways:

- **Duplicate default names.** Two windows are both `zsh` (or `bash`). Renaming one to
  `fast-orbit-69`: `prev = ['zsh','zsh']`, `next = ['zsh','fast-orbit-69']`. `removed = []` (a `zsh`
  still remains), `added = ['fast-orbit-69']` → `removed.length === 0` → **no rename detected**.
- **Renaming both.** `prev = ['zsh','fast-orbit-69']`, `next = ['fast-orbit-69','fast-orbit-69']`:
  `removed = ['zsh']`, `added = []` → still undefined.

The set-based comparison is fundamentally unable to detect a rename when any name is shared. It only
worked with a single window because then the sets can't collide. (Sessions are unaffected — tmux
requires session names to be unique, so `detectRename(prev.sessions, next.sessions)` is safe and
stays as-is. Only windows carry duplicate names.)

**Fix — identity-based window-rename detection.** Match windows across the two snapshots by their
stable identity `(sessionName, windowIndex)` — a rename changes a window's `name` but never its
index — and report a window whose name changed:

- In `observer.diff`, replace the name-list `detectRename` call for **windows** with a pass that
  builds `Map<"session:index", name>` from `prev.windows` and, for each `next.window` with the same
  key present in both, detects `prevName !== nextName`. Emit `renamedWindow = { from: prevName,
to: nextName }` for such a window. If several changed in one delta (rare — renames are one action
  per ~150 ms tick), prefer the one whose `to` is unique/most recent; a single result is sufficient
  because the detector only needs `renamedWindow.to` to equal `step.requiredInput`.
- Keep `renamedSession` on the existing name-set `detectRename` (unique names ⇒ correct).
- `TmuxState.windows` already carries `{ session, index, name }` (built in `snapshot()` from
  `list-panes`), so no new tmux query is needed.

The detector (`detector.ts:121-126`) is unchanged: it already emits `rename-window:${requiredInput}`
when `renamedWindow.to === step.requiredInput`, plus the bare `rename-window` for practice. With
identity-based detection this now fires regardless of window count or name collisions.

**Edge cases:** a window renamed to a name another window already has is still detected (identity,
not name, is the key). A rename in the same tick as a window add/remove still works — only keys
present in _both_ snapshots are compared, so an added/removed window can't masquerade as a rename.
A window that changes index (e.g. after a kill) with an unchanged name is not a rename and is
correctly ignored (its key changes, so it isn't matched). ONESHOT (OS1) holds: one rename action
advances the step from any state.

### 9.2 Practice mode shows no hint on how to perform the command (reported case 2) — UX

**Report:** the practice-mode status line shows only the command description (screenshot), with no
indication of the keystrokes/typed form. "Practice mode is meant to guide users through all of the
commands and tell exactly how to complete them."

**Root cause:** `practice-flow.ts`'s `createCommandPracticeItem` sets `step.prompt =
command.description` — the `command.shortcut` (e.g. `prefix + ,`, `tmux new -s <name>`) is never
surfaced. `PracticeController.view()` renders `item.steps[index].prompt` verbatim into
`@speedrun_prompt`.

**Fix — compose the hint in the CLI (no shared/web change).** `practice-flow.ts` lives in
`src/lib/data/` and is imported by the **web** practice page (`src/routes/practice/+page.svelte`),
so changing its prompt strings would alter the web UI — out of scope. Instead, compose the hint in
the CLI's `PracticeController` (`cli/src/tmux/controller.ts`), which already imports `PracticeItem`:

- Build a `commandName → shortcut` lookup from `TMUX_COMMANDS` (imported from
  `$lib/data/tmux-commands`).
- In the practice `StepEngine.view()`, for a `kind: 'command'` step return
  `prompt: \`${step.prompt} — ${shortcut}\``(e.g.`Rename the current window — prefix + ,`).
For `kind: 'copy-mode-action'`steps keep`step.prompt` (already a step-by-step instruction).
- Keep the composed prompt within the status-line sanitize cap (118 chars, `status-line.ts`) — the
  StatusLine already truncates, so no extra handling is needed, but keep the hint concise.
- Challenge mode is intentionally **not** given hints (it tests recall). Only practice changes.

Optionally also enrich the pre-run `info(...)` line in `practice.ts` intro (it already prints
`title — description`) to include the shortcut, but the status-line hint is the load-bearing fix
(that is what the user sees during the drill).

### 9.3 `tmux new` must create AND switch to a neighbouring session, in both modes (reported case 3)

**Report:** "`tmux new` doesn't work with error `sessions should be nested with care` — for both
challenge and practice mode … the behavior should be that a second neighboring session should be
created and switched to (this needs to be implemented)."

Two distinct requirements: (a) the nested-session error must never surface and the step must always
advance (this is the §8.3a shim's job — verify it actually fires); (b) the user must be **switched
into** the newly created session, which the current `new-session -d` shim does not do (it leaves the
user in their current session).

**Root cause of (b):** the shim (`config.ts` COMMAND_ALIASES) is
`new-session,new → run-shell "<echo after-new-session>" ; new-session -d`. `-d` creates the session
**detached**, which correctly bypasses tmux's client-side nested-session guard, but by design does
not move the attached client to it. The trailing-args constraint (interface §2.4: user args attach
to the LAST command in the alias expansion, so `new-session -d` must be last) makes it impossible to
append `switch-client` in the alias itself.

**Fix for (b) — switch via the `after-new-session` hook (robust; args-safe).** `after-new-session`
is a genuine tmux run-time hook (unlike the many `after-*` names tmux's whitelist rejects — see
§8.3d; it is one of the _live_ hooks, and must be confirmed present in `server.liveHooks` in
implementation). When `new-session -d` runs, that hook fires with the **new** session as its target,
so the hook can switch the requesting client into it without any dependence on the alias tail. In
`buildIsolatedConfig`, append a second, appended hook binding:

```
set-hook -ga after-new-session 'switch-client -t "#{hook_session}"'
```

(kept separate from the existing sink-writing `after-new-session` hook via `-ga` append). Notes:

- `switch-client` run **from a hook** does not fire `after-switch-client` (tmux does not run
  `after-*` hooks for hook-issued commands — the same property §3.2 already relies on), so this adds
  **no** sink line and needs no `expectedSinkEventsFor` accounting change.
- For the runner's own detached `new-session` execs (initial server start; `ensureRunning`
  recovery) there is no attached client at that instant, so `switch-client` is a harmless no-op
  (verify it errors quietly rather than warning; if it warns, guard with a client check in the hook
  or accept it, since those run inside the drain→recover window that a subsequent `resetBaseline`
  fast-forwards past).
- Confirm `#{hook_session}` is the correct format for the newly created session inside
  `after-new-session`; if the running tmux exposes it differently, use the equivalent (the new
  session is the hook's current target, so a bare `switch-client` may also suffice). This is an
  implementation detail to pin against real tmux in step 0.

**Fix for (a) — verify the shim actually intercepts the typed forms.** The user still sees the
nested error, which means for their invocation the `new`/`new-session` command-alias is **not**
intercepting before tmux runs the real (attached) `new-session`. Implementation must reproduce
`tmux new` / `tmux new-session` / `tmux new -s <name>` from inside a run on the target tmux and
confirm:

- the command-alias entries win over tmux's builtin abbreviation/command lookup for `new`,
  `new-session`, and (for case-3 completeness) `attach`, `a`, `attach-session`, `ls`,
  `list-sessions` — i.e. no `sessions should be nested with care` error appears and the step
  advances;
- if any typed form is **not** intercepted (e.g. tmux resolves the builtin/abbreviation before the
  `command-alias` array on that version, or the `set -s command-alias[100+]` indexing is shadowed
  by a lower-index default entry), fix the interception so it reliably wins — options to evaluate:
  assign at the front of the array / append with `-a` semantics, add the exact spellings the user
  types, or (last resort) rebind the relevant key table. The integration assertion in §9.5 must
  cover the _typed nested-guard_ case, not just event accounting.

Both fixes are config-level (`config.ts` / `buildIsolatedConfig`), so **challenge and practice get
them from the same shared `buildIsolatedConfig`** — satisfying "for both modes" with no per-command
duplication (the feedback's belief that practice lacks the override is addressed by making the
override actually fire; both modes already build the same isolated config).

### 9.4 New `tmux-speedrun debug` command (reported request 4)

**Report:** "we might want a `tmux debug` command that outputs relevant game state, along with
anything that would be helpful to debug when certain commands are not working."

**Design — `tmux-speedrun debug`** (new `cli/src/commands/debug.ts`, registered in
`cli/src/index.ts` and listed in `help.ts`). It reuses the existing server/observer/detector stack
so it exercises exactly the code paths a stuck command flows through:

1. **Environment**: tmux version (`tmuxVersion`), OS/platform, and the `requireInteractiveTmux`
   preflight result.
2. **Isolated server diagnostics**: spin up an isolated server (`createIsolatedTmuxServer`), then
   print `socketName`, `confPath`, `eventSink`, the **live vs. dead hooks** (`server.liveHooks` ∩/∖
   `SINK_HOOKS` — the single most useful signal for "why isn't my command detected"), and, behind
   `--verbose`, the full generated config text and the `KEY_REBINDS`/`COMMAND_ALIASES` tables.
3. **Live event/candidate trace (the core value)**: attach interactively (reusing the isolated
   server) and, via a `TmuxObserver.watch` callback, print each observed delta's `commandEvents`
   and the `deriveCandidates(delta, step)` output to the **launching terminal** (through `notify`),
   so the user can press keys and see exactly what the detector sees (or fails to see) for each
   action. A trivial always-incomplete `StepEngine` (or a direct `watch`) drives this without a
   challenge session. On detach / Ctrl-C, tear down (same signal/`finally` teardown as challenge).
4. Always `teardown()` in `finally`; leave no orphan server/temp dir (LIFE1).

Scope guard: `debug` must obey ISO1 (private socket only) and must **not** contact the API,
leaderboard, or crypto. It is a diagnostic; keep it read-only w.r.t. the user's real tmux. Exit
codes follow the existing convention (0 ok, 2 usage/preflight failure, 1 runtime).

Because `debug` shares the observer/detector, it is also a regression aid for §9.1/§9.3: renaming a
window or running `tmux new` in `debug` should print the `rename-window`/`new-session` candidate.

### 9.5 Files to change (delta on §4/§8.4)

| File                                   | Change                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/src/tmux/observer.ts`             | §9.1: identity-based (`session:index`) window-rename detection in `diff`; `detectRename` kept for sessions only                                                  |
| `cli/src/tmux/config.ts`               | §9.3b: appended `set-hook -ga after-new-session 'switch-client …'` in `buildIsolatedConfig`; verify/repair typed-form alias interception for `new`/`attach`/`ls` |
| `cli/src/tmux/controller.ts`           | §9.2: practice `StepEngine.view()` appends the command shortcut hint (lookup from `TMUX_COMMANDS`); challenge unchanged                                          |
| `cli/src/commands/debug.ts` (NEW)      | §9.4: the `debug` command                                                                                                                                        |
| `cli/src/index.ts`, `commands/help.ts` | §9.4: register + document `debug`                                                                                                                                |
| tests (§9.6)                           | `observer.test.ts`, `config.test.ts`, `detector.test.ts`, controller/practice test, `debug` test, `live-server.integration.test.ts`                              |

No web (`src/`), API, generator, or canonical-answer changes. `practice-flow.ts` is deliberately
**not** modified (§9.2). `.agent/interface.md` §4 (observer rename), §2.1/§2.2 (the extra
`after-new-session` hook) and §0/§8 (new `debug` command, practice hint) are amended by this section
where they conflict; the interface stage should reconcile them.

### 9.6 Testing (delta on §6/§8.5)

- **Unit — `observer.test.ts`** (§9.1 regression, the "never again" net for the reported bug):
  `diff` detects `renamedWindow` when two windows share the pre-rename name and one is renamed
  (`['zsh','zsh'] → ['zsh','fast-orbit-69']` ⇒ `{ from: 'zsh', to: 'fast-orbit-69' }`); when both
  are renamed across two ticks; when a window is renamed while another exists with an unrelated
  name; and does **not** report a rename for a pure window add/remove or an index change with an
  unchanged name. Session rename unaffected.
- **Unit — `detector.test.ts`**: with the identity-based `renamedWindow`, `rename-window:<text>` is
  emitted only when `to === requiredInput` (existing tightened-rename test still passes); bare
  `rename-window` present for practice.
- **Unit — `config.test.ts`**: generated text contains the appended
  `after-new-session … switch-client` hook (and still the sink-writing `after-new-session` hook);
  `after-new-session` remains in `SINK_HOOKS`; no accounting change (the hook-issued switch writes
  no sink line — assert `expectedSinkEventsFor(['new-session'], …)` is unchanged).
- **Unit — practice hint** (`controller` or a small practice test): practice `view()` for a
  `command` step includes the command's `shortcut`; a `copy-mode-action` step does not gain a bogus
  hint; challenge `view()` is unchanged (no shortcut leaked).
- **Unit — `debug`**: the diagnostic assembly (env + live/dead hook partition + config summary) is
  a pure/formatting function that can be unit-tested without tmux; the attach/trace path is
  integration/manual.
- **Integration (tmux-gated, `live-server.integration.test.ts`)**: (1) scripted rename of a window
  when a same-named sibling exists produces a `renamedWindow` delta (§9.1 at the tmux level); (2)
  a scripted client with `TMUX` set runs `tmux new` / `tmux new-session -s x` and: no
  `sessions should be nested with care` error, a new detached session appears, **and** the
  `after-new-session` switch hook moves the client to it (assert active session changed to the new
  one); same for the `attach`/`a`/`ls` typed forms not erroring (§9.3a).
- **Manual acceptance (feedback verbatim)**: complete challenge 0 including a rename step **with two
  windows present** without needing to kill the session; practice mode shows the hotkey/typed form
  for every drill; `tmux new` in both challenge and practice creates a session, switches into it,
  and advances with no nested error; `tmux-speedrun debug` prints version, live/dead hooks, and a
  live event→candidate trace as keys are pressed, and tears down cleanly. `cd cli && npm test`,
  `npm run typecheck`, and `npx prettier --check` on all branch-touched files must be green (run on
  a machine with tmux installed — the integration suite skips silently otherwise).

### 9.7 Risks & edge cases (delta on §7/§8.6)

- **Multiple simultaneous window renames in one delta** (§9.1): `renamedWindow` is a single object;
  emitting one result is correct because renames are one-per-action and the detector only matches
  `to`. If a future need arises to report several, widen the delta shape then — not now.
- **`switch-client` from the after-new-session hook with no client** (runner-origin detached
  creates): must be a quiet no-op, not a visible warning that pollutes the user's first attach.
  Verify on real tmux; if it warns, gate the hook on `#{?client…}` or accept it inside the
  drain→resetBaseline window.
- **Typed-form interception may still fail on some tmux versions** (§9.3a): the integration test
  must exercise the _nested-guard_ path (a client with `$TMUX` set), so a version where the alias
  loses to the builtin fails CI rather than stranding the user with the nested error again.
- **`debug` must not weaken ISO1/LIFE1**: it uses the same isolated server + teardown; assert no
  orphan `tmux -L tmux-speedrun-*` after it exits.
- Canonical-answer/crypto invariants, ISO1/DET1/LIFE1/PR1/SUP1/OS1 unchanged.

---

## 10. Revision 4 — PR #46 third feedback: continuous practice mode + login origin

The third PR #46 feedback comment (2026-07-05T21:29) confirms challenge 0 is now fully playable and
reports two remaining issues. Both are inside `cli/`; no web, API, generator, or canonical-answer
changes.

### 10.1 Practice mode should behave like challenge — one continuous session (reported case 1) — UX

**Report:** "most commands seem to trigger ending the tmux session. For example, the prompt is
'rename current window' and when completing the practice command, it does a detach from tmux to then
re-attach. I don't think this is a good UX… The practice mode should basically behave the same as a
challenge (the operations mostly produce the tmux real results), except… we should cycle through
every available command a single time, and the hotkeys to execute the command are displayed. Right
now we display the practice mode hotkeys correctly, but the behavior needs improvement."

**Root cause (verified):** practice is structured as **one isolated server per drill**.
`practice.ts` (`cli/src/commands/practice.ts:49-70`) loops over `createPracticeItems(...)` and, for
**each** item, calls `createIsolatedTmuxServer(...)`, runs a `PracticeController` over that single
item, then `server.teardown()` in `finally`. Each `PracticeController.run()` uses the shared
`runAttachLoop`, which on step completion (`controller.ts:91-96`) issues `detach-client` to end the
attach. So every drill ends by detaching the client, tearing down that drill's server, spinning up a
fresh server, and re-attaching for the next drill — the exact "detach then re-attach on almost every
command" the user sees. (This is the §3.1 decision "keep practice's per-item server; put the loop
inside each item"; it is now superseded for the reported UX reason.)

Challenge mode does **not** have this problem: it creates **one** server and runs **one**
`runAttachLoop` over **all** steps (`challenge.ts:54-59`); the loop only detaches on _final_
completion, so between steps the prompt is replaced in place with no detach (defect 1, §3.3). The
fix is to give practice the identical shape.

**Fix — a single continuous practice run over a flattened step sequence.** Restructure practice so
the whole drill sequence runs in **one** server / **one** `runAttachLoop`, exactly like challenge:

- **`PracticeController` takes `items: PracticeItem[]`** (the full ordered drill list) instead of a
  single `item`. Its `StepEngine` flattens all items into a linear list of `(item, step)` pairs and
  tracks a single global `index` across the whole sequence:
  - `isComplete()` → `index >= flat.length`.
  - `view()` → the current pair's step, with the **already-shipped §9.2 hint** unchanged: `command`
    steps append `— ${shortcut}` (lookup from `COMMAND_SHORTCUTS`); `copy-mode-action` steps keep
    their verbatim prompt. `index`/`total` are the global position, so the status line shows
    `[3/25] Rename the current window — prefix + ,` — the running progress the user needs to see
    "every available command a single time."
  - `detectionStep()` / `seedInput()` → the **current pair's item** `seedInput` (only the appended
    copy-paste item carries one; all other drills have `undefined`, unchanged behavior).
  - `trySubmit()` → unchanged per-step matching (`command` step: `candidates.includes(commandName)`;
    `copy-mode-action` step: `enteredCopyMode` / `bufferAdded` / `pasteObserved`). On match, `index++`.
- **`practice.ts`** creates **one** `createIsolatedTmuxServer({ initialSession: 'practice' })`,
  constructs one `TmuxObserver` + `StatusLine` + `PracticeController({ items, … })`, runs it once,
  and tears the server down once in `finally`. The current per-item `for` loop, the per-item
  `createIsolatedTmuxServer`/`teardown`, and the per-item `info("\n{title} — {description}")` banner
  are removed. Keep the pre-run intro `info(...)` (now: `<n> drills` / "Press the tmux keys…" /
  "detaching re-attaches automatically; Ctrl-C to quit") and the closing `Completed <c>/<total>`
  summary (derived from the controller result: completed ⇒ all; aborted ⇒ report the run stopped).
  The category filter and `EXIT_USAGE`/empty-set handling are unchanged.

Why this is safe and correct:

- **Continuity is exactly what challenge already does** — practice now inherits the same
  single-attach-loop lifecycle, so detach/kill-session/kill-server **drills** are handled by the
  loop's classify→recover→re-attach path (§3.1) instead of by a teardown between drills. The user
  stays attached across the whole practice run; only genuine detach/kill drills (and final
  completion) ever end an attach, identically to challenge.
- **ONESHOT (OS1, §8.1) makes a shared, accumulating session viable.** Because every command is
  completable from _any_ reachable state via input-based (write-first) detection, running all drills
  in one session — where state accumulates (extra windows/panes/sessions from `new-window`,
  `split-*`, `new-session`, etc.) — cannot strand a later drill. This is the precondition that lets
  practice drop the "fresh session per drill" isolation without reintroducing stuck steps.
- **Ordering & seed:** drills run in `createPracticeItems` order (TMUX_COMMANDS order, with the
  copy-paste sequence appended last), so per-step `seedInput` is only ever the copy-paste seed when
  those steps are current — matching today's per-item behavior.

`practice-flow.ts` (shared with the web practice page) is **not** modified — the flattening and hint
composition stay in the CLI `PracticeController`/`practice.ts`, consistent with §9.2's scope rule.

### 10.2 `login` uses the wrong origin (reported case 2) — BUG

**Report:** "For the login command, the incorrect URL is used, the redirect url for github login is
`https://tmux-speedrun.xyz/`."

**Root cause (verified):** `login.ts` builds the browser URL as
`${baseUrl}/api/auth/cli/login?port=…&state=…` (`login.ts:20`), where `baseUrl` comes from
`resolveConfig` → the pinned `DEFAULT_API_ORIGIN` (`config.ts:18`), currently
`https://tmux-speedrun.vercel.app`. So an unconfigured `tmux-speedrun login` opens the Vercel preview
origin instead of the canonical production domain, and the GitHub OAuth callback redirects through
the wrong host.

**Fix — repoint the pinned production origin.** Change `DEFAULT_API_ORIGIN` in `cli/src/config.ts`
to `https://tmux-speedrun.xyz` (no trailing slash — `trimTrailingSlash` normalizes regardless, and
path joins already prepend `/api/...`). This is the single source of the base origin for **all** CLI
API calls (login, challenge session, leaderboard, record), so it aligns every request with the
canonical domain, not just login. The `--server` flag and `TMUX_SPEEDRUN_API` env override remain the
supported dev escape hatches (e.g. `http://localhost:5173`). No other file references the old origin
(verified by grep); there is no `config.test.ts` asserting the constant.

### 10.3 Files to change (delta on §4/§8.4/§9.5)

| File                              | Change                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/src/tmux/controller.ts`      | §10.1: `PracticeController` accepts `items: PracticeItem[]`; `StepEngine` flattens all items to a single global-index sequence (hint composition & matching kept) |
| `cli/src/commands/practice.ts`    | §10.1: one server + one `PracticeController` run for the whole drill list (remove per-item server/teardown loop and per-item banner); adjust intro/summary output |
| `cli/src/config.ts`               | §10.2: `DEFAULT_API_ORIGIN = 'https://tmux-speedrun.xyz'`                                                                                                          |
| tests (§10.4)                     | practice controller/command test; existing practice/controller tests updated for the new `items` shape                                                            |

No changes: `config.ts`'s hook/alias machinery, `observer.ts`, `detector.ts`, `server.ts`,
`status-line.ts`, `debug.ts`, web `src/` (incl. `practice-flow.ts`), API, generator,
canonical answers.

### 10.4 Testing (delta on §6/§8.5/§9.6)

- **Unit — practice engine (`controller` test)**: with two or more `PracticeItem`s, the flattened
  `StepEngine` progresses a **single global index** across items (advancing item A's step then item
  B's step) without any intervening detach; `view()` reports global `index`/`total` and appends the
  `shortcut` hint for `command` steps only (`copy-mode-action` prompts verbatim); `seedInput()`
  returns the copy-paste seed only while a copy-paste step is current; a `command` step matches on
  `candidates.includes(commandName)`. Update any existing `PracticeController` test that constructs
  it with a single `item` to the new `items` array shape.
- **Unit — practice command wiring** (light): `practice.ts` constructs exactly **one** isolated
  server for the whole run (guards the reported "detach between drills" regression at the structural
  level — e.g. assert `createIsolatedTmuxServer` is called once for a multi-drill category via
  injected/spied factory, or cover via the controller-level test if the command isn't unit-seamed).
- **Unit — login origin**: assert `resolveConfig({})`/`DEFAULT_API_ORIGIN` yields
  `https://tmux-speedrun.xyz` and that the login URL is built against it (if `login.ts` isn't already
  unit-seamed, a `config` unit assertion on the constant suffices); `--server`/`TMUX_SPEEDRUN_API`
  overrides still win.
- **Manual acceptance (feedback verbatim)**: run `tmux-speedrun practice` and confirm completing a
  drill (e.g. "rename current window") advances **in place** to the next drill with **no**
  detach/re-attach flicker, the whole command set is cycled once, and each drill shows its hotkey;
  detach/kill-session drills still recover and continue (challenge-parity). `tmux-speedrun login`
  (no flags) opens `https://tmux-speedrun.xyz/api/auth/cli/login?...`. `cd cli && npm test`,
  `npm run typecheck`, and `npx prettier --check` on branch-touched files green (integration suite
  needs tmux installed).

### 10.5 Risks & edge cases (delta on §7/§8.6/§9.7)

- **Accumulating practice session state**: running every command in one session grows tmux state
  (extra windows/panes/sessions). ONESHOT (OS1) guarantees each remaining drill is still completable;
  no per-drill reset is needed or wanted (a reset would reintroduce the detach the user is asking us
  to remove). If a specific later drill is ever found un-completable from accumulated state, that is
  an OS1 gap to fix in the detection channel, not a reason to restore per-item servers.
- **Detach/kill drills mid-practice**: identical to challenge — the run loop's ~1s Ctrl-C notice +
  recovery applies. Acceptable and consistent (the intro already tells the user detaching
  re-attaches automatically).
- **Login origin**: `https://tmux-speedrun.xyz` must actually serve `/api/auth/cli/login` and the
  OAuth callback (it is the canonical production deployment); this is a pinned-constant change only —
  the loopback receiver, CSRF `state`, and token handling are unchanged.
- ISO1/DET1/LIFE1/PR1/SUP1/OS1 and the canonical-answer/crypto invariants unchanged.
