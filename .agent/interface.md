# Interface: `tsr lb` home-screen command — all-challenge leaderboards in a pager

Issue: jzohdi/tmux-speedrun#38 · Plan: `.agent/plan.md`

> This spec **replaces** the previous `.agent/interface.md` (which documented the shipped #35 CLI
> work). It pins the types, signatures, module boundaries, data shapes, and invariants the `tdd`
> and implementation stages build against. Where an existing module is quoted, its current
> behaviour is normative and must not change unless this spec says **MODIFY** or **NEW**.

Legend: **NEW** = create · **MODIFY** = change existing · **REUSE** = import unchanged.

## 0. Module map

```
src/lib/components/
  Pager.svelte                 NEW     pager shell (keys/scroll/focus/status bar), extracted from Manpage
  Manpage.svelte               MODIFY  content-only; wraps <Pager>; public props UNCHANGED
  LeaderboardPager.svelte      NEW     all-challenge leaderboard content rendered inside <Pager>
  Terminal.svelte              MODIFY  'lb-pager' mode, dispatch, help text, focus, body class
src/routes/
  +page.svelte                 MODIFY  add `tsr lb` hint to the hints array
src/lib/queries/leaderboard.ts REUSE   createLeaderboardQuery(), getEntriesForChallenge()
src/lib/data/challenges.ts     REUSE   getAllChallengeMetadata(), getChallengePoolCount(), isValidChallengeId()
src/lib/components/tmux/PaneView.svelte   UNTOUCHED (external consumer of `.manpage-container`)
src/routes/api/leaderboard/+server.ts     UNTOUCHED (no API changes)
cli/                                      UNTOUCHED (out of scope)
```

No backend, API, DB, or dependency changes.

## 1. `src/lib/components/Pager.svelte` — NEW

Generic man-page-styled pager shell. Everything listed here moves **verbatim** from the current
`Manpage.svelte` (src/lib/components/Manpage.svelte:40–165 script, 168–313 shell markup, and the
shell CSS); only the props type and the `children` snippet are new.

### Props

```ts
import type { Snippet } from 'svelte';

type PagerProps = {
	onQuit: () => void;                    // called on `q` / `Escape`
	onToggleMaximize?: () => void;         // called on Ctrl/Cmd+Enter (no-op if absent)
	containerRef?: HTMLDivElement | null;  // $bindable(null) — exposes the focusable container
	ariaLabel: string;                     // accessible name of the role="application" container
	children: Snippet;                     // pager body, rendered inside the scroll container
};
```

### Markup contract (carried over verbatim — class names are external API)

```svelte
<div class="manpage-container" role="application" aria-label={ariaLabel} tabindex="0"
     bind:this={containerElement} onkeydown onclick onfocus onblur>
	<div class="manpage-content" bind:this={scrollContainer}>
		{@render children()}
		<div class="content-spacer"></div>
	</div>
	<div class="status-bar"><span class="colon">:</span><span class="cursor" class:visible={isFocused}></span></div>
</div>
```

- **`manpage-container` and `manpage-content` class names MUST NOT be renamed.** External
  consumers: `PaneView.svelte:763` styles `:global(.manpage-container)` from outside (in-challenge
  man page pane-fill layout — no automated coverage), and `Terminal.browser.test.ts:62` queries
  `.manpage-container`. Put a code comment on the container div naming both consumers.
- The container element is synced to the bindable `containerRef` via the existing
  `$effect(() => { containerRef = containerElement; })` pattern.

### Behaviour (moved verbatim from Manpage)

- **Key map** (in `onkeydown` on the container): Ctrl/Cmd+Enter → `preventDefault` +
  `stopPropagation` + `onToggleMaximize?.()`; then unconditional `event.stopPropagation()` for
  every other key, then: `ArrowUp`/`k` scroll up one step (`SCROLL_STEP = 24`px), `ArrowDown`/`j`
  scroll down, `PageUp`/`b` page up, `PageDown`/`f`/`Space` page down, `g` top, `G` bottom,
  `q`/`Escape` → `preventDefault` + `onQuit()`. All scroll keys `preventDefault`.
