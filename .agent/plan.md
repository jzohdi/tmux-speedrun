# Plan — Issue #42: non-required commands must still affect the terminal

## Goal (restated)

In the in-browser tmux emulator (challenge / practice / free-play), every supported command must
behave like real tmux — mutating state or producing its normal output — **whenever it is validly
invoked**, independent of whether it matches the challenge's current required step. Challenge-step
matching stays a separate, non-blocking concern: a non-matching command still runs, it simply is not
counted toward the step. The headline broken cases are `command-prompt` (`prefix + :`) and
`paste-buffer` (`prefix + ]`), plus command-mode (`prefix + :` then a typed command) invocation of
query commands like `list-buffers`.

## Root-cause analysis (grounded in the current code)

The premise that a command is *gated on the required step* is **not** literally how the code works —
so the fix is about the command-execution path, not about adding/removing a step gate:

1. **No per-step execution gate exists.** Consumers only score, they never block execution:
   - Challenge (`src/routes/challenge/[id]/+page.svelte:157`): `handleSignal` forwards
     `command-executed` / `command` to `challenge.submitAnswer` (server-side crypto verification in
     `src/lib/client/challenge.ts:187`). Wrong answers just don't advance.
   - Practice (`src/routes/practice/+page.svelte:176`): `isCurrentStepMatch` compares the signal to
     the current step; a mismatch only shows "incorrect" feedback.
   - Free-play (`src/routes/free-play/+page.svelte`): no matching at all.
   - The only execution gate is the whole-terminal `disabled` check in
     `ChallengeTerminal.svelte:566` (`handleKeybinding`), driven by `disabled={!showInput}` /
     `challenge.status === 'active'` — not by step correctness.

2. **The real bug: the command-prompt / text path can only run *registered* commands.**
   `handleStatusBarInputSubmit` (`ChallengeTerminal.svelte:161`) routes command-prompt input to
   `tmux.processCommand`, which resolves commands through the registry in `tmux-commands.ts`
   (`executeCommand` → `findCommand`). The following `CommandId`s are **never** registered via
   `registerCommand`, so `executeCommand` returns `null` and `processCommand` prints
   `unknown command`:
   - `paste-buffer`, `copy-mode`, `display-panes`, `show-time` (and `command-prompt` itself).
   These commands only have effects wired in the component's prefix path
   (`executeLocalCommand`, `ChallengeTerminal.svelte:625`), which is **not reachable** from the
   command prompt. Result: typing `paste-buffer` (or `copy-mode`, etc.) into the command prompt
   silently no-ops — exactly the reported symptom. `list-buffers` / `list-windows` /
   `list-sessions` are registered and already work; we only need to lock that with tests.

