# Plan: `tsr lb` home-screen command — all-challenge leaderboards in a pager

Issue: jzohdi/tmux-speedrun#38

> This plan replaces the previous `.agent/plan.md` (which covered the now-merged issue #35 CLI work,
> commit `5cca21f`). The existing `.agent/interface.md` also belongs to that shipped work; the
> interface stage for this issue will overwrite it.

---

## 1. Goal (restated)

On the web home page's emulated terminal, a bare `tsr lb` currently prints a usage error. Make it
open a **pager-style view showing every challenge's top-10 leaderboard**, modeled on the existing
`man tmux` pager (first screenful shown, arrow-key/j/k scrolling, `q`/`Escape` exits back to the
prompt). Additionally:

- The pager output tells the user they can run `tsr lb <challenge-number>` for a single challenge.
- `tsr lb <n>` keeps working with **no regression** (we keep the existing inline single-challenge
  view untouched — the lowest-risk reading of requirement 3).
- Add a click-to-run `tsr lb` hint to the home page's hints row.
- Document `tsr lb` in the terminal's `help` output.

Web home page only. The native CLI (`cli/`) is out of scope. **No API or backend changes** —
`GET /api/leaderboard` already returns top-10 entries for all challenges keyed by challenge id.

## 2. How the relevant code works today (grounding)

- **`src/lib/components/Terminal.svelte`** — the home-page terminal.
  - `mode: 'default' | 'list' | 'leaderboard' | 'man'`. `man tmux` sets `mode = 'man'`, which
    renders `<Manpage onQuit={clearAndResetMode} onToggleMaximize={toggleMaximize} bind:containerRef={manpageRef} />`
    filling the terminal body (the body gets `class:man-mode` → `overflow: hidden; padding: 0`).
  - The terminal's `handleKeyDown` returns early in `'man'` mode — the Manpage handles its own keys
    and calls `stopPropagation()`.
  - `clearAndResetMode()` truncates history back to `historyLengthBeforeMode`, returns to
    `'default'`, and refocuses the input. Every mode entry point records
    `historyLengthBeforeMode = history.length` first.
  - `processCommand()` dispatches `tsr lb`: no arg → usage error; with arg → `showLeaderboard(arg)`,
    which validates via `isValidChallengeId` (error names the valid range `0-{max}`), then prints an
    inline top-10 table from the TanStack query (`mode = 'leaderboard'`, "Press q to return").
  - `runCommand(cmd)` (exported) is the clickable-hint path: `processCommand` + `tick()` +
    `focusInput()`. `focusInput()` branches per mode: `'default'` → input, `'man'` → `manpageRef`,
    else → container.
  - The leaderboard TanStack query is created once at component init via `createLeaderboardQuery()`
    (`src/lib/queries/leaderboard.ts`, query key `['leaderboard']`, staleTime 60 s). In TanStack
    Query v6 + Svelte 5 the result is a reactive object, not a store. `getEntriesForChallenge(data, id)`
    pulls one challenge's entries.
- **`src/lib/components/Manpage.svelte`** — the pager to model. Two concerns are mixed in one file:
  1. *Pager shell* (~150 lines): focusable container (`role="application"`, aria-label, tabindex),
     scroll container with hidden scrollbar, key handling (`ArrowUp/k`, `ArrowDown/j`, `PageUp/b`,
     `PageDown/f/Space`, `g`, `G`, `q`/`Escape` → `onQuit`, Ctrl/Cmd+Enter → `onToggleMaximize`,
     `stopPropagation` on everything else), focus-on-mount via `setTimeout`, bindable
     `containerRef`, and the `:`-cursor status bar with blink animation. The container carries
     class `manpage-container`; the scroll container carries `manpage-content`.
  2. *Man-page content*: the TMUX(1) sections and the command-category listing (with the optional
     `commands` filter prop).
  Also used by `src/lib/components/tmux/PaneView.svelte:436` (in-challenge man page), so Manpage's
  **public props must not change**: `{ onQuit, onToggleMaximize?, containerRef? ($bindable), commands? }`.
  PaneView additionally styles it from outside via
  `.pane-view.man-mode :global(.manpage-container) { position: relative; height: 100%; }`
  (`PaneView.svelte:763`), overriding the container's own `position: absolute; inset: 0` so the man
  page fills the pane — so the **`manpage-container` class name is external API too**.
