# Plan — Smooth out challenge command-count scaling (#37)

## Goal

Make individual challenges shorter and less tedious while keeping the game loop fun and
repeatable. Difficulty should come from the growing pool of unique commands to memorize, **not**
from the raw number of commands in a run. Concretely:

- Start Challenge 0 lower (15–20 commands instead of 25).
- Use a **non-increasing** per-step increment so counts grow smoothly and plateau instead of
  climbing linearly by 15.
- Bring the highest challenge's command count **substantially below** the current 100.
- Keep the per-challenge command **pools** (which/how many unique commands are introduced)
  unchanged.
- Define the scaling in **one place** (config/formula), not duplicated per screen.

## How the code works today

The instruction count is duplicated in two places, which currently agree only by convention:

- `src/lib/server/challenges/pools.ts` — the **authoritative** server config. Each
  `CHALLENGE_POOLS[i]` has `instructionCount = BASE_INSTRUCTION_COUNT (25) + INSTRUCTION_INCREMENT
  (15) * i` and a `minInputCommands`. `getInstructionCount(id)` feeds the generator.
- `src/lib/data/challenges.ts` — a **client-safe duplicate** (`CHALLENGE_METADATA`) that
  re-declares its own `BASE_INSTRUCTION_COUNT`/`INSTRUCTION_INCREMENT` and is documented as
  "must match the server pools." `Terminal.svelte` renders `${c.instructionCount} commands` from it.

The generator (`src/lib/server/challenges/generator.ts`) builds a run of `targetCount` instructions:
1. adds `min(minInputCommands, uniqueInputCommands)` input instructions (there are only **2** unique
   input commands in the whole command set — `rename-window`, `rename-session`);
2. adds simple commands until it reaches `maxStandardInstructions` (== `targetCount`, minus 1 when a
   copy-paste sequence is appended for challenges ≥ 4) — this is the pool-coverage pass;
3. tops up input instructions toward `minInputCommands` **only if slots remain** after coverage;
4. fills any remaining slots with random picks; then shuffles and re-indexes.

Pool sizes / simple-command counts (needed for the analysis below):
- C0: beginner only — 16 commands (2 input, 14 simple).
- C1–C2: beginner+intermediate — 30 commands (2 input, 28 simple).
- C3–C5: all — 39 commands (2 input, 37 simple; for C4/C5 the 2 standalone copy commands are
  excluded from the simple pool, leaving 35, and 1 slot is reserved for the copy-paste sequence).

### Key constraint discovered during planning

Because the coverage pass (step 2) runs **before** the input top-up (step 3), the min-input
requirement can only be met when `targetCount ≥ uniqueSimpleCovered + minInputCommands`, OR when
`minInputCommands ≤ 2` (guaranteed by step 1 alone). With the current escalating
`minInputCommands = [3, 5, 7, 9, 11, 13]`, the *floor* count needed to satisfy the existing
`generator.test.ts` "meets minimum input command requirement" test is:

- C1 needs ≥ 33, C2 ≥ 35, C3 ≥ 46, C4 ≥ 47, C5 ≥ 49.

The issue's requested ranges cap C1 at roughly 30 (C0 ≤ 20, first increment ≤ 10). **It is therefore
mathematically impossible** to hit the requested counts while keeping `minInputCommands` at its
current values — the min-input test would fail. `minInputCommands` **must** be lowered as a
necessary consequence of the count reduction. This does not touch the command pools, so it is
consistent with "do not change which/how many unique commands are introduced." It also *helps* the
issue's intent: typing random word-word-digit strings for input commands is the most tedious part of
a run, so fewer forced input commands = less tedious.

## Approach

### 1. Single source of truth for the scaling

Create a new client-safe module `src/lib/data/challenge-scaling.ts` that defines the scaling once:

```ts
/** Command count for Challenge 0. */
export const BASE_INSTRUCTION_COUNT = 18;

/**
 * Per-step increments, non-increasing, applied on top of the base.
 * Counts: [18, 26, 33, 39, 44, 48].
 */
export const INSTRUCTION_INCREMENTS = [8, 7, 6, 5, 4] as const;

/** Derived cumulative command count per challenge index. */
export const CHALLENGE_INSTRUCTION_COUNTS: number[] = INSTRUCTION_INCREMENTS.reduce(
  (counts, inc) => [...counts, counts[counts.length - 1] + inc],
  [BASE_INSTRUCTION_COUNT]
);

export function getInstructionCountForChallenge(index: number): number { ... }
```

Both consumers import from this module:
- `pools.ts` (`$lib/server/...` may import client-safe `$lib/data`) uses
  `CHALLENGE_INSTRUCTION_COUNTS[challengeId]` for each `instructionCount`, and deletes its local
  `BASE_INSTRUCTION_COUNT`/`INSTRUCTION_INCREMENT`.
- `challenges.ts` builds `CHALLENGE_METADATA` from `CHALLENGE_INSTRUCTION_COUNTS`, and deletes its
  local `BASE_INSTRUCTION_COUNT`/`INSTRUCTION_INCREMENT`. (Keep it as 6 entries, matching pools.)

An explicit `INSTRUCTION_INCREMENTS` array (rather than a closed-form formula) is deliberately the
"config" the issue asks for: it makes the non-increasing property auditable and easy to tune.

