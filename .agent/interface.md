# Interface — wrap long CLI command input (#51)

Single-file change: `src/lib/components/Terminal.svelte`. No new modules, exports, or props. This
spec pins the contracts the `tdd` stage writes failing tests against and the implementation
satisfies. The plan (`.agent/plan.md`) is the design source; this narrows it to precise,
testable contracts.

## Summary of the change
The interactive input control changes from a single-line `<input type="text">` to an auto-growing,
wrapping `<textarea rows="1">`. All existing behavior (typing, Enter-to-submit, Ctrl/Cmd+Enter
maximize, `runCommand`, focus management, clear-on-submit) is preserved. The only new behavior is:
the typed command wraps onto subsequent lines within the terminal width and the box grows/shrinks in
height to fit, responsively on resize.

## Component contract (public surface — unchanged)
- Props: `{ user?: SessionUser | null }` — unchanged.
- Exported method: `runCommand(cmd: string): void` — unchanged signature and behavior. Must still
  run the command through `processCommand`, clear `inputValue`, and defer focus via
  `tick().then(() => focusInput())`. After the clear it must additionally collapse the textarea back
  to one line (see Auto-grow invariant below).

`SessionUser` type is unchanged: `{ githubId: number; username: string }`.

## DOM / rendering contract
The interactive control, rendered only when `mode === 'default'`, MUST:
- Be a `<textarea>` element (replacing the `<input type="text">`).
- Keep `class="terminal-input"` (a test selects `.terminal-input` and asserts it is the focused
  element).
- Report ARIA role `textbox` — a `<textarea>` does natively, so `screen.getByRole('textbox')`
  continues to resolve, and `.toHaveValue(...)` continues to work.
- Keep `bind:value={inputValue}` and `bind:this={inputRef}`.
- Keep the attributes `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`,
  `spellcheck="false"`.
- Add `rows="1"` and `oninput={autoGrow}`.
- Remain inside `.input-line` with the leading `<span class="prompt">$</span>`.

`inputRef` state type changes: `HTMLInputElement | null` → `HTMLTextAreaElement | null`.

## Behavioral invariants (the implementation MUST uphold)

1. **Enter submits, never inserts a newline.** In `default` mode, a bare `Enter` keydown (bubbling to
   the container's `handleKeyDown`) calls `event.preventDefault()`, runs `processCommand(inputValue)`,
   and sets `inputValue = ''`. Because `preventDefault()` runs on the textarea's keydown, no `\n` is
   inserted. `inputValue` must never contain a newline via normal typing. Multi-line command entry is
   NOT a feature.

2. **Ctrl/Cmd+Enter toggles maximize** and does not submit or insert a newline — unchanged.

3. **Clear-on-submit + collapse.** After any path that programmatically clears the input
   (`inputValue = ''`): the Enter branch of `handleKeyDown`, and `runCommand`. Because `oninput` does
   NOT fire on programmatic value changes, the implementation MUST re-run the auto-grow logic after
   the clear (via `tick().then(autoGrow)` or equivalent) so the textarea height collapses back to the
   one-line baseline. Post-condition: after submitting/clearing, the textbox value is `''` AND its
   rendered height equals the empty one-line baseline height.

4. **Auto-grow invariant.** At all times the textarea's rendered height equals the height needed to
   display its current wrapped content with no vertical scrollbar and no clipped text. Achieved by:
   ```ts
   function autoGrow() {
     if (!inputRef) return;
     inputRef.style.height = 'auto';           // reset first so it can shrink
     inputRef.style.height = `${inputRef.scrollHeight}px`;
   }
   ```
   `autoGrow` is called from: `oninput` (typing/paste/delete), after each programmatic clear (see #3),
   and from the ResizeObserver (see #5).

5. **Responsive reflow.** A `ResizeObserver` observing `inputRef` recomputes `autoGrow` when the
   textarea's width changes (terminal/window resize, maximize toggle). It is set up in an `$effect`
   that reads `inputRef` (so it re-runs when the textarea is created/destroyed across mode changes)
   and returns a cleanup that disconnects the observer — no leaked observers. `ResizeObserver` fires
   once on `observe`, which also sets the correct initial height.

6. **Focus management unchanged.** `focusInput()` still focuses `inputRef` in `default` mode, the
   pager in `man`/`lb-pager`, and the container otherwise. `inputRef?.focus()` works identically on a
   textarea.

## CSS contract (`.terminal-input`, `.input-line`)
- `.input-line`: `align-items: center` → `align-items: flex-start` so the `$` prompt aligns with the
  first line of a wrapped, multi-line box instead of vertically centering.
- `.terminal-input` keeps: `flex: 1; background: transparent; border: none; outline: none;
  color: #e0e0e0; font-family: inherit; font-size: inherit; caret-color: #50fa7b;`.
- `.terminal-input` adds: `resize: none; overflow: hidden; white-space: pre-wrap;
  word-break: break-word; padding: 0; margin: 0; line-height: inherit;` — matches the input's flat
  look, wraps like history lines, and suppresses scrollbars so `scrollHeight` reflects full content.
- The `.terminal-input::placeholder` rule may remain (harmless on a textarea).

## Out of scope (do NOT change)
- Output/history rendering (`.terminal-line`, `white-space: pre-wrap; word-break: break-word;`) —
  already wraps.
- The non-terminal challenge prompt UI (`PromptBox.svelte`).
- Command execution logic (`processCommand` and all `tsr …` handling), navigation modes
  (`list`/`leaderboard`/`man`/`lb-pager`), and their keybindings.

## Test contracts (guidance for the `tdd` stage)
Existing tests in `src/lib/components/Terminal.browser.test.ts` MUST stay green unchanged:
- `getByRole('textbox')`, `.toHaveValue(...)`, `input.fill(...)`, and the `.terminal-input` selector
  all resolve against the new `<textarea>`.

New tests to add (tolerant of exact pixel values — assert relative height, not fixed px):
- **Wrap grows height:** render, capture the empty textbox `offsetHeight` (one-line baseline), fill
  the textbox with a long single-token string that must wrap in the terminal width, and assert its
  `offsetHeight` is strictly greater than the baseline.
- **Submit collapses height:** after filling with a wrapping string and submitting (Enter, or a
  default-mode-preserving `runCommand`), assert the textbox value is `''` AND its `offsetHeight`
  returns to the one-line baseline.
- **Enter does not insert a newline:** typing then pressing Enter clears the value to `''` (no
  residual `\n`), and the command was processed (echoed to history).

## Scope flags
- `needs_frontend: true`
- `needs_backend: false`
