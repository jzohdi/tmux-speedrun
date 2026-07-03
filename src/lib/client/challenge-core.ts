/**
 * Shared, pure challenge key-chain / step helpers.
 *
 * TDD STUB — implementation stage (issue #35) extracts these from
 * `challenge.ts` so both the web `ChallengeSession` and the `tmux-speedrun`
 * CLI import identical logic. See `.agent/interface.md` §1 (invariant CC1:
 * byte-parity with the server proof achieved solely by reusing these
 * functions + `$lib/crypto`).
 *
 * These bodies intentionally throw so the tdd-stage tests fail on a MISSING
 * feature (not on an import error). The implementation replaces them with the
 * pure logic currently living in `challenge.ts`.
 */

/** Step payload after decryption. */
export type DecryptedStep = {
	prompt: string;
	requiredInput?: string;
	seedInput?: string;
};

/** Encrypted step from the server. */
export type EncryptedStep = {
	index: number;
	nonceB64: string;
	ciphertextB64: string;
};

const NOT_IMPLEMENTED = 'challenge-core: not implemented (tdd stub)';

/** K0 = HKDF(sharedSecret, sessionSalt, "k0", 32). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deriveK0(
	sharedSecret: ArrayBuffer,
	sessionSalt: Uint8Array
): Promise<ArrayBuffer> {
	throw new Error(NOT_IMPLEMENTED);
}

/** K(n+1) = HKDF(Kn, SHA256(answer), `step-${stepIndex+1}`, 32). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deriveNextKey(
	currentKey: ArrayBuffer,
	answer: string,
	stepIndex: number
): Promise<ArrayBuffer> {
	throw new Error(NOT_IMPLEMENTED);
}

/** AES-GCM decrypt + JSON.parse → DecryptedStep. Throws on wrong key. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function decryptStep(key: ArrayBuffer, step: EncryptedStep): Promise<DecryptedStep> {
	throw new Error(NOT_IMPLEMENTED);
}

/** "12.3s" | "1m 23.4s". */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function formatDuration(ms: number): string {
	throw new Error(NOT_IMPLEMENTED);
}
