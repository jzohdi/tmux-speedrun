# Plan: Clickable home-page command-hint labels

Issue: jzohdi/tmux-speedrun#31 — Make home-page command-hint labels clickable to run the command in the terminal.

## Goal (restated)

On the home page (`/`), the row of command hints above the terminal (e.g. `tsr ls`, `tsr practice`,
`man tmux`) currently renders as non-interactive `<div>`s. Make each hint a clickable, keyboard-
accessible button. Clicking a hint must run its command in the on-page terminal exactly as if the
user typed it and pressed Enter, then move focus to the terminal. Existing appearance/layout must be
preserved.

## How it works today

- `src/routes/+page.svelte` renders the hint row (`.command-hints` containing five `.hint` divs,
  each with a `<code>` command and a `<span>` description) and, separately, mounts
  `<Terminal />` in the terminal section. The two do not communicate.
- `src/lib/components/Terminal.svelte` is the on-page terminal. Relevant internals:
  - `processCommand(cmd: string)` — parses and executes a command line, exactly the path used when
    the user presses Enter (`handleKeyDown` calls `processCommand(inputValue)` then clears input).
    It already handles `tsr ls`, `tsr lb <n>`, `tsr start <n>`, `tsr free-play`, `tsr practice`,
    `tsr config`, `man tmux`, `help`, `clear`, and unknown-command errors.
  - `focusInput()` — focuses the correct element for the current mode (default → text input,
    `man` → manpage container, list/leaderboard → container).
  - `inputValue` state holds the input box contents; mode changes (`list`/`man`/etc.) are driven by
    the command handlers.
- The current five hints (command → description):
  - `tsr ls` → list challenges
  - `tsr start <id>` → begin a challenge
  - `tsr practice` → learn step by step
  - `tsr config` → customize tmux.conf
  - `man tmux` → command reference

## Approach

Add a small public API to `Terminal.svelte` and call it from the page on hint click. Single source
of truth for each hint's command string (no separate mapping), per the issue.

### 1. Expose a run API from `Terminal.svelte`

Use a Svelte 5 component-level `export function` so the parent can invoke it via `bind:this`:

```ts
export function runCommand(cmd: string) {
  processCommand(cmd);   // same execution path as pressing Enter
  inputValue = '';       // mirror Enter handling, which clears the input
  tick().then(() => focusInput()); // focus after any mode-change DOM update settles
}
```

Notes:
- `processCommand` already no-ops on empty/whitespace input, so guarding isn't required but is cheap.
- `focusInput()` is awaited via `tick()` so that when a command changes the mode (e.g. `tsr ls`
  enters list mode, `man tmux` enters man mode) we focus the element that actually exists after the
  DOM updates — satisfying "focus moves to the terminal" for every command, not just default mode.
- No change to existing keyboard/typed behavior; `runCommand` reuses the same code path.

### 2. Make the hints interactive in `+page.svelte`

- Bind the terminal instance: `<Terminal bind:this={terminal} />`.
- Replace the hardcoded `.hint` divs with a loop over a single in-component array so the displayed
  command and the executed command are the same string:

  ```ts
  const hints = [
    { command: 'tsr ls', description: 'list challenges' },
    { command: 'tsr start <id>', description: 'begin a challenge' },
    { command: 'tsr practice', description: 'learn step by step' },
    { command: 'tsr config', description: 'customize tmux.conf' },
    { command: 'man tmux', description: 'command reference' }
  ];
  ```

- Render each as a `<button class="hint" type="button">` with the same inner
  `<code>{command}</code>` + `<span>{description}</span>` markup, an `onclick` that calls
  `terminal?.runCommand(command)`, and `aria-label={`Run command: ${command}`}`. A native `<button>`
  is focusable and Enter/Space-activatable out of the box, satisfying the keyboard-accessibility
  criteria without manual `role`/`tabindex`/keydown wiring.

### 3. Preserve styling

The `.hint` CSS targets the class, not the element, so most styling carries over. Add a button reset
so the `<button>` looks identical to the old `<div>`:

- `font-family: inherit; color: inherit; text-align: left;`
- `background`/`border`/`border-radius`/`padding`/`gap`/`display:flex`/`align-items` — already on
  `.hint`; ensure the button doesn't override them (remove UA button background/border by keeping the
  existing `.hint` declarations).
- Interactivity affordance (new): `cursor: pointer;` and a `.hint:hover` / `.hint:focus-visible`
  state (subtle border/background brighten, consistent with the existing `.badge:hover` treatment) to
  satisfy "visually indicates it is interactive." Keep the resting appearance unchanged.
- The existing mobile `@media (max-width: 640px)` rules for `.hint` continue to apply unchanged.

## Files to change

- `src/lib/components/Terminal.svelte` — add exported `runCommand(cmd)` (and ensure `tick` import,
  already present).
- `src/routes/+page.svelte` — bind terminal instance, convert hint row to looped `<button>`s, add
  hover/focus/cursor styling and button reset.

## Risks & edge cases

- **`tsr start <id>` hint is not a runnable command as displayed.** Typing/running `tsr start <id>`
  literally yields the terminal's existing "Usage: tsr start <number>" error (parseInt of `<id>` is
  NaN). This is the faithful "run exactly the label text" behavior and matches current typed
  behavior, but it produces an error rather than starting a challenge. Per the issue, command ==
  label text with no new mapping, so we keep it as-is. **Flag for review:** if a friendlier result is
  desired (e.g. route this hint to `tsr ls`, or change the label), that needs a product decision.
- **Open decision in the issue (run vs. pre-fill).** This plan implements **execute on click** (the
  issue's chosen default). If reviewers prefer pre-fill-only, `runCommand` would instead set
  `inputValue = cmd` and focus the input without calling `processCommand`.
- **Navigation commands** (`tsr practice`, `tsr config`) call `goto(...)`, navigating away from the
  home page — same as typing them. Expected and acceptable.
- **Focus across mode changes** — handled by awaiting `tick()` before `focusInput()` (see §1).
- **Visual regression** — the `<div>`→`<button>` swap is the main appearance risk; mitigated by the
  button reset and by keeping all styling on the `.hint` class. Verify resting state is pixel-stable.

## Testing

- **Browser test** (Vitest browser project, following `*.browser.test.ts` convention used by
  `ChallengeTerminal.browser.test.ts`): render `Terminal`, call the exported `runCommand('tsr ls')`
  (or, preferably, render the home page and click the `tsr ls` button), and assert the terminal
  shows the executed command / list mode and that focus lands in the terminal. A non-navigating
  command like `tsr ls` is best for assertions (avoids `goto`).
- **Manual/`/run` check:** load `/`, hover a hint (cursor + affordance), click `tsr ls` → terminal
  runs it and enters list mode with focus in the terminal; Tab to a hint and press Enter/Space →
  same result; confirm the hint row looks unchanged at rest on desktop and mobile widths.
- **Regression:** `npm run check` (svelte-check) and `npm run lint` (prettier + eslint) pass; typed
  terminal input still works.

## Scope flags

- Frontend: **yes** (UI/component change only).
- Backend: **no**.