- **Focus**: focus the container on mount via `setTimeout(..., 0)`; click focuses the container;
  focus/blur toggles `isFocused` driving the blinking `:` status-bar cursor (starts `true`).
- **CSS that moves here** (Svelte styles are component-scoped, so shell CSS must live where the
  shell markup lives): `.manpage-container` (incl. `position: absolute; inset` fill), `.manpage-content`
  (+ webkit scrollbar hiding), `.content-spacer`, `.status-bar`, `.colon`, `.cursor`,
  `@keyframes blink`, and the `@media (max-width: 640px)` rule for `.manpage-container` font-size.

## 2. `src/lib/components/Manpage.svelte` — MODIFY (content-only wrapper)

### Props — UNCHANGED (public API; also consumed by `PaneView.svelte:436`)

```ts
type ManpageProps = {
	onQuit: () => void;
	onToggleMaximize?: () => void;
	containerRef?: HTMLDivElement | null;  // $bindable(null)
	commands?: TmuxCommand[];              // optional filter, as today
};
```

### Body

```svelte
<Pager {onQuit} {onToggleMaximize} bind:containerRef
       ariaLabel="Manual page viewer - use arrow keys or j/k to scroll, q to quit">
	<!-- existing TMUX(1) header + sections, byte-identical markup -->
</Pager>
```

- The aria-label string above is **byte-identical** to today's — tests query
  `getByRole('application', { name: /manual page viewer/i })`.
- Keeps its content CSS (`.manpage-header`, `.manpage-section`, `.section-title`, `.section-body*`,
  `.bold`, `.underline`, `.command-category`, `.category-label`, `.command-entry`,
  `.command-shortcut`, `.command-desc`, and their 640px media rules). Snippet content is compiled in
  Manpage.svelte, so these scoped styles keep applying.
- The `commands` filtering logic (`allowedCommandNames`, `getFilteredCommands`) stays here.
- Observable behaviour of `man tmux` (home page and in-challenge) must be **unchanged**.

## 3. `src/lib/components/LeaderboardPager.svelte` — NEW

All-challenge leaderboard content inside `<Pager>`.

### Props (mirrors Manpage minus `commands`)

```ts
type LeaderboardPagerProps = {
	onQuit: () => void;
	onToggleMaximize?: () => void;
	containerRef?: HTMLDivElement | null;  // $bindable(null)
};
```

Passes `ariaLabel="Leaderboard viewer - use arrow keys or j/k to scroll, q to quit"` to Pager —
tdd queries `getByRole('application', { name: /leaderboard viewer/i })`.

### Data

- Creates its **own** query at init: `const leaderboardQuery = createLeaderboardQuery();`
  (`$lib/queries/leaderboard`). Same query key `['leaderboard']` as the Terminal's instance →
  TanStack dedupes/caches; stale data (>60 s) triggers a background refetch on mount.
- Rendering is template-driven off the reactive result object (`leaderboardQuery.isPending` /
  `.isError` / `.data`), so loading → data transitions update live. Do NOT snapshot the state.
- Challenge list: `getAllChallengeMetadata()` (`$lib/data/challenges`) — render one section per
  entry, in order, **always all of them** (entries come from
  `getEntriesForChallenge(leaderboardQuery.data, meta.index)`, which returns `[]` for missing keys).

### Content contract (exact user-visible strings — tdd asserts these)

Top of the scrollable body, in order:

1. Header line, man-style three-part: `LEADERBOARD(1)` · `tmux-speedrun Leaderboards` · `LEADERBOARD(1)`.
2. Tip line (requirement 2), exact text:
   `Tip: run 'tsr lb <challenge-number>' to view a single challenge's leaderboard.`

Then exactly one of:

- `leaderboardQuery.isPending` → the line `Loading leaderboards...`
- `leaderboardQuery.isError` → the line `Unable to load leaderboards. Try again later.`
- otherwise, for **each** `ChallengeMetadata { index, difficultyLabel }` from
  `getAllChallengeMetadata()`, a section:
  - Heading: `CHALLENGE {index} — {difficultyLabel}` (e.g. `CHALLENGE 0 — Beginner`).
  - If `getEntriesForChallenge(data, index)` is empty:
    `No entries yet. Be the first to complete this challenge!`
  - Else a table with column headers `RANK`, `USERNAME`, `TIME` and one row per entry showing
    `#{entry.rank}`, `{entry.username}`, `{entry.time}` — same visual style as the existing inline
    view in Terminal.svelte (`showLeaderboard`). Entry shape (REUSE, from
    `LeaderboardEntry`): `{ rank: number; username: string; time: string; durationMs: number; verified: boolean }`.

The pager must remain exitable (`q`/`Escape`) in **every** state — Pager owns the keys, so this
holds as long as content never intercepts keyboard events (it must not attach key handlers).

Content CSS lives here (own scoped styles); reuse the man-page look (monospace, `#8be9fd` headings,
`#50fa7b` accents) but class names are free — no external consumers.

## 4. `src/lib/components/Terminal.svelte` — MODIFY

```ts
import LeaderboardPager from './LeaderboardPager.svelte';

type TerminalMode = 'default' | 'list' | 'leaderboard' | 'man' | 'lb-pager';  // +'lb-pager'

let pagerRef = $state<HTMLDivElement | null>(null);  // RENAMED from manpageRef; binds to whichever
                                                     // pager is active ('man' or 'lb-pager' — never both)

function showLeaderboardPager(): void {
	// mirrors showManPage()
	historyLengthBeforeMode = history.length;
	mode = 'lb-pager';
}
```

### Dispatch (in `processCommand`, `tsr lb` branch) — replaces the bare-arg usage error

```ts
if (subcommand === 'lb') {
	const challengeNum = args[1];
	if (!challengeNum) {
		showLeaderboardPager();   // was: usage error
		return;
	}
	showLeaderboard(challengeNum);  // UNCHANGED — inline single-challenge view, incl. its
	return;                         // invalid-id error naming the valid range 0-{max}
}
```

`showLeaderboard()` itself is untouched (requirement 3: no regression).

### Keyboard / focus

- `handleKeyDown`: early-return when `mode === 'lb-pager'`, exactly like the existing
  `if (mode === 'man') return;` branch (Pager stops propagation itself; `q` must not double-fire).
- `focusInput()`: `'lb-pager'` behaves like `'man'` — focus `pagerRef`:

```ts
function focusInput() {
	if (mode === 'default') {
		inputRef?.focus();
	} else if ((mode === 'man' || mode === 'lb-pager') && pagerRef) {
		pagerRef.focus();
	} else {
		containerRef?.focus();
	}
}
```

- Exit path: Pager's `onQuit` is `clearAndResetMode` (existing) — truncates history back to
  `historyLengthBeforeMode` (leaving only the echoed `$ tsr lb` line), returns to `'default'`,
  refocuses the input. No new code.

### Template

```svelte
<div class="terminal-body" class:man-mode={mode === 'man' || mode === 'lb-pager'} bind:this={terminalRef}>
	{#if mode === 'man'}
		<Manpage onQuit={clearAndResetMode} onToggleMaximize={toggleMaximize} bind:containerRef={pagerRef} />
	{:else if mode === 'lb-pager'}
		<LeaderboardPager onQuit={clearAndResetMode} onToggleMaximize={toggleMaximize} bind:containerRef={pagerRef} />
	{:else}
		<!-- existing history / list / input markup unchanged -->
	{/if}
</div>
```

(`man-mode` here is Terminal-scoped CSS — `overflow: hidden; padding: 0` — unrelated to PaneView's
class of the same name; keep the name.)

### `showHelp()` — replace the single `tsr lb <num>` line with two lines (same position, after `tsr ls`)

```
  tsr lb              View all leaderboards (pager)
  tsr lb <num>        View leaderboard for a challenge
```

The `tsr` unknown-subcommand "Available: ..." line already lists `lb` — no change.

## 5. `src/routes/+page.svelte` — MODIFY

