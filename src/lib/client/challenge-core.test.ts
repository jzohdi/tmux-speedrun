/**
 * Failing tests for the shared, pure challenge key-chain core
 * (`challenge-core.ts`) — the extraction the CLI (issue #35) reuses so its
 * derived proof matches the server byte-for-byte (interface §1, invariant CC1).
 *
 * The "server" side of each test is simulated with the SAME `$lib/crypto`
 * primitives the server uses; the "client" side goes exclusively through
 * `challenge-core`. When the extraction is real, the client's Kfinal must equal
 * the server's expected proof byte-for-byte.
 *
 * These currently fail because `challenge-core.ts` is a not-yet-implemented stub.
 */

import { describe, it, expect } from 'vitest';
import { hkdf, sha256 } from '$lib/crypto/hkdf';
import { aesGcmEncrypt } from '$lib/crypto/aes-gcm';
import { base64ToBytes, bytesToBase64, stringToBytes, randomBytes } from '$lib/crypto/utils';
import {
	deriveK0,
	deriveNextKey,
	decryptStep,
	tryAdvanceKey,
	resolveTotalSteps,
	formatDuration,
	type EncryptedStep
} from './challenge-core';

// --- Server-side simulation (independent of challenge-core) -----------------

function serverDeriveK0(
	sharedSecret: ArrayBuffer,
	salt: Uint8Array<ArrayBuffer>
): Promise<ArrayBuffer> {
	return hkdf(sharedSecret, salt, 'k0', 32);
}

async function serverDeriveNextKey(
	currentKey: ArrayBuffer,
	answer: string,
	stepIndex: number
): Promise<ArrayBuffer> {
	const answerHash = await sha256(answer);
	return hkdf(currentKey, new Uint8Array(answerHash), `step-${stepIndex + 1}`, 32);
}

async function serverEncryptStep(
	key: ArrayBuffer,
	payload: { prompt: string; requiredInput?: string; seedInput?: string },
	index: number
): Promise<EncryptedStep> {
	const nonce = randomBytes(12);
	const ciphertext = await aesGcmEncrypt(key, nonce, stringToBytes(JSON.stringify(payload)));
	return { index, nonceB64: bytesToBase64(nonce), ciphertextB64: bytesToBase64(ciphertext) };
}

const b64 = (buf: ArrayBuffer) => bytesToBase64(new Uint8Array(buf));

describe('challenge-core: formatDuration', () => {
	it('formats sub-minute durations to one decimal', () => {
		expect(formatDuration(0)).toBe('0.0s');
		expect(formatDuration(12345)).toBe('12.3s');
	});

	it('formats durations over a minute as "Xm Y.Zs"', () => {
		expect(formatDuration(60000)).toBe('1m 0.0s');
		expect(formatDuration(123456)).toBe('2m 3.5s');
	});
});

describe('challenge-core: deriveK0', () => {
	it('produces a 32-byte key that matches the server derivation byte-for-byte', async () => {
		const sharedSecret = randomBytes(32).buffer;
		const sessionSalt = randomBytes(16);

		const clientK0 = await deriveK0(sharedSecret, sessionSalt);
		const serverK0 = await serverDeriveK0(sharedSecret, sessionSalt);

		expect(clientK0.byteLength).toBe(32);
		expect(b64(clientK0)).toBe(b64(serverK0));
	});

	it('is deterministic and salt-sensitive', async () => {
		const sharedSecret = randomBytes(32).buffer;
		const salt = randomBytes(16);
		const again = await deriveK0(sharedSecret, salt);
		const other = await deriveK0(sharedSecret, randomBytes(16));

		expect(b64(await deriveK0(sharedSecret, salt))).toBe(b64(again));
		expect(b64(again)).not.toBe(b64(other));
	});
});

