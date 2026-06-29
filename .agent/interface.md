# Interface: Clickable Home Page Helper Labels

## Overview

Two files change: `Terminal.svelte` gains one exported function; `+page.svelte` gains component binding, a click handler, and converts `.hint` divs to `<button>` elements.

---

## 1. `Terminal.svelte` — exported function

```typescript
export function triggerCommand(cmd: string): void
```

**Signature contract:**
- `cmd` — a raw command string, optionally containing a `<…>` placeholder token (e.g. `tsr start <id>`).
- Returns `void`. Side effects only.

**Behavioral invariants:**

| Condition | Required behavior |
|---|---|
| `mode !== 'default'` at call time | Synchronously reset: slice `history` back to `historyLengthBeforeMode` (no-op if `historyLengthBeforeMode === 0`), set `mode = 'default'`, `selectedIndex = 0`, `listData = []`, `historyLengthBeforeMode = 0`. Do **not** call `await tick()` or `focus()` here — the caller owns focus after mode reset. |
| `/<[^>]+>/.test(cmd) === true` (placeholder present) | Strip all `<…>` tokens via `cmd.replace(/<[^>]+>/g, '').trim()`, append a trailing space, assign to `inputValue`. Then `await tick()` and call `inputRef?.focus()`. Do **not** call `processCommand`. |
| `/<[^>]+>/.test(cmd) === false` (no placeholder) | Call `processCommand(cmd)` inside a `tick().then(…)` callback, then call `inputRef?.focus()`. The `tick()` ensures Svelte has flushed any mode-reset DOM changes before the command runs. |

**Placement:** defined at module scope in the `<script lang="ts">` block, using the `export function` syntax that Svelte 5 recognises as a component export.

**Does not modify:** `isMaximized`, `leaderboardQuery`, or any other state unrelated to mode/input.

---

## 2. `+page.svelte` — new reactive state

```typescript
let terminalComponent: ReturnType<typeof Terminal> | null = $state(null);
let terminalSectionRef: HTMLElement | null = $state(null);
```

- `terminalComponent` is bound via `bind:this={terminalComponent}` on the `<Terminal />` element. Its type exposes `triggerCommand`.
- `terminalSectionRef` is bound via `bind:this={terminalSectionRef}` on the `<section class="terminal-section">` element.

---

## 3. `+page.svelte` — click handler

```typescript
function handleHintClick(cmd: string): void
```

**Behavioral invariants:**

| Step | Detail |
|---|---|
| 1 | Call `terminalComponent?.triggerCommand(cmd)` — optional-chained so it is a no-op when the terminal has not yet mounted. |
| 2 | Call `terminalSectionRef?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` — brings the terminal into view on mobile / narrow viewports. |

No `await` — both calls are fire-and-forget from the page's perspective.

---

## 4. Hint button data

The five hints map to these exact command strings:

| Display text | Command string passed to `triggerCommand` |
|---|---|
| `tsr ls` | `'tsr ls'` |
| `tsr start <id>` | `'tsr start <id>'` |
| `tsr practice` | `'tsr practice'` |
| `tsr config` | `'tsr config'` |
| `man tmux` | `'man tmux'` |

The `<id>` placeholder in `tsr start <id>` matches the regex `/<[^>]+>/` and triggers the partial-input path in `triggerCommand`.

---

## 5. Markup contract (`+page.svelte`)

Each `.hint` div becomes a `<button>` element:

```svelte
<button class="hint" onclick={() => handleHintClick('tsr ls')}>
  <code>tsr ls</code>
  <span>list challenges</span>
</button>
```

- Tag: `<button>` (replaces `<div>`).
- `class="hint"` — unchanged, so existing layout CSS applies.
- `onclick` — calls `handleHintClick` with the exact command string from the table above.
- No `type` attribute needed (defaults to `"button"` inside a non-form context, but adding `type="button"` is acceptable for explicitness).
- No additional ARIA attributes required — `<button>` is semantically interactive.
- The inner `<code>` and `<span>` children are preserved unchanged.

---

## 6. CSS contract (`+page.svelte`)

Additions/changes to the `.hint` rule and its variants. All selectors are scoped to the component.

| Selector | Property | Value | Rationale |
|---|---|---|---|
| `.hint` | `cursor` | `pointer` | Signals clickability |
| `.hint` | `background` | (keep existing `rgba(255,255,255,0.03)`) | No change at rest |
| `.hint` | `border-color` | (keep existing `rgba(255,255,255,0.06)`) | No change at rest |
| `.hint` | `transition` | `background 0.15s ease, border-color 0.15s ease, transform 0.15s ease` | Smooth state changes |
| `.hint:hover` | `background` | `rgba(80, 250, 123, 0.08)` | Green-tinted hover consistent with site palette |
| `.hint:hover` | `border-color` | `rgba(80, 250, 123, 0.25)` | Elevated border on hover |
| `.hint:active` | `transform` | `scale(0.97)` | Subtle pressed feedback |
| Button reset (on `.hint`) | `appearance`, `font`, `text-align`, `padding`, `border`, `background`, `border-radius` | Inherit from existing `.hint` rule | `<button>` carries user-agent styles that must be neutralised |

The button reset properties to add to `.hint`:
```css
.hint {
  /* existing properties preserved; add: */
  appearance: none;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
```

No changes to `.hint code` or `.hint span`.

---

## 7. Module boundary summary

| Module | Consumes | Produces |
|---|---|---|
| `Terminal.svelte` | `inputValue` (internal state), `mode` (internal state), `processCommand` (internal function), `tick` (Svelte import), `inputRef` (internal ref) | Exported `triggerCommand(cmd: string): void` |
| `+page.svelte` | `Terminal` component (existing import), `terminalComponent.triggerCommand` (new export), `terminalSectionRef` (new ref) | `handleHintClick(cmd: string): void`, five `<button class="hint">` elements with `onclick` wiring |

No new files. No new dependencies. No changes to routing, server endpoints, or shared stores.

---

## 8. Key invariants for the TDD stage

1. Calling `triggerCommand` while `mode === 'list'` must leave `mode === 'default'` and `listData === []` before any command processing occurs.
2. Calling `triggerCommand('tsr start <id>')` must set `inputValue` to `'tsr start '` (trailing space, no `<id>`), must **not** call `processCommand`, and must focus the input.
3. Calling `triggerCommand('tsr ls')` must call `processCommand('tsr ls')` and focus the input.
4. `handleHintClick` must not throw when `terminalComponent` is `null`.
5. Each hint `<button>` must be reachable via keyboard Tab and activate on Enter/Space.
