# Interface: CLI challenge-run reliability fixes (issue #45)

Issue: jzohdi/tmux-speedrun#45 · Plan: `.agent/plan.md`

> This spec **replaces** the previous `.agent/interface.md` (which documented the shipped #35/#41
> CLI, commit `5cca21f`). Everything it pinned that this spec does not mention (auth, API client,
> challenge-session crypto, args, packaging, web docs) is **shipped and unchanged** — treat the code
> on the branch as normative there. This spec pins only what issue #45 changes, all inside `cli/`.
> No web (`src/`), API, or generator changes; canonical answer strings and the encrypted step chain
> must stay byte-identical to the server generator.

Legend: **NEW** = create · **ADAPT** = modify existing · **KEEP** = existing behavior preserved.

## 0. Scope / module map

```
cli/src/engine/types.ts        ADAPT  PaneInfo.mode, StateDelta.commandEvents/enteredMode/movedPanes
cli/src/tmux/config.ts         ADAPT  exit-empty off; @speedrun_prompt indirection; expanded hooks;
                                      NEW exports SINK_HOOKS, expectedSinkEventsFor()
cli/src/tmux/server.ts         ADAPT  isAlive(), ensureRunning(), attach() → { code }
cli/src/tmux/observer.ts       ADAPT  sink tailing, suppression queue, exec(), expectEvents(),
                                      resetBaseline(), drainDelta(), shared baseline, pane_mode
cli/src/tmux/detector.ts       ADAPT  event→candidate table; mode mapping; cascade kills; moved panes;
                                      NEW export SERVER_DIED_EVENT
cli/src/tmux/controller.ts     ADAPT  runAttachLoop() (NEW, shared); StepEngine (NEW);
                                      ChallengeController/PracticeController rebuilt on the loop
cli/src/ui/status-line.ts      ADAPT  writes @speedrun_prompt user option; sanitize cap 118
cli/src/commands/challenge.ts  ADAPT  notify wiring + abort messaging (structure unchanged)
cli/src/commands/practice.ts   ADAPT  in-item loop semantics (detach no longer skips an item)
cli/src/tmux/client.ts         KEEP   tmuxExec / tmuxVersion unchanged
cli/src/api/challenge-session.ts KEEP CliChallengeSession unchanged
```

Tests (handed to `tdd`, §10): extend `cli/src/tmux/detector.test.ts`; new `observer.test.ts`,
`run-loop.test.ts`, `config.test.ts` (unit, no tmux); new tmux-gated
`live-server.integration.test.ts`.

---

## 1. Shared types — `cli/src/engine/types.ts` (ADAPT)

```ts
export type PaneInfo = {
  paneId: string;          // #{pane_id}
  sessionName: string;
  windowIndex: number;
  windowName: string;
  active: boolean;
  left: number; top: number; width: number; height: number;
  zoomed: boolean;
  inMode: boolean;         // KEEP: #{pane_in_mode}
  mode: string | null;     // NEW:  #{pane_mode} — 'copy-mode' | 'view-mode' | 'clock-mode'
                           //       | 'tree-mode' | ... | null when not in a mode
};

export type TmuxState = { /* KEEP — unchanged shape */ };

export type StateDelta = {
  // ... all existing fields KEEP, plus:

  /**
   * NEW. Sink event names observed since the previous delta (installed hook names, one per
   * occurrence, in file order), after runner-origin suppression (§4.3). May also contain
   * synthetic events injected by the run loop (SERVER_DIED_EVENT). Always present ([] when none).
   */
  commandEvents: string[];

  /**
   * NEW. Raw #{pane_mode} of a pane that newly entered a mode this delta (undefined when none).
   * `enteredCopyMode` is REDEFINED as: enteredMode is 'copy-mode' or 'view-mode' (clock/tree
   * modes no longer set it — they map to their own candidates, §5.2).
   */
  enteredMode?: string;

  /**
   * NEW. Panes present in both snapshots whose (sessionName, windowIndex) changed —
   * i.e. a pane was MOVED (join-pane / break-pane / swap-pane / swap-window). Always present.
   */
  movedPanes: { paneId: string;
                from: { session: string; windowIndex: number };
                to:   { session: string; windowIndex: number } }[];
};
```

