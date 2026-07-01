# Plan analysis: `swap-window` command (issue jzohdi/tmux-speedrun#16)

## Conclusion: already implemented — escalating

Issue #16 requests adding a `swap-window` command. **This feature is already fully
implemented and merged into `main`** (commit `9914ea8` "implemented code for swap window
command", now an ancestor of `main`'s tip `3473726`). There is no implementation work left
to plan, so this run is escalated for a human decision (close the issue as already-done, or
clarify what additional behavior is wanted).

## Evidence — every checklist item in the issue is already present

| # | Checklist item | Location | Status |
|---|----------------|----------|--------|
| 1 | `CommandId.SWAP_WINDOW = 'swap-window'` | `src/lib/utils/tmux-commands.ts:67` | done |
| 2 | `WindowOperation` `{ type: 'swap'; source?: number; target: number }` | `src/lib/utils/tmux-commands.ts:172` | done |
| 2 | Command registered `matchPatterns: ['swap-window','swapw']`, `matchMode: 'prefix'`, `-s`/`-t` parsing (via `getFlagValue`) | `src/lib/utils/tmux-commands.ts:1172-1198` | done |
| 3 | `handleWindowOperation` `'swap'` case → validates indices, emits `can't find window: <n>`, calls `swapWindows` | `src/lib/stores/tmux-state.svelte.ts:1126-1141` | done |
| 3 | `swapWindows(source, target)` mutation (distinct from `reorderWindows`; exchanges two indices, recomputes `activeWindowIndex` so the active window follows its content) + exported | `src/lib/stores/tmux-state.svelte.ts:1507-1539`, export at `:3034` | done |
| 4 | No default keybinding | (none added) | done |
| 5 | `TMUX_COMMANDS` entry (difficulty `advanced`, category `window`) | `src/lib/data/tmux-commands.ts:126-130` | done |
| 6 | `PROMPT_VARIATIONS['swap-window']` (5 fixed-form prompts, no `requiresInput`) | `src/lib/server/challenges/prompt-variations.ts:111-117` | done |
| 7 | Store unit tests | `src/lib/stores/tmux-state.test.ts:1021-1158` (+ last-window-by-id survives swap `:1348-1353`) | done |

### Test coverage present
- Swap two non-active windows → active window unchanged.
- Swap that includes the active window → active follows to its new position.
- `swap-window -t Y` (no `-s`) → swaps the active window with target.
- Invalid / out-of-range index → `can't find window: <n>` error, no state change.
- Non-numeric `-t` and missing `-t` → `usage: swap-window [-s src] -t dst`.
- Same source/target → no-op, no error.
- `swapw` alias resolves.
- Direct `swapWindows` index-math unit tests (exchange + active-follows; out-of-range no-op).

All edge cases and mode-interaction requirements from the issue are covered by the existing
implementation.

## Git state note (why this run is confusing)

- `main` tip = `3473726`; it already contains `9914ea8` (swap-window).
- This branch `agent/run-1-71bc34` = `main` + unrelated leftover work: issue #31/#33
  "clickable home-page command hints" (`Terminal.svelte`, `+page.svelte`, browser tests) and
  stale `.agent/interface.md` (also for #31). `git diff main...HEAD` shows **only** those
  files — nothing swap-window related, because swap-window is already in the merge base.
- The `.agent/interface.md` and the #31 source changes on this branch are contamination from a
  prior run and are unrelated to issue #16.

## Recommended human action

1. Close issue #16 as already-implemented (feature shipped in `9914ea8`), **or** amend the
   issue if some additional/changed behavior is actually desired (in which case a fresh,
   specific plan can be written).
2. Separately, note the stale/contaminated worktree state (leftover #31 artifacts on this
   branch) so the pipeline's branch bookkeeping can be corrected.

## Scope (nature of the feature, for reference)
- Backend / store-logic only (command parsing + state mutation + tests). No UI work.
