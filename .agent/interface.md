# Interface Spec — Issue #42: non-required commands must still affect the terminal

This pins the types, signatures, and invariants the `tdd` and implementation stages build against.
It follows `.agent/plan.md`. Four source files change; everything is client-side.

Legend: `➕ new`, `✏️ changed`, `▶ existing (referenced, unchanged)`.

---

## 1. `src/lib/utils/tmux-commands.ts`

### 1.1 `BufferOperation` — extend the union ✏️

```ts
export type BufferOperation =
	| { type: 'show'; name?: string }
	| { type: 'delete'; name?: string }
	| { type: 'capture' }
	| { type: 'paste'; name?: string }; // ➕ paste a buffer into the focused pane input
```

- `name` is the optional `-b <name>` target (mirrors `show` / `delete`). Absent ⇒ most-recent buffer.

### 1.2 Register `paste-buffer` ➕

Add a `registerCommand` entry mirroring the existing `show-buffer` / `delete-buffer` handlers:

```ts
registerCommand({
	name: CommandId.PASTE_BUFFER, // canonical id 'paste-buffer'
	matchPatterns: ['tmux paste-buffer', 'tmux pasteb', 'paste-buffer', 'pasteb'],
	matchMode: 'prefix',
	description: 'Paste a buffer into the focused pane',
	handler: (ctx) => ({
		handled: true,
		bufferOperation: { type: 'paste', name: getFlagValue(ctx.args, '-b') }
	})
});
```

- `matchMode: 'prefix'` is required so `paste-buffer -b bufferNNNN` still matches.
- Non-`tmux `-prefixed patterns (`paste-buffer`, `pasteb`) are what the command prompt sends.

### 1.3 Register the view-effect commands `copy-mode`, `display-panes`, `show-time` ➕

Purpose: make the component able to resolve their canonical id from typed command-prompt text via
`executeCommand` (used purely as a resolver — see §3.2). Their visible effect stays component-owned;
the handler returns a minimal handled result.

```ts
registerCommand({
	name: CommandId.COPY_MODE,
	matchPatterns: ['tmux copy-mode', 'copy-mode'],
	matchMode: 'prefix',
	description: 'Enter copy mode',
	handler: () => ({ handled: true }) // view effect owned by ChallengeTerminal.executeLocalCommand
});

registerCommand({
	name: CommandId.DISPLAY_PANES,
	matchPatterns: ['tmux display-panes', 'tmux displayp', 'display-panes', 'displayp'],
	matchMode: 'prefix',
	description: 'Briefly display pane indicators',
	handler: () => ({ handled: true }) // view effect owned by the component
});

registerCommand({
	name: CommandId.SHOW_TIME,
	matchPatterns: ['tmux clock-mode', 'clock-mode', 'show-time'],
	matchMode: 'prefix',
	description: 'Display the clock',
	handler: () => ({ handled: true }) // view effect owned by the component
});
```

- Invariant: because these return `{ handled: true }` with no operation, a **pane-typed** invocation
  (not routed through the component resolver) is handled but produces no visible effect. This is an
  accepted, documented edge — these are prefix commands; their effect is component-owned. Do not add
  store-side effects for them in this issue.
- Side benefit: they now appear in `help` / `list-keys` output; that is acceptable.

### 1.4 `commandPopulatesTerminalInput` — new predicate ➕

The challenge route's analogue of practice-flow's `shouldPreserveTerminalInputOnStepCompletion`, but
keyed on the executed command rather than a practice item.

```ts
/**
 * Commands whose entire effect is to populate the focused pane's text input.
 * Kept as a data-driven set so future input-populating commands are easy to add.
 */
const INPUT_POPULATING_COMMANDS: ReadonlySet<CommandIdType> = new Set([CommandId.PASTE_BUFFER]);

/**
 * True only for commands whose effect is to populate the pane input (currently paste-buffer).
 * Consumers use this to decide whether clearing the input after a command would erase its effect.
 * Returns false for undefined (e.g. the raw `command` signal, which carries no commandName).
 */
export function commandPopulatesTerminalInput(commandName?: CommandIdType): boolean {
	return commandName !== undefined && INPUT_POPULATING_COMMANDS.has(commandName);
}
```

- Signature is `(commandName?: CommandIdType) => boolean`. **Must accept `undefined`** and return
  `false` — the raw `command` signal branch in the challenge route has no `commandName`.
- No change to `executeCommand`; the component reuses it as a resolver (§3.2).

---

## 2. `src/lib/stores/tmux-state.svelte.ts`

### 2.1 Handle `bufferOperation.type === 'paste'` in `handleBufferOperation` ✏️