`hasChange(d)` (observer-internal) additionally returns true when `commandEvents.length > 0`,
`enteredMode !== undefined`, or `movedPanes.length > 0`.

---

## 2. Generated config — `cli/src/tmux/config.ts` (ADAPT)

### 2.1 Config text (normative lines)

`buildIsolatedConfig(opts: { eventSink: string }): GeneratedConfig` — signature KEEP. The generated
text must contain, in addition to the existing settings:

```
set -g exit-empty off                          # server survives 0 sessions (kill-session observable; recovery possible)
set -g @speedrun_prompt ''                     # single source of truth for the prompt text
set -g status-left '#{@speedrun_prompt}'       # STATIC — never rewritten at runtime (defect 1)
set -g status-left-length 120                  # KEEP
```

plus one `set-hook -g <event> 'run-shell "printf %s\n <event> >> <sink> || true"'` line per entry
in `SINK_HOOKS` (same shell shape as today; best-effort `|| true` KEEP).

### 2.2 Installed hooks — `SINK_HOOKS` (NEW export)

```ts
/** Every hook installed in the generated conf; each writes its own name as one sink line. */
export const SINK_HOOKS: readonly string[];
```

Contents — `after-` command hooks:
`after-attach-session`, `after-break-pane`, `after-capture-pane`, `after-choose-tree`,
`after-clock-mode`, `after-command-prompt`, `after-copy-mode`, `after-delete-buffer`,
`after-display-panes`, `after-join-pane`, `after-kill-pane`, `after-kill-session`,
`after-kill-window`, `after-last-pane`, `after-last-window`, `after-list-buffers`,
`after-list-keys`, `after-list-sessions`, `after-list-windows`, `after-new-session`,
`after-new-window`, `after-next-window`, `after-paste-buffer`, `after-previous-window`,
`after-rename-session`, `after-rename-window`, `after-select-pane`, `after-select-window`,
`after-show-buffer`, `after-source-file`, `after-split-window`, `after-swap-pane`,
`after-swap-window`, `after-rotate-window`, `after-switch-client`;
notification hooks: `client-attached`, `client-detached`, `session-closed`, `window-renamed`,
`pane-mode-changed`, `pane-focus-in`.

Constraints:
- **Never** install hooks for commands the runner executes without accounting: `set-option`,
  `display-message`, `list-panes`, `refresh-client` (invariant SUP1, §9).
- Implementation step 0 (plan §5) empirically verifies each `after-*` hook fires on real tmux ≥ 3.0.
  Any that don't fire get a **key-rebind fallback** inside `buildIsolatedConfig` (bind the default
  key to the default command chained with the sink write); the `SINK_HOOKS` event name and the
  detector mapping stay the same either way. Removing a dead hook from `SINK_HOOKS` is allowed only
  together with its rebind fallback.

### 2.3 Runner exec → expected sink events (NEW export)

```ts
/**
 * Pure. Given tmux exec args (e.g. ['list-sessions','-F',…]), return the sink event lines that
 * exec will cause, for suppression accounting (§4.3):
 *  - command c with 'after-c' ∈ SINK_HOOKS            → ['after-c']
 *  - 'detach-client'                                  → ['client-detached']
 *  - 'attach-session'                                 → ['client-attached', 'after-attach-session']
 *  - 'kill-session'                                   → ['after-kill-session', 'session-closed']
 *  - anything else (incl. unhooked commands)          → []
 * The command word is args[0] (tmux full command names; the runner never uses aliases).
 */
export function expectedSinkEventsFor(args: string[]): string[];
```

---

## 3. Server primitives — `cli/src/tmux/server.ts` (ADAPT)

