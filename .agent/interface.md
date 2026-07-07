# Interface — Fix: Challenge 5 unreachable (404)

Issue: jzohdi/tmux-speedrun#43 · builds on `.agent/plan.md`

This spec pins the contract the `tdd` and implementation stages build against. The fix repoints
the `/challenge/[id]` route loader from the legacy `CHALLENGES` array (0–4) to the metadata source
that already supports 0–5, so the route's valid-id range can never again drift from what the home
page renders.

## Source-of-truth functions (already exist — do NOT change)

From `$lib/data/challenges` (`src/lib/data/challenges.ts`) — these are the metadata-based, 0–5
functions the loader must consume:

- `isValidChallengeId(challengeId: number): boolean` — true iff `Number.isInteger` &&
  `0 <= id < CHALLENGE_METADATA.length` (currently 6). Already rejects negatives, non-integers, and
  `>= 6`.
- `getChallengePoolCount(): number` — `CHALLENGE_METADATA.length` (currently `6`).
- `getAllChallengeMetadata(): ChallengeMetadata[]` — the 6-entry array; index `i` →
  `{ index, instructionCount, difficultyLabel }`. Label for index 5 is `'Advanced'`.

`ChallengeMetadata = { index: number; instructionCount: number; difficultyLabel: string }`.

The legacy `CHALLENGES` array and its helpers (`getChallengeByIndex`, `getChallengeCount`,
`getMaxChallengeIndex`, `getDifficultyLabel`, `getAllChallengesWithMeta`, `getAllUsedCommands`,
`getChallengeWithCommandsByIndex`) stay in place, untouched — out of scope. The fix only removes the
route's dependency on them.

## Contract 1 — route loader `src/routes/challenge/[id]/+page.server.ts`

### Type change

`ChallengePageData` — **remove the `challenge` field**; keep the rest:

```ts
export type ChallengePageData = {
  challengeIndex: number;
  totalChallenges: number;
  difficultyLabel: string;
  user: SessionUser | null;
  pendingResult: { durationMs: number } | null;
};
```

Rationale: `data.challenge` is never read by `+page.svelte` (verified in plan). Drop the field and
the `Challenge` type import rather than fabricate a metadata-shaped `Challenge`.

### Import change

- Drop from `$lib/data/challenges`: `getChallengeByIndex`, `getChallengeCount`,
  `getMaxChallengeIndex`, `getDifficultyLabel`, and the `Challenge` type import.
- Add from `$lib/data/challenges`: `isValidChallengeId`, `getChallengePoolCount`,
  `getAllChallengeMetadata`.
- Unchanged imports: `error` (`@sveltejs/kit`), `PENDING_RESULT_COOKIE_NAME` (`$lib/server/env`),
  `verifyPendingResultToken` (`$lib/server/challenges/pending`), `SessionUser` type, `PageServerLoad`.

### `load` behavior (signature unchanged: `async ({ params, cookies, locals })`)

1. `const numericId = parseInt(params.id, 10);`
2. **Guard A (kept verbatim):** `if (Number.isNaN(numericId) || numericId < 0)` → `error(404, …)`
   with the existing `Invalid challenge ID: "${id}". Challenge IDs must be non-negative numbers.`
   message. Preserves the distinct message for NaN/negative ids.
3. **Guard B (replaces the `getChallengeByIndex` block):** `if (!isValidChallengeId(numericId))` →
   `error(404, { message: `Challenge ${numericId} not found. Available challenges: 0-${getChallengePoolCount() - 1}.` })`.
   With the current metadata this renders `Available challenges: 0-5.`
4. **Pending-result re-hydration (unchanged):**
   ```ts
   let pendingResult: { durationMs: number } | null = null;
   const pending = await verifyPendingResultToken(cookies.get(PENDING_RESULT_COOKIE_NAME) ?? '');
   if (pending && pending.challengeId === numericId) {
     pendingResult = { durationMs: pending.durationMs };
   }
   ```
5. **Return:**
   ```ts
   return {
     challengeIndex: numericId,
     totalChallenges: getChallengePoolCount(),                       // → 6
     difficultyLabel: getAllChallengeMetadata()[numericId].difficultyLabel, // index 5 → 'Advanced'
     user: locals.user,
     pendingResult
   };
   ```
   No `challenge` field.

### Invariants the implementation must uphold

- `load` resolves (does not throw) for every `id` in `0..getChallengePoolCount()-1`, and throws a
  SvelteKit `HttpError` with `status === 404` for `id === getChallengePoolCount()` (`6`), negatives,
  NaN, and non-integers.
- `totalChallenges === getChallengePoolCount() === getAllChallengeMetadata().length`.
- `difficultyLabel === getAllChallengeMetadata()[numericId].difficultyLabel`.
- No new drift: the accepted range is derived from the metadata; adding a future challenge
  (extending scaling/pools) widens the route's range with no route edit.
- No `+page.svelte` change is required or permitted for this fix (page already ignores `challenge`).

## Contract 2 — `src/lib/data/challenges.test.ts` (extend existing)

Keep the existing three test cases. Add an assertion locking the valid-id range to the metadata
length as the source of truth, e.g.:

- `getChallengePoolCount() === getAllChallengeMetadata().length`
- `isValidChallengeId(5) === true`
- `isValidChallengeId(6) === false`

(The existing "six valid ids" test already covers most of this; the new assertion makes the
range↔metadata coupling explicit. Do not weaken existing assertions.)

## Contract 3 — new `src/routes/challenge/[id]/+page.server.test.ts`

Route-level regression that challenge 5 is reachable. Import `{ load }` from `./+page.server` and
invoke it directly (SvelteKit `load` is a plain async function).

Test-harness notes:
- `cookies.get` may return `undefined` → the loader passes `'' ` to `verifyPendingResultToken`, which
  **short-circuits on empty input and returns `null` without calling `getSessionSecret()`** (verified
  in `pending.ts:86`). So no `SESSION_SECRET` env setup is needed for these cases.
- Minimal event stub: `{ params: { id }, cookies: { get: () => undefined }, locals: { user: null } }`.
  Cast as needed to satisfy the `PageServerLoad` param type in the test.
- A throwing `load` rejects with a SvelteKit `HttpError` object shaped `{ status, body: { message } }`.
  Assert on `status === 404` (e.g. via a try/catch or `await expect(load(...)).rejects` and inspect
  the caught value's `.status`).

Required cases:
- `id = '5'` → resolves; `challengeIndex === 5`, `totalChallenges === 6`,
  `difficultyLabel === 'Advanced'`, `pendingResult === null`.
- `id = '6'` → throws; caught error has `status === 404`.
- `id = '0'` (lower-bound happy path) → resolves; `challengeIndex === 0`, `totalChallenges === 6`.

## Verification

- `npm run test` — new/extended tests pass; existing `challenges.test.ts`, generator, and
  `api/challenge/*` tests stay green.
- `npm run check` — trimmed `ChallengePageData` and removed imports leave no dangling references.
- `npm run lint`.
- Acceptance: `/challenge/5` loads a playable run (server already generates C5); 0–4 unchanged;
  `/challenge/6` still 404s.