describe('challenge-core: deriveNextKey', () => {
	it('matches the server chaining for the same answer + index', async () => {
		const k0 = await deriveK0(randomBytes(32).buffer, randomBytes(16));
		const clientK1 = await deriveNextKey(k0, 'split-vertical', 0);
		const serverK1 = await serverDeriveNextKey(k0, 'split-vertical', 0);

		expect(b64(clientK1)).toBe(b64(serverK1));
	});

	it('diverges for different answers and different step indices', async () => {
		const k0 = await deriveK0(randomBytes(32).buffer, randomBytes(16));
		const a = await deriveNextKey(k0, 'split-vertical', 0);
		const b = await deriveNextKey(k0, 'split-horizontal', 0);
		const c = await deriveNextKey(k0, 'split-vertical', 1);

		expect(b64(a)).not.toBe(b64(b));
		expect(b64(a)).not.toBe(b64(c));
	});
});

describe('challenge-core: decryptStep', () => {
	it('decrypts a step encrypted under the matching key', async () => {
		const k0 = await deriveK0(randomBytes(32).buffer, randomBytes(16));
		const payload = {
			prompt: "Rename the window to 'swift-tiger-42'",
			requiredInput: 'swift-tiger-42'
		};
		const encrypted = await serverEncryptStep(k0, payload, 0);

		const decrypted = await decryptStep(k0, encrypted);
		expect(decrypted.prompt).toBe(payload.prompt);
		expect(decrypted.requiredInput).toBe('swift-tiger-42');
	});

	it('throws (auth-tag failure) when the key is wrong', async () => {
		const k0 = await deriveK0(randomBytes(32).buffer, randomBytes(16));
		const encrypted = await serverEncryptStep(k0, { prompt: 'Split the pane vertically' }, 0);
		const wrongKey = await deriveNextKey(k0, 'wrong', 0);

		await expect(decryptStep(wrongKey, encrypted)).rejects.toThrow();
	});

	it('throws on tampered ciphertext', async () => {
		const k0 = await deriveK0(randomBytes(32).buffer, randomBytes(16));
		const encrypted = await serverEncryptStep(k0, { prompt: 'x' }, 0);
		const bytes = base64ToBytes(encrypted.ciphertextB64);
		bytes[0] ^= 0xff;

		await expect(
			decryptStep(k0, { ...encrypted, ciphertextB64: bytesToBase64(bytes) })
		).rejects.toThrow();
	});
});

describe('challenge-core: full-chain byte-parity (CC1)', () => {
	it("the client's final key equals the server's expected proof", async () => {
		const sharedSecret = randomBytes(32).buffer;
		const sessionSalt = randomBytes(16);
		const steps = [
			{ prompt: 'Start a new tmux session' },
			{ prompt: 'Split the pane vertically' },
			{ prompt: "Rename the window to 'swift-tiger-42'", requiredInput: 'swift-tiger-42' }
		];
		const answers = ['new-session', 'split-vertical', 'rename-window:swift-tiger-42'];

		// Server: encrypt each step under its chain key.
		let serverKey = await serverDeriveK0(sharedSecret, sessionSalt);
		const encryptedSteps: EncryptedStep[] = [];
		for (let i = 0; i < steps.length; i++) {
			encryptedSteps.push(await serverEncryptStep(serverKey, steps[i], i));
			serverKey = await serverDeriveNextKey(serverKey, answers[i], i);
		}
		const expectedProof = b64(serverKey); // Kfinal after the last answer

		// Client: decrypt via challenge-core, chain via challenge-core.
		let clientKey = await deriveK0(sharedSecret, sessionSalt);
		for (let i = 0; i < steps.length; i++) {
			const step = await decryptStep(clientKey, encryptedSteps[i]);
			expect(step.prompt).toBe(steps[i].prompt);
			clientKey = await deriveNextKey(clientKey, answers[i], i);
		}

		expect(b64(clientKey)).toBe(expectedProof);
	});

	it('a wrong answer mid-chain breaks decryption of the next step', async () => {
		const sharedSecret = randomBytes(32).buffer;
		const sessionSalt = randomBytes(16);
		const steps = [{ prompt: 's0' }, { prompt: 's1' }, { prompt: 's2' }];
		const answers = ['a0', 'a1', 'a2'];

		let serverKey = await serverDeriveK0(sharedSecret, sessionSalt);
		const encryptedSteps: EncryptedStep[] = [];
		for (let i = 0; i < steps.length; i++) {
			encryptedSteps.push(await serverEncryptStep(serverKey, steps[i], i));
			serverKey = await serverDeriveNextKey(serverKey, answers[i], i);
		}

		let clientKey = await deriveK0(sharedSecret, sessionSalt);
		await decryptStep(clientKey, encryptedSteps[0]);
		clientKey = await deriveNextKey(clientKey, answers[0], 0);
		await decryptStep(clientKey, encryptedSteps[1]);
		clientKey = await deriveNextKey(clientKey, 'WRONG', 1); // wrong answer at step 1

		await expect(decryptStep(clientKey, encryptedSteps[2])).rejects.toThrow();
	});
});

