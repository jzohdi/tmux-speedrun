# Plan — Issue #53: CLI practice-mode status-line prompts easier to read

## Goal (restated)

In CLI practice mode the step prompt is rendered in the tmux status line (via the
`@speedrun_prompt` user option, referenced by the static `status-left`). Today it reads as flat,
undifferentiated text like `[3/12] Split the current pane vertically — prefix + "` and butts
directly against tmux's window list (`… "1:zsh`). Make prompts scannable:

1. **Visually separate** the prompt from the rest of the status bar (no more `"1:zsh` run-together).
2. **Emphasize the hotkey/keystroke portion** (color and/or bold) so the keys to press stand out
   from the descriptive text. Only where a shortcut is actually shown (practice mode), never in
   challenge mode (which deliberately does not hint).

All while preserving the single-source invariant PR1 (only ever write `@speedrun_prompt`, never
`status-left`), keeping `#` in user text escaped, not leaking stray format sequences, and staying
within `status-left-length` (120).

## How it works today

- `cli/src/tmux/controller.ts` — the practice `StepEngine.view()` (around line 271-279) composes the
  prompt string itself: it looks up the shortcut for `command` steps
  (`COMMAND_SHORTCUTS.get(step.commandName)`) and returns
  `{ prompt: shortcut ? \`${step.prompt} — ${shortcut}\` : step.prompt, index, total }`.
  `copy-mode-action` steps have no shortcut and keep their prompt verbatim. The **challenge**
  `view()` (around line 204-208) returns `{ prompt, index, total }` with **no** shortcut — challenge
  mode is intentionally un-hinted.
- `cli/src/ui/status-line.ts` — `StatusLine.setPrompt(view)` prepends the counter
  (`[${index+1}/${total}] ${prompt}`) and calls `sanitize()`, which collapses whitespace, slices to
  118 chars, then doubles every `#` → `##` (because the value is expanded as a tmux **format
  string** by the static `status-left`, so a literal `#` must be escaped). It writes only
  `@speedrun_prompt`.
- `cli/src/tmux/config.ts` — `buildIsolatedConfig()` emits the static
  `status-left '#{@speedrun_prompt}'`, `status-left-length 120`,
  `status-style 'bg=colour24,fg=white'`. These stay as-is (PR1).

Key realization: the hotkey is **already a distinct piece of data** in the controller; today it is
prematurely concatenated into one flat string. The clean fix is to pass the hotkey to `StatusLine`
as a separate field so the status line can escape the *text* and wrap the *hotkey* in tmux inline
style directives independently — exactly the "compose the styled wrapper outside `sanitize`, escape
only the prompt text" approach the issue suggests.

## Approach

### 1. Carry the hotkey through as structured data (`controller.ts`)

- Change the practice `view()` to stop pre-concatenating: return
  `{ prompt: step.prompt, index, total, hotkey: shortcut }` (omit / leave `hotkey` undefined for
  `copy-mode-action` steps and when no shortcut exists). Drop the local em-dash join — the em-dash
  now belongs to the status-line renderer.
- Leave the **challenge** `view()` unchanged (no `hotkey`) → challenge prompts get spacing/counter
  treatment but **no** hotkey emphasis, satisfying the "do not add hotkey emphasis where no shortcut
  is shown" constraint.

### 2. Style the prompt in the status line (`status-line.ts`)

- Extend `PromptView` with an optional `hotkey?: string`.
- Restructure `setPrompt` so composition and escaping are separated:
  - Split today's `sanitize()` into a text-escaping helper (`escapeText`: collapse whitespace +
    double `#`) applied **only** to user-derived text segments (the descriptive prompt and the
    hotkey), and a composer that assembles the final tmux format string by concatenating literal
    `#[…]` style directives (composed **outside** escaping so they survive) with the escaped text.
  - Target format (colors indicative, tuned for legibility on `bg=colour24`; final values decided in
    implementation):
    - **Counter** `[i/N]` — de-emphasized (e.g. `#[fg=colour250]…#[default]` or dim), followed by a
      space.
    - **Descriptive text** — default fg (white), escaped.
    - **Hotkey** (only when `hotkey` present) — an em-dash separator then bold + a distinct legible
      color, e.g. `#[fg=colour227,bold]<escaped hotkey>#[default]`.
    - **Trailing separation** — always append trailing spacing (e.g. two spaces, or a separator
      glyph) after `#[default]` so the prompt never abuts the window list. Reset style (`#[default]`)
      before the trailing gap so no color bleeds into tmux's window list.
  - Every opened `#[…]` is closed with `#[default]` so no format state leaks past the prompt.
