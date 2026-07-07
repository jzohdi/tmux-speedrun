# Plan — Fix: Challenge 5 is unreachable (404) despite being listed on the home page

Issue: jzohdi/tmux-speedrun#43

## Goal (restated)

`/challenge/5` currently returns a 404 even though the home page lists challenges 0–5 and the
server can already generate and validate a challenge-5 run. Make `/challenge/5` load and play like
challenges 0–4, and eliminate the drift that caused the bug so the route's valid-id range stays in
lock-step with the metadata the home page renders.

## Root cause (confirmed by reading the code)

There are two parallel challenge-definition systems:

- **Metadata / pool source (supports 0–5):** `src/lib/data/challenge-scaling.ts`
  (`CHALLENGE_INSTRUCTION_COUNTS` → 6 values), `src/lib/data/challenges.ts`
  (`CHALLENGE_METADATA`, `getAllChallengeMetadata`, `getChallengePoolCount`, `isValidChallengeId`,
  and `CHALLENGE_DIFFICULTY_LABELS` — all 6 entries), and the server pool
  `src/lib/server/challenges/pools.ts` (`CHALLENGE_POOLS` C0–C5). The home terminal
  (`src/lib/components/Terminal.svelte`) lists challenges via `getAllChallengeMetadata()` from
  `$lib/data/challenges`, so it shows 0–5.
- **Legacy `CHALLENGES` array (supports only 0–4):** `src/lib/data/challenges.ts` `CHALLENGES` has
  indices 0–4 only, and `getChallengeByIndex` / `getChallengeCount` / `getMaxChallengeIndex` derive
  from it.

The route loader `src/routes/challenge/[id]/+page.server.ts` gates validity on
`getChallengeByIndex(numericId)` (legacy array). For `id = 5` that returns `undefined`, so the
loader throws `error(404, …)`.

**Key finding — the actual gameplay does NOT use the legacy array.** The run is generated
server-side from the pool config: the page calls `challenge.start(index)` →
`POST /api/challenge/start`, which validates with `isValidChallengeId` and calls
`generateInstructions(challengeId)` from `$lib/server/challenges` (pool-based, 0–5). The legacy
`CHALLENGES[].commandNames` are not consulted for a real run.

**Second key finding — the loader's `challenge` payload is dead.** The three fields the loader
derives from the legacy array/`Challenge` — `challenge`, `totalChallenges`, `difficultyLabel` — are
**not referenced anywhere in `+page.svelte`** (verified by grep: no `data.challenge`,
`data.totalChallenges`, or `data.difficultyLabel` usage). The page only uses `data.challengeIndex`,
`data.user`, and `data.pendingResult`. So the loader's dependency on the legacy array is purely a
validation gate plus unused data.

Legacy `CHALLENGES`-derived functions (`getChallengeByIndex`, `getChallengeWithCommandsByIndex`,
`getChallengeCount`, `getMaxChallengeIndex`, `getAllChallengesWithMeta`, `getAllUsedCommands`) are
referenced only inside `challenges.ts` itself and in `+page.server.ts` (the first/count/max ones).
No other route, component, or the CLI consumes them.

## Approach

Take the drift-reducing option the issue invites, not the "add a 6th hand-maintained `CHALLENGES`
entry" band-aid. Point the route loader at the **same metadata source the home page already uses**
(`$lib/data/challenges` metadata, which supports 0–5), so the route's valid-id range is derived from
— and can never again drift from — what the home page renders.

Because the loader's `challenge` field is unused by the page, drop it rather than fabricate a
metadata-shaped `Challenge`. This fully decouples the route from the legacy `CHALLENGES` array at the
one place that caused the 404.

Leave the legacy `CHALLENGES` array and its remaining helpers in place (out of scope to delete;
still self-referenced and unused elsewhere) — this fix removes the route's dependency on it, which is
what mattered.

## Files to change

### 1. `src/routes/challenge/[id]/+page.server.ts` (the fix)

- Update imports from `$lib/data/challenges`: drop `getChallengeByIndex`, `getChallengeCount`,
  `getMaxChallengeIndex`, `getDifficultyLabel`, and the `Challenge` type. Import instead
  `isValidChallengeId`, `getChallengePoolCount`, and `getAllChallengeMetadata` (metadata-based, 0–5).
- Update the `ChallengePageData` type: remove the `challenge: Challenge` field. Keep
  `challengeIndex`, `totalChallenges`, `difficultyLabel`, `user`, `pendingResult`.
