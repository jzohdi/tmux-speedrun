# Interface — Issue #53: styled, separated practice-mode status-line prompts

This pins the types, signatures, format contract, and invariants the TDD stage writes failing
tests against and the implementation satisfies. It refines `.agent/plan.md`; where this document
gives a concrete value (color codes, separators, budgets), that value is the contract.

## Design summary

The hotkey is already distinct data inside the practice `view()` — today it is prematurely joined
into one flat prompt string with ` — `. We stop joining it there and carry it as a **separate
`hotkey` field** through `StepEngine.view()` → `PromptView` → `StatusLine.setPrompt`. The status
line then composes a tmux **format string** by concatenating *literal* `#[…]` style directives
(never escaped) around *escaped* user text segments. This is the "compose the styled wrapper
outside `sanitize`, escape only the prompt text" approach the issue asks for.

Only practice `command` steps carry a `hotkey`; challenge and `copy-mode-action` steps do not, so
they get the layout/counter/trailing treatment but **no** hotkey emphasis (challenge parity).

## 1. Types

### `PromptView` (`cli/src/ui/status-line.ts`)

```ts
export type PromptView = {
  prompt: string;
  index: number;   // 0-based
  total: number;
  hotkey?: string; // present only when a shortcut hint should be emphasized (practice command steps)
};
```

- `hotkey` is optional and backward-compatible: existing callers that omit it render exactly as
  before **except** for the new counter styling and trailing separation (which apply always).

### `StepEngine.view()` return type (`cli/src/tmux/controller.ts`)

```ts
view(): { prompt: string; index: number; total: number; hotkey?: string };
```

- Widen the inline return type of `view()` to include the optional `hotkey?: string`.

## 2. `StatusLine.setPrompt` — format contract

`setPrompt` keeps both overloads and still writes **only** `@speedrun_prompt` (invariant PR1);
`flash()` and `clear()` are unchanged. The value written is composed from three or four segments,
in order. `<esc>` denotes text passed through the escape helper (§3).

**Counter segment (always):**
```
#[fg=colour245][<index+1>/<total>]#[default] 
```
(a de-emphasized gray counter, closed with `#[default]`, followed by one literal space).