Insert one entry into the `hints` array, directly after `tsr ls` (the array is the single source of
truth; displayed string IS the executed string):

```ts
const hints: Hint[] = [
	{ command: 'tsr ls', description: 'list challenges' },
	{ command: 'tsr lb', description: 'view leaderboards' },   // NEW
	{ command: 'tsr start <id>', description: 'begin a challenge' },
	{ command: 'tsr practice', description: 'learn step by step' },
	{ command: 'tsr config', description: 'customize tmux.conf' },
	{ command: 'man tmux', description: 'command reference' }
];
```

Nothing else changes — the existing `{#each hints}` button markup already renders it with
accessible name `Run command: tsr lb` and `onclick={() => terminal?.runCommand('tsr lb')}`.

## 6. Invariants (implementation MUST uphold; tdd tests against these)

1. **Class names `manpage-container` / `manpage-content` are preserved verbatim** in Pager.svelte
   (external API: `PaneView.svelte:763` global override + `Terminal.browser.test.ts:62` selector).
2. **Manpage public props and aria-label are byte-identical** to today's; `man tmux` behaviour
   (home page and in-challenge via PaneView) is observably unchanged. PaneView.svelte untouched.
3. **`tsr lb <arg>` path is byte-identical**: valid id → existing inline view ("Press q to
   return"); invalid id (`abc`, `99`) → existing two-line error naming range `0-{max}`.
4. Bare `tsr lb` never prints the old usage error; it enters `'lb-pager'` mode.
5. Pager exits on `q` AND `Escape` in every query state (pending / error / data / empty), returning
   to `'default'` with history truncated to `historyLengthBeforeMode` and focus on the input.
6. No double key handling: Pager `stopPropagation()`s all handled keys; Terminal's `handleKeyDown`
   early-returns in `'lb-pager'` (and `'man'`) mode.
7. Hint click → `runCommand('tsr lb')` → after `tick()`, focus lands on the pager container
   (`focusInput()`'s `'lb-pager'` branch). `runCommand` itself is unchanged.
8. All `getChallengePoolCount()` challenges render a section in the pager even when the API
   response is missing keys (`getEntriesForChallenge` defaults to `[]`).
9. Ctrl/Cmd+Enter inside the pager toggles terminal maximize (shell behaviour carried over).
10. No changes to `src/routes/api/**`, `src/lib/queries/leaderboard.ts`,
    `src/lib/data/challenges.ts`, or `cli/**`.

## 7. Test contracts (tdd stage)

Browser project (`npm run test:browser -- --run`), module-mocking `$lib/queries/leaderboard` as the
existing tests do (`Terminal.browser.test.ts:9–12`):

- **Stub shapes**: data-bearing stub returns
  `createLeaderboardQuery: () => ({ isPending: false, isError: false, data: <LeaderboardResponse> })`
  and a real pass-through `getEntriesForChallenge: (data, id) => data?.[String(id)] ?? []`;
  pending stub `{ isPending: true, isError: false, data: undefined }`; error stub
  `{ isPending: false, isError: true, data: undefined }`. `LeaderboardResponse =
  Record<string, LeaderboardEntry[]>` keyed by challenge index as a string.
- **Terminal**: `tsr lb` opens `getByRole('application', { name: /leaderboard viewer/i })`; tip
  line visible; per-challenge headings + mocked rows; empty/pending/error lines per §3; `q` and
  `Escape` exit, focus returns to `.terminal-input`, history restored; `tsr lb 2` still renders the
  inline view; `tsr lb 99` / `tsr lb abc` show the invalid-id error; `help` includes the bare
  `tsr lb` line; existing man-mode tests pass **unchanged**.
- **Home page** (`home-page.browser.test.ts`): extend `HINT_COMMANDS` to
  `['tsr ls', 'tsr lb', 'tsr start <id>', 'tsr practice', 'tsr config', 'man tmux']`; clicking the
  `Run command: tsr lb` button opens the pager and moves focus into it.

Server project (`npm run test`) unaffected; `npm run check` and `npm run lint` must pass.
