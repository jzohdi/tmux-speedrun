# Interface: CLI challenge-run reliability fixes (issue #45)

Issue: jzohdi/tmux-speedrun#45 · Plan: `.agent/plan.md`

> This spec **replaces** the previous `.agent/interface.md` (which documented the shipped #35/#41
> CLI, commit `5cca21f`). Everything it pinned that this spec does not mention (auth, API client,
> challenge-session crypto, args, packaging, web docs) is **shipped and unchanged** — treat the code
> on the branch as normative there. This spec pins only what issue #45 changes, all inside `cli/`.
> No web (`src/`), API, or generator changes; canonical answer strings and the encrypted step chain
> must stay byte-identical to the server generator.
>
> **Revision 2 (2026-07-05, PR #46 feedback round — plan §8).** §1–§7 of the plan are implemented
> on this branch (commit `ce38036`); this spec is reconciled with what shipped (the hook-whitelist
> reality, `WINDOW_NAV_TRIGGER`, write-first rebinds, alias interceptors — all reviewed and
> approved) and extended with the remaining work: the **ONESHOT** invariant (§9 OS1), nested-context
> shims, the new rebinds/aliases, `liveHooks`-aware suppression accounting (the two-argument
> `expectedSinkEventsFor`), and the `speedrun-attach` private alias. Sections marked **SHIPPED**
> describe code already on the branch — the tdd stage must not write failing tests against those
> as if they were new; sections marked **R2** are the work this round.
>
> **Revision 3 (2026-07-05, PR #46 second feedback round — plan §9).** §1–§8 of the plan are
> implemented, reviewed, and merged on this branch (through commit `7f3785f`); everything above and
> below marked **SHIPPED** or **R2** is normative and must not be re-derived. The second PR #46
> feedback (comment of 2026-07-05T16:26) reports four more problems, pinned here as **R3** and
> collected in the new **§11**: (1) a **rename-window step gets stuck** with >1 window or duplicate
> window names — the observer's name-set rename detection is replaced by **identity-based**
> `(session,index)` matching (§11.1, amends §1/§4/§5.2.4); (2) **practice mode shows no hint** — the
> CLI practice `StepEngine.view()` appends the command's `shortcut` (§11.2, amends §6.1); (3)
> **`tmux new` must create AND switch to** a neighbouring session in both modes — an appended
> `after-new-session` switch hook plus verified typed-form shim interception (§11.3, amends
> §2.1/§2.2); (4) a new **`tmux-speedrun debug`** command that dumps game state (§11.4, NEW
> `cli/src/commands/debug.ts`). Where §11 conflicts with an earlier section it wins. All work is in
> `cli/`; no web (`src/`), API, generator, or canonical-answer changes (`practice-flow.ts` is
> deliberately not modified — the hint is composed CLI-side).
>
> **Revision 4 (2026-07-05, PR #46 third feedback round — plan §10).** §1–§9 of the plan are
> implemented, reviewed, and merged on this branch (through commit `e34ed99`); challenge 0 is now
> completable end-to-end (the user confirmed). Everything above marked **SHIPPED**/**R2**/**R3** is
> normative and must not be re-derived. The third PR #46 feedback (comment of 2026-07-05T21:29)
> reports two remaining issues, pinned here as **R4** and collected in the new **§12**: (1)
> **practice mode detaches/re-attaches between almost every drill** — it must behave like challenge
> (one continuous attached session cycling through every command once, each producing real tmux
> results, keeping the already-shipped §11.2 hotkey hints). The fix restructures `PracticeController`
> to take the full `items: PracticeItem[]` list and run **one** server / **one** `runAttachLoop` over
> a flattened `(item, step)` sequence (§12.1, amends §6.1/§6.3 and §8's practice notes); and (2) the
> **`login` command uses the wrong origin** — the GitHub-login redirect must go through
> `https://tmux-speedrun.xyz`, not the pinned Vercel preview origin. The fix repoints
> `DEFAULT_API_ORIGIN` (§12.2, NEW pin on `cli/src/config.ts`). Where §12 conflicts with an earlier
> section it wins. All work is in `cli/`; no web (`src/`, incl. `practice-flow.ts`), API, generator,
> or canonical-answer changes.

Legend: **NEW** = create · **ADAPT** = modify existing · **KEEP** = existing behavior preserved.

## 0. Scope / module map

```
cli/src/engine/types.ts        SHIPPED  PaneInfo.mode, StateDelta.commandEvents/enteredMode/movedPanes
cli/src/tmux/config.ts         R2       SHIPPED: exit-empty off; @speedrun_prompt indirection; hooks;
                                        exports SINK_HOOKS, WINDOW_NAV_TRIGGER, expectedSinkEventsFor.
                                        R2: shims, new rebinds/aliases, speedrun-attach, ZOOM_KEY_EVENT,
                                        exported KEY_REBINDS/COMMAND_ALIASES tables,
                                        expectedSinkEventsFor(args, liveHooks) (§2.3–§2.4)
cli/src/tmux/server.ts         R2       SHIPPED: isAlive(), ensureRunning(), attach() → { code }.
                                        R2: liveHooks; attach()/absorbConfigErrors() spawn via
                                        speedrun-attach with TMUX/TMUX_PANE stripped; spawnImpl seam (§3)
cli/src/tmux/observer.ts       R3       SHIPPED: sink tailing, suppression queue, exec(), expectEvents(),
                                        resetBaseline(), drainDelta(), shared baseline, pane_mode.
                                        R2: exec() threads server.liveHooks into accounting (§4).
                                        R3: identity-based window-rename detection in diff() (§11.1)
cli/src/tmux/config.ts (again) R3       R3: appended `after-new-session … switch-client` hook +
                                        verified typed-form shim interception (§11.3)
cli/src/tmux/detector.ts       R2       SHIPPED: event→candidate table; mode mapping; cascade kills;
                                        moved panes; SERVER_DIED_EVENT; window-nav event gating.
                                        R2: ZOOM_KEY_EVENT → toggle-zoom entry (§5.1).
                                        R3: no change (identity rename keeps the same delta shape, §11.1)
cli/src/tmux/controller.ts     R4       SHIPPED: runAttachLoop(), StepEngine, controllers on the loop.
                                        R2: first-attach expectEvents via the liveness-aware helper (§6.2).
                                        R3: practice StepEngine.view() appends command shortcut hint (§11.2).
                                        R4: PracticeController takes items[]; flattened global-index
                                        StepEngine → one continuous run (§12.1)
cli/src/ui/status-line.ts      SHIPPED  writes @speedrun_prompt user option; sanitize cap 118 — no change
cli/src/commands/challenge.ts  SHIPPED  notify wiring + abort messaging — no R2/R3/R4 change
cli/src/commands/practice.ts   R4       SHIPPED: preflight, category filter, intro/summary.
                                        R4: one server + one PracticeController({ items }) for the
                                        whole drill list (remove the per-item server/teardown loop) (§12.1)
cli/src/commands/debug.ts      NEW  R3  `tmux-speedrun debug` — dumps env, live/dead hooks, config
                                        summary, and a live event→candidate trace (§11.4)
cli/src/index.ts               R3       register the `debug` command (§11.4)
cli/src/commands/help.ts       R3       document the `debug` command (§11.4)
cli/src/config.ts              R4       DEFAULT_API_ORIGIN → 'https://tmux-speedrun.xyz' (§12.2)
cli/src/tmux/client.ts         KEEP     tmuxExec / tmuxVersion unchanged
cli/src/api/challenge-session.ts KEEP   CliChallengeSession unchanged
```

Tests (handed to `tdd`, §10): SHIPPED — `cli/src/tmux/detector.test.ts`, `observer.test.ts`,
`run-loop.test.ts`, `config.test.ts`, `ui/status-line.test.ts` (unit) and tmux-gated
`live-server.integration.test.ts`. R2 extends `config.test.ts`, `observer.test.ts`,
`detector.test.ts`, `live-server.integration.test.ts` and adds the ONESHOT completeness test
`cli/src/tmux/oneshot.test.ts` (§10-R2). R3 extends `observer.test.ts`, `detector.test.ts`,
`config.test.ts`, adds a practice-hint controller test and `commands/debug.test.ts` (§11.5). R4
extends the practice `controller`/`practice` tests and adds a `config` (login-origin) assertion
(§12.3).

---

## 1. Shared types — `cli/src/engine/types.ts` (ADAPT)

```ts
export type PaneInfo = {
	paneId: string; // #{pane_id}
	sessionName: string;
	windowIndex: number;
	windowName: string;
	active: boolean;
	left: number;
	top: number;
	width: number;
	height: number;
	zoomed: boolean;
	inMode: boolean; // KEEP: #{pane_in_mode}
	mode: string | null; // NEW:  #{pane_mode} — 'copy-mode' | 'view-mode' | 'clock-mode'
	//       | 'tree-mode' | ... | null when not in a mode
};

export type TmuxState = {
	/* KEEP — unchanged shape */
};

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
	movedPanes: {
		paneId: string;
		from: { session: string; windowIndex: number };
		to: { session: string; windowIndex: number };
	}[];
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

plus (all **SHIPPED** unless marked R2/R3):

- one `set-hook -g <event> 'run-shell "echo <line> >> <sink> || true"'` line per entry in
  `SINK_HOOKS` (best-effort `|| true`; `echo`, not `printf %s\n` — the backslash does not survive
  the tmux→sh quoting chain). The `after-select-window` hook writes `WINDOW_NAV_TRIGGER` instead of
  its own name (§2.2).
- **R3**: an appended `set-hook -ga after-new-session 'switch-client -t "#{hook_session}"'` line
  (create-and-switch; §11.3b) — a **second** binding on `after-new-session`, kept separate from the
  sink-writing hook via `-ga`.
- one `bind-key` line per `KEY_REBINDS` entry and one `command-alias` line per name in each
  `COMMAND_ALIASES` entry — `buildIsolatedConfig` derives these lines **solely from the exported
  tables** (§2.4), which are the single source of truth shared with `expectedSinkEventsFor`.
- **R2**: the private runner alias `speedrun-attach=attach-session` (§2.4c). It is _not_ part of
  `COMMAND_ALIASES` (it writes no sink events; alias expansion does not recurse, so it reaches the
  real `attach-session` even though that name is itself intercepted).

### 2.2 Installed hooks — `SINK_HOOKS` (SHIPPED export; R2 reconciles the liveness reality)

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

Hook-liveness reality (SHIPPED, verified on tmux 3.6a; now normative): tmux **whitelists** settable
`after-*` hook names — only some `SINK_HOOKS` command hooks are accepted; the rest are config
errors the server absorbs at startup (§3) and **never fire**. Coverage is therefore guaranteed by
the write-first rebinds and alias interceptors (§2.4), driven by the documented input forms
(invariant OS1), not by hook liveness. All `SINK_HOOKS` entries stay installed regardless (live
ones are extra signal; dead ones are absorbed errors), and which ones are live is captured at
runtime as `server.liveHooks` (§3, R2). `after-new-session` is one of the **live** hooks — its
liveness is what makes the R3 create-and-switch hook (§11.3b) fire; confirm it is present in
`server.liveHooks` at implementation.

```ts
/**
 * SHIPPED. What the (live) after-select-window hook writes to the sink. tmux fires that hook for
 * next/previous/last-window too, so it must NOT write 'after-select-window' — a generic move would
 * masquerade as a targeted select (defect 2). It writes this neutral trigger instead; each
 * window-nav input path (number keys, n/p/l, typed forms) writes its own exact event via
 * rebind/alias (§2.4).
 */
export const WINDOW_NAV_TRIGGER = 'window-nav-trigger';

/** R2. Sink event written by the `z` rebind (§2.4b); resize-pane has no after-hook of its own. */
export const ZOOM_KEY_EVENT = 'zoom-key';
```

Constraints:

- **Never** install hooks — **nor command aliases** (R2) — for commands the runner executes without
  accounting: `set-option`, `show-options`, `show-hooks`, `display-message`, `list-panes`,
  `refresh-client` (invariant SUP1, §9). These are the runner's guaranteed-silent commands
  (`isAlive` probes `show-options -s`; `liveHooks` capture runs `show-hooks -g`; StatusLine writes
  options; the poll lists panes).

### 2.3 Runner exec → expected sink events (R2 — signature CHANGED from the shipped one-arg form)

```ts
/**
 * Pure. Given tmux exec args (args[0] is the command word) and the set of hooks the running tmux
 * actually accepted (server.liveHooks, §3), return the EXACT MULTISET of sink lines that one
 * successful exec produces, for suppression accounting (§4.3). Replaces the shipped
 * expectedSinkEventsFor(args) — every caller must be migrated; there is no one-arg overload.
 */
export function expectedSinkEventsFor(args: string[], liveHooks: ReadonlySet<string>): string[];
```

Multiset rules (order irrelevant — suppression matches per line). Let `entry` be the
`COMMAND_ALIASES` entry whose `names` contains `args[0]` (if any), and let `c` = the first word of
`entry.command` when an alias matched, else `args[0]`:

1. **Runner attach special case (checked first):** `args[0] === 'speedrun-attach'` →
   `'client-attached'` if `'client-attached' ∈ liveHooks`, plus `'after-attach-session'` if
   `'after-attach-session' ∈ liveHooks`, and nothing else. This models the runner's real attach
   (the private alias runs the genuine `attach-session`). It is deliberately NOT keyed on
   `'attach-session'`: an exec of that spelling hits the user-facing shim (§2.4a) and is covered by
   rules 2–4 (alias write + `switch-client` live hook).
2. **Alias-origin writes (unconditional):** if an alias matched, `entry.events` verbatim — the
   interceptor's `run-shell` always writes, even when the trailing command no-ops or errors.
3. **Live-hook write:** if `after-${c}` ∈ `SINK_HOOKS` **and** `after-${c}` ∈ `liveHooks`, one
   line: `WINDOW_NAV_TRIGGER` when `c === 'select-window'`, else `after-${c}`. (This is how one
   `show-buffer` poll exec on a hook-live tmux yields TWO lines — alias write + hook write — the
   review's double-count case.) The R3 `after-new-session` create-and-switch hook adds **no** rule
   here: a hook-issued `switch-client` does not fire `after-switch-client` (§11.3b).
4. **Notification writes (liveness-gated uniformly):** `c === 'detach-client'` →
   `'client-detached'` if live; `c === 'kill-session'` → `'session-closed'` if live.

The function models **successful** execution; a shim whose trailing command errors (e.g.
`switch-client` from a context with no client) produces only the rule-2 alias writes — integration
tests that exec shim spellings in such contexts must expect the rule-2 subset (§10-R2).

### 2.4 Input interception tables (R2 — NEW exports; single source of truth for conf + accounting)

```ts
export type KeyRebind = {
	key: string; // bind-key key spec as written in the conf (e.g. '0', "';'", 'C-o', 'Up')
	repeat?: boolean; // emit `bind-key -r` (kept for the arrow keys, matching tmux defaults)
	events: readonly string[]; // sink lines written BEFORE the command runs (write-first)
	command: string; // the default command then run
};
export const KEY_REBINDS: readonly KeyRebind[];

export type CommandAlias = {
	names: readonly string[]; // every intercepted spelling (full command name first)
	events: readonly string[]; // sink lines written BEFORE the command runs (write-first)
	command: string; // real command the alias runs; TRAILING USER ARGS ATTACH TO IT —
	// therefore it must be the LAST command in the alias expansion
};
export const COMMAND_ALIASES: readonly CommandAlias[];
```

Write-first is the ONESHOT mechanism: the sink event arrives even when the movement/command is a
no-op (`prefix+0` on the already-active window, `prefix+Left` with one pane) or errors
(`paste-buffer` with zero buffers, `join-pane` with one window).

**(a) Nested-context shims** (R2 — override tmux's nested-session guard inside the run; the two
commands the guard refuses when `$TMUX` is set, per the PR #46 feedback):

| `names`                         | `events`               | `command`        | notes                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new-session`, `new`            | `after-new-session`    | `new-session -d` | `-d` legitimately bypasses the nested guard: a real detached session is created on the private server. `tmux new -s foo` → `new-session -d -s foo` (a duplicated `-d` is accepted). No trailing `display-message` may be chained — user args would attach to it instead of `new-session`. The R3 appended `after-new-session` hook then switches the client into the new session (§11.3b). |
| `attach-session`, `attach`, `a` | `after-attach-session` | `switch-client`  | Inside the attach, "attach" morally is switching this client: `tmux attach -t x` → `switch-client -t x`; bare forms are a harmless same-session switch. An erroring invocation still advances via the write-first event.                                                                  |

**(b) Key rebinds** — full normative `KEY_REBINDS` contents (SHIPPED rows first, R2 rows marked):

| key(s)                                    | events                                                              | command                                           |                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `0`…`9`                                   | `after-select-window`                                               | `select-window -t :=<n>`                          | SHIPPED                                                                                  |
| `n` / `p` / `l`                           | `after-next-window` / `after-previous-window` / `after-last-window` | `next-window` / `previous-window` / `last-window` | SHIPPED                                                                                  |
| `';'`                                     | `after-last-pane`                                                   | `last-pane`                                       | SHIPPED                                                                                  |
| `'{'` / `'}'`                             | `after-swap-pane`                                                   | `swap-pane -U` / `swap-pane -D`                   | SHIPPED                                                                                  |
| `C-o`                                     | `after-rotate-window`                                               | `rotate-window`                                   | SHIPPED                                                                                  |
| `'!'`                                     | `after-break-pane`                                                  | `break-pane`                                      | SHIPPED                                                                                  |
| `':'`                                     | `after-command-prompt`                                              | `command-prompt`                                  | SHIPPED                                                                                  |
| `t`                                       | `after-clock-mode`                                                  | `clock-mode`                                      | SHIPPED                                                                                  |
| `w` / `s`                                 | `after-choose-tree`                                                 | `choose-tree -Zw` / `choose-tree -Zs`             | SHIPPED                                                                                  |
| `'('` / `')'`                             | `after-switch-client`                                               | `switch-client -p` / `switch-client -n`           | SHIPPED                                                                                  |
| `Up` `Down` `Left` `Right` (repeat: true) | `after-select-pane`                                                 | `select-pane -U/-D/-L/-R`                         | **R2** — feedback case 2: single-pane no-op still advances                               |
| `o`                                       | `after-select-pane`                                                 | `select-pane -t :.+`                              | **R2**                                                                                   |
| `z`                                       | `ZOOM_KEY_EVENT`                                                    | `resize-pane -Z`                                  | **R2** — single-pane zoom is a no-op: no `zoomToggled`, so the event is the only channel |
| `']'`                                     | `after-paste-buffer`                                                | `paste-buffer`                                    | **R2** — errors with zero buffers                                                        |
| `q`                                       | `after-display-panes`                                               | `display-panes`                                   | **R2** — review comment: no fallback if hook dead                                        |
| `'?'`                                     | `after-list-keys`                                                   | `list-keys`                                       | **R2** — review comment: same                                                            |

**(c) Typed-form aliases** — full normative `COMMAND_ALIASES` contents = the shims (a) plus:

| `names`                    | `events`                | `command`         |                                   |
| -------------------------- | ----------------------- | ----------------- | --------------------------------- |
| `show-buffer`, `showb`     | `after-show-buffer`     | `show-buffer`     | SHIPPED                           |
| `source-file`, `source`    | `after-source-file`     | `source-file`     | SHIPPED                           |
| `kill-session`             | `after-kill-session`    | `kill-session`    | SHIPPED                           |
| `select-window`, `selectw` | `after-select-window`   | `select-window`   | SHIPPED                           |
| `next-window`, `next`      | `after-next-window`     | `next-window`     | SHIPPED                           |
| `previous-window`, `prev`  | `after-previous-window` | `previous-window` | SHIPPED                           |
| `last-window`, `last`      | `after-last-window`     | `last-window`     | SHIPPED                           |
| `list-sessions`, `ls`      | `after-list-sessions`   | `list-sessions`   | **R2**                            |
| `list-windows`, `lsw`      | `after-list-windows`    | `list-windows`    | **R2**                            |
| `list-buffers`, `lsb`      | `after-list-buffers`    | `list-buffers`    | **R2**                            |
| `delete-buffer`, `deleteb` | `after-delete-buffer`   | `delete-buffer`   | **R2** — errors with zero buffers |
| `capture-pane`, `capturep` | `after-capture-pane`    | `capture-pane`    | **R2**                            |
| `join-pane`, `joinp`       | `after-join-pane`       | `join-pane`       | **R2** — errors with one window   |
| `swap-window`, `swapw`     | `after-swap-window`     | `swap-window`     | **R2** — errors with one window   |
| `list-keys`, `lsk`         | `after-list-keys`       | `list-keys`       | **R2**                            |

Plus the private, event-free runner alias (R2), NOT in `COMMAND_ALIASES`:

```ts
/** The only spelling the runner may use to attach a real client (§3). */
export const RUNNER_ATTACH_COMMAND = 'speedrun-attach'; // conf: speedrun-attach=attach-session
```

`kill-server` needs no alias (`SERVER_DIED_EVENT` synthesis covers it). Aliasing
`list-sessions`/`list-buffers`/`show-buffer` full names means the observer's own 150 ms poll now
produces alias writes every tick — which is exactly why `expectedSinkEventsFor` must account the
full multiset (§2.3 rules 2+3) and why SUP1 gains the "no alias either" clause (§2.2). Runner
execs that bypass observer accounting (`ensureRunning`'s `new-session` — now shim-intercepted —
and its `list-sessions` probe) are safe **only** because they run between the loop's drain (step
9–10) and the next loop-top `resetBaseline()` (step 3), which fast-forwards the sink past their
lines — this ordering is load-bearing and must be noted in the code.

---

## 3. Server primitives — `cli/src/tmux/server.ts` (ADAPT)

```ts
export type IsolatedTmuxServer = {
	socketName: string;
	confPath: string;
	eventSink: string; // KEEP — plain file path; readable even when server dead
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
	ensureRunning(opts?: {
		session?: string;
	}): Promise<{ restartedServer: boolean; createdSession: boolean }>;

	/**
	 * R2: the SINK_HOOKS entries the running tmux actually accepted (its settable-hook whitelist
	 * varies by version). Captured via one `show-hooks -g` exec after config load at server start
	 * (next to absorbConfigErrors) and RE-CAPTURED after every ensureRunning restart — implement as
	 * a getter over mutable state. Parse: entry h is live iff some output line starts with `h ` or
	 * `h[`. On capture failure (non-zero exit / unparseable / throw) fall back to the FULL
	 * SINK_HOOKS set (= the shipped static behavior; document this in the code).
	 */
	liveHooks: ReadonlySet<string>;

	teardown(): Promise<void>; // KEEP — semantics, idempotency, signal handlers unchanged
};
```

R2 — runner attach spelling and nested-launch hardening (plan §8.3a, critical):

- The runner invokes `attach-session` in exactly two places — `attach()` (the user's interactive
  client) and `absorbConfigErrors()` (the throwaway `-C … ; detach-client` control client that
  swallows the queued config errors for the dead SINK_HOOKS entries, at server start AND inside
  every `ensureRunning` restart). With the §2.4a shim installed, both would be rewritten into a
  non-attaching `switch-client` — so both spawns MUST use `RUNNER_ATTACH_COMMAND`
  (`speedrun-attach`) instead of `attach-session`. No other code may use `speedrun-attach`.
- Both client spawns MUST strip `TMUX` and `TMUX_PANE` from the child env, via an exported pure
  helper (unit-testable):

  ```ts
  /** Copy of `env` without TMUX / TMUX_PANE, so the real attach-session never trips the nested
   *  guard when the CLI itself is launched from inside a user's tmux. */
  export function sanitizedClientEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  ```

- `createIsolatedTmuxServer(opts?: { initialSession?: string; spawnImpl?: typeof spawn })` —
  R2 test seam: `spawnImpl` (default `node:child_process.spawn`) is used by the two client spawns
  above, so tests can record their args/env (§10-R2 regression: both use `speedrun-attach` +
  `sanitizedClientEnv`). The `exit`-backstop spawn keeps using the real `spawn`.

Notes:

- The temp dir (conf + sink) lives until `teardown()`; server restarts reuse it.
- Signal handling KEEP verbatim: SIGINT/SIGTERM/SIGHUP → teardown → exit(130); `exit` backstop
  unchanged; teardown removes the process-wide handlers (SHIPPED — stale-handler orphan fix).
  Closing the launching terminal (SIGHUP) is the "launcher death" abort path. Post-teardown execs
  are guarded (SHIPPED) so nothing can resurrect a killed server.
- `createIsolatedTmuxServer` remembers `opts.initialSession` (default `'speedrun'`) so
  `ensureRunning` can recreate a session with the same name.
- Start order: `new-session -d` (hits the §2.4a shim; its sink lines land before the observer is
  constructed, whose offset starts at the sink's then-current EOF) → absorb via `speedrun-attach`
  → capture `liveHooks`. The absorb client's own attach/detach sink lines are neutralized the same
  way at start, and by the loop's drain → recover → `resetBaseline()` ordering after restarts.
- `isAlive()` keeps probing `show-options -s` and `liveHooks` capture uses `show-hooks -g` — both
  on the guaranteed-silent list (§2.2), so neither can satisfy a step (SUP1).

---

## 4. Observer — `cli/src/tmux/observer.ts` (ADAPT)

```ts
export class TmuxObserver {
	constructor(server: IsolatedTmuxServer);

	/**
	 * NEW (R2-amended). Accounted exec: pushes expectedSinkEventsFor(args, this.server.liveHooks)
	 * onto the suppression queue, then delegates to server.exec(args). EVERY runner-origin exec
	 * that can fire an installed hook OR alias interceptor while a run is live MUST go through
	 * this (SUP1). snapshot() uses it internally. Threading liveHooks per call (not caching a
	 * snapshot of it) is required: the set changes after an ensureRunning restart.
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
	 * ADAPT (R3): pure. ctx.commandEvents (default []) is copied into the delta verbatim; computes
	 * enteredMode / redefined enteredCopyMode (§1) and movedPanes. R3: window-rename detection is
	 * IDENTITY-based (§11.1) — match windows across snapshots by (session, index); session-rename
	 * keeps the name-set detectRename. Everything else unchanged.
	 */
	diff(
		prev: TmuxState,
		next: TmuxState,
		ctx?: { seedInput?: string; commandEvents?: string[] }
	): StateDelta;

	/**
	 * ADAPT: each tick = read new sink lines (offset tail, §4.2) → suppression filter (§4.3) →
	 * snapshot → diff(baseline, next, { commandEvents, seedInput: getSeedInput?.() }) → if
	 * hasChange, onDelta → baseline = next. Uses the OBSERVER-LEVEL baseline shared with
	 * resetBaseline()/drainDelta() (no more watch-local `prev`). Poll remains the only scheduler
	 * (150ms default); the sink adds events, not extra timers.
	 */
	watch(
		onDelta: (d: StateDelta) => void,
		opts?: { intervalMs?: number; getSeedInput?: () => string | undefined }
	): { stop(): void };

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
	drainDelta(opts?: {
		settleMs?: number;
		extraEvents?: string[];
		seedInput?: string;
	}): Promise<StateDelta>;
}
```

### 4.1 Baseline

One `baseline: TmuxState | null` per observer instance, shared by `watch` ticks, `resetBaseline`,
and `drainDelta`. The last successful snapshot is retained as `lastKnown` so a dead-server
`drainDelta` still has a meaningful `prev`.

### 4.2 Sink tailing

The sink is an append-only file (KEEP: hooks/rebinds/aliases append via `echo <line> >>`, §2.1).
The observer tracks a byte
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
  tick via `exec()`; unhooked-and-unaliased `list-panes` needs nothing. R2: with those three now
  alias-intercepted (§2.4c), the per-exec multiset varies by machine — one `show-buffer` exec on a
  hook-live tmux writes TWO lines (alias + hook), both of which the accounting must consume, or a
  spurious user event leaks every tick and can SELF-COMPLETE a step (§2.3 rule 3; the review's
  suppression-balance case).

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

| sink event                                                                                                                | candidates added                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `after-select-window`                                                                                                     | `select-window` **(defect 2 fix — fires even when the target window was already active)**                    |
| `after-next-window`                                                                                                       | `next-window`                                                                                                |
| `after-previous-window`                                                                                                   | `previous-window`                                                                                            |
| `after-last-window`                                                                                                       | `last-window`                                                                                                |
| `after-select-pane`                                                                                                       | `select-pane`, `last-pane`                                                                                   |
| `after-last-pane`                                                                                                         | `last-pane`                                                                                                  |
| `after-list-sessions`                                                                                                     | `list-sessions`                                                                                              |
| `after-list-windows`                                                                                                      | `list-windows`                                                                                               |
| `after-choose-tree`                                                                                                       | `list-windows`, `list-sessions` (prefix+w / prefix+s)                                                        |
| `after-list-keys`                                                                                                         | `list-keys`                                                                                                  |
| `after-list-buffers`                                                                                                      | `list-buffers`                                                                                               |
| `after-show-buffer`                                                                                                       | `show-buffer`                                                                                                |
| `after-delete-buffer`                                                                                                     | `delete-buffer`                                                                                              |
| `after-capture-pane`                                                                                                      | `capture-pane`                                                                                               |
| `after-paste-buffer`                                                                                                      | `paste-buffer`                                                                                               |
| `after-copy-mode`                                                                                                         | `copy-mode`                                                                                                  |
| `after-clock-mode`                                                                                                        | `show-time`                                                                                                  |
| `after-display-panes`                                                                                                     | `display-panes`                                                                                              |
| `after-command-prompt`                                                                                                    | `command-prompt`                                                                                             |
| `after-source-file`                                                                                                       | `reload-config`                                                                                              |
| `after-split-window`                                                                                                      | `split-vertical`, `split-horizontal`                                                                         |
| `after-new-window`                                                                                                        | `new-window`                                                                                                 |
| `after-new-session`                                                                                                       | `new-session`                                                                                                |
| `after-break-pane`                                                                                                        | `break-pane`                                                                                                 |
| `after-join-pane`                                                                                                         | `join-pane`                                                                                                  |
| `after-swap-pane`                                                                                                         | `swap-pane`                                                                                                  |
| `after-swap-window`                                                                                                       | `swap-window`                                                                                                |
| `after-rotate-window`                                                                                                     | `rotate-panes`                                                                                               |
| `after-kill-pane`                                                                                                         | `kill-pane`                                                                                                  |
| `after-kill-window`                                                                                                       | `kill-window`                                                                                                |
| `after-kill-session`                                                                                                      | `kill-session`                                                                                               |
| `after-rename-window`                                                                                                     | `rename-window` (SHIPPED — bare form for practice matching; challenge answers are `rename-*:<text>`, §5.2.4) |
| `after-rename-session`                                                                                                    | `rename-session` (SHIPPED — same)                                                                            |
| `client-detached`                                                                                                         | `detach` **(defect 3 — detach becomes detectable)**                                                          |
| `client-attached`                                                                                                         | `attach-session`                                                                                             |
| `after-attach-session`                                                                                                    | `attach-session`                                                                                             |
| `after-switch-client`                                                                                                     | `attach-session`, `next-session`, `previous-session`                                                         |
| `SERVER_DIED_EVENT`                                                                                                       | `kill-server`, `kill-session`                                                                                |
| `ZOOM_KEY_EVENT` (`zoom-key`)                                                                                             | `toggle-zoom` **(R2 — the only new detector entry this round)**                                              |
| any other event (`WINDOW_NAV_TRIGGER`, `session-closed`, `window-renamed`, `pane-mode-changed`, `pane-focus-in`, unknown) | _nothing_ (trigger-only)                                                                                     |

All candidate strings above are exact `TMUX_COMMANDS` canonical names (note `rotate-window` →
`rotate-panes`, `clock-mode` → `show-time`, `source-file` → `reload-config`, `choose-tree` → the
two list answers).

Window-nav gating (SHIPPED, now normative): when any of `after-select-window` /
`after-next-window` / `after-previous-window` / `after-last-window` is present in
`commandEvents`, the generic `activeWindowChanged` multi-candidate set is **suppressed** — the
events alone classify the movement, preserving the targeted-vs-generic distinction (defect 2).
The config guarantees every window-nav input path writes one of these exact events (§2.4); the
state-diff set remains as the no-events safety net.

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
   text must emit nothing. R3: `renamedWindow` is now produced by identity-based detection (§11.1),
   so this fires regardless of window count / duplicate names; the detector code and its shape are
   unchanged.

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

Practice `view()` (SHIPPED R3, §11.2): for a `kind: 'command'` step, append the command's
`shortcut` from `COMMAND_SHORTCUTS` (`${prompt} — ${shortcut}`); `kind: 'copy-mode-action'` steps
render `prompt` verbatim; challenge `view()` is never hinted. R4 preserves this composition; only
the sequencing changes (§12.1).

### 6.2 The shared attach loop (NEW)

```ts
export type RunLoopDeps = {
	server: Pick<IsolatedTmuxServer, 'attach' | 'isAlive' | 'ensureRunning' | 'liveHooks'>; // R2: + liveHooks
	observer: Pick<TmuxObserver, 'watch' | 'resetBaseline' | 'drainDelta' | 'exec' | 'expectEvents'>;
	ui: StatusLine;
	engine: StepEngine;
	/** One-line notices printed to the launching terminal between attaches. Default: no-op. */
	notify?: (message: string) => void;
	/** Injectable time for tests. Defaults: real setTimeout / Date.now. */
	clock?: { sleep(ms: number): Promise<void>; now(): number };
	reattachDelayMs?: number; // default 1000 — the Ctrl-C abort window
	rapidExitMs?: number; // default 2000 — attach shorter than this counts toward the guard
	maxRapidExitsWithoutProgress?: number; // default 3 — then abort (tight-loop guard)
	sessionName?: string; // recovery session name (default server's initialSession)
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
  6. if firstAttach: observer.expectEvents(
         expectedSinkEventsFor([RUNNER_ATTACH_COMMAND], server.liveHooks))
                                                       // R2: liveness-aware (§2.3 rule 1) — no more
                                                       // hardcoded event list. Suppresses the first
                                                       // attach's own sink events. Recovery
                                                       // re-attaches are intentionally NOT
                                                       // suppressed (they may legitimately satisfy
                                                       // an attach-session step)
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
	constructor(args: {
		server: IsolatedTmuxServer;
		observer: TmuxObserver;
		session: CliChallengeSession;
		ui: StatusLine;
		notify?: (m: string) => void;
	});
	/** Build the CliChallengeSession-backed StepEngine, delegate to runAttachLoop, then:
	 *  completed → { completed: true, finish: await session.finish() };
	 *  aborted   → { completed: false, aborted: true }. */
	run(): Promise<ChallengeRunResult>;
}

export class PracticeController {
	// R4: takes the FULL ordered drill list, not a single item (§12.1).
	constructor(args: {
		server: IsolatedTmuxServer;
		observer: TmuxObserver;
		items: PracticeItem[];
		ui: StatusLine;
		notify?: (m: string) => void;
	});
	/** Flattened (item, step)-pair StepEngine over ALL items + ONE runAttachLoop. Detaching NO
	 *  LONGER ends a drill — the loop re-attaches, and the run continues in place through the whole
	 *  sequence (challenge parity). */
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

	flash(message: string): Promise<void>; // KEEP (display-message)

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
- `practice.ts` (**R4 restructured — supersedes the shipped per-item loop**): create **one**
  isolated server for the whole drill list, construct one `TmuxObserver` + `StatusLine` +
  `PracticeController({ items, … })`, run it once, tear the server down once in `finally` (§12.1).
  The shipped per-item `for` loop, per-item `createIsolatedTmuxServer`/`teardown`, per-item
  `info("\n{title} — {description}")` banner, and the "user detached → break" branch are all
  removed. Keep the pre-run intro `info(...)` (drill count + "Ctrl-C to quit") and the closing
  `Completed <c>/<total>` summary derived from the controller result. Category filter and
  `EXIT_USAGE`/empty-set handling KEEP.

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
  dirs on any of those paths. **R4:** practice is now a single continuous run (§12.1) — the same
  LIFE1 guarantee spans the whole drill sequence, and the one server is torn down once.
- **PR1 (NEW)** — exactly one prompt source of truth: the `@speedrun_prompt` user option, rendered
  by the static `status-left` set once in the conf. Runtime code never writes `status-left`. The
  loop re-asserts the current prompt before every attach (loop step 2).
- **SUP1 (R2-amended)** — every runner-origin action that fires an installed hook **or an alias
  interceptor** is accounted with the exact per-machine multiset (`expectedSinkEventsFor(args,
liveHooks)`, §2.3): execs go through the observer's `exec()`, non-exec actions (the first
  attach's spawned client) through `expectEvents()` — or the events are neutralized by a
  subsequent `resetBaseline` (the only cover for `ensureRunning`'s internal execs, §2.4). The
  hook AND alias sets never cover the runner's guaranteed-silent commands (`set-option`,
  `show-options`, `show-hooks`, `display-message`, `list-panes`, `refresh-client`). Never add a
  hook or alias for a command the runner executes without extending the §2.4 tables (which feed
  the accounting). Sole deliberate exception: recovery re-attaches (loop step 6 note).
- **OS1 (R2, ONESHOT, plan §8.1)** — every pool command's step must be completable by
  performing **any one** of its documented input forms (the `shortcut` strings in
  `src/lib/data/tmux-commands.ts`, plus canonical full names and tmux's builtin short aliases)
  **exactly once, from any reachable run state** — including the minimal state (1 session,
  1 window, 1 pane, attached, 0 buffers). Detection is therefore input-based (write-first
  rebind/alias, §2.4), so a no-op or erroring invocation still advances. Sole exemption: the
  copy-paste sequence step (documented multi-action procedure by design). Enforced structurally
  by the ONESHOT completeness test (§10-R2). The dual failure mode — self-completion via
  over-detection — is equally forbidden and guarded by SUP1's multiset accounting. **R4** depends
  on OS1 directly: the continuous practice session accumulates state (extra windows/panes/sessions
  from earlier drills), and OS1 is precisely what keeps every later drill completable from that
  accumulated state without a per-drill reset (§12.1).
- **CC1/CS1/NOSPOOF (KEEP)** — no changes to canonical answer strings, the key chain, crypto code,
  or server endpoints; timing stays server-authoritative. **R4** repoints only the base API origin
  constant (§12.2); the loopback receiver, CSRF `state`, and token handling are unchanged.

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

> The unit/integration surface above is **SHIPPED** on the branch (the suites exist and pass);
> tdd's job this round is §12-R4 below. Where an R4 change breaks a shipped test's assumption
> (notably the `PracticeController({ item })` single-item shape), update the shipped test to the
> new `items` contract rather than preserving the stale shape.

### §10-R2 — test surface for the ONESHOT round

Unit (no tmux):

- `config.test.ts` (extend): conf text contains every §2.4b R2 rebind (arrows with `-r`, `o`, `z`,
  `']'`, `q`, `'?'`), every §2.4c R2 alias, both shims, and the `speedrun-attach` alias line; the
  rebind/alias conf lines are derived from `KEY_REBINDS`/`COMMAND_ALIASES` (one line per table
  entry/name — coverage by construction); still no hook or alias for any guaranteed-silent command
  (§2.2). `expectedSinkEventsFor` liveness matrix (§2.3):
  `['show-buffer']` with `after-show-buffer` live → alias + hook lines (the review double-count
  case); dead → alias line only; `['select-window',…]` with live hook → `after-select-window` +
  `WINDOW_NAV_TRIGGER` (rewrite); `['kill-session']` → alias + hook-if-live + `session-closed`-if-
  live; `['detach-client']` gated on `client-detached` liveness; `['speedrun-attach']` → gated
  `client-attached`/`after-attach-session` and nothing else; `['attach-session']` → shim modeling
  (`after-attach-session` + `after-switch-client`-if-live); silent commands → `[]`.
- `oneshot.test.ts` (NEW — the "never again" net): parse every `TMUX_COMMANDS.shortcut` string
  from `src/lib/data/tmux-commands.ts` (tolerant of the heterogeneous formats: `'prefix + { or }'`,
  `'tmux ls, tmux list-sessions'`, `'prefix + <0-9>'`, `'prefix + Ctrl+o'`, `'prefix + Arrow'`,
  forms with `<arg>` placeholders) and assert each documented input form is covered by a
  `KEY_REBINDS` entry, a `COMMAND_ALIASES` name, or an entry in an **explicit named exemption
  list** — silent skips are forbidden; an unparseable form must fail the test. Normative
  exemptions (each with its guaranteed channel): `prefix + d` (detach → `client-detached`),
  `tmux kill-server` (→ `SERVER_DIED_EVENT`), and the state-diff-guaranteed keys always
  performable from minimal state — `prefix + c`, `"`, `%`, `x`, `&`, `[`, `,`, `$` — plus the
  copy-paste sequence step (OS1 exemption). A future pool command added without a channel fails CI.
- `observer.test.ts` (extend): `exec()` accounts with the server's **current** `liveHooks`
  (mutating the fake server's set between calls changes what gets suppressed).
- `detector.test.ts` (extend): `ZOOM_KEY_EVENT` → `toggle-zoom`; `WINDOW_NAV_TRIGGER` alone maps
  to no candidate (trigger-only).
- `server`: `sanitizedClientEnv` strips exactly `TMUX`/`TMUX_PANE` and preserves everything else.

Integration (`live-server.integration.test.ts`, tmux-gated, no TTY — extend with plan §8.5's five):

1. Per aliased typed form (every name in `COMMAND_ALIASES`): one scripted exec produces **exactly**
   the `expectedSinkEventsFor(form, server.liveHooks)` multiset of sink lines — pins per-machine
   hook/alias balance. For shim spellings whose trailing command errors in the scripted context,
   expect the rule-2 subset (§2.3).
2. `list-keys` output shows every `KEY_REBINDS` key bound to the sink write plus the right final
   command.
3. `show-hooks -g` parsing works (`liveHooks` ⊆ `SINK_HOOKS`, non-empty on a real server), and
   every `SINK_HOOKS` entry is live **or** its dependent documented forms are covered by
   rebind/alias — version drift fails tests instead of stranding a step.
4. Nested-shim behavior: a scripted client exec with `TMUX` set in its env runs `new-session` → a
   real detached session appears (no "nested with care" error) and the sink got
   `after-new-session`.
5. Config-error absorption still works with the attach shim installed: after server start **and**
   after a scripted `ensureRunning` restart, a fresh control client attaching via `speedrun-attach`
   sees no queued config-error output. Plus the spawn regression: with a recording `spawnImpl`,
   both client spawns (`attach()`, absorb) use `speedrun-attach` and an env without
   `TMUX`/`TMUX_PANE`.

Manual acceptance = the issue checklist **plus the PR #46 feedback verbatim**: one visible prompt
updated in place; `prefix + <n>` completes window-by-number; runs containing detach/kill-session
complete end-to-end; `tmux new` advances a "start a new session" step from inside the run;
`prefix + Arrow` advances a "select a different pane" step with a single pane; `tmux a` advances an
"attach to a session" step; one full challenge-0 run and one of challenge 3–5 with no stuck step;
no orphan servers after terminal close. `cd cli && npm test` + `npm run typecheck` clean — run on
a machine **with tmux installed** (the integration suite skips silently without it).

---

## 11. Revision 3 — PR #46 second feedback (plan §9)

Four fixes. All in `cli/`. Where §11 conflicts with an earlier section, §11 wins. No change to
canonical answer strings, the key chain, crypto, the generator, the API, or the web app.
`practice-flow.ts` (shared with web) is **not** modified.

### 11.1 Identity-based window-rename detection (BUG — amends §1, §4, §5.2.4)

**Problem:** `observer.diff` currently detects window renames by comparing the two snapshots'
window-**name lists** as sets (`detectRename(prev.windows.map(w=>w.name), next.windows.map(w=>w.name))`,
`observer.ts:186`). With more than one window this fails whenever any name is shared: renaming one of
two `zsh` windows to `fast-orbit-69` yields `removed=[]` (a `zsh` remains) so no rename is detected,
and the challenge rename step can never advance. It only worked with a single window (names can't
collide). Reported case 1.

**Contract (ADAPT `observer.diff`):**

- `StateDelta.renamedWindow` keeps its shape `{ from: string; to: string } | undefined` (§1) — **no
  type change**, so the detector (§5.2.4) and its tests are unchanged.
- Detection basis changes from name-set membership to **window identity**. `TmuxState.windows`
  already carries `{ session, index, name, active }` (types.ts:23), so identity
  `key = \`${session}:${index}\`` is available with no new tmux query.
- Algorithm: build `Map<key, name>` from `prev.windows`; for each `next.window` whose `key` exists in
  **both** maps, if `prevName !== nextName` that window was renamed. Emit
  `renamedWindow = { from: prevName, to: nextName }`. If several changed in one delta (rare — one
  rename per ~150 ms tick), return a single result (any of them; prefer the last in `next` order for
  determinism) — the detector only needs `renamedWindow.to` to equal `step.requiredInput`, and
  `deriveCandidates` stays pure/deterministic over `(delta, step)` (DET1).
- **Sessions are unaffected**: tmux enforces unique session names, so
  `renamedSession = detectRename(prev.sessions, next.sessions)` stays as-is (keep the existing
  name-set `detectRename` for sessions only).

**Edge cases (must hold):** a window renamed to a name a sibling already has is still detected
(identity, not name, is the key); a rename in the same tick as a window add/remove is not confused
with the add/remove (only keys present in **both** snapshots are compared); a window that changes
`index` with an unchanged `name` (e.g. after a sibling kill) is **not** a rename (its key changed, so
it isn't matched). ONESHOT (OS1) holds: one rename action advances the step from any window count.

`hasChange` still returns true on `renamedWindow` (§4, unchanged).

### 11.2 Practice-mode command hint (UX — amends §6.1)

**Problem:** practice steps render only `step.prompt` (the command description); the user is never
shown the keystrokes/typed form. Reported case 2.

**Contract (ADAPT `PracticeController`'s `StepEngine.view()` in `controller.ts:258`):** compose the
hint CLI-side (do **not** touch the shared `practice-flow.ts`).

- Build a `commandName → shortcut` lookup once from `TMUX_COMMANDS` (imported from
  `$lib/data/tmux-commands`).
- For a `kind: 'command'` step, `view()` returns
  `{ prompt: \`${step.prompt} — ${shortcut}\`, index, total }` (e.g.
  `Rename the current window — prefix + ,`). If a `commandName` has no `TMUX_COMMANDS` match
  (shouldn't happen), fall back to the bare `step.prompt` (no trailing separator).
- For a `kind: 'copy-mode-action'` step, `view()` returns `step.prompt` **verbatim** (it is already a
  step-by-step instruction — no shortcut appended).
- Only `view()`'s `prompt` changes; `detectionStep()`, `seedInput()`, `trySubmit()` are unchanged.
- **Challenge mode is not given hints** (`ChallengeController` tests recall) — its `view()` is
  unchanged; no shortcut is leaked into the challenge prompt.
- The composed prompt flows through `StatusLine.sanitize` (truncate 118, `#`→`##`, §7) as today —
  keep hints concise; no extra handling needed.

### 11.3 `new-session` create-and-switch + verified shim interception (amends §2.1, §2.2)

Two requirements from reported case 3: (a) the nested-session error must never surface and the step
must always advance (the §2.4a `new-session → new-session -d` shim's job — **verify it actually
fires** for the user's typed forms); (b) the user must be **switched into** the newly created
session, which `new-session -d` alone does not do.

**(a) Verify/repair typed-form shim interception (config-level).** The user still saw
`sessions should be nested with care`, meaning for their invocation the `new`/`new-session`
`command-alias` did **not** win over tmux's builtin lookup. Implementation must reproduce
`tmux new` / `tmux new-session` / `tmux new -s <name>` (and, for completeness, `attach` / `a` /
`attach-session` / `ls` / `list-sessions`) from a client with `$TMUX` set on the target tmux and
confirm the alias intercepts (no nested error, step advances). If a form is not intercepted (e.g. a
tmux version resolves the builtin/abbreviation before the `command-alias` array, or a lower-index
default entry shadows `set -s command-alias[100+]`), repair so interception reliably wins — options:
assign at the front of the array, add the exact spellings the user types, or (last resort) a key-table
rebind. The §11.5 integration assertion must exercise the **typed nested-guard path** (a `$TMUX`-set
client), so a regression fails CI instead of stranding the user with the nested error.

**(b) Switch into the new session via an appended `after-new-session` hook (config text, §2.1).**
`after-new-session` is one of the **live** hooks (must be confirmed present in `server.liveHooks` at
implementation — §3). Append, kept separate from the existing sink-writing `after-new-session` hook
via `-ga`:

```
set-hook -ga after-new-session 'switch-client -t "#{hook_session}"'
```

Normative properties:

- **No accounting change.** `switch-client` run **from a hook** does not fire `after-switch-client`
  (tmux never runs `after-*` hooks for hook-issued commands — the property §3.2 already relies on),
  so this adds **no** sink line: `expectedSinkEventsFor(['new-session'], liveHooks)` (§2.3) is
  **unchanged** (still alias-write `after-new-session` + live-hook `after-new-session`-if-live). Do
  not add a rule for it.
- **Runner-origin detached creates are safe.** For the initial server-start `new-session -d` and
  `ensureRunning`'s recovery `new-session` there is no attached client at that instant, so the hook's
  `switch-client` is a harmless no-op / quiet error — and it runs inside the loop's drain →
  `resetBaseline()` fast-forward window (§2.4, load-bearing) so it can't produce a spurious delta.
  Verify on real tmux that it does not emit a visible warning that would pollute the user's first
  attach; if it warns, gate the hook on a client check (e.g. `#{?client_...}`) — pin in step 0.
- **`#{hook_session}`** is the expected format for the newly created session inside
  `after-new-session`; confirm against the running tmux (a bare `switch-client` may also suffice
  since the new session is the hook's current target). Implementation detail to pin in step 0.
- Both modes get this from the shared `buildIsolatedConfig`, satisfying "for both modes" with no
  per-command duplication (the feedback's belief that practice lacks the override is addressed by
  making the override actually fire — both modes already build the same isolated config). **R4** then
  makes practice a single continuous run (§12.1), so the switch-into-new-session behavior is visible
  in practice exactly as in challenge.

`after-new-session` stays in `SINK_HOOKS` (§2.2) — the appended switch hook is a **second** binding
on the same event, not a replacement.

### 11.4 `tmux-speedrun debug` command (NEW — `cli/src/commands/debug.ts`)

A diagnostic that reuses the existing server/observer/detector stack so it exercises exactly the code
paths a stuck command flows through. Registered in `cli/src/index.ts` and documented in `help.ts`.

```ts
/** `tmux-speedrun debug [--verbose]` — print game/tmux diagnostics; exit 0 ok, 2 preflight, 1 runtime. */
export function debugCommand(argv: string[]): Promise<number>;
```

Behavior:

1. **Environment**: tmux version (`tmuxVersion()`), OS/platform, and the `requireInteractiveTmux`
   preflight result (do not hard-fail on the TTY check for the non-attach diagnostics — but the live
   trace in step 3 needs a TTY; degrade gracefully).
2. **Isolated-server diagnostics**: `createIsolatedTmuxServer()`, then print `socketName`, `confPath`,
   `eventSink`, and the **live vs. dead hook partition** `server.liveHooks` ∩ / ∖ `SINK_HOOKS` (the
   single most useful "why isn't my command detected" signal). Under `--verbose`, also print the full
   generated config text and the `KEY_REBINDS` / `COMMAND_ALIASES` tables.
3. **Live event/candidate trace** (core value): attach interactively (reusing the isolated server)
   and, via a `TmuxObserver.watch` callback, print each observed delta's `commandEvents` and the
   `deriveCandidates(delta, step)` output to the **launching terminal** (through `notify`), so the
   user presses keys and sees exactly what the detector sees. Drive it with a trivial
   always-incomplete `StepEngine` (or a direct `watch`) — no challenge session, no API. On
   detach / Ctrl-C, tear down.
4. Always `teardown()` in `finally` — no orphan server / temp dir (LIFE1).

Scope guard: obeys **ISO1** (private socket only); **must not** contact the API, leaderboard, or
crypto; read-only w.r.t. the user's real tmux. Because it shares the observer/detector, it is also a
regression aid for §11.1/§11.3 (renaming a window or running `tmux new` in `debug` prints the
`rename-window` / `new-session` candidate).

Split the pure assembly (env + live/dead-hook partition + config summary → formatted string) into a
unit-testable function; the attach/trace path is integration/manual.

### 11.5 Test surface for R3 (delta on §10 / §10-R2)

Unit (no tmux):

- `observer.test.ts` (extend — §11.1 regression, the "never again" net): `diff` detects
  `renamedWindow` when two windows share the pre-rename name and one is renamed
  (`windows [zsh@0, zsh@1] → [zsh@0, fast-orbit-69@1]` ⇒ `{ from: 'zsh', to: 'fast-orbit-69' }`);
  detects it across two ticks when both are renamed; detects it when a window is renamed while an
  unrelated-named sibling exists; does **not** report a rename for a pure window add/remove or for an
  index change with an unchanged name. Session rename via `detectRename` unaffected.
- `detector.test.ts` (extend): with identity-based `renamedWindow`, `rename-window:<text>` is emitted
  only when `to === requiredInput` (the existing tightened-rename test at `detector.test.ts:155`/`406`
  still passes); bare `rename-window` still present for practice. No new detector behavior.
- `config.test.ts` (extend — §11.3): generated text contains the appended
  `set-hook -ga after-new-session 'switch-client …'` line **and** still the original sink-writing
  `after-new-session` hook; `after-new-session` remains in `SINK_HOOKS`; assert
  `expectedSinkEventsFor(['new-session'], liveHooks)` is **unchanged** by the appended switch hook.
- practice-hint (`controller` unit or a small practice test — §11.2): practice `view()` for a
  `command` step includes the command's `shortcut` (`— <shortcut>` suffix); a `copy-mode-action`
  step's prompt is returned verbatim (no bogus hint); challenge `view()` is unchanged (no shortcut
  leaked).
- `debug` (§11.4): the pure diagnostic-assembly function (env + live/dead-hook partition + config
  summary) is unit-testable without tmux; the attach/trace path is integration/manual.

Integration (`live-server.integration.test.ts`, tmux-gated, no TTY):

1. §11.1 at the tmux level: a scripted rename of a window when a same-named sibling exists produces a
   `renamedWindow` delta.
2. §11.3: a scripted client with `TMUX` set runs `tmux new` / `tmux new-session -s x` → **no**
   `sessions should be nested with care` error, a real detached session appears, the sink got
   `after-new-session`, **and** the appended switch hook moved the client to the new session (assert
   the active session changed to it). Same script confirms `attach` / `a` / `ls` typed forms do not
   error under the nested guard (§11.3a).

Manual acceptance (feedback verbatim): complete challenge 0 including a rename step **with two
windows present** without killing the session; practice mode shows the hotkey/typed form for every
drill; `tmux new` in both challenge and practice creates a session, **switches into it**, and
advances with no nested error; `tmux-speedrun debug` prints version, live/dead hooks, and a live
event→candidate trace as keys are pressed, and tears down cleanly (no orphan `tmux -L
tmux-speedrun-*`). `cd cli && npm test`, `npm run typecheck`, and `npx prettier --check` on all
branch-touched files must be green (run where tmux is installed — the integration suite skips
silently otherwise).

---

## 12. Revision 4 — PR #46 third feedback (plan §10)

Two fixes. All in `cli/`. Where §12 conflicts with an earlier section, §12 wins. No change to
canonical answer strings, the key chain, crypto, the generator, the API, or the web app
(`practice-flow.ts` is **not** modified).

### 12.1 Continuous practice mode — one server, one run over all drills (UX — amends §6.1, §6.3, §8)

**Problem:** practice is structured as **one isolated server per drill**. `practice.ts` loops over
`createPracticeItems(...)` and, for each item, creates a server, runs a single-item
`PracticeController`, and tears the server down. Each `PracticeController.run()` uses the shared
`runAttachLoop`, whose completion path (`controller.ts:91-96`) issues `detach-client`. So every drill
ends by detaching the client, tearing down that drill's server, spinning up a fresh server, and
re-attaching for the next drill — the "detach then re-attach on almost every command" the user
reports. Challenge mode does not have this problem: it runs **one** server and **one** `runAttachLoop`
over **all** steps, so between steps the prompt is replaced in place with no detach. Reported case 1.

**Contract — `PracticeController` runs the whole drill list in one continuous loop** (mirrors
challenge exactly):

- **Constructor shape CHANGES (breaking, R4):** `PracticeController` takes `items: PracticeItem[]`
  (the full ordered drill list) instead of a single `item` (§6.3). All shipped tests / callers that
  construct it with `{ item }` must migrate to `{ items }`.
- Its `StepEngine` **flattens** all items into a linear list of `(item, step)` pairs and tracks a
  single global `index` across the whole sequence. Define the flat list once in `run()`:
  `flat = items.flatMap(item => item.steps.map(step => ({ item, step })))`; `total = flat.length`.
  - `isComplete()` → `index >= total`.
  - `view()` → the current pair's step, with the **already-shipped §11.2 hint unchanged**:
    `command` steps append `— ${shortcut}` (lookup from the existing `COMMAND_SHORTCUTS` map);
    `copy-mode-action` steps keep their verbatim `prompt`. `index` / `total` are the **global**
    position, so the status line shows running progress across the whole command set (e.g.
    `[3/25] Rename the current window — prefix + ,`).
  - `detectionStep()` → `{ prompt: flat[index].step.prompt, seedInput: flat[index].item.seedInput }`
    (the **current pair's item** seedInput — only the appended copy-paste item carries one; all
    other drills have `undefined`, unchanged behavior).
  - `seedInput()` → `flat[index].item.seedInput` (same source as `detectionStep`).
  - `trySubmit(candidates, delta)` → **unchanged per-step matching** against `flat[index].step`
    (`command` step: `candidates.includes(step.commandName)`; `copy-mode-action` step:
    `delta.enteredCopyMode || delta.bufferAdded !== undefined || delta.pasteObserved === true`). On
    match, `index++`.
- `run()` builds that engine and delegates to **one** `runAttachLoop(...)` (same deps wiring as
  challenge), returning `{ completed, aborted }` from the result exactly as today.
- **`practice.ts` (§8, R4):** create **one** `createIsolatedTmuxServer({ initialSession: 'practice' })`,
  one `TmuxObserver` + `StatusLine` + `PracticeController({ items, observer, ui, server, notify })`,
  run it once, tear the server down once in `finally`. Remove the per-item `for` loop, the per-item
  server/teardown, the per-item `info("\n{title} — {description}")` banner, and the "user detached →
  break" branch. Keep the pre-run intro `info(...)` (drill count + "Ctrl-C to quit"; already says
  detaching re-attaches automatically) and the closing `Completed <c>/<total>` summary derived from
  the controller result (`completed` ⇒ all drills; `aborted` ⇒ report the run stopped). Category
  filter and `EXIT_USAGE`/empty-set handling KEEP.

Why this is safe and correct:

- **Continuity is exactly what challenge already does** — practice now inherits the same
  single-attach-loop lifecycle (LIFE1). Detach / kill-session / kill-server **drills** are handled by
  the loop's classify → recover → re-attach path (§6.2) instead of by a teardown between drills; the
  user stays attached across the whole practice run, and only genuine detach/kill drills (and final
  completion) ever end an attach, identically to challenge.
- **OS1 (ONESHOT) makes a shared, accumulating session viable.** Every command is completable from
  _any_ reachable state via input-based write-first detection (§2.4), so running all drills in one
  session — where state accumulates (extra windows/panes/sessions from `new-window`, `split-*`,
  `new-session`, etc.) — cannot strand a later drill. This is the precondition that lets practice
  drop the "fresh session per drill" isolation without reintroducing stuck steps.
- **Ordering & seed:** drills run in `createPracticeItems` order (TMUX_COMMANDS order, copy-paste
  sequence appended last), so per-step `seedInput` is only ever the copy-paste seed while those steps
  are current — matching today's per-item behavior.

`practice-flow.ts` (shared with the web practice page) is **not** modified — the flattening and hint
composition stay in the CLI `PracticeController` / `practice.ts`, consistent with §11.2's scope rule.

### 12.2 `login` uses the wrong origin (BUG — new pin on `cli/src/config.ts`)

**Problem:** `login.ts` builds the browser URL as
`${baseUrl}/api/auth/cli/login?port=…&state=…`, where `baseUrl` comes from `resolveConfig` → the
pinned `DEFAULT_API_ORIGIN` (`config.ts:18`), currently `https://tmux-speedrun.vercel.app`. So an
unconfigured `tmux-speedrun login` opens the Vercel preview origin, and the GitHub OAuth callback
redirects through the wrong host. Reported case 2.

**Contract (ADAPT `cli/src/config.ts`):**

```ts
export const DEFAULT_API_ORIGIN = 'https://tmux-speedrun.xyz';
```

- No trailing slash (`trimTrailingSlash` normalizes regardless; path joins already prepend
  `/api/...`). This is the **single source** of the base origin for **all** CLI API calls (login,
  challenge session, leaderboard, record), so it aligns every request with the canonical production
  domain, not just login.
- `login.ts` and `resolveConfig` are otherwise **unchanged** — the fix is the constant only.
- The `--server <url>` flag and `TMUX_SPEEDRUN_API` env override remain the supported dev escape
  hatches (e.g. `http://localhost:5173`) and still take precedence over the constant.
- No other file references the old origin (verified by grep); there is no existing `config.test.ts`
  asserting the constant.

### 12.3 Test surface for R4 (delta on §10 / §10-R2 / §11.5)

Unit (no tmux):

- **Practice engine (`controller` test)** — with two or more `PracticeItem`s, the flattened
  `StepEngine` progresses a **single global index** across items (advancing item A's step then item
  B's step) with **no** intervening detach; `view()` reports the **global** `index` / `total` and
  appends the `shortcut` hint for `command` steps only (`copy-mode-action` prompts verbatim);
  `seedInput()` / `detectionStep().seedInput` return the copy-paste seed only while a copy-paste step
  is current (`undefined` otherwise); a `command` step matches on `candidates.includes(commandName)`.
  **Migrate** every shipped `PracticeController` test that constructs it with a single `item` to the
  new `items` array shape (this is the §10 "update the shipped test to the new contract" note).
- **Practice command wiring** (light) — `practice.ts` constructs exactly **one** isolated server for
  the whole run (guards the "detach between drills" regression structurally — e.g. assert
  `createIsolatedTmuxServer` is called once for a multi-drill category via an injected/spied factory,
  or cover it at the controller level if the command isn't unit-seamed).
- **Login origin** — assert `DEFAULT_API_ORIGIN === 'https://tmux-speedrun.xyz'` and that
  `resolveConfig({})`.`baseUrl` yields it (and, if `login.ts` is unit-seamed, that the login URL is
  built against it); `--server` / `TMUX_SPEEDRUN_API` overrides still win.

Integration / manual: no new tmux-gated integration is required for R4 (the continuous-loop behavior
is covered by the shipped `run-loop.test.ts` structural tests plus the manual acceptance below).

Manual acceptance (feedback verbatim): run `tmux-speedrun practice` and confirm completing a drill
(e.g. "rename current window") advances **in place** to the next drill with **no** detach/re-attach
flicker, the whole command set is cycled once, and each drill shows its hotkey; detach/kill-session
drills still recover and continue (challenge parity). `tmux-speedrun login` (no flags) opens
`https://tmux-speedrun.xyz/api/auth/cli/login?...`. `cd cli && npm test`, `npm run typecheck`, and
`npx prettier --check` on all branch-touched files must be green (run where tmux is installed — the
integration suite skips silently otherwise).

### 12.4 Risks & edge cases (delta on §7 / §8.6 / §11.7)

- **Accumulating practice session state**: running every command in one session grows tmux state
  (extra windows/panes/sessions). OS1 guarantees each remaining drill is still completable; no
  per-drill reset is needed or wanted (a reset would reintroduce the detach the user asked us to
  remove). If a specific later drill is ever found un-completable from accumulated state, that is an
  OS1 gap to fix in the detection channel, not a reason to restore per-item servers.
- **Detach / kill drills mid-practice**: identical to challenge — the run loop's ~1s Ctrl-C notice +
  recovery applies. Acceptable and consistent (the intro already tells the user detaching re-attaches
  automatically).
- **Login origin**: `https://tmux-speedrun.xyz` must actually serve `/api/auth/cli/login` and the
  OAuth callback (it is the canonical production deployment); this is a pinned-constant change only —
  the loopback receiver, CSRF `state`, and token handling are unchanged.
- ISO1 / DET1 / LIFE1 / PR1 / SUP1 / OS1 and the canonical-answer / crypto invariants unchanged.