Add a `case 'paste'` to the switch at `handleBufferOperation` (~`:2433`):

```ts
case 'paste': {
	const buffer = findPasteBuffer(operation.name);

	// Empty / unknown buffer → silent no-op mirroring real tmux (no throw, no error line).
	if (!buffer || !buffer.content) {
		return;
	}

	// Append the buffer content to the focused pane's current input value.
	const pane = getFocusedPaneState();
	const currentValue = pane?.inputValue ?? '';
	setInput(currentValue + buffer.content);
	break;
}
```

- Uses existing helpers only: `findPasteBuffer(name?)` (`:522`), `getFocusedPaneState()` (`:341`),
  `setInput(value, paneId?)` (`:2275`).
- **Invariant:** empty or missing buffer is a silent no-op — input unchanged, no error line, no throw.
- Unlike the component's prefix path (which does caret-aware insertion), the store path appends at the
  end. That is acceptable: the command prompt has no caret position for the pane input.
- No further wiring needed: `handleBufferOperation` is already reached from both `processCommand`
  branches (`:2611`, `:2748`) and `executeRegisteredTmuxCommand` (implicitly), so paste works via pane
  text input **and** the command prompt.
- The command-executed signal emitted for a command-prompt paste already carries
  `commandName: 'paste-buffer'` (store `emitSignal` at `:2614` / the `processCommand` tmux branch),
  so the challenge-route preservation gate (§4) detects it.

---

## 3. `src/lib/components/tmux/ChallengeTerminal.svelte`

### 3.1 View-effect command set ➕

```ts
const VIEW_EFFECT_COMMANDS: ReadonlySet<CommandIdType> = new Set([
	CommandId.COPY_MODE,
	CommandId.DISPLAY_PANES,
	CommandId.SHOW_TIME
]);
```

- `PASTE_BUFFER` is deliberately **excluded** — it is store-handled (§2.1).

### 3.2 Command-prompt branch of `handleStatusBarInputSubmit` ✏️

At the `commandName === CommandId.COMMAND_PROMPT` branch (`:161`), after the empty-cancel check and
before the existing `tmux.processCommand(trimmedValue)` call (`:172`), resolve the typed text and
route view-effect commands to the component's local path (the exact path prefix keys use):

```ts
const resolved = executeCommand(trimmedValue, tmux.focusedPaneId, tmux.focusedPane?.mode ?? 'tmux')?.commandName;

if (resolved && VIEW_EFFECT_COMMANDS.has(resolved)) {
	tmux.executeTmuxCommand(resolved); // scoring signal, same as prefix path
	executeLocalCommand(resolved); // component-owned view effect (overlay / copy surface)
} else {
	// paste-buffer, list-*, and everything else run generically through the store.
	tmux.processCommand(trimmedValue);
}
```

- `executeCommand(command, paneId, mode)` returns `ExecuteResult | null`; use `?.commandName`.
  `tmux.focusedPaneId` and `tmux.focusedPane` (with `.mode`) are both already used in this component
  (`:274`, `:78`). The `mode` arg is only threaded into the handler context; the view-effect and paste
  handlers ignore it, so its exact value does not affect resolution. Do not invent new store API.
- `executeLocalCommand(commandName: CommandIdType): void` already exists (`:625`) and handles
  `COPY_MODE` / `DISPLAY_PANES` / `SHOW_TIME`.
- Keep the surrounding reset logic (`inputModeCommand = null; inputModeValue = ''`,
  `restoreFocusAfterInputMode()`) exactly as today for both branches.
- **Invariant:** nothing here consults any required-step state; resolution and dispatch are
  step-independent.

### 3.3 Tag the prefix paste signal with its command id ✏️ (required for the §4 gate)

`emitCompositeSequenceSignal` currently emits only `command`. Give it an optional `commandName` param
that it forwards onto the signal:

```ts
function emitCompositeSequenceSignal(command: string, commandName?: CommandIdType): void {
	onSignal?.({
		type: 'command-executed',
		command,
		...(commandName ? { commandName } : {})
	});
}
```

Then, in the prefix `CommandId.PASTE_BUFFER` case (`:749`), pass the id:

```ts
emitCompositeSequenceSignal(createCopyPasteSequenceAction(latestPasteBuffer.content), CommandId.PASTE_BUFFER);
```

- **Invariant — scoring unchanged:** `signal.command` (the composite copy/paste answer consumed by
  `submitAnswer`) is untouched; only `commandName` is added. The challenge route scores off
  `signal.command` only (`commandName` is used for debug logging), so challenge scoring is unaffected.