```ts
export type IsolatedTmuxServer = {
  socketName: string;
  confPath: string;
  eventSink: string;                       // KEEP — plain file path; readable even when server dead
  exec(args: string[]): Promise<TmuxResult>;

  /** ADAPT: resolves with the tmux client's exit code when the attach ends (any reason). */
  attach(target?: string): Promise<{ code: number | null }>;

  /** NEW: true iff the private server responds on this socket (e.g. list-sessions exits 0). */
  isAlive(): Promise<boolean>;

  /**
   * NEW: idempotent recovery primitive. Ensure the private server is running on the SAME socket
   * (a plain exec with `-f` re-sources the conf, restarting a dead server) and ≥ 1 session exists
   * (create `new-session -d -s <session ?? initialSession>` when empty). Reports what it did.
   * Never touches any other socket (ISO1). Must not throw on an already-healthy server.
   */
  ensureRunning(opts?: { session?: string }): Promise<{ restartedServer: boolean; createdSession: boolean }>;

  teardown(): Promise<void>;               // KEEP — semantics, idempotency, signal handlers unchanged
};
```

Notes:
- The temp dir (conf + sink) lives until `teardown()`; server restarts reuse it.
- Signal handling KEEP verbatim: SIGINT/SIGTERM/SIGHUP → teardown → exit(130); `exit` backstop
  unchanged. Closing the launching terminal (SIGHUP) is the "launcher death" abort path.
- `createIsolatedTmuxServer` remembers `opts.initialSession` (default `'speedrun'`) so
  `ensureRunning` can recreate a session with the same name.

---

## 4. Observer — `cli/src/tmux/observer.ts` (ADAPT)

```ts
export class TmuxObserver {
  constructor(server: IsolatedTmuxServer);

  /**
   * NEW. Accounted exec: pushes expectedSinkEventsFor(args) onto the suppression queue, then
   * delegates to server.exec(args). EVERY runner-origin exec that can fire an installed hook
   * while a run is live MUST go through this (SUP1). snapshot() uses it internally.
   */
  exec(args: string[]): Promise<TmuxResult>;

  /**
   * NEW. Suppression accounting WITHOUT executing anything: pushes the given event names onto the
   * suppression queue (§4.3), same TTL and size cap as exec(). For runner-origin actions that
   * fire hooks but are not observer execs — the run loop's first server.attach() (a spawned
   * interactive tmux client) is the canonical caller (loop step 6, §6.2).
   */
  expectEvents(events: string[]): void;

  /** ADAPT: PANE_FORMAT gains #{pane_mode} (last field) → PaneInfo.mode ('' → null). */
  snapshot(): Promise<TmuxState>;

  /**
   * ADAPT: pure. ctx.commandEvents (default []) is copied into the delta verbatim; computes
   * enteredMode / redefined enteredCopyMode (§1) and movedPanes. Everything else unchanged.
   */
  diff(prev: TmuxState, next: TmuxState,
       ctx?: { seedInput?: string; commandEvents?: string[] }): StateDelta;

  /**
   * ADAPT: each tick = read new sink lines (offset tail, §4.2) → suppression filter (§4.3) →
   * snapshot → diff(baseline, next, { commandEvents, seedInput: getSeedInput?.() }) → if
   * hasChange, onDelta → baseline = next. Uses the OBSERVER-LEVEL baseline shared with
   * resetBaseline()/drainDelta() (no more watch-local `prev`). Poll remains the only scheduler
   * (150ms default); the sink adds events, not extra timers.
   */
  watch(onDelta: (d: StateDelta) => void,
        opts?: { intervalMs?: number; getSeedInput?: () => string | undefined }): { stop(): void };

  /**
   * NEW. Recovery-boundary reset: wait settleMs (default 300) for straggling async run-shell
   * writes, fast-forward the sink offset to EOF (discarding unread lines), clear the suppression
   * queue, snapshot, and set it as the baseline. After this, only actions performed from now on
   * can produce deltas. Never throws (dead server → baseline = EMPTY_STATE).
   */
  resetBaseline(opts?: { settleMs?: number }): Promise<void>;

  /**
   * NEW. Exit-classification read, called by the run loop after the attach ends and the watcher
   * is stopped. Waits settleMs (default 300), reads remaining sink lines (suppression-filtered),
   * appends opts.extraEvents (synthetic, NOT suppression-filtered), snapshots — or uses
   * EMPTY_STATE = { sessions:[], windows:[], panes:[], activePaneId:null, activeWindow:null,
   * buffers:[] } when the server is dead — diffs against the baseline, advances the baseline,
   * and returns the delta (even when hasChange is false). Never throws.
   */
  drainDelta(opts?: { settleMs?: number; extraEvents?: string[]; seedInput?: string }): Promise<StateDelta>;
}
```

