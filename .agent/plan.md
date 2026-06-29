# Plan: Clickable Home Page Helper Labels

## Goal

Make the command hint labels on the home page clickable so that clicking one triggers the
corresponding command in the terminal and focuses the terminal input.

## Current State

The home page (`src/routes/+page.svelte`) renders five `.hint` elements above the `<Terminal />`
component. Previously these were inert divs; they are now `<button>` elements wired to a
`handleHintClick(cmd)` function. `Terminal.svelte` exports a `triggerCommand(cmd)` method that the
page calls when a hint is clicked.

Both the home page wiring and the `triggerCommand` export are already implemented and committed.
Browser tests exist in `src/routes/home.browser.test.ts` and
`src/lib/components/Terminal.browser.test.ts`.

## Architecture

This is a pure frontend change — no API routes, database access, or server-side logic is involved.

### `src/lib/components/Terminal.svelte` — exported `triggerCommand`

```typescript
export function triggerCommand(cmd: string): void {
  // Reset any active non-default mode synchronously
  if (mode !== 'default') {
    if (historyLengthBeforeMode > 0) history = history.slice(0, historyLengthBeforeMode);
    mode = 'default'; selectedIndex = 0; listData = []; historyLengthBeforeMode = 0;
  }

  const hasPlaceholder = /<[^>]+>/.test(cmd);
  if (hasPlaceholder) {
    // Strip placeholder and pre-fill input so user can type the missing arg
    inputValue = cmd.replace(/<[^>]+>/g, '').trim() + ' ';
    tick().then(() => inputRef?.focus());
  } else {
    tick().then(() => { processCommand(cmd); inputRef?.focus(); });
  }
}
```

### `src/routes/+page.svelte` — hint buttons and wiring

```svelte
<script lang="ts">
  import Terminal from '$lib/components/Terminal.svelte';
  let terminalComponent: ReturnType<typeof Terminal> | null = $state(null);
  let terminalSectionRef: HTMLElement | null = $state(null);

  function handleHintClick(cmd: string): void {
    terminalComponent?.triggerCommand(cmd);
    terminalSectionRef?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
</script>

<button type="button" class="hint" onclick={() => handleHintClick('tsr ls')}>
  <code>tsr ls</code><span>list challenges</span>
</button>
<!-- … four more buttons … -->
```

## Files Changed

| File | Change |
|------|--------|
| `src/lib/components/Terminal.svelte` | Export `triggerCommand(cmd)` |
| `src/routes/+page.svelte` | Bind terminal instance; convert `.hint` divs to `<button>`; add `handleHintClick`; scroll wiring; hover/active CSS |

## Edge Cases Handled

- **Placeholder commands** (`tsr start <id>`): placeholder is stripped and the terminal input is
  pre-filled with the prefix (`tsr start `); the command is not executed until the user completes
  it and presses Enter.
- **Non-default mode reset**: if the terminal is showing the challenge list, leaderboard, or man
  page when a hint is clicked, state is reset synchronously before the new command runs.
- **Off-screen terminal**: `scrollIntoView` brings the terminal into the viewport on click.
- **Accessibility**: `<button>` elements give keyboard focus (Tab), Enter/Space activation, and
  semantic role without extra ARIA attributes.

## Testing

Browser test suites cover:
1. All five hints render as `<button class="hint">` elements (not divs).
2. Each button is reachable via `getByRole('button', { name: /…/ })`.
3. Clicking `tsr ls` shows the challenge list output in the terminal.
4. Clicking `tsr start <id>` pre-fills the input with `tsr start `.
5. `triggerCommand` resets non-default mode before re-running a command.
6. `triggerCommand("man tmux")` enters man-page mode (input hidden).

The frontend implementation stage should verify these tests pass and fix any issues found.