### 2. Chosen counts and increments

| Challenge | Count | Increment from previous |
|-----------|-------|-------------------------|
| 0         | 18    | — (base, in 15–20)      |
| 1         | 26    | +8  (range 5–10)        |
| 2         | 33    | +7  (range 5–10)        |
| 3         | 39    | +6  (range 4–8)         |
| 4         | 44    | +5  (range 4–7)         |
| 5         | 48    | +4  (taper)             |

Increments `8, 7, 6, 5, 4` are strictly decreasing (⇒ non-increasing ✓), each within the requested
range, and the max count 48 is ~52% below 100 ("substantially lower" ✓).

### 3. Lower `minInputCommands`

Set `minInputCommands = 2` for **all** challenges in `pools.ts`. Rationale:
- Guaranteed satisfiable at any count ≥ 2 (step 1 adds `min(2, 2) = 2` input instructions before the
  coverage pass), so the min-input test passes for every new count.
- Security is preserved: two input instructions with fresh random strings per generation still make
  replay/precompute infeasible; the global answer-space security test in `generator.test.ts` uses
  the full command set (unaffected).
- Fewer forced random-string entries directly reduces run tedium.

(If a reviewer prefers a slight escalation, C4/C5 have headroom for up to ~8/12 input commands under
these counts, but a flat `2` is the simplest guaranteed-correct choice and is the recommendation.)

## Files to change

- **NEW** `src/lib/data/challenge-scaling.ts` — single-source scaling config + derived counts +
  `getInstructionCountForChallenge` helper.
- `src/lib/server/challenges/pools.ts` — import counts from the scaling module; remove local
  `BASE_INSTRUCTION_COUNT`/`INSTRUCTION_INCREMENT`; set each `instructionCount` from the shared
  counts; set every `minInputCommands` to `2`; update the header doc comment (the
  "grow by 15 … C0=25…C5=100" block is now stale).
- `src/lib/data/challenges.ts` — import counts from the scaling module; remove local
  `BASE_INSTRUCTION_COUNT`/`INSTRUCTION_INCREMENT`; build `CHALLENGE_METADATA.instructionCount`
  from the shared counts; update the "must match the server pools" comment to point at the shared
  module.
- `src/lib/server/challenges/generator.test.ts` — update expectations:
  - "instruction count follows …" `expectedCounts` → `[18, 26, 33, 39, 44, 48]`.
  - "instruction count grows by 15 per challenge level" → replace with a **non-increasing
    increment** assertion (each `counts[i] - counts[i-1] > 0` and
    `counts[i] - counts[i-1] <= counts[i-1] - counts[i-2]` for i ≥ 2), which is the actual
    acceptance criterion now.
  - "minInputCommands is configured for each challenge" `expectedMins` → `[2, 2, 2, 2, 2, 2]`.
  - Leave the "meets minimum input command requirement", "generates correct number of instructions",
    and copy-paste sequence tests as-is; verify they still pass under the new numbers.
- **(Optional, recommended)** add `src/lib/data/challenge-scaling.test.ts` asserting: C0 ∈ [15,20],
  every increment > 0 and non-increasing, each increment within the issue's ranges, and max count
  well below 100 — encoding the acceptance criteria as guardrails.

## Risks and edge cases

- **Min-input test regression** — the central risk; addressed by lowering `minInputCommands` to 2
  (analysis above). Must re-run `generator.test.ts` to confirm green.
- **Partial pool coverage per run** — with C1 count 26 < 30 pool commands, a single run no longer
  necessarily includes every command in the pool; the shuffled sampling surfaces them across
  repeated runs. This is acceptable and consistent with the goal (the *pool* of unique commands to
  memorize is unchanged; a run samples it). Note it but do not attempt to force full coverage — that
  would re-inflate counts.
- **Two duplicated configs drifting** — resolved by the shared module; keep both importing it so
  they cannot diverge again.
- **Legacy `CHALLENGES` array** in `challenges.ts` (difficulty-based, 5 entries) is a separate,
  unrelated data path used by `challenge/[id]/+page.server.ts`; it is **out of scope** — do not
  touch it.
- **Stale doc comments** — the pools.ts header explicitly states "grow by 15 … C5=100"; update it
  or it will mislead the next reader.

## Testing

- `npm run test` (vitest) — focus on `src/lib/server/challenges/generator.test.ts`; confirm updated
  count/increment/min-input tests pass and the untouched generation/security tests stay green.
- `npm run check` / lint — confirm no dangling references to the removed `BASE_INSTRUCTION_COUNT` /
  `INSTRUCTION_INCREMENT` constants and types still resolve.
- Manual sanity (optional): confirm the home/terminal challenge list renders the new
  "N commands" labels (18 … 48) via `Terminal.svelte`, which reads `CHALLENGE_METADATA`.

## Acceptance-criteria mapping

- [x] Challenge 0 requires 15–20 → **18**.
- [x] Per-step increment non-increasing → `8, 7, 6, 5, 4`.
- [x] Each increment within ranges → C1 +8, C2 +7, C3 +6, C4 +5, C5 +4 (taper).
- [x] Highest count substantially lower than 100 → **48**.
- [x] Unique commands per challenge unchanged → pool filters untouched.
- [x] Scaling defined in one place → new `challenge-scaling.ts`, imported by both configs.