### 4.1 Baseline

One `baseline: TmuxState | null` per observer instance, shared by `watch` ticks, `resetBaseline`,
and `drainDelta`. The last successful snapshot is retained as `lastKnown` so a dead-server
`drainDelta` still has a meaningful `prev`.

### 4.2 Sink tailing

The sink is an append-only file (KEEP: hooks `printf %s\n <event> >>`). The observer tracks a byte
offset, **initialized to the file's current EOF at construction** (pre-run lines — e.g. the initial
`new-session` — are never read). Each read consumes whole lines only; a trailing partial line waits
for the next read. One event name per line.

### 4.3 Suppression queue (runner self-suppression, SUP1)

- Queue of `{ event: string, expiresAt: number }`, pushed by `exec()` before delegation and by
  `expectEvents()` (TTL ~2000ms, size-capped).
- When a sink line is read: if an unexpired queue entry matches it, consume the **oldest** matching
  entry and drop the line; otherwise keep the line as a user event.
- Do **not** use `#{client_tty}` / `#{hook_client}` for attribution (tmux-version-dependent).
- The watch poll's own `list-sessions` / `list-buffers` / `show-buffer` execs are accounted every
  tick via `exec()`; unhooked `list-panes` needs nothing.

---

## 5. Detector — `cli/src/tmux/detector.ts` (ADAPT)

Signature KEEP — `deriveCandidates(delta: StateDelta, step: DecryptedStep): string[]` stays pure and
deterministic over `(delta, step)` (DET1). Over-emission is always safe (trial-decrypt filters);
under-emission loses the run. New export:

```ts
/** Synthetic event injected by the run loop when the private server died during an attach. */
export const SERVER_DIED_EVENT = 'speedrun-server-died';
```

### 5.1 Event → candidate table (NEW, evaluated for every entry of `delta.commandEvents`)

| sink event | candidates added |
|---|---|
| `after-select-window` | `select-window` **(defect 2 fix — fires even when the target window was already active)** |
| `after-next-window` | `next-window` |
| `after-previous-window` | `previous-window` |
| `after-last-window` | `last-window` |
| `after-select-pane` | `select-pane`, `last-pane` |
| `after-last-pane` | `last-pane` |
| `after-list-sessions` | `list-sessions` |
| `after-list-windows` | `list-windows` |
| `after-choose-tree` | `list-windows`, `list-sessions` (prefix+w / prefix+s) |
| `after-list-keys` | `list-keys` |
| `after-list-buffers` | `list-buffers` |
| `after-show-buffer` | `show-buffer` |
| `after-delete-buffer` | `delete-buffer` |
| `after-capture-pane` | `capture-pane` |
| `after-paste-buffer` | `paste-buffer` |
| `after-copy-mode` | `copy-mode` |
| `after-clock-mode` | `show-time` |
| `after-display-panes` | `display-panes` |
| `after-command-prompt` | `command-prompt` |
| `after-source-file` | `reload-config` |
| `after-split-window` | `split-vertical`, `split-horizontal` |
| `after-new-window` | `new-window` |
| `after-new-session` | `new-session` |
| `after-break-pane` | `break-pane` |
| `after-join-pane` | `join-pane` |
| `after-swap-pane` | `swap-pane` |
| `after-swap-window` | `swap-window` |
| `after-rotate-window` | `rotate-panes` |
| `after-kill-pane` | `kill-pane` |
| `after-kill-window` | `kill-window` |
| `after-kill-session` | `kill-session` |
| `client-detached` | `detach` **(defect 3 — detach becomes detectable)** |
| `client-attached` | `attach-session` |
| `after-attach-session` | `attach-session` |
| `after-switch-client` | `attach-session`, `next-session`, `previous-session` |
| `SERVER_DIED_EVENT` | `kill-server`, `kill-session` |
| any other event (`session-closed`, `window-renamed`, `pane-mode-changed`, `pane-focus-in`, unknown) | *nothing* (trigger-only) |