3. **The second real bug: the challenge route wipes paste-buffer's effect.** The prefix path
   (`ChallengeTerminal.svelte:726`) pastes buffer content into the focused pane input and emits
   `command-executed`; the new command-prompt path (below) emits the same signal. But in the
   *challenge route*, `handleSignal` calls `terminalRef.clearInput()` **unconditionally on every
   `command-executed`** (`src/routes/challenge/[id]/+page.svelte:184`, and again for raw `command`
   signals at `:203`), regardless of whether the command matched the required step. `clearInput()`
   runs `tmux.setInput('')`, blanking the pane input the instant after paste-buffer populated it — so
   in a live challenge the paste "does nothing" on screen. This hits **both** the existing prefix
   `prefix + ]` path and the plan's new command-prompt `paste-buffer` path, and it directly fails
   acceptance criterion #3 and reported example #2. The practice route already avoids this: it only
   clears on a *matched* step, and even then preserves input for paste-buffer via
   `cleanupCurrentItem({ clearInput: !shouldPreserveTerminalInputOnStepCompletion(currentItem, currentStep) })`
   (`src/routes/practice/+page.svelte:157`; predicate in `src/lib/data/practice-flow.ts:107`). The
   challenge route is the one consumer that still clears input after paste-buffer, so it **must come
   into scope** — the issue's 3-file "Scope" is an explicit starting hint that invites planning to
   redirect, and the binding acceptance criteria (#3) require challenge-mode paste to actually work.

   **Signal shape caveat (must be handled by the fix):** the challenge-route preservation gate keys
   on the executed command's canonical id, but the two paste emitters populate the `command-executed`
   signal differently:
   - The **command-prompt** path goes through the store: `processCommand` → `emitSignal('command-executed')`
     sets `commandName: 'paste-buffer'` (`tmux-state.svelte.ts:~2614`). Detectable.
   - The **prefix `prefix + ]`** path (`ChallengeTerminal.svelte:749`) emits via
     `emitCompositeSequenceSignal(createCopyPasteSequenceAction(...))` (`:338-343`), which sets **only**
     `command` (the composite copy/paste answer string) and **omits `commandName`**. So
     `signal.commandName` is `undefined` for a prefix paste, `commandPopulatesTerminalInput(undefined)`
     → `false`, and the gate would **still** fire `clearInput()` — wiping the just-pasted input.
   The prefix paste — the *original* reported symptom (reported example #2) — is exactly the emitter
   that omits `commandName`. Therefore the prefix paste emitter must be made detectable by the gate
   (see File #3). Verified: `emitCompositeSequenceSignal` has a single caller (the prefix paste at
   `:749`); `TmuxSignal.commandName` is already an optional `CommandIdType` (`pane-tree.ts:198`); and
   `handleSignal` scores solely off `signal.command` (`:165`, `:180`) with `commandName` used only for
   debug logging — so adding `commandName` to the prefix paste signal cannot change challenge scoring.

## Approach & architecture

Model command execution as a single, **step-independent** concern with two effect layers, and make
both the prefix path and the command-prompt/text path reach every supported command:

- **Store-executable commands** (state change / output): registered in `tmux-commands.ts`, executed
  by the store through `processCommand` / `executeRegisteredTmuxCommand`. Bring `paste-buffer` into
  this layer with a new `paste` buffer operation so it works uniformly whether typed in a pane or via
  the command prompt.
- **View-effect commands** (`copy-mode`, `display-panes`, `show-time`): require component-owned
  overlays / copy-surface / DOM focus that the store cannot perform. These stay executed by
  `executeLocalCommand` in the component. To make them reachable from the command prompt, the
  component's submit handler resolves the typed text to a canonical command id and dispatches
  view-effect commands to `executeLocalCommand` (the same path prefix keys use), delegating
  everything else to `tmux.processCommand`.

- **Challenge-route input preservation** (the second fix): paste-buffer's whole effect *is* to
  populate the pane input, so the challenge consumer must stop erasing it. Gate the route's
  `clearInput()` on the command that ran: skip clearing when the executed command's effect is to
  populate terminal input (i.e. `paste-buffer`), mirroring how the practice route already preserves
  input for the paste-buffer step. This keeps the existing "clear after each command" reset for every
  other command while letting paste survive on screen. For the gate to work on **both** paste paths,
  the prefix paste emitter (which today omits `commandName`) must be updated to tag its
  `command-executed` signal with `commandName: CommandId.PASTE_BUFFER` (see File #3) — the
  command-prompt path already sets `commandName` via the store. Without that, only the command-prompt
  paste would be preserved and the prefix `prefix + ]` paste (the original reported bug) would still
  be wiped.

Net effect: command-prompt runs **every** supported command generically, the prefix and command-mode
paths share one execution definition per command, nothing consults the current required step, and the
paste effect persists in a live challenge instead of being wiped by the consumer.

## Files to change

### 1. `src/lib/utils/tmux-commands.ts`
- Extend the `BufferOperation` union with `{ type: 'paste'; name?: string }`.
- Register a `paste-buffer` command (canonical name `CommandId.PASTE_BUFFER`), e.g.
  `matchPatterns: ['tmux paste-buffer', 'tmux pasteb', 'paste-buffer', 'pasteb']`,
  `matchMode: 'prefix'`, handler returning
  `{ handled: true, bufferOperation: { type: 'paste', name: getFlagValue(ctx.args, '-b') } }`
  (mirrors the existing `show-buffer` / `delete-buffer` handlers, incl. optional `-b <name>`).
- Register the view-effect commands `copy-mode`, `display-panes`, `show-time` (with real tmux
  match patterns, e.g. `clock-mode` for show-time, `displayp` for display-panes) so the component
  can resolve their canonical id from typed text via `executeCommand`. Their handlers return a
  minimal `{ handled: true }` result; the visible effect is owned by the component layer (documented
  in a comment). This also makes them appear in `help` / `list-keys`, matching real tmux.
- (No change needed to `executeCommand`; the component reuses it purely as a resolver.)
- Export a small, unit-testable predicate `commandPopulatesTerminalInput(commandName: CommandIdType):
  boolean` returning `true` only for `CommandId.PASTE_BUFFER` (the one supported command whose effect
  is to populate the pane input). This is the challenge route's analogue of practice-flow's
  `shouldPreserveTerminalInputOnStepCompletion`, but keyed on the command rather than the practice
  item — so the same predicate can drive the challenge consumer's clear/preserve decision. Keep it
  data-driven (a set of `CommandId`s) so future input-populating commands are easy to add.

### 2. `src/lib/stores/tmux-state.svelte.ts`
- Handle `bufferOperation.type === 'paste'` in `handleBufferOperation` (~`:2433`): resolve the target
  buffer via the existing `findPasteBuffer(name)` (named or most-recent); append its content to the
  focused pane's input using `setInput` (append to current `inputValue`). Empty/absent buffer →
  no-op that mirrors real tmux (optionally an inert system line), never an error/throw.
- Because `handleBufferOperation` is already invoked from both `processCommand` (default + tmux
  branches) and `executeRegisteredTmuxCommand`, paste-buffer will work via pane text input **and**
  the command prompt with no further wiring.

### 3. `src/lib/components/tmux/ChallengeTerminal.svelte`
- Define a `VIEW_EFFECT_COMMANDS` set: `COPY_MODE`, `DISPLAY_PANES`, `SHOW_TIME` (and keep
  `PASTE_BUFFER` out of it — it is store-handled).
- In the command-prompt branch of `handleStatusBarInputSubmit` (`:161`), before delegating to
  `tmux.processCommand`, resolve the typed text: `const resolved = executeCommand(trimmedValue,
  tmux.focusedPaneId, mode)?.commandName`. If `resolved` is in `VIEW_EFFECT_COMMANDS`, emit the
  scoring signal (`tmux.executeTmuxCommand(resolved)`) and run `executeLocalCommand(resolved)` — the
  exact prefix path. Otherwise keep the existing `tmux.processCommand(trimmedValue)` call (now
  covering paste-buffer and the list-* query commands).
- Consider extracting a small shared `dispatchTypedCommand(text)` helper so the same resolution could
  later back pane submission too; keeping the initial change focused on the command-prompt path is
  acceptable.
- **Tag the prefix paste signal with its command id (required for the preservation gate).** The prefix
  `PASTE_BUFFER` case (`:726-751`) currently emits its `command-executed` via
  `emitCompositeSequenceSignal(createCopyPasteSequenceAction(...))`, which sets only `command` and no
  `commandName`. Change this so the emitted signal also carries `commandName: CommandId.PASTE_BUFFER`.
  Concretely, give `emitCompositeSequenceSignal(command: string, commandName?: CommandIdType)` an
  optional second parameter that it forwards onto the signal object (`{ type: 'command-executed',
  command, ...(commandName ? { commandName } : {}) }`), and call it as
  `emitCompositeSequenceSignal(createCopyPasteSequenceAction(latestPasteBuffer.content), CommandId.PASTE_BUFFER)`
  at `:749`. This makes the prefix paste detectable by the challenge route's preservation gate (File #4)
  while leaving `signal.command` — the composite answer used by `submitAnswer` — unchanged, so challenge
  scoring is unaffected (`handleSignal` scores off `signal.command` only; `commandName` is used solely
  for debug logging). `emitCompositeSequenceSignal` has a single caller, so this is a contained change.
  The caret-aware paste behavior itself (`getFocusedPaneInputSelection` / `setInput` / caret restore)
  and the `emitPracticeStepSignal(CommandId.PASTE_BUFFER)` call are left as-is.
- Do **not** otherwise change the prefix handlers (`handleKeybinding` / `executeLocalCommand`) — aside
  from the paste signal's added `commandName`, prefix `paste-buffer` keeps its caret-aware paste and
  copy-mode/overlays behave as today.

### 4. `src/routes/challenge/[id]/+page.svelte` (challenge consumer — now in scope)
- In `handleSignal`, both the `command-executed` branch (`:184`) and the raw `command` branch
  (`:203`) call `terminalRef?.clearInput()` unconditionally after every signal. Gate that clear on the
  new predicate so paste-buffer's populated input survives:
  `if (!commandPopulatesTerminalInput(signal.commandName)) terminalRef?.clearInput();`
  (the `command-executed` signal carries `commandName?: CommandIdType`; the raw `command` branch has
  no `commandName`, so the predicate returns `false` there and clearing continues as today).
- Keep the subsequent `terminalRef?.focus()` unchanged so the next command can be typed; only the
  input-blanking is skipped for paste-buffer. Every other command keeps the existing
  clear-after-each-command reset, so no unrelated challenge behavior changes.
- Rationale: this is the minimal, behavior-preserving change that makes acceptance criterion #3 pass
  in challenge mode, and it mirrors the practice route's existing preservation mechanism rather than
  inventing a new pattern.

## Edge cases & risks

- **Empty paste buffer:** paste must be a silent no-op (real tmux does nothing); ensure no crash and
  no spurious error. Prefix path already shows "Paste buffer empty" feedback; store path should just
  no-op.
- **Named buffer (`paste-buffer -b bufferNNNN`):** support `-b` like show/delete; unknown name →
  no-op / mirror tmux (do not throw).
- **Scoring-signal parity (accepted divergence):** command-mode `paste-buffer` emits
  `command-executed` with `commandName: 'paste-buffer'`, whereas the prefix path emits a composite
  copy/paste sequence answer. So a challenge whose required step is paste-buffer may not *score* a
  command-mode paste. This is within acceptance criterion #4 ("a non-matching command runs but does
  not advance the step") — the paste effect still happens, which is what #3 requires. Note it; do not
  try to unify scoring.
- **Challenge route `clearInput()` interaction (now fixed in scope):** in a live challenge,
  `clearInput()` on `command-executed` previously blanked the pane input right after a paste, making
  the paste's on-screen effect transient — the core failure for acceptance criterion #3 / reported
  example #2. Fixed by gating the clear on `commandPopulatesTerminalInput(signal.commandName)` in
  `src/routes/challenge/[id]/+page.svelte` (file #4 above). **This gate only works if both paste
  emitters set `commandName`** — the command-prompt path already does (via the store), and File #3
  now tags the prefix paste signal with `commandName: CommandId.PASTE_BUFFER` too. Both fixes are
  required together: the route gate without the prefix-signal tag would leave the prefix `prefix + ]`
  paste broken (its `commandName` would be `undefined` → gate returns `false` → `clearInput` still
  fires). Because this bug lives in the consumer, it must be exercised by a test that includes the
  consumer's clear-on-signal behavior for **both** paste paths (see Testing), not just an isolated
  component/store test — an isolated test would pass while the shipped feature stayed broken.
- **View-effect commands reached by the store path:** the `{ handled: true }` registrations mean a
  pane-typed `copy-mode`/`display-panes`/`show-time` (not via the resolver) would report handled
  with no visible effect. This is an existing-shaped edge (these are prefix commands); document that
  their effect is component-owned. Pane-typed support can be added later via the shared dispatch
  helper if desired.
- **Focus/overlay timing:** command-prompt closes and restores focus (rAF) before
  `executeLocalCommand` runs display-panes/show-time overlays; verify the overlay still renders and
  paste caret handling degrades gracefully to end-of-input when the input isn't focused yet.

## Testing strategy

Test runner: two vitest projects — `server` (node, `*.test.ts`) and `browser`
(`*.browser.test.ts`, playwright/chromium). Commands: `npm run test:unit -- --run` and
`npm run test:browser`.

- **Store unit tests — `src/lib/stores/tmux-state.test.ts`:**
  - `executeRegisteredTmuxCommand('paste-buffer')` and `processCommand('paste-buffer')` append the
    latest buffer's content to the focused pane input.
  - `paste-buffer -b bufferNNNN` targets a named buffer; unknown name / empty buffers → no-op (no
    throw, input unchanged).
  - Regression lock: `list-buffers`, `list-windows`, `list-sessions` invoked via `processCommand`
    (no `tmux ` prefix, as command-prompt sends them) each produce their normal output.
- **Predicate unit test — `src/lib/utils/tmux-commands.test.ts`:** `commandPopulatesTerminalInput`
  returns `true` for `CommandId.PASTE_BUFFER` and `false` for a representative sample of other
  commands (and for `undefined`, matching the raw-`command` signal case). This locks the
  challenge-route clear/preserve decision at the unit level.
- **Browser tests — `src/lib/components/tmux/ChallengeTerminal.browser.test.ts`:**
  - Command prompt (`prefix + :`) → type `paste-buffer` → the focused input receives the buffer
    content (seed a buffer first via copy-mode as the existing paste test does).
  - Command prompt → type `list-buffers` / `list-windows` / `list-sessions` → output appears in
    history.
  - Command prompt → `copy-mode` enters copy mode (title/state reflects copy mode).
  - Keep the existing prefix `paste-buffer` test (`:283`).
  - Step-independence test: since the component holds no step state, assert that these invocations
    perform their effect and emit signals unconditionally (e.g. wire an `onSignal` spy and confirm
    the command executes regardless of any notion of a "required step"). This satisfies acceptance
    criterion #5 (command-prompt and paste-buffer execute while a *different* command would be the
    required step).
  - **Consumer-driven clear/preserve test (covers the challenge-route bug):** the isolated component
    test above does *not* catch the challenge bug, because the offending `clearInput()` lives in the
    route consumer, not the component. Add a test that mounts `ChallengeTerminal` with an `onSignal`
    handler mimicking the challenge consumer — on `command-executed` it calls `clearInput()` **only
    when `!commandPopulatesTerminalInput(signal.commandName)`** (importing the real predicate, exactly
    as the route will). Seed a buffer, then (a) run `paste-buffer` via prefix `prefix + ]` and (b) run
    `paste-buffer` via command prompt, while some *other* command (e.g. `list-windows`) is the notional
    required step; assert the focused pane input **retains** the pasted content after the signal
    handler runs in **both** cases. The prefix case (a) is the critical regression guard: it only
    passes because File #3 tags the prefix paste signal with `commandName: CommandId.PASTE_BUFFER`; if
    that tag is dropped, `signal.commandName` is `undefined`, the mimicked consumer clears, and this
    assertion fails — so the test directly locks the prefix-signal fix, not just the command-prompt
    path. Also assert (for both paths) that the emitted `command-executed` signal's `command` field is
    still the composite copy/paste answer (unchanged scoring input). Add a contrast case: a non-input
    command (e.g. `list-windows`) does trigger the consumer's `clearInput()`. These are the tests that
    would fail against today's unconditional-clear route / untagged prefix signal and pass once both
    fixes land — directly exercising acceptance criterion #3.
  - (Optional, if practical without heavy mocking of the challenge store: a route-level browser test
    of `src/routes/challenge/[id]/+page.svelte`. If the store/network mocking proves too costly, the
    consumer-mimicking component test above is the primary guarantee; note the tradeoff so it is not
    read as full route coverage.)

## Out of scope / notes

- **CLI (`cli/`) unchanged.** As the issue states, the CLI runs native tmux via generated key
  rebinds that already execute the real command unconditionally. No CLI change.
- **Challenge route (`src/routes/challenge/[id]/+page.svelte`)** is now **in scope** (file #4): its
  unconditional `clearInput()` is the second real bug behind reported example #2, so fixing it is
  required to satisfy acceptance criterion #3. The issue's 3-file "Scope" list is a starting hint that
  explicitly invites planning to redirect; this is that redirect.
- All work is client-side (Svelte components + TS store/util + one route consumer). No server, API,
  or database changes.

## Scope flags
- `needs_frontend`: true (Svelte component + client store/util logic).
- `needs_backend`: false (no server/API/database work).
