# Plan — `prefix + :` (command-prompt) doesn't open its input in challenge mode (#50)

## Goal

In challenge mode, pressing `prefix + :` must open the orange command-prompt input at the
bottom of the terminal and focus the user's cursor there, matching practice mode. Typing a
command and pressing Enter must still run and score it. All other prefix commands must be
unchanged.

## Root cause (confirmed against current code)

The reported flow still holds, though line numbers have drifted:

1. `src/lib/components/tmux/ChallengeTerminal.svelte` `handleCommand` (lines ~615–621): on
   `prefix + :` it **both** emits the scoring signal
   `tmux.executeTmuxCommand(CommandId.COMMAND_PROMPT)` (a `command-executed` signal with
   `commandName: 'command-prompt'`) **and** opens the overlay by setting
   `inputModeCommand = cmd`.
2. `src/routes/challenge/[id]/+page.svelte` `handleSignal` (lines ~158–194): on every
   `command-executed` signal it submits the answer for scoring, then — unless the command
   populates the pane input (`commandPopulatesTerminalInput`, currently true only for
   `paste-buffer`) — calls `terminalRef?.clearInput()` and then `terminalRef?.focus()`.
3. `clearInput()` (ChallengeTerminal ~line 1076) sets `inputModeCommand = null`, which
   immediately closes the overlay that step 1 just opened. `focus()` additionally pulls focus
   back to the terminal pane. Net effect: the command prompt never becomes visible/focused.

Practice mode does not hit this because its handler gates clearing differently
(`shouldPreserveTerminalInputOnStepCompletion`), so the overlay survives there.

Note: there is already an established gate pattern here. `commandPopulatesTerminalInput`
(`src/lib/utils/tmux-commands.ts` ~line 125, backed by the `INPUT_POPULATING_COMMANDS` set)
was introduced so `paste-buffer` survives the clearing consumer. We extend that same pattern
rather than inventing a new mechanism.

## Approach

Follow the issue's first suggested direction: in the challenge signal handler, do **not**
dismiss or steal focus from the just-opened command-prompt overlay. The command-prompt is a
special case because, unlike `paste-buffer`, it must *also* not receive `focus()` (that would
move the cursor from the overlay input back to the terminal pane).

Add a small, data-driven predicate that identifies commands whose effect is to open a
component-owned input overlay that the challenge consumer must leave alone (currently only
`command-prompt`), and use it in `handleSignal` to skip **both** `clearInput()` and `focus()`
for that command. Scoring is untouched — `submitAnswer(answer)` still runs before the gate, so
the `command-prompt` step is still verified exactly as today.

Submission of a command typed into the prompt is already correct and needs no change:
`handleStatusBarInputSubmit` (ChallengeTerminal ~lines 156–236) resolves the typed text and
either calls `tmux.executeTmuxCommand(resolved)` (view-effect commands) or
`tmux.processCommand(trimmedValue)` (store commands), and sets `inputModeCommand = null`
itself. After submission the overlay is already closed, so a later `clearInput()` from the
resulting signal is harmless.

### Chosen implementation