All candidate strings above are exact `TMUX_COMMANDS` canonical names (note `rotate-window` →
`rotate-panes`, `clock-mode` → `show-time`, `source-file` → `reload-config`, `choose-tree` → the
two list answers).

### 5.2 State-diff changes (ADAPT; existing mappings otherwise KEEP)

1. **Session kills over-emit** (replaces the either/or at `detector.ts:51-58`): when
   `sessionCountDelta < 0` add `kill-session`, `kill-window`, `kill-pane` (cascade), and — only when
   `next.sessions.length === 0` — also `kill-server`. (With `exit-empty off`, an empty live server
   means the last session was killed, not necessarily the server.)
2. **Modes**: `enteredCopyMode` (now = entered `copy-mode`/`view-mode`) → `copy-mode`;
   `enteredMode === 'clock-mode'` → `show-time`; `enteredMode === 'tree-mode'` → `list-windows`,
   `list-sessions`. No candidate for other modes.
3. **Moved panes**: `movedPanes.length > 0` → add `join-pane`, `swap-pane`, `swap-window`, and (when
   `windowCountDelta > 0`) `break-pane`. The existing removedPaneIds-based `join-pane` heuristic
   stays.
4. **Renames tightened**: emit `rename-window:${step.requiredInput}` only when
   `delta.renamedWindow?.to === step.requiredInput` (likewise sessions) — a rename to the wrong
   text must emit nothing.

---

## 6. Run loop + controllers — `cli/src/tmux/controller.ts` (ADAPT, core of defect 3)

### 6.1 StepEngine (NEW) — one abstraction over challenge & practice progression

```ts
export type StepEngine = {
  isComplete(): boolean;
  /** Current step for display; index is 0-based. Only valid while !isComplete(). */
  view(): { prompt: string; index: number; total: number };
  /** The step object handed to deriveCandidates (challenge: the decrypted step;
   *  practice: { prompt, seedInput } pseudo-step as today). */
  detectionStep(): DecryptedStep;
  seedInput(): string | undefined;
  /**
   * Try to advance one step. Challenge: session.submitAnswer(c) for each candidate in order,
   * first success wins. Practice: 'command' step ⇒ candidates.includes(step.commandName);
   * 'copy-mode-action' step ⇒ delta.enteredCopyMode || delta.bufferAdded !== undefined ||
   * delta.pasteObserved === true (unchanged semantics). Returns true iff advanced.
   */
  trySubmit(candidates: string[], delta: StateDelta): Promise<boolean>;
};
```

### 6.2 The shared attach loop (NEW)

