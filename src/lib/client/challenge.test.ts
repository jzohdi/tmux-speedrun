/**
 * Unit tests for client-side challenge service.
 *
 * These tests verify:
 * - Key derivation matches server-side behavior
 * - Step decryption with correct keys
 * - Step decryption failure with wrong keys
 * - Proof generation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { hkdf, sha256 } from '$lib/crypto/hkdf';
import { aesGcmDecrypt, aesGcmEncrypt } from '$lib/crypto/aes-gcm';
import {
	base64ToBytes,
	bytesToBase64,
	stringToBytes,
	bytesToString,
	randomBytes
} from '$lib/crypto/utils';
import { formatDuration } from './challenge';

/**
 * Simulates server-side key derivation for testing.
 */
async function deriveK0(
	sharedSecret: ArrayBuffer,
	sessionSalt: Uint8Array<ArrayBuffer>
): Promise<ArrayBuffer> {
	return hkdf(sharedSecret, sessionSalt, 'k0', 32);
}

/**
 * Simulates server-side next key derivation.
 */
async function deriveNextKey(
	currentKey: ArrayBuffer,
	answer: string,
	stepIndex: number
): Promise<ArrayBuffer> {
	const answerHash = await sha256(answer);
	return hkdf(currentKey, new Uint8Array(answerHash), `step-${stepIndex + 1}`, 32);
}

/**
 * Simulates server-side step encryption.
 */
async function encryptStep(
	key: ArrayBuffer,
	payload: { prompt: string; requiredInput?: string },
	index: number
): Promise<{ index: number; nonceB64: string; ciphertextB64: string }> {
	const nonce = randomBytes(12);
	const plaintext = stringToBytes(JSON.stringify(payload));
	const ciphertext = await aesGcmEncrypt(key, nonce, plaintext);

	return {
		index,
		nonceB64: bytesToBase64(nonce),
		ciphertextB64: bytesToBase64(ciphertext)
	};
}

/**
 * Simulates client-side step decryption.
 */
async function decryptStep(
	key: ArrayBuffer,
	encryptedStep: { nonceB64: string; ciphertextB64: string }
): Promise<{ prompt: string; requiredInput?: string }> {
	const nonce = base64ToBytes(encryptedStep.nonceB64);
	const ciphertext = base64ToBytes(encryptedStep.ciphertextB64);
	const plaintext = await aesGcmDecrypt(key, nonce, ciphertext);
	return JSON.parse(bytesToString(plaintext));
}