- **Length budgeting.** tmux's `status-left-length` limits *visible* width; `#[…]` style directives
  do not occupy display columns, and `##` renders as one visible `#`. Enforce a **visible-width**
  budget ≤ 120 by: reserving width for the counter, the ` — ` separator + hotkey, and the trailing
  gap, then truncating **only the descriptive text** to fit the remainder. Truncation operates on
  the escaped-text segment boundaries so it can never land inside a `#[…]` directive or split a `##`
  pair. (Be conservative: compute visible width as escaped-text length with `##`→`#` collapsed, plus
  hotkey/counter/separator widths, excluding `#[…]` runs.)
- Keep the single-source invariant: `setPrompt` still writes **only** `@speedrun_prompt`; `clear()`
  and `flash()` are unchanged. Never touch `status-left`.

### 3. Config (`config.ts`)

- **No functional change expected.** `status-left-length` stays 120 (locked by
  `config.test.ts`), `status-style 'bg=colour24,fg=white'` stays. Hotkey/counter colors are chosen
  to remain legible against `bg=colour24`. (If implementation finds the visible budget too tight for
  counter+hotkey+text+gap we may revisit, but the default is to leave config untouched to keep the
  change minimal and PR1-safe.)

## Files to change

- `cli/src/tmux/controller.ts` — practice `view()` returns `hotkey` separately; stop concatenating
  the em-dash. Challenge `view()` untouched.
- `cli/src/ui/status-line.ts` — `PromptView.hotkey?`; split escaping vs. styled composition; emit
  styled counter + text + optional styled hotkey + trailing separator with visible-width budgeting.
- `cli/src/ui/status-line.test.ts` — update the existing exact-string assertions (the plain
  `'[1/10] Split the pane'` expectation changes to the new styled form) and add coverage (below).
- Possibly `cli/src/tmux/controller.test.ts` / `cli/src/tmux/run-loop.test.ts` — only if their view
  fixtures assert the old concatenated string; the new `hotkey` field is optional and
  backward-compatible, so minimal/no change expected.

## Risks & edge cases

- **Escaping vs. styling coexistence.** The whole `@speedrun_prompt` value is a tmux format string.
  Literal `#` from user text MUST stay doubled (`##`); the intentional `#[…]` directives MUST NOT be
  doubled. Guaranteed by escaping only the text segments and concatenating raw directive literals
  around them — never run `escapeText` over a string that already contains `#[…]`.
- **Truncation must not split an escape sequence or a `##` pair.** Truncate the descriptive text
  *before* wrapping/joining, on visible-width budget, so directives are added post-truncation.
- **Length budget.** Must respect `status-left-length 120`; styled output must stay within the
  visible budget and never truncate mid-`#[…]`. Add a test asserting visible width ≤ 120.
- **No style bleed into the window list.** End with `#[default]` before trailing spaces so the
  window list renders in default style.
- **Challenge parity.** Challenge mode must gain no hotkey emphasis (no `hotkey` field → renderer
  skips the bold hotkey segment). Verify with a no-hotkey test.
- **Color legibility.** Chosen fg colors must be readable on `bg=colour24` (dark blue) — avoid dark
  blues; bold + a bright color (yellow/bright-white) for the hotkey.
- **Trailing-space trimming.** If tmux trims trailing spaces from `status-left`, the separation may
  not render; mitigate by using a trailing separator that is not purely whitespace if needed (decide
  in implementation; a couple of trailing spaces is the first choice).

## Testing

Extend `cli/src/ui/status-line.test.ts` (Vitest):

- **Single-source invariant preserved** — `setPrompt`/`clear` still write only `@speedrun_prompt`,
  never `status-left` (keep existing assertions, adjust expected value strings).
- **Hotkey emphasis present** — a practice view with `hotkey` produces a value containing a bold +
  color directive wrapping the (escaped) hotkey text and a closing `#[default]`.
- **No emphasis without a hotkey** — a view with no `hotkey` (challenge/copy-mode) contains **no**
  bold hotkey directive.
- **Escaping intact** — `#` in prompt text is still doubled to `##`; the intentional `#[…]` style
  directives are **not** doubled and survive verbatim.
- **No stray/unbalanced sequences** — every `#[` is balanced by a following `#[default]`; the value
  does not end mid-directive.
- **Length bounded** — for a very long prompt, the computed visible width (strip `#[…]` runs,
  collapse `##`→`#`) is ≤ 120, and truncation lands in the descriptive text, not inside a directive.
- **Trailing separation** — the value ends with the separator/trailing spacing so it won't abut the
  window list.

Run the CLI test suite (`cli`) to confirm `status-line.test.ts`, `controller.test.ts`,
`run-loop.test.ts`, and `config.test.ts` all pass. Optionally sanity-check visually via
`tmux-speedrun practice` (manual, not required for CI).

## Scope flags

- `needs_backend: true` — all changes are CLI/Node TypeScript (`cli/src/**`) with unit tests.
- `needs_frontend: false` — no web/Svelte UI involved.
