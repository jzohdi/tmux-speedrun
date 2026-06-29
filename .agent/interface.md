# Interface Specification: Clickable Home Page Helper Labels

## Overview

This is a pure frontend change. No API routes or server-side code are affected. Two components are
involved: `Terminal.svelte` (exports the command trigger) and `+page.svelte` (wires hint buttons to
the terminal).

---

## 1. `Terminal.svelte` — exported `triggerCommand`

### Signature

```typescript
export function triggerCommand(cmd: string): void
```

### Behavior contracts

| Condition | Expected behavior |
|-----------|-------------------|
| `cmd` has no `<placeholder>` pattern | Resets non-default mode synchronously (see below), then calls `processCommand(cmd)` via `tick().then(…)`, then focuses `inputRef`. |
| `cmd` contains `<placeholder>` (matches `/<[^>]+>/`) | Resets non-default mode synchronously, strips placeholder tokens, sets `inputValue` to stripped prefix + trailing space, then focuses `inputRef` via `tick().then(…)`. Does **not** call `processCommand`. |
| Terminal is currently in `'list'` mode when called | `history` is truncated to `historyLengthBeforeMode`, `mode` → `'default'`, `selectedIndex` → `0`, `listData` → `[]`, `historyLengthBeforeMode` → `0` — all synchronously before the tick. |
| Terminal is currently in `'leaderboard'` or `'man'` mode | Same synchronous reset as list mode. |
| Terminal is already in `'default'` mode | No reset needed; proceeds directly to run or pre-fill. |

### Placeholder stripping rule

```
inputValue = cmd.replace(/<[^>]+>/g, '').trim() + ' '
```

Example: `'tsr start <id>'` → `inputValue = 'tsr start '`

---

## 2. `+page.svelte` — hint buttons and page wiring

### State

```typescript
let terminalComponent: ReturnType<typeof Terminal> | null = $state(null);
let terminalSectionRef: HTMLElement | null = $state(null);
```

### `handleHintClick`

```typescript
function handleHintClick(cmd: string): void {
  terminalComponent?.triggerCommand(cmd);
  terminalSectionRef?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
```

Invariants:
- Calls `triggerCommand` on the bound terminal instance (optional chaining — safe when terminal is
  not yet mounted).
- Always attempts `scrollIntoView` on the terminal section immediately after, regardless of whether
  `triggerCommand` succeeds.
- No `await` — both calls are fire-and-forget from the page's perspective.

### Hint button markup

Each hint must be rendered as a `<button type="button" class="hint">` element containing:
- A `<code>` child with the command string (HTML-encoded for display).
- A `<span>` child with the human-readable label.

The five required hints and their `cmd` arguments:

| Display (`<code>`) | Label (`<span>`) | `cmd` passed to `handleHintClick` |
|--------------------|------------------|-----------------------------------|
| `tsr ls` | `list challenges` | `'tsr ls'` |
| `tsr start <id>` | `begin a challenge` | `'tsr start <id>'` |
| `tsr practice` | `learn step by step` | `'tsr practice'` |
| `tsr config` | `customize tmux.conf` | `'tsr config'` |
| `man tmux` | `command reference` | `'man tmux'` |

### Terminal binding

```svelte
<Terminal bind:this={terminalComponent} />
<section class="terminal-section" bind:this={terminalSectionRef}> … </section>
```

`terminalComponent` is bound with `bind:this` so that `triggerCommand` is accessible as a method on
the component instance.

---

## 3. Invariants the implementation must uphold

1. **Hint elements are focusable and activatable via keyboard.** Using `<button>` elements (not
   `<div>` or `<span>`) satisfies this without extra ARIA.
2. **Non-default mode is reset before any new command runs.** `triggerCommand` performs this reset
   synchronously before any `tick()` call.
3. **Placeholder commands never execute automatically.** When a placeholder is detected, only
   `inputValue` is set; `processCommand` is never called.
4. **Terminal receives focus after every hint click.** `inputRef?.focus()` is called inside the
   `tick().then(…)` callback in both the placeholder and non-placeholder paths.
5. **Terminal section scrolls into view on click.** `scrollIntoView` is called unconditionally in
   `handleHintClick`.
6. **`handleHintClick` is safe when terminal is null.** Optional chaining on `terminalComponent?`
   means no error when the component has not yet mounted.

---

## 4. CSS contract for `.hint` buttons

Button-reset properties (needed because `<button>` carries user-agent styles) already applied on
`.hint`:

```css
.hint {
  appearance: none;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.hint:hover {
  background: rgba(80, 250, 123, 0.08);
  border-color: rgba(80, 250, 123, 0.25);
}

.hint:active {
  transform: scale(0.97);
}
```

---

## 5. Files in scope

| File | Role |
|------|------|
| `src/lib/components/Terminal.svelte` | Exports `triggerCommand`; owns terminal state |
| `src/routes/+page.svelte` | Renders hint buttons; owns `handleHintClick`; binds terminal instance |

No new files. No new dependencies. No changes to routing, server endpoints, or shared stores.

---

## 6. Key invariants for the TDD stage

1. Calling `triggerCommand` while `mode === 'list'` must leave `mode === 'default'` and
   `listData === []` before any command processing occurs.
2. Calling `triggerCommand('tsr start <id>')` must set `inputValue` to `'tsr start '` (trailing
   space, no `<id>`), must **not** call `processCommand`, and must focus the input.
3. Calling `triggerCommand('tsr ls')` must invoke `processCommand('tsr ls')` and focus the input.
4. `handleHintClick` must not throw when `terminalComponent` is `null`.
5. Each hint `<button>` must be reachable via keyboard Tab and activate on Enter/Space.
6. Clicking `tsr ls` hint must produce challenge-list output visible in the terminal body.
7. Clicking `man tmux` hint must put the terminal into man mode (input row hidden).