- Validation:
  - Keep the existing `Number.isNaN(numericId) || numericId < 0` guard (preserves the specific
    "must be non-negative numbers" 404 message).
  - Replace the `getChallengeByIndex(...)` / `!challenge` block with a range check via
    `isValidChallengeId(numericId)`. On failure, `error(404, …)` with
    `Available challenges: 0-${getChallengePoolCount() - 1}` (now resolves to `0-5`).
- Returned data:
  - `totalChallenges: getChallengePoolCount()` (→ 6).
  - `difficultyLabel: getAllChallengeMetadata()[numericId].difficultyLabel` (index 5 → `Advanced`).
  - Remove the `challenge` field.
  - `challengeIndex`, `user`, `pendingResult` unchanged (pending-result re-hydration logic untouched).

This is a self-contained backend change; the page already ignores the removed field, so no
`+page.svelte` edit is required.

### 2. Tests

- **`src/lib/data/challenges.test.ts`** (extend existing): it already asserts six valid ids and
  metadata. Add/confirm an explicit assertion tying the metadata length to the valid-id range (e.g.
  `getChallengePoolCount() === getAllChallengeMetadata().length` and `isValidChallengeId(5) === true`,
  `isValidChallengeId(6) === false`) so "the route's valid-id range matches the metadata's 6
  challenges" is locked in at the source of truth.
- **New `src/routes/challenge/[id]/+page.server.test.ts`** (route-level regression for the 404):
  - Call the exported `load` with `params.id = '5'`, a stub `cookies.get` returning `undefined`
    (empty pending token → `verifyPendingResultToken` returns `null`, no throw), and
    `locals.user = null`. Assert it resolves (does not throw) with `challengeIndex === 5`,
    `totalChallenges === 6`, `difficultyLabel === 'Advanced'`, `pendingResult === null`.
  - Assert `load` with `params.id = '6'` throws a 404 (SvelteKit `HttpError`, `status === 404`).
  - Optionally a `params.id = '0'` happy-path case to guard the lower bound.
  - Test note: `verifyPendingResultToken` calls `getSessionSecret()`; with an empty token it must
    short-circuit before needing the secret — verify during implementation. If the secret is
    required, either set the test env var (follow the pattern in the existing
    `src/routes/api/challenge/*.test.ts`) or mock `$lib/server/challenges/pending`'s
    `verifyPendingResultToken` to resolve `null`.

## Risks & edge cases

- **Behavioral parity for 0–4:** `getAllChallengeMetadata()[i].difficultyLabel` yields
  Beginner/Intermediate/Intermediate/Advanced/Advanced/Advanced. The legacy `getDifficultyLabel`
  (numeric thresholds) previously produced labels from `CHALLENGES[i].difficulty` — a cosmetic value
  that the page never displayed, so any label difference is invisible to users. No functional risk.
- **Removed `challenge` field:** confirmed unused by `+page.svelte` and by any other consumer of this
  loader's `PageData`. TypeScript will flag any missed reference at build/`svelte-check` time.
- **Validation semantics:** `isValidChallengeId` also rejects non-integers and negatives, so the
  behavior for bad ids is preserved (still 404). The explicit NaN/negative guard is kept only to
  retain its distinct message.
- **No new drift introduced:** the route now derives its range from the metadata; adding a future
  challenge (extending `INSTRUCTION_INCREMENTS` / pools) automatically widens the route's accepted
  range with no route edit.

## How it will be tested

- `npm run test` (vitest): new route-loader test + extended metadata test must pass; existing
  `challenges.test.ts`, `generator.test.ts`, and the `api/challenge/*` tests must stay green.
- `npm run check` (svelte-check / tsc): confirms the trimmed `ChallengePageData` type and removed
  imports have no dangling references.
- `npm run lint` for style.
- Manual/acceptance: navigating to `/challenge/5` loads the challenge page and starts a playable run
  (server generates 48-instruction, all-commands pool); challenges 0–4 continue to work; `/challenge/6`
  still 404s.

## Acceptance criteria mapping

- *`/challenge/5` loads a playable run (no 404):* route loader now accepts 0–5 via metadata; run
  generation already supports C5 server-side.
- *All home-page challenges (0–5) reachable/playable:* route range is now derived from the same
  metadata the home page lists from — they cannot disagree.
- *Existing tests pass + new coverage that challenge 5 is reachable / route range matches metadata's
  6 challenges:* covered by the new route-loader test and the extended metadata test.

## Scope flags

- `needs_frontend`: **false** — no UI/component/Svelte changes; the page already ignores the removed
  field. (The one touched `.ts` file is a server route loader, i.e. backend.)
- `needs_backend`: **true** — the change is to the server route loader plus tests.