describe('challenge-core: tryAdvanceKey', () => {
	/** Build a 2-step chain + final-check step; return everything a client gets. */
	async function makeChain() {
		const sharedSecret = randomBytes(32).buffer;
		const sessionSalt = randomBytes(16);
		const answers = ['a0', 'a1'];

		let serverKey = await serverDeriveK0(sharedSecret, sessionSalt);
		const encryptedSteps: EncryptedStep[] = [];
		for (let i = 0; i < answers.length; i++) {
			encryptedSteps.push(await serverEncryptStep(serverKey, { prompt: `s${i}` }, i));
			serverKey = await serverDeriveNextKey(serverKey, answers[i], i);
		}
		// serverKey is now Kfinal — the final-check step is encrypted under it.
		encryptedSteps.push(await serverEncryptStep(serverKey, { prompt: '' }, answers.length));

		const k0 = await deriveK0(sharedSecret, sessionSalt);
		return { k0, answers, encryptedSteps, expectedProof: b64(serverKey) };
	}

	it('advances on a correct answer (verified against the next step)', async () => {
		const { k0, answers, encryptedSteps } = await makeChain();

		const k1 = await tryAdvanceKey(k0, answers[0], 0, encryptedSteps[1]);

		expect(k1).not.toBeNull();
		await expect(decryptStep(k1!, encryptedSteps[1])).resolves.toMatchObject({ prompt: 's1' });
	});

	it('returns null on a wrong answer instead of advancing', async () => {
		const { k0, encryptedSteps } = await makeChain();

		expect(await tryAdvanceKey(k0, 'WRONG', 0, encryptedSteps[1])).toBeNull();
	});

	it('verifies the LAST real answer against the final-check step', async () => {
		const { k0, answers, encryptedSteps, expectedProof } = await makeChain();

		const k1 = await tryAdvanceKey(k0, answers[0], 0, encryptedSteps[1]);

		// Wrong final answer: rejected locally — the run is NOT failed.
		expect(await tryAdvanceKey(k1!, 'WRONG-FINAL', 1, encryptedSteps[2])).toBeNull();

		// Correct final answer: accepted, and the key IS the expected proof.
		const kfinal = await tryAdvanceKey(k1!, answers[1], 1, encryptedSteps[2]);
		expect(kfinal).not.toBeNull();
		expect(b64(kfinal!)).toBe(expectedProof);
	});

	it('accepts blindly when no verify step exists (legacy server fallback)', async () => {
		const { k0 } = await makeChain();

		// Even a wrong answer advances — the historical last-step behavior.
		const key = await tryAdvanceKey(k0, 'ANYTHING', 0, undefined);
		expect(key).not.toBeNull();
		expect(key!.byteLength).toBe(32);
	});
});

describe('challenge-core: resolveTotalSteps', () => {
	const steps = (n: number): EncryptedStep[] =>
		Array.from({ length: n }, (_, i) => ({ index: i, nonceB64: '', ciphertextB64: '' }));

	it('uses the server count when sane (final-check protocol)', () => {
		expect(resolveTotalSteps(steps(4), 3)).toBe(3);
		expect(resolveTotalSteps(steps(4), 4)).toBe(4);
	});

	it('falls back to steps.length for a missing or insane count (legacy server)', () => {
		expect(resolveTotalSteps(steps(4), undefined)).toBe(4);
		expect(resolveTotalSteps(steps(4), 0)).toBe(4);
		expect(resolveTotalSteps(steps(4), 5)).toBe(4);
		expect(resolveTotalSteps(steps(4), 2.5)).toBe(4);
		expect(resolveTotalSteps(steps(4), '3')).toBe(4);
	});
});
