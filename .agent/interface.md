# Interface Spec — Challenge command-count scaling (#37)

## 1. Scope

This change adjusts only the per-challenge instruction-count scaling and the minimum forced
input-command count needed to keep the existing generator contract satisfiable at lower totals.

Out of scope:

- changing challenge IDs or the number of challenge levels
- changing which commands belong to each challenge pool
- changing difficulty labels
- changing the challenge start/finish/record API shapes
- changing the legacy `CHALLENGES` array in `src/lib/data/challenges.ts`
- changing copy-paste sequence behavior beyond the fact that shorter runs still include it for
  challenges 4 and 5

## 2. Shared scaling module

Create a new client-safe module at `src/lib/data/challenge-scaling.ts`. This module is the single
source of truth for instruction counts and must contain no server-only imports.

Required export surface:

```ts
export const BASE_INSTRUCTION_COUNT = 18;
export const INSTRUCTION_INCREMENTS = [8, 7, 6, 5, 4] as const;
export const CHALLENGE_INSTRUCTION_COUNTS = [18, 26, 33, 39, 44, 48] as const;

export function getInstructionCountForChallenge(index: number): number;
```

Contract for `getInstructionCountForChallenge(index)`:

- accepts the existing numeric challenge index space `0..5`
- returns `CHALLENGE_INSTRUCTION_COUNTS[index]` for valid integer indices
- throws for invalid indices (negative, non-integer, or out of range)

Implementation freedom:

- `CHALLENGE_INSTRUCTION_COUNTS` may be declared literally or derived from
  `BASE_INSTRUCTION_COUNT` + `INSTRUCTION_INCREMENTS`
- the exported values above are the contract; downstream code/tests must observe those exact values

## 3. Server module contract

### `src/lib/server/challenges/pools.ts`

The public server-facing surface of this module stays in place:

```ts
export type PoolConfig = {
	challengeId: number;
	instructionCount: number;
	filter: (cmd: TmuxCommand) => boolean;
	minInputCommands: number;
};

export const CHALLENGE_POOLS: PoolConfig[];

export function getPoolConfig(challengeId: number): PoolConfig;
export function getPoolForChallenge(challengeId: number): TmuxCommand[];
export function getInputCommandsForChallenge(challengeId: number): TmuxCommand[];
export function getSimpleCommandsForChallenge(challengeId: number): TmuxCommand[];
export function getInstructionCount(challengeId: number): number;
export function getMinInputCommands(challengeId: number): number;
export function getChallengePoolCount(): number;
export function isValidChallengeId(challengeId: number): boolean;
export function getAllChallengeCommands(): TmuxCommand[];
export function getChallengeDifficultyLabel(challengeId: number): string;
export function getAllChallengeMetadata(): ChallengeMetadata[];
```

Required data contract for `CHALLENGE_POOLS`:

- length remains `6`
- `challengeId` values remain `0, 1, 2, 3, 4, 5`
- `instructionCount` values are sourced from `CHALLENGE_INSTRUCTION_COUNTS`
- pool filters are unchanged:
  - challenge 0: beginner only
  - challenges 1-2: beginner or intermediate
  - challenges 3-5: all commands
- `minInputCommands` is `2` for every challenge

Required behavior:

- `getInstructionCount(challengeId)` remains the authoritative server lookup used by the generator
- `getMinInputCommands(challengeId)` returns `2` for every valid challenge ID
- `getChallengePoolCount()` still returns `6`
- `isValidChallengeId()` semantics stay unchanged
- `getChallengeDifficultyLabel()` mapping stays unchanged:
  - `0 -> Beginner`
  - `1, 2 -> Intermediate`
  - `3, 4, 5 -> Advanced`

## 4. Client data contract

### `src/lib/data/challenges.ts`

The client-safe metadata surface remains:

```ts
export type ChallengeMetadata = {
	index: number;
	instructionCount: number;
	difficultyLabel: string;
};

export const CHALLENGE_METADATA: ChallengeMetadata[];

export function getAllChallengeMetadata(): ChallengeMetadata[];
export function getChallengePoolCount(): number;
export function isValidChallengeId(challengeId: number): boolean;
```

Required `CHALLENGE_METADATA` contents:

```ts
[
	{ index: 0, instructionCount: 18, difficultyLabel: 'Beginner' },
	{ index: 1, instructionCount: 26, difficultyLabel: 'Intermediate' },
	{ index: 2, instructionCount: 33, difficultyLabel: 'Intermediate' },
	{ index: 3, instructionCount: 39, difficultyLabel: 'Advanced' },
	{ index: 4, instructionCount: 44, difficultyLabel: 'Advanced' },
	{ index: 5, instructionCount: 48, difficultyLabel: 'Advanced' }
]
```

Required invariants:

- this file imports the shared scaling module rather than re-declaring its own base/increment values
- `getChallengePoolCount()` continues to derive from `CHALLENGE_METADATA.length`
- `isValidChallengeId()` continues to validate against `CHALLENGE_METADATA.length`
- the legacy `CHALLENGES` array and its helper functions are not modified by this work

## 5. Runtime/API boundary

No HTTP contract changes are allowed.

Existing surfaces stay the same:

- `POST /api/challenge/start` request body shape is unchanged
- `POST /api/challenge/start` response shape is unchanged
- `ChallengeSession.start()` / `ChallengeSession.getTotalSteps()` contract is unchanged

What does change:

- the number of encrypted `steps` returned by `POST /api/challenge/start` for each challenge ID must
  now match the shared counts `[18, 26, 33, 39, 44, 48]`
- client UI that renders challenge metadata (currently via `getAllChallengeMetadata()` in
  `src/lib/components/Terminal.svelte`) must display those same counts

## 6. Generator invariants the implementation must preserve

The implementation may change configuration values, but it must preserve these observable
properties:

1. `generateInstructions(challengeId)` still returns exactly `getInstructionCount(challengeId)`
   instructions.
2. `meetsInputRequirement(generateInstructions(challengeId), getMinInputCommands(challengeId))`
   remains true for every valid challenge.
3. Copy-paste sequence behavior is unchanged:
   - challenge 3 does not include the composite copy-paste step
   - challenges 4 and 5 include exactly one composite copy-paste step
   - standalone `copy-mode` / `paste-buffer` instructions are still excluded where the composite step
     is used
4. Pool membership is unchanged; only run length and minimum forced input count change.
5. The number of available challenge levels remains `6`.

## 7. Acceptance values

These exact values are the intended public contract for this change:

| Challenge | Instruction count | Increment |
|-----------|-------------------|-----------|
| 0         | 18                | base      |
| 1         | 26                | +8        |
| 2         | 33                | +7        |
| 3         | 39                | +6        |
| 4         | 44                | +5        |
| 5         | 48                | +4        |

Acceptance invariants:

- challenge 0 is within `15..20`
- each increment is positive
- increments are non-increasing
- increments satisfy the issue's target bands:
  - step to challenge 1: `5..10`
  - step to challenge 2: `5..10`
  - step to challenge 3: `4..8`
  - step to challenge 4: `4..7`
  - step to challenge 5: tapered continuation, here `+4`
- the highest challenge count is substantially below `100`

## 8. Test-facing expectations for the next stage

The TDD stage should encode the contract above in failing tests, at minimum by updating
`src/lib/server/challenges/generator.test.ts` to assert:

- instruction counts are `[18, 26, 33, 39, 44, 48]`
- count increments are positive and non-increasing, not fixed at `15`
- `minInputCommands` is `[2, 2, 2, 2, 2, 2]`
- the existing "correct number of instructions", "meets minimum input command requirement", and
  copy-paste sequence tests continue to pass under the new configuration

An additional focused test for `src/lib/data/challenge-scaling.ts` is allowed but not required.