```ts
export type RunLoopDeps = {
  server: Pick<IsolatedTmuxServer, 'attach' | 'isAlive' | 'ensureRunning'>;
  observer: Pick<TmuxObserver, 'watch' | 'resetBaseline' | 'drainDelta' | 'exec' | 'expectEvents'>;
  ui: StatusLine;
  engine: StepEngine;
  /** One-line notices printed to the launching terminal between attaches. Default: no-op. */
  notify?: (message: string) => void;
  /** Injectable time for tests. Defaults: real setTimeout / Date.now. */
  clock?: { sleep(ms: number): Promise<void>; now(): number };
  reattachDelayMs?: number;          // default 1000 — the Ctrl-C abort window
  rapidExitMs?: number;              // default 2000 — attach shorter than this counts toward the guard
  maxRapidExitsWithoutProgress?: number; // default 3 — then abort (tight-loop guard)
  sessionName?: string;              // recovery session name (default server's initialSession)
};

export type RunLoopResult = { completed: boolean; aborted: boolean; abortReason?: string };

export function runAttachLoop(deps: RunLoopDeps): Promise<RunLoopResult>;
```

**Normative iteration order** (deviations are bugs):

```
firstAttach = true; rapidNoProgress = 0
loop:
  1. if engine.isComplete(): return { completed: true, aborted: false }
  2. ui.setPrompt(engine.view())                      // idempotent re-assertion (defect 1)
  3. observer.resetBaseline()                          // recovery/startup actions can't look like user actions
  4. if !firstAttach: notify('Re-attaching — Ctrl-C now to quit.'); clock.sleep(reattachDelayMs)
  5. watcher = observer.watch(delta => submitDelta(delta), { getSeedInput: engine.seedInput })
  6. if firstAttach: observer.expectEvents(['client-attached', 'after-attach-session'])
                                                       // = expectedSinkEventsFor(['attach-session']);
                                                       // suppresses the first attach's own sink
                                                       // events. Recovery re-attaches are
                                                       // intentionally NOT suppressed (they may
                                                       // legitimately satisfy an attach-session step)
  7. advancedThisIteration = false; t0 = clock.now()
     await server.attach(); watcher.stop(); firstAttach = false
  8. alive = await server.isAlive()
  9. delta = await observer.drainDelta({ extraEvents: alive ? [] : [SERVER_DIED_EVENT],
                                         seedInput: engine.seedInput() })
 10. await submitDelta(delta)                          // classify WHY the client exited;
                                                       // sets advancedThisIteration on advance
 11. if engine.isComplete(): return { completed: true, aborted: false }
 12. if !advancedThisIteration && (clock.now() - t0) < rapidExitMs: rapidNoProgress++
     else rapidNoProgress = 0
     if rapidNoProgress >= maxRapidExitsWithoutProgress:
        return { completed: false, aborted: true, abortReason: '…' }
 13. await server.ensureRunning({ session: sessionName })   // AFTER drain — never before classification
```

`submitDelta(delta)` (loop-internal, single definition used by both the watcher callback and step
10; serialized by the existing `advancing`-style guard so at most one submission chain runs at a
time):

```
candidates = deriveCandidates(delta, engine.detectionStep())
if engine.trySubmit(candidates, delta):
    advancedThisIteration = true
    if engine.isComplete(): ui.clear(); observer.exec(['detach-client'])   // best-effort, errors ignored
    else ui.setPrompt(engine.view())                                        // in-place replace (defect 1)
    return true
return false
```

`advancedThisIteration` (loop-internal, single definition): reset to `false` at step 7's `t0`; set
to `true` iff **any** `submitDelta` call — a watcher callback during the attach or the step-10
drain — advances the engine before step 12 runs. A mid-attach advance therefore counts as progress
even when the client then exits within `rapidExitMs` and the drain itself advances nothing: the
guard must never abort a run the user is actively progressing.

Semantics pinned by the issue:
- The loop **never** treats a client exit as end-of-run. It ends only via: completion (steps done),
  the rapid-exit guard, or process death (Ctrl-C/SIGTERM/SIGHUP → server.ts signal handlers →
  teardown → exit; the loop itself never observes those).
- The completion `detach-client` is runner-origin and suppressed (via `observer.exec`).
- Steps 8–10 run **before** step 13: recovery must never overwrite the evidence of what the user
  did (`kill-session` must be classified from the 0-session server before a session is recreated).