**Descriptive-text segment (always):**
```
<esc(prompt)>
```
(default style — the config's `fg=white` on `bg=colour24`).

**Hotkey segment (only when `hotkey` is a non-empty string):**
```
 — #[fg=colour227,bold]<esc(hotkey)>#[default]
```
(a leading space + em-dash + space in default style, then a bold bright-yellow hotkey, closed with
`#[default]`).

**Trailing-separation segment (always):**
```
  
```
(two literal spaces) so the prompt never abuts the tmux window list.

### Concrete examples

Practice command step (`prompt="Split the current pane vertically"`, `hotkey='prefix + "'`,
index 2, total 12):
```
#[fg=colour245][3/12]#[default] Split the current pane vertically — #[fg=colour227,bold]prefix + "#[default]  
```

Challenge / copy-mode step (no `hotkey`, `prompt="Rename the window"`, index 2, total 9):
```
#[fg=colour245][3/9]#[default] Rename the window  
```

- Color codes (`colour245`, `colour227`) are the pinned contract but are chosen for legibility on
  `bg=colour24`; the implementation may tune the exact numbers, but must keep: counter
  de-emphasized, hotkey **bold + a bright non-blue color**, every `#[…]` closed by `#[default]`.
  Tests SHOULD assert structural facts (presence of `bold`, a `#[fg=…]` before the hotkey text, a
  closing `#[default]`, correct escaping) rather than exact color numbers, so color tuning does not
  break the suite.

## 3. Escaping vs. styling (invariant)

Split today's `sanitize()` into two responsibilities:

- **`escapeText(s)`** — applied ONLY to user-derived text (the `prompt` and the `hotkey`):
  1. collapse runs of whitespace to a single space (`\s+` → `' '`),
  2. double every `#` → `##` (so tmux format expansion cannot mangle literal `#`).
  It does NOT slice — truncation is handled separately (§4).
- **Composer** — concatenates the literal `#[…]` directives (raw, never passed through
  `escapeText`) with the escaped segments.

Invariant: `escapeText` is never run over a string that already contains `#[…]` directives, so the
intentional style directives keep their single `#` and survive verbatim, while user `#` stays
doubled.

## 4. Length budgeting

`status-left-length` (120, locked by `config.test.ts`) limits **visible** columns. `#[…]`
directives occupy zero display columns, and `##` renders as one column. Enforce a visible-width
budget as follows:

- `MAX_VISIBLE = 118` (keeps the prior 2-column margin under `status-left-length` 120).
- Fixed cost = visible width of the counter (`[<i>/<N>] ` including its trailing space) + the
  hotkey segment when present (` — ` = 3 columns + the hotkey's visible width) + trailing 2 spaces.
- Remaining budget for the descriptive text = `MAX_VISIBLE − fixedCost` (floored at 0).
- Truncate the **raw** `prompt` (pre-escape) to that many characters, THEN escape it. Truncating
  raw text guarantees a cut can never land inside a `##` pair or a `#[…]` directive (directives are
  added only after truncation), and raw chars map 1:1 to visible columns.
- The counter and hotkey are never truncated (they are short and are the scannable payload).

Result: the composed value's **visible width** (strip `#[…]` runs, collapse `##`→`#`) is
`≤ MAX_VISIBLE ≤ status-left-length`, and the raw value never ends mid-directive.

## 5. Controller changes

### Practice `view()` (`cli/src/tmux/controller.ts` ~line 271-279)

- Stop concatenating the em-dash + shortcut. Return the shortcut as a separate field:
  ```ts
  const shortcut =
    step.kind === 'command' ? COMMAND_SHORTCUTS.get(step.commandName) : undefined;
  return { prompt: step.prompt, index, total, hotkey: shortcut };
  ```
- `copy-mode-action` steps: `shortcut` is `undefined` → `hotkey` omitted → prompt rendered verbatim
  (no emphasis).

### Challenge `view()` (~line 204-208)

- Unchanged. No `hotkey` field → no hotkey emphasis (challenge parity, per issue scope).

## 6. Invariants the implementation must uphold

- **PR1 single source:** `setPrompt`/`clear` write ONLY `@speedrun_prompt`; never `status-left`.
- **Escaping intact:** literal `#` in user text → `##`; intentional `#[…]` directives are NOT
  doubled and survive verbatim.
- **Balanced directives / no bleed:** every `#[fg=…]` (or other opening `#[…]`) is closed by a
  following `#[default]`; the value ends with `#[default]` (from the last styled segment) followed
  only by the trailing spaces, so no style leaks into the window list, and it never ends
  mid-directive.
- **Bounded length:** visible width ≤ 118 (< `status-left-length` 120); truncation only ever
  shortens the descriptive text.
- **Trailing separation:** the value ends with the trailing spaces so the prompt never abuts the
  window list.
- **Challenge parity:** a view with no `hotkey` produces NO bold hotkey directive.

## 7. Tests (TDD stage targets)

`cli/src/ui/status-line.test.ts` — update existing exact-string expectations (the plain
`'[1/10] Split the pane'` etc. become the new styled forms) and add:

- **Single-source preserved** — `setPrompt`/`clear` still write only `@speedrun_prompt`, never
  `status-left`.
- **Hotkey emphasis present** — a view with `hotkey` yields a value containing a bold `#[fg=…,bold]`
  directive wrapping the escaped hotkey, closed by `#[default]`.
- **No emphasis without a hotkey** — a view without `hotkey` (challenge/copy-mode) contains no bold
  hotkey directive.
- **Escaping intact** — `#` in `prompt`/`hotkey` becomes `##`; `#[…]` directives are not doubled.
- **Balanced / no stray sequences** — every `#[` is balanced by a following `#[default]`; value
  does not end mid-directive; ends with trailing spaces.
- **Length bounded** — for a very long prompt, computed visible width (strip `#[…]`, collapse
  `##`→`#`) is ≤ 118, and truncation lands in the descriptive text (counter + hotkey intact).
- **Trailing separation** — value ends with the trailing spaces.

`cli/src/tmux/controller.test.ts` — the existing assertion (~line 246-250) that
`v.prompt.includes(renameShortcut)` must change to assert the shortcut now arrives on `v.hotkey`
(e.g. `f.promptViews.some((v) => v.hotkey === renameShortcut)`), and the copy-mode-action assertion
that `v.prompt === copyPrompt` still holds (now guaranteed since no em-dash is appended).

`cli/src/tmux/config.ts` / `config.test.ts` — **no change**; `status-left-length` stays 120,
`status-style 'bg=colour24,fg=white'` stays.

## 8. Files to change

- `cli/src/ui/status-line.ts` — `PromptView.hotkey?`; split `sanitize` into `escapeText` +
  composer; emit styled counter + text + optional styled hotkey + trailing separation with
  visible-width budgeting.
- `cli/src/tmux/controller.ts` — practice `view()` returns `hotkey` separately (drop em-dash join);
  widen `StepEngine.view()` return type with `hotkey?`. Challenge `view()` untouched.
- `cli/src/ui/status-line.test.ts` — updated + new coverage (§7).
- `cli/src/tmux/controller.test.ts` — update the shortcut assertion to read `hotkey` (§7).
