/**
 * Shared, pure challenge key-chain / step helpers.
 *
 * Extracted from `challenge.ts` so both the web `ChallengeSession` and the
 * `tmux-speedrun` CLI (issue #35) import identical logic — guaranteeing the
 * CLI's derived proof matches the server byte-for-byte (interface §1, invariant
 * CC1). These functions are transport-free and depend only on `$lib/crypto`,
 * whose primitives use Web-Crypto globals available in both browsers and Node ≥ 20.
 */

import { base64ToBytes, bytesToString } from '$lib/crypto';
import { hkdf, sha256 } from '$lib/crypto/hkdf';
import { aesGcmDecrypt } from '$lib/crypto/aes-gcm';

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

/** K0 = HKDF(sharedSecret, sessionSalt, "k0", 32). */
export async function deriveK0(
	sharedSecret: ArrayBuffer,
	sessionSalt: Uint8Array<ArrayBuffer>
): Promise<ArrayBuffer> {
	return hkdf(sharedSecret, sessionSalt, 'k0', 32);
}

/** K(n+1) = HKDF(Kn, SHA256(answer), `step-${stepIndex+1}`, 32). */
export async function deriveNextKey(
	currentKey: ArrayBuffer,
	answer: string,
	stepIndex: number
): Promise<ArrayBuffer> {
	const answerHash = await sha256(answer);

	return hkdf(currentKey, new Uint8Array(answerHash), `step-${stepIndex + 1}`, 32);
}

/**
 * AES-GCM decrypt + JSON.parse → DecryptedStep. Throws on the wrong key
 * (auth-tag failure) — this is the trial-decrypt correctness check.
 */
export async function decryptStep(key: ArrayBuffer, step: EncryptedStep): Promise<DecryptedStep> {
	const nonce = base64ToBytes(step.nonceB64);
	const ciphertext = base64ToBytes(step.ciphertextB64);

	const plaintext = await aesGcmDecrypt(key, nonce, ciphertext);

	return JSON.parse(bytesToString(plaintext)) as DecryptedStep;
}

/**
 * Format duration in a human-readable way.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "12.3s" or "1m 23.4s"
 */
export function formatDuration(ms: number): string {
	const seconds = ms / 1000;

	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}