### 6.3 Controllers (ADAPT — same constructor shapes as today, plus `notify`)

```ts
export type ChallengeRunResult = { completed: boolean; finish?: FinishResponse; aborted?: boolean };

export class ChallengeController {
  constructor(args: { server: IsolatedTmuxServer; observer: TmuxObserver;
                      session: CliChallengeSession; ui: StatusLine;
                      notify?: (m: string) => void });
  /** Build the CliChallengeSession-backed StepEngine, delegate to runAttachLoop, then:
   *  completed → { completed: true, finish: await session.finish() };
   *  aborted   → { completed: false, aborted: true }. */
  run(): Promise<ChallengeRunResult>;
}

export class PracticeController {
  constructor(args: { server: IsolatedTmuxServer; observer: TmuxObserver;
                      item: PracticeItem; ui: StatusLine; notify?: (m: string) => void });
  /** PracticeItem-backed StepEngine + runAttachLoop. Detaching NO LONGER ends the item —
   *  the loop re-attaches (practice detach/kill-session drills become completable). */
  run(): Promise<{ completed: boolean; aborted?: boolean }>;
}
```

Challenge-specific engine details: `detectionStep()` returns the currently decrypted step (cached;
re-decrypted after every successful advance), so mid-attach advances update both the prompt and the
seed used by `getSeedInput`.

---

## 7. Status line — `cli/src/ui/status-line.ts` (ADAPT)

Class shape and constructor KEEP. New behavior:

```ts
class StatusLine {
  /** set -g @speedrun_prompt '[i+1/total] <sanitized prompt>' — the config's static status-left
   *  references it (§2.1); tmux owns the redraw. NEVER writes status-left. Overload/keep the
   *  (prompt, stepIndex, totalSteps) signature; also accept a view object { prompt, index, total }. */
  setPrompt(view: { prompt: string; index: number; total: number }): Promise<void>;
  setPrompt(prompt: string, stepIndex: number, totalSteps: number): Promise<void>;

  flash(message: string): Promise<void>;   // KEEP (display-message)

  /** set -g @speedrun_prompt '' */
  clear(): Promise<void>;
}
```

`sanitize`: collapse whitespace (KEEP) → truncate to **118** chars → escape `#` as `##` (the value
is interpolated into the `status-left` format; tmux truncates display at `status-left-length` 120).
`set-option` / `display-message` are never hooked (§2.2), so StatusLine may keep using
`server.exec` directly.

---

## 8. Command layer — `cli/src/commands/{challenge,practice}.ts` (ADAPT)

- `challenge.ts`: pass `notify: info` into the controller; on `aborted` print why (guard message)
  — otherwise structurally unchanged (start → run → finish/record → teardown in `finally`).
- `practice.ts`: per-item server + `finally` teardown KEEP. The "user detached → Skipped + break"
  branch is REMOVED (detach re-attaches now). `result.aborted` (guard) → print the reason and stop
  the drill sequence; Ctrl-C during a pause exits the whole process via the signal path. Update the
  intro copy to say Ctrl-C quits.

Exit codes, arg validation, preflight (tmux ≥ 3.0, TTY): KEEP.

---

## 9. Invariants (must hold end-to-end)

- **ISO1 (KEEP, hard)** — every tmux invocation, including recovery restarts, uses the run's
  private `-L` socket; the user's default server is never referenced; idempotent teardown on every
  exit path. `ensureRunning` restarts only on the same socket, same conf.
- **DET1 (KEEP)** — `deriveCandidates` pure/deterministic over `(delta, step)`; trial-decrypt is
  the correctness authority; over-emission safe, under-emission forbidden for pool commands.
- **LIFE1 (NEW)** — a run ends only on (a) all steps complete, (b) explicit user abort
  (Ctrl-C/terminal close → signal path), or (c) the rapid-exit guard. No tmux client exit, session
  kill, or server death ends a run by itself. No orphan `tmux -L tmux-speedrun-*` processes or temp
  dirs on any of those paths.
