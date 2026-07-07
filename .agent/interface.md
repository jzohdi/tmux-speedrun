# Interface — `prefix + :` opens command-prompt in challenge mode (#50)

This spec pins the contracts the implementation must satisfy. The change is a small, data-driven
gate in the challenge signal consumer, mirroring the existing `commandPopulatesTerminalInput`
pattern. No behavioral change to `ChallengeTerminal.svelte`, scoring, or practice mode.

## 1. New predicate — `src/lib/utils/tmux-commands.ts`

Add, adjacent to the existing `INPUT_POPULATING_COMMANDS` / `commandPopulatesTerminalInput`:

```ts
/**
 * Commands whose effect is to open a component-owned input overlay (currently the
 * command-prompt). A consumer that clears/refocuses the terminal after a command must leave
 * these alone, or it will dismiss the just-opened overlay and steal focus from it.
 * Kept as a data-driven set so future overlay-opening commands are easy to add.
 */
const OVERLAY_INPUT_COMMANDS: ReadonlySet<CommandIdType> = new Set([CommandId.COMMAND_PROMPT]);

/**
 * True only for commands that open a component-owned input overlay (currently command-prompt).
 * Consumers use this to skip clearing/refocusing the terminal, which would dismiss the overlay.
 * Returns false for undefined (e.g. the raw `command` signal, which carries no commandName).
 */
export function commandOpensInputOverlay(commandName?: CommandIdType): boolean {
	return commandName !== undefined && OVERLAY_INPUT_COMMANDS.has(commandName);
}
```

### Contract

- **Signature:** `commandOpensInputOverlay(commandName?: CommandIdType): boolean`
- **Exported** (named export), same module as `commandPopulatesTerminalInput`.
- **Returns `true`** iff `commandName === CommandId.COMMAND_PROMPT` (`'command-prompt'`).
- **Returns `false`** for `undefined` and for every other `CommandIdType` — matching the exact
  contract of `commandPopulatesTerminalInput` (false on `undefined` so the raw `command` signal,
  which has no `commandName`, is unaffected).
- Pure, synchronous, no side effects.
- `OVERLAY_INPUT_COMMANDS` and `INPUT_POPULATING_COMMANDS` remain **disjoint** sets — a command is
  either an input-populating command (paste-buffer: skip clear, keep focus) or an overlay-opening
  command (command-prompt: skip clear *and* skip focus), never both.

## 2. Consumer gate — `src/routes/challenge/[id]/+page.svelte` `handleSignal`

Import the new predicate alongside the existing one:

```ts
import { commandPopulatesTerminalInput, commandOpensInputOverlay } from '$lib/utils/tmux-commands';
```
(match the file's existing import path/style for `commandPopulatesTerminalInput`).

In **both** signal branches (`command-executed` ~184–193 and raw `command` ~207–215), gate
`clearInput()` and `focus()` as follows:

```ts
const opensOverlay = commandOpensInputOverlay(signal.commandName);

// Skip clearing when the command populates the pane input (paste-buffer) OR opens an overlay
// (command-prompt) — clearing would erase the paste / dismiss the overlay.
if (!commandPopulatesTerminalInput(signal.commandName) && !opensOverlay) {
	terminalRef?.clearInput();
}

// Skip refocusing the terminal pane only when an overlay is open — stealing focus would pull the
// cursor out of the overlay input. paste-buffer still receives focus() (unchanged).
if (challenge.status === 'active' && !opensOverlay) {
	terminalRef?.focus();
}
```

### Contract / invariants

- **Scoring is untouched.** `challenge.submitAnswer(answer)` still runs before the gate in the
  `command-executed` branch (and `submitAnswer(command)` in the raw branch). The `command-prompt`
  step is verified exactly as today.
- **command-prompt** (`opensOverlay === true`): both `clearInput()` and `focus()` are skipped, so
  the overlay opened by `ChallengeTerminal.handleCommand` stays visible and its own auto-focus
  (StatusBar auto-focuses its input on input mode activation) keeps the cursor in the prompt.
- **paste-buffer** (`commandPopulatesTerminalInput === true`, `opensOverlay === false`): skips
  `clearInput()`, still calls `focus()` — **unchanged** from current behavior.
- **all other commands** (both predicates false): `clearInput()` then `focus()` — **unchanged**.
- The raw `command` branch is kept in sync defensively; `command-prompt` always arrives as a typed
  `command-executed` signal, so `commandName` is `undefined` in the raw branch and both predicates
  return false there in practice.

## 3. No change required

- `ChallengeTerminal.svelte` `handleCommand` already emits the `command-prompt` scoring signal and
  opens the overlay (`inputModeCommand = cmd`) correctly. Do not modify it.
- `handleStatusBarInputSubmit` / cancel / empty-submit paths already set `inputModeCommand = null`
  themselves; a later `clearInput()` from the resulting signal is harmless. Unchanged.
- Practice mode (`src/routes/practice/+page.svelte`) is unaffected — it uses its own
  `shouldPreserveTerminalInputOnStepCompletion` gate.

## 4. Test contracts (for the tdd stage)

**Unit — `src/lib/utils/tmux-commands.test.ts`**
- `commandOpensInputOverlay(CommandId.COMMAND_PROMPT)` → `true`.
- `commandOpensInputOverlay(<non-overlay command>)` (e.g. `CommandId.LIST_WINDOWS` or
  `CommandId.SPLIT_VERTICAL`) → `false`.
- `commandOpensInputOverlay(undefined)` → `false`.
- (Guard) `commandPopulatesTerminalInput(CommandId.COMMAND_PROMPT)` → `false` and
  `commandOpensInputOverlay(CommandId.PASTE_BUFFER)` → `false` — the two sets stay disjoint.

**Browser regression — `src/lib/components/tmux/ChallengeTerminal.commands.browser.test.ts`**
- Mount `ChallengeTerminal` with a consumer that, on `command-executed`, mimics the real challenge
  route: gates `clearInput()` by `commandPopulatesTerminalInput || commandOpensInputOverlay` and
  gates `focus()` by `!commandOpensInputOverlay` (using the real predicates).
- Press `prefix + :` (`{Control>}b{/Control}:`).
- Assert the command-prompt overlay is **open and focused** (orange input mode active — the `:`
  label / `.status-input` element present) and that typing lands in it — i.e. it survives the
  consumer's `clearInput()`/`focus()`.
- Assert the `command-prompt` `command-executed` signal was still emitted (scoring parity).
- Optionally type e.g. `list-windows{Enter}` and assert it runs after the overlay stayed open.
- The existing paste-buffer "survives a clearing consumer" tests and any non-overlay clear-contrast
  test must remain green.

## Scope

Frontend only: one util predicate + its unit test, a two-branch gate in the challenge page, and a
browser regression test. No backend, schema, or API changes.