- **`src/routes/+page.svelte`** — `hints` array is the single source of truth for the hint row: the
  displayed string IS the executed string (per #31). Currently five hints.
- **`src/routes/api/leaderboard/+server.ts`** — `LeaderboardResponse = Record<string, LeaderboardEntry[]>`,
  entries `{ rank, username, time, durationMs, verified }`. No changes.
- **`src/lib/data/challenges.ts`** — `getAllChallengeMetadata()` gives
  `{ index, instructionCount, difficultyLabel }` for all 6 challenges; `getChallengePoolCount()`,
  `isValidChallengeId()`.
- **Tests** — Vitest projects: `server` (node) and `browser` (Playwright/Chromium,
  `*.browser.test.ts`). Existing browser tests: `src/lib/components/Terminal.browser.test.ts`
  (runCommand + focus; queries `.manpage-container` by class) and `src/routes/home-page.browser.test.ts`
  (hints row; asserts the exact hint list). Both stub `$lib/queries/leaderboard` with a module mock.

## 3. Approach & architecture

### 3.1 Extract a shared pager shell: NEW `src/lib/components/Pager.svelte`

Requirement 1 demands the *same* interaction as `man tmux`. Rather than duplicating ~150 lines of
keyboard/scroll/focus/status-bar logic into a second component, extract it:

- **`Pager.svelte` (NEW)** owns everything listed under "pager shell" above, moved verbatim from
  Manpage: the container div (`role="application"`, `tabindex="0"`), scroll methods and key map,
  focus-on-mount, blur/focus tracking for the cursor, the status bar, and the container/scrollbar/
  status-bar CSS (which moves here because Svelte styles are scoped). Props:
  `{ onQuit, onToggleMaximize?, containerRef? ($bindable), ariaLabel, children }` — `children` is a
  Svelte 5 snippet rendered inside the scroll container (followed by the existing
  `.content-spacer`).
- **The `manpage-container` / `manpage-content` class names move verbatim too — do NOT rename
  them.** `PaneView.svelte:763` targets `:global(.manpage-container)` from outside the component
  (see §2) and `Terminal.browser.test.ts:62` queries it; renaming would silently break the
  in-challenge man-page layout (no browser test covers PaneView man-mode layout). Add a code
  comment on the container div in Pager.svelte noting these two external consumers. (The name is
  slightly off for a generic pager, but the pager *is* man-page-styled, and keeping it means zero
  changes to PaneView and zero test-selector churn.)
- **`Manpage.svelte` (MODIFY)** keeps its exact public props and becomes content-only: it renders
  `<Pager {onQuit} {onToggleMaximize} bind:containerRef ariaLabel="Manual page viewer - use arrow keys or j/k to scroll, q to quit">`
  with its TMUX(1) sections as the snippet body, keeping its content CSS (`manpage-header`,
  `manpage-section` — no external consumers). Behavior must stay byte-identical: same aria-label so
  `getByRole('application', { name: /manual page viewer/i })` still passes, same container class so
  PaneView's override and the existing focus test (the only test querying `.manpage-container`)
  keep working; PaneView untouched.

Risk note: this refactor touches the in-challenge man page too, but it is prop-compatible and the
existing browser tests cover the man-mode focus/interaction path. If the implementation stage hits
unexpected trouble with snippet extraction, the fallback is a self-contained `LeaderboardPager`
duplicating the shell — but the extraction is the intended design.

### 3.2 NEW `src/lib/components/LeaderboardPager.svelte`

Content component rendering all challenges' leaderboards inside `<Pager>`:

- Props: `{ onQuit, onToggleMaximize?, containerRef? ($bindable) }` (mirrors Manpage; passes an
  aria-label like "Leaderboard viewer - use arrow keys or j/k to scroll, q to quit").
- Creates its own query via `createLeaderboardQuery()` — same query key as the Terminal's instance,
  so TanStack dedupes/caches; mounting when data is stale (>60 s) triggers a background refetch, so
  the pager shows fresh data. Because rendering is template-driven off the reactive result object,
  loading → data transitions live (unlike the existing inline view's frozen snapshot — this is what
  makes the "loading handled gracefully" acceptance criterion work).
- Layout, man-page-styled:
  - Header line, e.g. `LEADERBOARD(1)  tmux-speedrun Leaderboards  LEADERBOARD(1)`.
  - A tip line satisfying requirement 2: `Tip: run 'tsr lb <challenge-number>' to view a single challenge's leaderboard.`
  - `isPending` → `Loading leaderboards...`; `isError` → `Unable to load leaderboards. Try again later.`
    (pager stays open either way; `q` still exits).
  - On data: one section per `getAllChallengeMetadata()` entry — heading
    `CHALLENGE {index} — {difficultyLabel}`, then a RANK/USERNAME/TIME table from
    `getEntriesForChallenge(data, index)` (reuse the column formatting style of the existing inline
    view), or `No entries yet. Be the first to complete this challenge!` when empty. All six
    sections render even when the response is missing keys (`getEntriesForChallenge` already
    defaults to `[]`).

### 3.3 Terminal.svelte wiring (MODIFY)

- Add `'lb-pager'` to `TerminalMode`. New `showLeaderboardPager()`:
  `historyLengthBeforeMode = history.length; mode = 'lb-pager';` (mirrors `showManPage()`).
- Dispatch: in the `tsr lb` branch, no argument → `showLeaderboardPager()` (replaces the usage
  error); with argument → existing `showLeaderboard(arg)` unchanged (invalid ids keep the existing
  helpful error naming the valid range).
- Rename `manpageRef` → `pagerRef` and bind it to whichever pager is active (only one can be).
- `handleKeyDown`: early-return for `mode === 'lb-pager'` exactly like `'man'` (Pager stops
  propagation itself).
- `focusInput()`: treat `'lb-pager'` like `'man'` (focus `pagerRef`) so the clickable hint lands
  focus in the pager after `runCommand('tsr lb')`.
- Template: render `<LeaderboardPager onQuit={clearAndResetMode} onToggleMaximize={toggleMaximize} bind:containerRef={pagerRef} />`
  when `mode === 'lb-pager'`; extend the body class to
  `class:man-mode={mode === 'man' || mode === 'lb-pager'}` (keep the existing class name — it is
  Terminal-scoped CSS, unrelated to PaneView's `man-mode`).
- `showHelp()`: add a bare-`tsr lb` line and keep the single-challenge line, e.g.
  - `tsr lb              View all leaderboards (pager)`
  - `tsr lb <num>        View leaderboard for a challenge`
- The `tsr` unknown-subcommand "Available: ..." line already lists `lb`; no change needed there.

### 3.4 Home page hint (MODIFY `src/routes/+page.svelte`)

Add `{ command: 'tsr lb', description: 'view leaderboards' }` to the `hints` array, placed after
`tsr ls`. Nothing else — the hint row already renders/executes from this single source of truth.

## 4. Files to change

| File | Change |
| --- | --- |
| `src/lib/components/Pager.svelte` | NEW — pager shell extracted verbatim from Manpage |
| `src/lib/components/Manpage.svelte` | MODIFY — content-only, wraps `<Pager>`; public props unchanged |
| `src/lib/components/LeaderboardPager.svelte` | NEW — all-challenge leaderboard content in `<Pager>` |
| `src/lib/components/Terminal.svelte` | MODIFY — mode, dispatch, help text, focus, body class |
| `src/routes/+page.svelte` | MODIFY — add `tsr lb` hint |
| `src/lib/components/Terminal.browser.test.ts` | MODIFY — new `tsr lb` cases (or a sibling browser test file); existing selectors untouched |
| `src/routes/home-page.browser.test.ts` | MODIFY — add `tsr lb` to the asserted hint list + a click-opens-pager case |

No backend, API, DB, or `cli/` changes. `PaneView.svelte` is deliberately untouched — its
`:global(.manpage-container)` dependency is satisfied by keeping the class name (§3.1).

## 5. Risks & edge cases

- **Manpage refactor regression** (also used in-challenge via PaneView): mitigated by keeping
  Manpage's props, aria-label, and the `manpage-container`/`manpage-content` class names identical
  (so PaneView's `:global(.manpage-container)` pane-fill override keeps matching), moving shell
  code verbatim, and the existing browser tests covering man-mode rendering + focus. PaneView
  man-mode *layout* has no automated coverage, so the in-challenge man page gets an explicit
  manual regression check (§6). This is the main risk of the chosen design.
- **Focus flow**: hint click → `runCommand('tsr lb')` → `tick()` → `focusInput()` must focus the
  pager container (new `focusInput` branch); on `q`, `clearAndResetMode()` already refocuses the
  input. Test both.
- **Query states**: pending, error, empty-per-challenge, and missing-key responses all render
  gracefully (§3.2). The pager must remain exitable in every state.
- **No double key handling**: Pager `stopPropagation()`s its keys, and Terminal early-returns in
  `'lb-pager'` mode — `q` must not also reach the terminal handler.
- **`tsr lb <bad-id>`** (e.g. `abc`, `99`): unchanged existing error path — covered by a regression
  test.
- **History hygiene**: entering/exiting the pager must restore history via the
  `historyLengthBeforeMode` mechanism, leaving only the echoed `$ tsr lb` line (same as `man tmux`).
- **Maximize**: Ctrl/Cmd+Enter inside the pager toggles maximize (shell behavior carried over).
- **Mobile/responsive**: pager shell carries over Manpage's 640px media-query font sizing.

## 6. Testing

Browser project (`npm run test:browser -- --run`):

- **Terminal `tsr lb`** (extend `Terminal.browser.test.ts` or add
  `LeaderboardPager.browser.test.ts` following the same module-mock pattern for
  `$lib/queries/leaderboard`, with a data-bearing stub):
  - `tsr lb` opens the pager (`getByRole('application', { name: /leaderboard viewer/i })`), shows
    the tip line and per-challenge sections with mocked entries.
  - Empty data → per-challenge "No entries yet" lines; `isPending` stub → loading line; `isError`
    stub → error line.
  - `q` (and `Escape`) exits back to the prompt; focus returns to the input; history restored.
  - `tsr lb 2` still renders the inline single-challenge view (regression), `tsr lb 99` /
    `tsr lb abc` show the invalid-id error.
  - `help` output includes the bare `tsr lb` line.
  - Man-mode tests still pass **unchanged** — the `.manpage-container` selector at
    `Terminal.browser.test.ts:62` keeps matching because the class name is preserved.
- **Home page** (`home-page.browser.test.ts`): hint list includes `tsr lb` (button with accessible
  name `Run command: tsr lb`); clicking it opens the pager and moves focus into it.

Server project (`npm run test`): unaffected, run as regression. Also `npm run check` and
`npm run lint` must pass.

Manual verification: `npm run dev` → home page → click `tsr lb` hint and type `tsr lb` / `tsr lb 2`
/ `tsr lb 99`; scroll with arrows/j/k/Space, exit with `q`; repeat maximized (Ctrl+Enter).
**In-challenge man-page regression check**: start a challenge, run `man tmux` in the pane, and
confirm the man page still fills the pane (relative/full-height layout via PaneView's
`:global(.manpage-container)` override), scrolls, and exits — this layout has no automated test.
