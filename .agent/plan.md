# Plan — CLI mode: wrap long command input instead of cutting it off (#51)

## Goal (restated)
In CLI (browser terminal emulator) mode, a long command typed at the prompt is visually cut off /
scrolls horizontally when the terminal is narrow, so the user cannot see the whole command. Make the
typed command **wrap onto subsequent lines** within the terminal width, responsively as the terminal /
window is resized — without regressing typing, submitting, or any existing keybindings. If no clean,
low-complexity fix exists, document that instead; but a clean fix does exist here (see below).

## Current behavior (grounded in the code)
- Main component: `src/lib/components/Terminal.svelte`.
- Output/history lines already wrap: `.terminal-line` uses `white-space: pre-wrap; word-break: break-word;`
  (~lines 642–647). **Out of scope — do not touch.**
- The interactive input is a single-line `<input type="text" class="terminal-input">` inside
  `.input-line` (~lines 510–524). A single-line `<input>` cannot wrap — it scrolls horizontally. That
  is the whole bug.
- Key handling: `onkeydown={handleKeyDown}` is on the outer `.terminal-container` `<button>` (line 442).
  The input's keydown **bubbles up** to it. In `default` mode the only handled key is `Enter`
  (line 374–378) → `processCommand(inputValue); inputValue = ''`. `Ctrl/Cmd+Enter` toggles maximize
  (lines 324–328). **There is no command-history (Up/Down) navigation in default mode today** — the
  issue lists it as a concern, but the code has none, so there is nothing to preserve there.
- `inputRef` is bound to the input and focused by `focusInput()` / `clearAndResetMode()` /
  `runCommand()`. Type is currently `HTMLInputElement`.
- `.input-line` is `display: flex; align-items: center;` with a `$` `.prompt` span and the input at
  `flex: 1`.

## Approach — convert the single-line `<input>` to an auto-growing wrapping `<textarea>`
A `<textarea>` naturally wraps text at its width. We make it behave like a one-line prompt that grows
downward as the command wraps, and recompute its height on content change and on resize. This is the
smallest robust change: it reuses the existing bubbling keydown handler and the existing `inputValue`
binding, and keeps the `textbox` ARIA role so existing tests keep passing.

### Changes in `src/lib/components/Terminal.svelte`

1. **Markup (lines ~513–522):** replace the `<input type="text" …>` with a `<textarea>`:
   - `rows="1"`, keep `class="terminal-input"`, `bind:value={inputValue}`, `bind:this={inputRef}`,
     and the `autocomplete/autocorrect/autocapitalize/spellcheck="false"` attributes.
   - Add `oninput={autoGrow}` so height tracks typing/deletion/paste.
   - (A `<textarea>` reports `role="textbox"`, so `screen.getByRole('textbox')` /
     `toHaveValue` in the tests still resolve.)

2. **`inputRef` type:** change `$state<HTMLInputElement | null>` → `$state<HTMLTextAreaElement | null>`.

3. **Auto-grow helper:** add
   ```ts
   function autoGrow() {
     if (!inputRef) return;
     inputRef.style.height = 'auto';        // reset so scrollHeight shrinks too
     inputRef.style.height = `${inputRef.scrollHeight}px`;
   }
   ```
   Call `autoGrow()` after every programmatic reset of `inputValue` (the Enter branch in
   `handleKeyDown` and inside `runCommand`) via `tick().then(autoGrow)` — `oninput` does not fire on
   programmatic value changes, so the box must be collapsed back to one line after submit/clear.

4. **Responsive reflow:** attach a `ResizeObserver` to the textarea so wrapping recomputes when the
   terminal/window narrows or when maximize toggles:
   ```ts
   $effect(() => {
     if (!inputRef) return;
     const ro = new ResizeObserver(() => autoGrow());
     ro.observe(inputRef);
     return () => ro.disconnect();
   });
   ```
   Reading `inputRef` makes the effect re-run when the textarea is created/destroyed (it only exists
   in `default` mode). `ResizeObserver` fires once on `observe`, giving the correct initial height.

5. **Enter still submits, never inserts a newline:** `handleKeyDown` already calls
   `event.preventDefault()` on `Enter` in default mode and on `Ctrl/Cmd+Enter`; `preventDefault` on a
   textarea keydown suppresses newline insertion. Verify no code path lets a bare Enter through. (No
   multi-line command entry is desired.)

6. **CSS (`.terminal-input`, ~lines 701–710, and `.input-line`, ~689–693):**
   - `.input-line`: change `align-items: center` → `align-items: flex-start` so the `$` prompt aligns
     with the first wrapped line rather than vertically centering against a tall box.
   - `.terminal-input`: keep the transparent/border-none/inherit-font styling; add
     `resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; padding: 0;
     margin: 0; line-height: inherit;` so it matches the input's look, wraps like the history lines,
     and has no scrollbars. Keep `caret-color` and the `::placeholder` rule (harmless on textarea).

## Files to change
- `src/lib/components/Terminal.svelte` — markup swap, `inputRef` type, `autoGrow`, `ResizeObserver`
  effect, two reset call sites, CSS. Single-file change.

## Risks & edge cases
- **Programmatic clears** (`inputValue = ''` after Enter, `runCommand`): must re-run `autoGrow` or the
  box stays tall after submitting a wrapped command. Handled via `tick().then(autoGrow)`.
- **Mode switches:** textarea only renders in `default` mode; the `ResizeObserver` effect re-runs on
  `inputRef` change, so it re-observes when the user returns to default mode. No leaked observers
  (cleanup returned).
- **Enter-as-newline regression:** relies on the existing `preventDefault`. Covered by the bubbling
  handler; confirm during implementation.
- **`getByRole('textbox')` in existing tests:** textarea keeps this role, so
  `Terminal.browser.test.ts` (runCommand + "clears the input box") stays green. The
  `.terminal-input` selector used in one test also still matches.
- **Maximize / small-screen media query (`@media max-width: 640px`):** font-size shrinks; `autoGrow`
  is width-agnostic (uses live `scrollHeight`) so it stays correct.
- **No `field-sizing: content` CSS-only shortcut:** browser support is too new to rely on; the JS
  `scrollHeight` approach is the established, robust pattern and is what this plan uses.

## Testing
- **Automated (browser tests, vitest-browser-svelte):** extend `Terminal.browser.test.ts`:
  - The interactive control is now a `<textarea>` and still resolves via `getByRole('textbox')`;
    existing tests (runCommand echo/focus, "clears the input box", invalid-id focus) must stay green.
  - Add a test that fills the textbox with a long string and asserts the element's rendered height
    grows beyond a single line (e.g. `offsetHeight` increases vs. the empty/one-line baseline),
    demonstrating wrap. Keep assertions tolerant of exact pixel values.
  - Add a test that after a wrapped command is submitted, the textbox value is `''` and its height
    collapses back to the one-line baseline.
- **Manual (per issue acceptance criteria):** run the app, open the CLI terminal, type a long command
  and shrink the window / terminal to confirm the text wraps and reflows on resize; confirm typing,
  Enter-to-submit, Ctrl/Cmd+Enter maximize, and the list/leaderboard/man keybindings all still work;
  confirm no visual regression to the `$` prompt alignment or the output area.

## Scope flags
- `needs_frontend: true` — single Svelte component (markup + CSS + small script).
- `needs_backend: false` — no server, data, or API changes.
