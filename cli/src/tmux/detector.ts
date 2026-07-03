/**
 * Action detection: observed StateDelta → candidate canonical answer strings.
 *
 * TDD STUB — issue #35, interface §7 (invariant DET1: pure & deterministic over
 * (delta, step); trial-decrypt is the correctness authority, so this only needs
 * to *include* the right candidate). Implementation stage fills this in against
 * real tmux ≥ 3.0.
 *
 * Body throws so tdd tests fail on the missing feature, not an import error.
 */

import type { DecryptedStep } from '$lib/client/challenge-core';
import type { StateDelta } from '../engine/types';

/**
 * Produce candidate canonical answers for a delta given the current step.
 * Ambiguous deltas emit ALL plausible candidates (order is a best-guess
 * optimization only). Input commands use `step.requiredInput`; the copy-paste
 * step uses `step.seedInput`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function deriveCandidates(delta: StateDelta, step: DecryptedStep): string[] {
	throw new Error('detector: deriveCandidates not implemented (tdd stub)');
}