- `emitCompositeSequenceSignal` has a single caller (the prefix paste), so this is contained.
- Leave the caret-aware paste behavior (`getFocusedPaneInputSelection` / `setInput` / caret restore)
  and the `emitPracticeStepSignal(CommandId.PASTE_BUFFER)` call unchanged.
- Do **not** otherwise change `handleKeybinding` / `executeLocalCommand`.

---

## 4. `src/routes/challenge/[id]/+page.svelte` (challenge consumer) ✏️

In `handleSignal` (`:157`), gate the `terminalRef?.clearInput()` calls on the new predicate so
paste-buffer's populated input survives:

- `command-executed` branch (`:184`):

```ts
if (!commandPopulatesTerminalInput(signal.commandName)) {
	terminalRef?.clearInput();
}
```

- raw `command` branch (`:203`): same guard. That signal has no `commandName`, so the predicate
  returns `false` and clearing continues exactly as today.

Requires an import of `commandPopulatesTerminalInput` from `$lib/utils/tmux-commands`.

- Leave the subsequent `terminalRef?.focus()` unchanged so the next command can be typed.
- **Invariant:** every command except input-populating ones (currently only `paste-buffer`) keeps the
  existing clear-after-each-command reset. Only the input-blanking is skipped for paste-buffer, and
  only when the emitting signal carried `commandName: 'paste-buffer'` — which both paste paths now do
  (command-prompt via the store §2.1; prefix via §3.3).

---

## Contracts / invariants summary

1. **Step-independence:** No code path introduced or changed here consults the challenge's current
   required step. Command execution and challenge scoring stay fully decoupled (acceptance #1, #4, #5).
2. **paste-buffer everywhere:** `paste-buffer` (and `pasteb`, `-b <name>`) runs identically via pane
   text input, command prompt, and prefix `prefix + ]` — appending / inserting buffer content into the
   focused pane input (acceptance #2 command-prompt path; #3 effect).
3. **Empty/unknown buffer:** silent no-op — no throw, no error line, input unchanged (acceptance #3
   "define expected behavior when no buffer exists").
4. **Preservation gate correctness:** `commandPopulatesTerminalInput(signal.commandName)` returns
   `true` for both paste emitters (command-prompt sets `commandName` via the store; prefix sets it via
   §3.3) and `false` for every other command and for `undefined`. Dropping §3.3's tag would leave the
   prefix `prefix + ]` paste wiped — the two fixes are coupled.
5. **Scoring unchanged:** `submitAnswer` still receives the same `signal.command` values as before;
   `commandName` is additive metadata only.
6. **View-effect commands via command prompt:** `copy-mode` / `display-panes` / `show-time` typed into
   the command prompt resolve to their canonical id and run the same component overlay path as prefix
   keys (acceptance #2 generic command-prompt execution).

---

## Test surface (for the `tdd` stage)

Runner: vitest — `server` project (`*.test.ts`, node) and `browser` project (`*.browser.test.ts`,
playwright/chromium). Commands: `npm run test:unit -- --run`, `npm run test:browser`.

- **`src/lib/utils/tmux-commands.test.ts`** (server): `commandPopulatesTerminalInput` ⇒ `true` for
  `CommandId.PASTE_BUFFER`; `false` for a sample of other commands **and** for `undefined`.
- **`src/lib/stores/tmux-state.test.ts`** (server): `processCommand('paste-buffer')` and
  `executeRegisteredTmuxCommand('paste-buffer')` append the latest buffer content to the focused pane
  input; `paste-buffer -b bufferNNNN` targets a named buffer; empty / unknown buffer ⇒ no-op (no
  throw, input unchanged). Regression-lock `list-buffers` / `list-windows` / `list-sessions` via
  `processCommand` (no `tmux ` prefix) still produce their normal output.
- **`src/lib/components/tmux/ChallengeTerminal.browser.test.ts`** (browser): command prompt
  (`prefix + :`) → `paste-buffer` pastes into the focused input; command prompt → `list-buffers` /
  `list-windows` / `list-sessions` produce history output; command prompt → `copy-mode` enters copy
  mode; keep existing prefix `paste-buffer` test. **Consumer-mimicking clear/preserve test:** mount
  with an `onSignal` that calls `clearInput()` only when
  `!commandPopulatesTerminalInput(signal.commandName)` (importing the real predicate); seed a buffer;
  run paste via (a) prefix `prefix + ]` and (b) command prompt while a *different* command is the
  notional required step; assert input is retained in **both** cases and that `signal.command` is
  still the composite copy/paste answer. Contrast case: a non-input command (e.g. `list-windows`)
  triggers `clearInput()`. Case (a) is the guard for the §3.3 prefix-signal tag.