describe('Client Challenge Service', () => {
	describe('formatDuration', () => {
		it('formats sub-minute durations', () => {
			expect(formatDuration(0)).toBe('0.0s');
			expect(formatDuration(1000)).toBe('1.0s');
			expect(formatDuration(12345)).toBe('12.3s');
			expect(formatDuration(59999)).toBe('60.0s');
		});

		it('formats durations over a minute', () => {
			expect(formatDuration(60000)).toBe('1m 0.0s');
			expect(formatDuration(90000)).toBe('1m 30.0s');
			expect(formatDuration(123456)).toBe('2m 3.5s');
		});

		it('handles edge cases', () => {
			expect(formatDuration(100)).toBe('0.1s');
			expect(formatDuration(999)).toBe('1.0s');
		});
	});

	describe('Key Derivation', () => {
		let sharedSecret: ArrayBuffer;
		let sessionSalt: Uint8Array<ArrayBuffer>;
		let k0: ArrayBuffer;

		beforeAll(async () => {
			// Simulate shared secret from ECDH
			sharedSecret = randomBytes(32).buffer;
			sessionSalt = randomBytes(16);
			k0 = await deriveK0(sharedSecret, sessionSalt);
		});

		it('derives K0 from shared secret and salt', async () => {
			expect(k0.byteLength).toBe(32);

			// Same inputs produce same key
			const k0Again = await deriveK0(sharedSecret, sessionSalt);
			expect(bytesToBase64(new Uint8Array(k0))).toBe(bytesToBase64(new Uint8Array(k0Again)));
		});

		it('derives different K0 with different salt', async () => {
			const differentSalt = randomBytes(16);
			const differentK0 = await deriveK0(sharedSecret, differentSalt);

			expect(bytesToBase64(new Uint8Array(k0))).not.toBe(
				bytesToBase64(new Uint8Array(differentK0))
			);
		});

		it('derives next key using answer hash', async () => {
			const answer = 'split-vertical';
			const k1 = await deriveNextKey(k0, answer, 0);

			expect(k1.byteLength).toBe(32);
			// Different from K0
			expect(bytesToBase64(new Uint8Array(k1))).not.toBe(bytesToBase64(new Uint8Array(k0)));
		});

		it('derives different keys for different answers', async () => {
			const k1Correct = await deriveNextKey(k0, 'split-vertical', 0);
			const k1Wrong = await deriveNextKey(k0, 'split-horizontal', 0);

			expect(bytesToBase64(new Uint8Array(k1Correct))).not.toBe(
				bytesToBase64(new Uint8Array(k1Wrong))
			);
		});

		it('derives different keys for different step indices', async () => {
			const answer = 'split-vertical';
			const k1 = await deriveNextKey(k0, answer, 0);
			const k2 = await deriveNextKey(k0, answer, 1);

			expect(bytesToBase64(new Uint8Array(k1))).not.toBe(bytesToBase64(new Uint8Array(k2)));
		});
	});

	describe('Step Encryption/Decryption', () => {
		let k0: ArrayBuffer;

		beforeAll(async () => {
			const sharedSecret = randomBytes(32).buffer;
			const sessionSalt = randomBytes(16);
			k0 = await deriveK0(sharedSecret, sessionSalt);
		});

		it('encrypts and decrypts a simple step', async () => {
			const payload = { prompt: 'Split the pane vertically' };
			const encrypted = await encryptStep(k0, payload, 0);

			expect(encrypted.index).toBe(0);
			expect(encrypted.nonceB64).toBeDefined();
			expect(encrypted.ciphertextB64).toBeDefined();

			const decrypted = await decryptStep(k0, encrypted);
			expect(decrypted.prompt).toBe(payload.prompt);
			expect(decrypted.requiredInput).toBeUndefined();
		});

		it('encrypts and decrypts a step with required input', async () => {
			const payload = {
				prompt: "Rename the window to 'swift-tiger-42'",
				requiredInput: 'swift-tiger-42'
			};
			const encrypted = await encryptStep(k0, payload, 0);

			const decrypted = await decryptStep(k0, encrypted);
			expect(decrypted.prompt).toBe(payload.prompt);
			expect(decrypted.requiredInput).toBe('swift-tiger-42');
		});

		it('fails to decrypt with wrong key', async () => {
			const payload = { prompt: 'Split the pane vertically' };
			const encrypted = await encryptStep(k0, payload, 0);

			// Derive a wrong key
			const wrongKey = await deriveNextKey(k0, 'wrong-answer', 0);

			await expect(decryptStep(wrongKey, encrypted)).rejects.toThrow();
		});

		it('fails to decrypt with tampered ciphertext', async () => {
			const payload = { prompt: 'Split the pane vertically' };
			const encrypted = await encryptStep(k0, payload, 0);

			// Tamper with ciphertext
			const tamperedCiphertext = base64ToBytes(encrypted.ciphertextB64);
			tamperedCiphertext[0] ^= 0xff;

			await expect(
				decryptStep(k0, { ...encrypted, ciphertextB64: bytesToBase64(tamperedCiphertext) })
			).rejects.toThrow();
		});
	});

	describe('Key Chain Derivation', () => {
		it('correctly derives full key chain', async () => {
			const sharedSecret = randomBytes(32).buffer;
			const sessionSalt = randomBytes(16);

			const answers = ['new-session', 'split-vertical', 'rename-window:swift-tiger-42'];

			// Derive K0
			const k0 = await deriveK0(sharedSecret, sessionSalt);

			// Derive key chain
			let currentKey = k0;
			const keys: ArrayBuffer[] = [k0];

			for (let i = 0; i < answers.length; i++) {
				currentKey = await deriveNextKey(currentKey, answers[i], i);
				keys.push(currentKey);
			}

			// Should have K0, K1, K2, K3 (Kfinal)
			expect(keys.length).toBe(4);

			// All keys should be different
			const keyStrings = keys.map((k) => bytesToBase64(new Uint8Array(k)));
			const uniqueKeys = new Set(keyStrings);
			expect(uniqueKeys.size).toBe(4);
		});

		it('produces same Kfinal with same answers', async () => {
			const sharedSecret = randomBytes(32).buffer;
			const sessionSalt = randomBytes(16);
			const answers = ['new-session', 'split-vertical'];

			// First derivation
			const k0_1 = await deriveK0(sharedSecret, sessionSalt);
			let current1 = k0_1;
			for (let i = 0; i < answers.length; i++) {
				current1 = await deriveNextKey(current1, answers[i], i);
			}

			// Second derivation (same inputs)
			const k0_2 = await deriveK0(sharedSecret, sessionSalt);
			let current2 = k0_2;
			for (let i = 0; i < answers.length; i++) {
				current2 = await deriveNextKey(current2, answers[i], i);
			}

			expect(bytesToBase64(new Uint8Array(current1))).toBe(bytesToBase64(new Uint8Array(current2)));
		});

		it('produces different Kfinal with different answers', async () => {
			const sharedSecret = randomBytes(32).buffer;
			const sessionSalt = randomBytes(16);

			// First with correct answers
			const k0_1 = await deriveK0(sharedSecret, sessionSalt);
			let current1 = k0_1;
			const correctAnswers = ['new-session', 'split-vertical'];
			for (let i = 0; i < correctAnswers.length; i++) {
				current1 = await deriveNextKey(current1, correctAnswers[i], i);
			}

			// Second with one wrong answer
			const k0_2 = await deriveK0(sharedSecret, sessionSalt);
			let current2 = k0_2;
			const wrongAnswers = ['new-session', 'split-horizontal']; // Different second answer
			for (let i = 0; i < wrongAnswers.length; i++) {
				current2 = await deriveNextKey(current2, wrongAnswers[i], i);
			}

			expect(bytesToBase64(new Uint8Array(current1))).not.toBe(
				bytesToBase64(new Uint8Array(current2))
			);
		});
	});

	describe('End-to-End Flow Simulation', () => {
		it('simulates full challenge completion', async () => {
			// Server generates challenge
			const sharedSecret = randomBytes(32).buffer;
			const sessionSalt = randomBytes(16);

			const steps = [
				{ prompt: 'Start a new tmux session' },
				{ prompt: 'Split the pane vertically' },
				{ prompt: "Rename the window to 'swift-tiger-42'", requiredInput: 'swift-tiger-42' }
			];
			const correctAnswers = ['new-session', 'split-vertical', 'rename-window:swift-tiger-42'];

			// Server encrypts steps
			const k0 = await deriveK0(sharedSecret, sessionSalt);
			let serverKey = k0;
			const encryptedSteps = [];

			for (let i = 0; i < steps.length; i++) {
				const encrypted = await encryptStep(serverKey, steps[i], i);
				encryptedSteps.push(encrypted);

				if (i < steps.length - 1) {
					serverKey = await deriveNextKey(serverKey, correctAnswers[i], i);
				}
			}

			// Also derive final server key
			serverKey = k0;
			for (let i = 0; i < correctAnswers.length; i++) {
				serverKey = await deriveNextKey(serverKey, correctAnswers[i], i);
			}
			const expectedProof = bytesToBase64(new Uint8Array(serverKey));

			// Client starts with K0
			let clientKey = await deriveK0(sharedSecret, sessionSalt);

			// Client decrypts step 0
			const step0 = await decryptStep(clientKey, encryptedSteps[0]);
			expect(step0.prompt).toBe(steps[0].prompt);

			// Client provides answer, derives K1
			clientKey = await deriveNextKey(clientKey, correctAnswers[0], 0);

			// Client decrypts step 1
			const step1 = await decryptStep(clientKey, encryptedSteps[1]);
			expect(step1.prompt).toBe(steps[1].prompt);

			// Client provides answer, derives K2
			clientKey = await deriveNextKey(clientKey, correctAnswers[1], 1);

			// Client decrypts step 2
			const step2 = await decryptStep(clientKey, encryptedSteps[2]);
			expect(step2.prompt).toBe(steps[2].prompt);
			expect(step2.requiredInput).toBe('swift-tiger-42');

			// Client provides final answer, derives Kfinal
			clientKey = await deriveNextKey(clientKey, correctAnswers[2], 2);

			// Client's proof should match server's expected proof
			const clientProof = bytesToBase64(new Uint8Array(clientKey));
			expect(clientProof).toBe(expectedProof);
		});

		it('fails verification with wrong answer at any step', async () => {
			const sharedSecret = randomBytes(32).buffer;
			const sessionSalt = randomBytes(16);

			const steps = [{ prompt: 'Step 1' }, { prompt: 'Step 2' }, { prompt: 'Step 3' }];
			const correctAnswers = ['answer-1', 'answer-2', 'answer-3'];

			// Server encrypts with correct keys
			let serverKey = await deriveK0(sharedSecret, sessionSalt);
			const encryptedSteps = [];

			for (let i = 0; i < steps.length; i++) {
				const encrypted = await encryptStep(serverKey, steps[i], i);
				encryptedSteps.push(encrypted);

				if (i < steps.length - 1) {
					serverKey = await deriveNextKey(serverKey, correctAnswers[i], i);
				}
			}

			// Client with wrong second answer
			let clientKey = await deriveK0(sharedSecret, sessionSalt);

			// Step 0 - correct
			await decryptStep(clientKey, encryptedSteps[0]);
			clientKey = await deriveNextKey(clientKey, correctAnswers[0], 0);

			// Step 1 - WRONG ANSWER
			await decryptStep(clientKey, encryptedSteps[1]);
			clientKey = await deriveNextKey(clientKey, 'wrong-answer', 1);

			// Step 2 - should fail to decrypt because key chain is broken
			await expect(decryptStep(clientKey, encryptedSteps[2])).rejects.toThrow();
		});
	});
});
