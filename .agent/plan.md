# Plan: Clickable Home Page Helper Labels

## Goal

Make the command hint labels on the home page clickable. Clicking a label should trigger the corresponding command in the terminal and focus the terminal's cursor.

## Context

The home page (`src/routes/+page.svelte`) renders a `.command-hints` section with five `.hint` divs. Each `.hint` contains a `<code>` element with a command string (e.g., `tsr ls`) and a `<span>` with a description. Below the hints, a `<Terminal />` component handles all command execution.

The `Terminal.svelte` component is self-contained: it owns `inputValue`, `processCommand()`, `focusInput()`, and terminal mode state. The page has no current mechanism to push a command into the terminal from outside.

## Approach

### 1. Expose a `triggerCommand` method on `Terminal.svelte`

Add an exported function `triggerCommand(cmd: string)` to `Terminal.svelte`. Svelte 5 components can export functions that are accessible to the parent via `bind:this`.

Behavior:
- If the terminal is in a non-default mode (list, leaderboard, man), synchronously reset to default mode (same logic as `clearAndResetMode` but without the async focus step, since we handle focus separately).
- If `cmd` contains a placeholder token (e.g., `<id>`), strip the placeholder, set `inputValue` to the resulting prefix (e.g., `tsr start `), and focus the input — letting the user type the missing argument.
- If `cmd` has no placeholder, call `processCommand(cmd)` directly to run it, then focus the input.
- In both cases use `tick()` before focusing to let Svelte flush DOM updates.

### 2. Update `+page.svelte` to bind the terminal and wire up hint clicks

- Import the `Terminal` component type and bind its instance via `bind:this={terminalComponent}`.
- Introduce a `handleHintClick(cmd: string)` function that calls `terminalComponent?.triggerCommand(cmd)` and scrolls the terminal section into view.
- Convert the five `.hint` divs to `<button>` elements so they are semantically clickable and keyboard accessible. Pass `onclick={()=>handleHintClick(code_text)}` to each.
- Add a `bind:this={terminalSectionRef}` on the `.terminal-section` wrapper so `scrollIntoView()` can be called to bring the terminal into the viewport after a hint click.

### 3. CSS updates in `+page.svelte`

- Add `cursor: pointer` to `.hint`.
- Add a hover state to `.hint`: slightly elevated border color and background to signal interactivity.
- Remove default button styles (background, border, padding resets) while preserving existing visual design.
- Add a subtle active/pressed state.

## Files to Change

| File | Change |
|---|---|
| `src/lib/components/Terminal.svelte` | Export `triggerCommand(cmd)` function |
| `src/routes/+page.svelte` | Bind terminal instance, convert hints to buttons, wire clicks, update CSS |

## Detailed Implementation Notes

### `Terminal.svelte` — `triggerCommand`

```typescript
export function triggerCommand(cmd: string) {
  // Reset non-default mode synchronously
  if (mode !== 'default') {
    history = historyLengthBeforeMode > 0
      ? history.slice(0, historyLengthBeforeMode)
      : history;
    mode = 'default';
    selectedIndex = 0;
    listData = [];
    historyLengthBeforeMode = 0;
  }

  const hasPlaceholder = /<[^>]+>/.test(cmd);
  if (hasPlaceholder) {
    // Populate input with command prefix so user can fill in the arg
    inputValue = cmd.replace(/<[^>]+>/g, '').trim() + ' ';
    tick().then(() => inputRef?.focus());
  } else {
    tick().then(() => {
      processCommand(cmd);
      inputRef?.focus();
    });
  }
}
```

### `+page.svelte` — hint button markup (example)

```svelte
<script lang="ts">
  import Terminal from '$lib/components/Terminal.svelte';

  let terminalComponent: Terminal | null = $state(null);
  let terminalSectionRef: HTMLElement | null = $state(null);

  function handleHintClick(cmd: string) {
    terminalComponent?.triggerCommand(cmd);
    terminalSectionRef?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
</script>

<button class="hint" onclick={() => handleHintClick('tsr ls')}>
  <code>tsr ls</code>
  <span>list challenges</span>
</button>
```

## Risks and Edge Cases

- **Mode reset**: If the terminal is showing the challenge list, leaderboard, or man page when a hint is clicked, we reset state synchronously before processing the new command to avoid double-mode conflicts.
- **Placeholder command UX**: `tsr start <id>` should not try to run with literal `<id>` because it would produce an error. Stripping the placeholder and populating the input field gives a better experience.
- **Scroll**: On mobile or narrow viewports the terminal may be off-screen when a hint is clicked. `scrollIntoView` ensures the terminal is visible.
- **Accessibility**: Converting `.hint` divs to `<button>` elements gives proper keyboard focus, Enter/Space activation, and semantic meaning without additional ARIA attributes.
- **Type-safety**: `bind:this` on a Svelte 5 component exposes its exported functions. The type for `terminalComponent` should be inferred as `ReturnType<typeof Terminal>` or simply declared as `Terminal` (the component class type) to get autocomplete on `triggerCommand`.

## Testing Plan

1. Load the home page and click each hint label.
2. `tsr ls` → challenge list appears in the terminal, terminal scrolls into view.
3. `tsr practice` → navigates to `/practice`.
4. `tsr config` → navigates to `/tmux-conf`.
5. `man tmux` → man page appears.
6. `tsr start <id>` → terminal input is populated with `tsr start ` and cursor is focused in the input field.
7. While the terminal is in list mode, click `tsr ls` again → mode resets and command reruns.
8. Keyboard: Tab to a hint, press Enter → same behavior as click.