1. **`src/lib/utils/tmux-commands.ts`** — add a sibling to `commandPopulatesTerminalInput`:
   - A `readonly Set<CommandIdType>` (e.g. `OVERLAY_INPUT_COMMANDS`) containing
     `CommandId.COMMAND_PROMPT`.
   - An exported predicate `commandOpensInputOverlay(commandName?: CommandIdType): boolean`
     that returns `true` only for members of that set (and `false` for `undefined`, matching
     the existing helper's contract for the raw `command` signal).
   - Keep JSDoc consistent with the existing helper so the intent (a clear/focus gate for the
     challenge route) is documented at the source.

2. **`src/routes/challenge/[id]/+page.svelte`** `handleSignal` — in **both** the
   `command-executed` branch (~184–193) and the raw `command` branch (~207–215), compute the
   overlay flag once and gate:
   - Skip `terminalRef?.clearInput()` when `commandPopulatesTerminalInput(...)` **or**
     `commandOpensInputOverlay(...)` is true (preserves existing paste-buffer behavior; adds
     command-prompt).
   - Skip `terminalRef?.focus()` when `commandOpensInputOverlay(...)` is true (paste-buffer
     still gets `focus()`, unchanged).
   - Import the new predicate alongside the existing `commandPopulatesTerminalInput` import.

   Sketch:
   ```ts
   const opensOverlay = commandOpensInputOverlay(signal.commandName);
   if (!commandPopulatesTerminalInput(signal.commandName) && !opensOverlay) {
       terminalRef?.clearInput();
   }
   if (challenge.status === 'active' && !opensOverlay) {
       terminalRef?.focus();
   }
   ```

No change is required inside `ChallengeTerminal.svelte`'s `handleCommand` — the component
already opens the overlay correctly; the bug is purely the consumer dismissing it.

## Files to change

- `src/lib/utils/tmux-commands.ts` — new `OVERLAY_INPUT_COMMANDS` set + exported
  `commandOpensInputOverlay` predicate.
- `src/routes/challenge/[id]/+page.svelte` — import the predicate; gate `clearInput()`/
  `focus()` in the two `handleSignal` branches.
- `src/lib/utils/tmux-commands.test.ts` — unit coverage for the new predicate.
- `src/lib/components/tmux/ChallengeTerminal.commands.browser.test.ts` — regression coverage
  that the overlay stays open in challenge mode after `prefix + :` (see Testing).

## Risks and edge cases

- **Don't break the paste-buffer gate.** `paste-buffer` must keep skipping `clearInput()` but
  keep receiving `focus()`. The two predicates are kept separate precisely so paste-buffer
  behavior is untouched; the existing browser tests in the "paste survives a clearing consumer"
  describe block guard this.
- **Scoring parity.** The `command-prompt` step is scored from the signal emitted when the
  prompt opens (`submitAnswer` runs before the gate). Gating only `clearInput()`/`focus()`
  does not affect scoring. Verify no challenge relies on the overlay being auto-dismissed.
- **Focus timing.** Confirm the overlay input actually receives focus (StatusBar auto-focuses
  its input when input mode becomes active, `StatusBar.svelte` ~line 73). Because we now skip
  the consumer's `focus()`, the overlay's own auto-focus is what keeps the cursor in the
  prompt — the regression test must assert focus/typeability, not just visibility.
- **Raw `command` branch.** Kept in sync so an unrecognized command can never dismiss an open
  overlay; `command-prompt` always arrives as a typed `command-executed` signal, so this is
  defensive but cheap.
- **Escape/empty submit still cancels.** `handleStatusBarInputCancel` /
  empty-submit paths still set `inputModeCommand = null` inside the component — unaffected.

## Testing

Run the existing suites (`pnpm test` / the browser vitest project) — they must stay green,
especially the paste-buffer gate tests.

New regression coverage:

1. **Unit (`tmux-commands.test.ts`)** — `commandOpensInputOverlay` returns `true` for
   `CommandId.COMMAND_PROMPT`, `false` for a representative non-overlay command
   (e.g. `LIST_WINDOWS`, `SPLIT_VERTICAL`) and for `undefined`.

2. **Browser (`ChallengeTerminal.commands.browser.test.ts`)** — add a case that mounts
   `ChallengeTerminal` with a consumer mimicking the real challenge route (clears **and**
   focuses on `command-executed`, gated by the real `commandPopulatesTerminalInput` **and**
   `commandOpensInputOverlay` predicates — mirroring `mountWithClearingConsumer`). Then:
   - Press `prefix + :` (`{Control>}b{/Control}:`).
   - Assert the command-prompt overlay is open and focused — e.g. the orange input mode is
     active (the `:` label / `.status-input` element is present) and typing lands in it, i.e.
     the overlay survives the consumer's `clearInput()`/`focus()`.
   - Assert the `command-prompt` `command-executed` signal was still emitted (scoring parity).
   - Optionally: type a command (e.g. `list-windows{Enter}`) and assert it runs, confirming the
     submit path still works after the overlay stays open.

   A contrast case (a non-overlay command still triggers the consumer's clear) already exists;
   ensure it remains green.

## Scope

Frontend only (Svelte components, a util predicate, and their tests). No backend, schema, or
API changes.