- **PR1 (NEW)** — exactly one prompt source of truth: the `@speedrun_prompt` user option, rendered
  by the static `status-left` set once in the conf. Runtime code never writes `status-left`. The
  loop re-asserts the current prompt before every attach (loop step 2).
- **SUP1 (NEW)** — every runner-origin action that fires an installed hook is accounted: execs go
  through the observer's `exec()`, non-exec actions (the first attach's spawned client) through
  `expectEvents()` — or the events are neutralized by a subsequent `resetBaseline`. The installed
  hook set never covers unaccounted runner commands (`set-option`, `display-message`,
  `list-panes`). Sole deliberate exception: recovery re-attaches (loop step 6 note).
- **CC1/CS1/NOSPOOF (KEEP)** — no changes to canonical answer strings, the key chain, crypto code,
  or server endpoints; timing stays server-authoritative.

---

## 10. Test surface handed to `tdd`

Unit (vitest, `cd cli && npm test`, no tmux/network):

- `detector.test.ts` (extend): every §5.1 event mapping; **defect-2 regression** —
  `commandEvents: ['after-select-window']` with a no-change state diff yields `select-window`,
  while `['after-next-window']` does not; `client-detached` → `detach`; `SERVER_DIED_EVENT` →
  `kill-server` + `kill-session`; §5.2 cascade kills (last-session kill on a live server emits both
  `kill-session` and `kill-server`); clock/tree mode mapping (and NOT `copy-mode`); movedPanes →
  join/swap; tightened rename (wrong `to` → no candidate); existing mappings still pass.
- `observer.test.ts` (new): `diff` copies `commandEvents` and computes `enteredMode` /
  `movedPanes` / redefined `enteredCopyMode` from synthetic states; sink line parsing incl.
  partial-line handling (pure helpers); suppression — accounted events dropped once (oldest
  first), user duplicates kept, TTL expiry re-admits, `expectEvents()` pushes queue entries
  without executing anything.
- `run-loop.test.ts` (new; fake server/observer/ui/engine/clock injected per §6.2 structural deps):
  detach step → detach classified at drain, loop re-attaches, prompt re-asserted (order: setPrompt
  → resetBaseline → attach); kill-session as **first** step → recover + advance; server death →
  `SERVER_DIED_EVENT` injected, `ensureRunning` called AFTER drain; completion mid-attach →
  ui.clear + suppressed detach-client, loop returns completed without re-attach; rapid-exit guard
  aborts after N, but a watcher-callback advance during a rapid attach resets it
  (`advancedThisIteration` counts mid-attach advances); `expectEvents(['client-attached',
  'after-attach-session'])` called on the first attach only, never on recovery re-attaches.
- `config.test.ts` (new): generated text contains `exit-empty off`, `@speedrun_prompt` default +
  static `status-left '#{@speedrun_prompt}'`, one hook line per `SINK_HOOKS` entry, no hook for
  `set-option`/`display-message`/`list-panes`; `expectedSinkEventsFor` table (§2.3).
- `status-line` (may live in a small new test file): writes `@speedrun_prompt` (never
  `status-left`), sanitize truncation + `#` escaping.

Integration (guard with `describe.skipIf(no tmux)`; no TTY needed):

- `live-server.integration.test.ts` (new): against a real isolated server — `kill-session` with
  `exit-empty off` leaves an alive 0-session server (`isAlive()` true) and `ensureRunning`
  recreates the session; hook lines appear in the sink for scripted `select-window` (already-active
  target — defect-2 root), `next-window`, `kill-session`; `ensureRunning` restarts a killed server
  on the same socket; teardown leaves no process/temp dir.

Manual acceptance = the issue checklist (one visible prompt, `prefix + <n>` completes
window-by-number, runs containing detach/kill-session complete end-to-end, no orphan servers after
terminal close, `npm test` + `npm run typecheck` clean in `cli/`).
