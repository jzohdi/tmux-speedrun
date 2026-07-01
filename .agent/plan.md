# Plan: Add `swap-window` command (issue #16)

## Goal (restated)

Add a `swap-window` tmux command to the speedrun trainer that swaps the **positions** of two
windows in the current session's window list.

- `swap-window -s X -t Y` → swap windows at indices X and Y.
- `swap-window -t Y` (no `-s`) → swap the current/active window with the window at index Y.
- Active window **follows its content**: after the swap `activeWindowIndex` still points at the
  originally-active window's new position.
- Fixed-form command (NOT `requiresInput`), canonical answer `swap-window`, category `window`,
  difficulty `advanced`, no default keybinding.

## Current state of the repository (IMPORTANT)

While studying the code I found that **this feature is already fully implemented and tested in the
working tree** on this branch. Every item on the issue's implementation checklist is present:

1. `CommandId.SWAP_WINDOW = 'swap-window'` — `src/lib/utils/tmux-commands.ts:67`.
2. `WindowOperation` extended with `{ type: 'swap'; source?: number; target: number }` —
   `tmux-commands.ts:172`. Command registered with `matchPatterns: ['swap-window', 'swapw']`,
   `matchMode: 'prefix'`, parsing `-s`/`-t` via the shared `getFlagValue` helper —
   `tmux-commands.ts:1172-1198`. On a bad/absent `-t` (or non-numeric `-s`) it returns
   `error: 'usage: swap-window [-s src] -t dst'`.
3. `handleWindowOperation` `'swap'` case — `src/lib/stores/tmux-state.svelte.ts:1126-1141`.
   It defaults `source` to `activeWindowIndex`, validates both indices, on failure adds an
   `error` history line `can't find window: <n>`, otherwise calls a dedicated
   `swapWindows(a, b)` mutation (`tmux-state.svelte.ts:1507-1539`). `swapWindows` exchanges
   exactly two indices (distinct from `reorderWindows`, which *moves*) and recomputes
   `activeWindowIndex` so the active window follows its content. Pane trees / `focusedPaneId`
   are preserved because only array positions are swapped.
4. No default keybinding — `swap-window` does not appear in `src/lib/data/keybindings.ts`.
5. `TMUX_COMMANDS` entry — `src/lib/data/tmux-commands.ts:125-131` (difficulty `advanced`,
   category `window`, shortcut `swap-window -s X -t Y, swapw -s X -t Y`). It is NOT in the
   `requiresInput` set, so it is treated as fixed-form per the resolved decision.
6. `PROMPT_VARIATIONS['swap-window']` — `src/lib/server/challenges/prompt-variations.ts:111-117`
   (5 variations).
7. Store unit tests — `src/lib/stores/tmux-state.test.ts`,
   `describe('createTmuxStore swap-window command')` (~lines 1021-1160): swap two non-active
   windows, swap including the active window (active follows), no-`-s` uses active window,
   invalid/out-of-range index → no-op, same-src==dst → no-op, missing `-t` → usage error,
   non-numeric `-t` → usage error, plus direct `swapWindows` index-math tests and an
   out-of-range no-op test. A `last-window` interaction test also exercises `swapWindows`.

## Approach for the implementation stage

Because the code already exists, the implementation stage's job is **verification and closing any
residual gaps**, not re-writing the feature. Concretely:

1. **Verify the suite is green.** Run the unit tests, type-check, and lint:
   - `pnpm vitest run src/lib/stores/tmux-state.test.ts` (or the full `pnpm test`).
   - `pnpm check` (svelte-check / tsc) to confirm the `WindowOperation` union change type-checks.
   - `pnpm lint`.
   Confirm the `swap-window` describe block passes and there are no type errors from the added
   `'swap'` variant.

2. **Re-read each checklist item against the code** (list above) and confirm behavior matches the
   issue, paying attention to the edge cases:
   - Invalid index (out of range / non-numeric) → error, no state change.
   - Same source and target → no-op, no error.
   - Only one window → any target other than 0 is out of range → error/no-op.
   - Active window in the swapped pair → `activeWindowIndex` recomputed to follow content.
   - Active window NOT in the pair → `activeWindowIndex` unchanged.
   - `focusedPaneId` / pane trees preserved.

3. **Optional refinement (low priority, only for tighter alignment with the issue wording):** the
   issue suggests prompts "asking to swap two specific window numbers." The current
   `PROMPT_VARIATIONS['swap-window']` are generic ("Swap the positions of two windows by their
   indices") rather than naming concrete numbers. This is acceptable under the resolved decision
   (canonical answer is just `swap-window`, no per-instruction random input, so the prompt need not
   embed specific numbers), so **treat this as optional polish, not a required change.** If touched,
   keep 4–6 variations and do NOT introduce `{input}` placeholders or set `requiresInput`.

## Files (already changed on this branch; areas to re-verify)

- `src/lib/utils/tmux-commands.ts` — `CommandId`, `WindowOperation`, command registration.
- `src/lib/stores/tmux-state.svelte.ts` — `handleWindowOperation` swap case, `swapWindows` helper,
  and its export in the returned store object.
- `src/lib/data/tmux-commands.ts` — `TMUX_COMMANDS` metadata entry.
- `src/lib/server/challenges/prompt-variations.ts` — `PROMPT_VARIATIONS['swap-window']`.
- `src/lib/stores/tmux-state.test.ts` — swap-window unit tests.

## Risks & edge cases

- **move vs swap:** must not reuse `reorderWindows` semantics — a swap exchanges exactly two
  indices and leaves all others fixed. Already handled by the dedicated `swapWindows` helper;
  verify the index math via the existing direct `swapWindows` tests.
- **Active-index recomputation:** double-check the two branches (`active === source` →
  `target`, `active === target` → `source`) and that an active window outside the pair is
  untouched. Covered by tests; re-confirm.
- **Validation order:** the handler validates both indices before mutating; ensure the error path
  emits `can't find window: <n>` and leaves state unchanged.
- **Mode gate:** command runs via CLI / command-prompt through `executeTmuxCommand`; independent
  of focused pane mode. No change needed here.

## How the result is tested

- Existing Vitest store tests in `tmux-state.test.ts` cover swap of non-active windows, swap
  including the active window, no-`-s` default-to-active, invalid index, and same-src/dst no-op.
- Type-check (`pnpm check`) validates the `WindowOperation` union extension end-to-end.
- Lint ensures style compliance.

If all of the above pass unchanged, the feature is complete and the change is ready to proceed; no
new production code is required beyond confirming/polishing what is already on the branch.

## Scope flags

- `needs_frontend`: **false** — no UI/component work; the command flows through existing
  CLI/command-prompt plumbing and store logic.
- `needs_backend`: **true** — command logic, store mutation, command metadata, prompt data, and
  unit tests (the app's non-UI logic layer).
