# Interface Spec: Clickable home-page command-hint labels

Issue: jzohdi/tmux-speedrun#31. Drives `.agent/plan.md`. This pins the contracts the `tdd` stage
writes tests against and the implementation must satisfy.

Scope: frontend only. Two files change:
- `src/lib/components/Terminal.svelte` — add one exported method.
- `src/routes/+page.svelte` — bind the terminal, convert the hint row to buttons, add styling.

No backend, no new data/config, no change to the set of labels/commands.

---

## 1. `Terminal.svelte` — new public component method

Add a Svelte 5 component-level export so a parent holding the instance (via `bind:this`) can run a
command through the exact same execution path as a typed-and-Entered command line.

### Signature

```ts
export function runCommand(cmd: string): void
```

### Contract / invariants

Given the existing private `processCommand`, `focusInput`, `inputValue` state, and the imported
`tick`, `runCommand(cmd)` MUST:

1. Execute `cmd` via the existing `processCommand(cmd)` — the SAME code path `handleKeyDown` uses on
   Enter. It must NOT reimplement command parsing/dispatch.
2. Clear the input box afterward: `inputValue = ''` (mirrors the Enter handler at
   `Terminal.svelte:311-312`).
3. After the resulting DOM update settles, move focus into the terminal by calling the existing
   `focusInput()`. Because a command may change `mode` (e.g. `tsr ls` → `list`, `man tmux` → `man`),
   the focus call MUST be deferred until after the mode-driven DOM change is applied — i.e. `await
   tick()` (or `tick().then(...)`) before `focusInput()`. `focusInput()` already routes to the
   correct element per mode (`inputRef` default / `manpageRef` man / `containerRef` list+leaderboard).

Behavioral invariants the implementation must preserve:
- `processCommand` already no-ops on empty/whitespace (`Terminal.svelte:168-169`); `runCommand` need
  not re-guard but must not crash on `''`.
- No change to existing typed/keyboard behavior. `runCommand` is purely additive; `handleKeyDown`,
  `processCommand`, `focusInput`, and all existing exports/refs remain untouched in signature.
- "Execute on click" is the chosen behavior (issue's default). `runCommand` RUNS the command; it does
  not merely pre-fill. (Pre-fill-only is explicitly out of scope unless review reverses the decision.)

### Post-conditions, by command (for TDD assertions)

`runCommand(cmd)` produces exactly what typing `cmd` + Enter produces today:

| `cmd`            | Effect                                                      | Final focus target              |
|------------------|------------------------------------------------------------|---------------------------------|
| `tsr ls`         | enters `list` mode, renders challenge list                 | `containerRef` (terminal button)|
| `tsr practice`   | adds output, `goto('/practice')` (navigates away)          | n/a (navigation)                |
| `tsr config`     | adds output, `goto('/tmux-conf')` (navigates away)         | n/a (navigation)                |
| `man tmux`       | enters `man` mode (Manpage)                                | `manpageRef`                    |
| `tsr start <id>` | literal text → "Error: Invalid challenge ID '<id>'." + usage hint | `inputRef` (stays default mode) |

Use a non-navigating command (`tsr ls`) for the primary focus/run assertions to avoid `goto`.

> Note: `tsr start <id>` is the displayed label verbatim; running it yields the existing
> "Invalid challenge ID" error (because `<id>` is not a valid number). This is the faithful
> "command == label text, no new mapping" behavior per the issue and is flagged in the plan for
> review — TDD should assert the error output, not a navigation.

---

## 2. `+page.svelte` — interactive hint row

### Data shape (single source of truth)

Replace the five hardcoded `.hint` `<div>`s with a loop over an in-component array. The string shown
IS the string executed — no separate mapping.

```ts
type Hint = { command: string; description: string };

const hints: Hint[] = [
  { command: 'tsr ls',         description: 'list challenges' },
  { command: 'tsr start <id>', description: 'begin a challenge' },
  { command: 'tsr practice',   description: 'learn step by step' },
  { command: 'tsr config',     description: 'customize tmux.conf' },
  { command: 'man tmux',       description: 'command reference' }
];
```

The rendered command text MUST equal `command`. (Today `tsr start <id>` is shown as `tsr start
&lt;id&gt;`; with `{command}` Svelte text-escapes `<id>` automatically — same visible output.)

### Terminal binding

```svelte
<script lang="ts">
  let terminal: Terminal | undefined = $state();
</script>

<Terminal bind:this={terminal} />
```

### Hint markup contract

Each hint renders as a NATIVE `<button>` (not a div with role), preserving the existing inner markup:

```svelte
{#each hints as hint}
  <button
    type="button"
    class="hint"
    aria-label={`Run command: ${hint.command}`}
    onclick={() => terminal?.runCommand(hint.command)}
  >
    <code>{hint.command}</code>
    <span>{hint.description}</span>
  </button>
{/each}
```

Requirements (acceptance-criteria mapping):
- **Clickable + runs command**: `onclick` calls `terminal?.runCommand(hint.command)`. The optional
  chaining tolerates the brief pre-mount window.
- **Keyboard accessible**: a native `<button>` is focusable and Enter/Space-activatable with no manual
  `tabindex`/`role`/keydown wiring. Do NOT add `role`/`tabindex`.
- **Accessible name**: `aria-label="Run command: <command>"` (the visible `<code>`/`<span>` text also
  contributes an accessible name; the explicit label makes intent clear).
- **No change to label set**: still exactly these five hints in this order.

### Styling contract (no visual regression)

The `.hint` CSS targets the class, so existing rules (`+page.svelte:255-275`) carry over to the
button. The implementation MUST keep the resting appearance pixel-stable and add only interactivity
affordances:

- Button reset on `.hint` so the `<button>` matches the old `<div>`: `font-family: inherit;`,
  `font-size: inherit;` (or keep child `code`/`span` sizes), `color: inherit;`, `text-align: left;`,
  and ensure no UA `background`/`border`/`margin` overrides the existing `.hint` declarations
  (existing `background`, `border`, `border-radius`, `padding`, `display:flex`, `align-items`, `gap`
  must remain in effect).
- Interactivity affordance (NEW, required by AC): `cursor: pointer;` plus a `.hint:hover` and
  `.hint:focus-visible` state (subtle border/background brighten, consistent with the existing
  `.badge:hover` treatment at `+page.svelte:213-217`). Resting state unchanged.
- The existing mobile `@media (max-width: 640px)` `.hint`/`.command-hints` rules
  (`+page.svelte:298-313`) continue to apply unchanged.

---

## 3. Out of scope / non-goals

- No backend, route, or data changes.
- No change to `processCommand`, `handleKeyDown`, `focusInput`, or terminal modes.
- No new mapping between labels and commands beyond the `hints` array (label text == command).
- No pre-fill-only variant (execute-on-click is the chosen behavior).

## 4. Verification surface for `tdd`

Preferred test (browser project, `*.browser.test.ts`, following
`ChallengeTerminal.browser.test.ts`): render the home page (or `Terminal` directly), activate the
`tsr ls` hint (click and/or keyboard Enter/Space on the focused button), then assert:
1. The terminal executed the command — `$ tsr ls` appears in history and `list` mode renders.
2. Focus lands inside the terminal after activation (the `containerRef` element for `tsr ls`).
3. Each hint is a focusable `<button>` with `aria-label="Run command: <command>"`.

Regression gates: `npm run check` (svelte-check) and `npm run lint` pass; typed terminal input still
works.
