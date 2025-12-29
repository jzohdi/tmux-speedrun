/**
 * Tests for the challenge crypto module.
 *
 * Tests cover:
 * - K0 derivation
 * - Key chain derivation
 * - Step encryption/decryption
 * - Proof encryption/validation
 * - End-to-end challenge flow
 */

import { describe, it, expect } from 'vitest';
import { randomBytes, bytesToBase64, base64ToBytes } from '$lib/crypto';
import {
	SESSION_SALT_SIZE,
	generateSessionSalt,
	generateSessionId,
	deriveK0,
	deriveNextKey,
	deriveKeyChain,
	deriveKfinal,
	encryptStep,
	decryptStep,
	encryptAllSteps,
	encryptProof,
	decryptProof,
	verifyProof,
	prepareChallenge,
	validateChallenge
} from './crypto';
import type { Instruction, StepPayload } from './types';

/**
 * Session Salt Tests
 */
describe('Session Salt', () => {
	it('generateSessionSalt produces correct size', () => {
		const salt = generateSessionSalt();

		expect(salt.length).toBe(SESSION_SALT_SIZE);
		expect(salt.length).toBe(16);
	});

	it('generates unique salts', () => {
		const a = generateSessionSalt();
		const b = generateSessionSalt();

		expect(a).not.toEqual(b);
	});
});

/**
 * Session ID Tests
 */
describe('Session ID', () => {
	it('generateSessionId returns Base64 string', () => {
		const id = generateSessionId();

		expect(typeof id).toBe('string');
		// Should be valid Base64
		const validBase64 = /^[A-Za-z0-9+/=]*$/;
		expect(validBase64.test(id)).toBe(true);
	});

	it('generates unique IDs', () => {
		const ids = new Set<string>();

		for (let i = 0; i < 100; i++) {
			ids.add(generateSessionId());
		}

		expect(ids.size).toBe(100);
	});
});

/**
 * K0 Derivation Tests
 */
describe('K0 Derivation', () => {
	it('produces 32-byte key', async () => {
		const sharedSecret = randomBytes(32);
		const salt = generateSessionSalt();

		const k0 = await deriveK0(sharedSecret, salt);

		expect(k0.byteLength).toBe(32);
	});

	it('produces deterministic output', async () => {
		const sharedSecret = new Uint8Array(32).fill(1);
		const salt = new Uint8Array(16).fill(2);

		const k0a = await deriveK0(sharedSecret, salt);
		const k0b = await deriveK0(sharedSecret, salt);

		expect(new Uint8Array(k0a)).toEqual(new Uint8Array(k0b));
	});

	it('different salts produce different K0', async () => {
		const sharedSecret = randomBytes(32);
		const saltA = generateSessionSalt();
		const saltB = generateSessionSalt();

		const k0a = await deriveK0(sharedSecret, saltA);
		const k0b = await deriveK0(sharedSecret, saltB);

		expect(new Uint8Array(k0a)).not.toEqual(new Uint8Array(k0b));
	});
});

/**
 * Key Chain Derivation Tests
 */
describe('Key Chain Derivation', () => {
	it('deriveNextKey produces different key for different answers', async () => {
		const k0 = randomBytes(32);

		const k1a = await deriveNextKey(k0, 'split-vertical', 0);
		const k1b = await deriveNextKey(k0, 'split-horizontal', 0);

		expect(new Uint8Array(k1a)).not.toEqual(new Uint8Array(k1b));
	});

	it('deriveNextKey is deterministic', async () => {
		const k0 = new Uint8Array(32).fill(1);

		const k1a = await deriveNextKey(k0, 'split-vertical', 0);
		const k1b = await deriveNextKey(k0, 'split-vertical', 0);

		expect(new Uint8Array(k1a)).toEqual(new Uint8Array(k1b));
	});

	it('deriveKeyChain returns correct number of keys', async () => {
		const k0 = randomBytes(32);
		const answers = ['split-vertical', 'next-window', 'kill-pane'];

		const keys = await deriveKeyChain(k0, answers);

		// Should have K0, K1, K2, K3 (one more than answers)
		expect(keys.length).toBe(answers.length + 1);
	});

	it('deriveKfinal matches last key in chain', async () => {
		const k0 = randomBytes(32);
		const answers = ['split-vertical', 'next-window', 'kill-pane'];

		const keys = await deriveKeyChain(k0, answers);
		const kfinal = await deriveKfinal(k0, answers);

		expect(new Uint8Array(kfinal)).toEqual(new Uint8Array(keys[keys.length - 1]));
	});

	it('different answer order produces different Kfinal', async () => {
		const k0 = randomBytes(32);

		const kfinalA = await deriveKfinal(k0, ['a', 'b', 'c']);
		const kfinalB = await deriveKfinal(k0, ['a', 'c', 'b']);

		expect(new Uint8Array(kfinalA)).not.toEqual(new Uint8Array(kfinalB));
	});

	it('key chain is sequential derivation', async () => {
		const k0 = randomBytes(32);
		const answers = ['split-vertical', 'next-window'];

		// Manual derivation
		const k1Manual = await deriveNextKey(k0, answers[0], 0);
		const k2Manual = await deriveNextKey(k1Manual, answers[1], 1);

		// Chain derivation
		const keys = await deriveKeyChain(k0, answers);

		expect(new Uint8Array(keys[1])).toEqual(new Uint8Array(k1Manual));
		expect(new Uint8Array(keys[2])).toEqual(new Uint8Array(k2Manual));
	});
});

/**
 * Step Encryption Tests
 */
describe('Step Encryption', () => {
	it('encryptStep produces valid structure', async () => {
		const key = randomBytes(32);
		const payload: StepPayload = { prompt: 'Test prompt' };

		const encrypted = await encryptStep(key, payload);

		expect(encrypted).toHaveProperty('index');
		expect(encrypted).toHaveProperty('nonceB64');
		expect(encrypted).toHaveProperty('ciphertextB64');
		expect(typeof encrypted.nonceB64).toBe('string');
		expect(typeof encrypted.ciphertextB64).toBe('string');
	});

	it('decryptStep recovers payload', async () => {
		const key = randomBytes(32);
		const payload: StepPayload = {
			prompt: 'Test prompt',
			requiredInput: 'swift-tiger-42'
		};

		const encrypted = await encryptStep(key, payload);
		const decrypted = await decryptStep(key, encrypted);

		expect(decrypted).toEqual(payload);
	});

	it('decryption fails with wrong key', async () => {
		const key1 = randomBytes(32);
		const key2 = randomBytes(32);
		const payload: StepPayload = { prompt: 'Test' };

		const encrypted = await encryptStep(key1, payload);

		await expect(decryptStep(key2, encrypted)).rejects.toThrow();
	});

	it('each encryption produces unique nonce', async () => {
		const key = randomBytes(32);
		const payload: StepPayload = { prompt: 'Test' };

		const enc1 = await encryptStep(key, payload);
		const enc2 = await encryptStep(key, payload);

		expect(enc1.nonceB64).not.toBe(enc2.nonceB64);
	});
});

describe('Encrypt All Steps', () => {
	it('encrypts all instructions with corresponding keys', async () => {
		const k0 = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Prompt 0', expectedAction: 'action-0' },
			{ index: 1, prompt: 'Prompt 1', expectedAction: 'action-1' },
			{ index: 2, prompt: 'Prompt 2', expectedAction: 'action-2' }
		];

		const answers = instructions.map((i) => i.expectedAction);
		const keys = await deriveKeyChain(k0, answers);

		const encryptedSteps = await encryptAllSteps(keys, instructions);

		expect(encryptedSteps.length).toBe(instructions.length);

		// Each step should be decryptable with its corresponding key
		for (let i = 0; i < instructions.length; i++) {
			const decrypted = await decryptStep(keys[i], encryptedSteps[i]);
			expect(decrypted.prompt).toBe(instructions[i].prompt);
		}
	});

	it('step N cannot be decrypted with key N-1', async () => {
		const k0 = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Prompt 0', expectedAction: 'action-0' },
			{ index: 1, prompt: 'Prompt 1', expectedAction: 'action-1' }
		];

		const answers = instructions.map((i) => i.expectedAction);
		const keys = await deriveKeyChain(k0, answers);

		const encryptedSteps = await encryptAllSteps(keys, instructions);

		// Try to decrypt step 1 with key 0 (should fail)
		await expect(decryptStep(keys[0], encryptedSteps[1])).rejects.toThrow();
	});

	it('includes requiredInput in payload when present', async () => {
		const k0 = randomBytes(32);
		const instructions: Instruction[] = [
			{
				index: 0,
				prompt: "Rename to 'test'",
				expectedAction: 'rename-window:test',
				requiredInput: 'test'
			}
		];

		const keys = await deriveKeyChain(
			k0,
			instructions.map((i) => i.expectedAction)
		);
		const encryptedSteps = await encryptAllSteps(keys, instructions);

		const decrypted = await decryptStep(keys[0], encryptedSteps[0]);

		expect(decrypted.requiredInput).toBe('test');
	});

	it('throws if not enough keys', async () => {
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Prompt 0', expectedAction: 'action-0' },
			{ index: 1, prompt: 'Prompt 1', expectedAction: 'action-1' }
		];

		const keys = [randomBytes(32)]; // Only 1 key for 2 instructions

		await expect(
			encryptAllSteps(
				keys.map((k) => k.buffer),
				instructions
			)
		).rejects.toThrow();
	});
});

/**
 * Proof Encryption Tests
 */
describe('Proof Encryption', () => {
	it('encryptProof produces Base64 string', async () => {
		const serverSecret = randomBytes(32);
		const kfinal = randomBytes(32);
		const sessionId = generateSessionId();

		const encrypted = await encryptProof(serverSecret, kfinal.buffer, sessionId);

		expect(typeof encrypted).toBe('string');
		const validBase64 = /^[A-Za-z0-9+/=]*$/;
		expect(validBase64.test(encrypted)).toBe(true);
	});

	it('decryptProof recovers original proof', async () => {
		const serverSecret = randomBytes(32);
		const kfinal = randomBytes(32);
		const sessionId = generateSessionId();

		const encrypted = await encryptProof(serverSecret, kfinal.buffer, sessionId);
		const decrypted = await decryptProof(serverSecret, encrypted, sessionId);

		expect(decrypted).toEqual(kfinal);
	});

	it('decryption fails with wrong server secret', async () => {
		const serverSecret1 = randomBytes(32);
		const serverSecret2 = randomBytes(32);
		const kfinal = randomBytes(32);
		const sessionId = generateSessionId();

		const encrypted = await encryptProof(serverSecret1, kfinal.buffer, sessionId);

		await expect(decryptProof(serverSecret2, encrypted, sessionId)).rejects.toThrow();
	});

	it('decryption fails with wrong session ID', async () => {
		const serverSecret = randomBytes(32);
		const kfinal = randomBytes(32);
		const sessionId1 = generateSessionId();
		const sessionId2 = generateSessionId();

		const encrypted = await encryptProof(serverSecret, kfinal.buffer, sessionId1);

		await expect(decryptProof(serverSecret, encrypted, sessionId2)).rejects.toThrow();
	});
});

/**
 * Proof Verification Tests
 */
describe('Proof Verification', () => {
	it('verifyProof returns true for matching proofs', () => {
		const proof = randomBytes(32);

		expect(verifyProof(proof, proof)).toBe(true);
	});

	it('verifyProof returns false for different proofs', () => {
		const proof1 = randomBytes(32);
		const proof2 = randomBytes(32);

		expect(verifyProof(proof1, proof2)).toBe(false);
	});
});

/**
 * End-to-End Challenge Flow Tests
 */
describe('End-to-End Challenge Flow', () => {
	it('prepareChallenge returns all required data', async () => {
		const sharedSecret = randomBytes(32);
		const serverSecret = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Prompt 0', expectedAction: 'action-0' },
			{ index: 1, prompt: 'Prompt 1', expectedAction: 'action-1' }
		];

		const result = await prepareChallenge(sharedSecret.buffer, instructions, serverSecret);

		expect(result.sessionSalt).toBeDefined();
		expect(result.sessionSalt.length).toBe(SESSION_SALT_SIZE);
		expect(result.sessionId).toBeDefined();
		expect(result.encryptedSteps).toBeDefined();
		expect(result.encryptedSteps.length).toBe(instructions.length);
		expect(result.encryptedProof).toBeDefined();
	});

	it('validateChallenge returns true for correct proof', async () => {
		const sharedSecret = randomBytes(32);
		const serverSecret = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Prompt 0', expectedAction: 'action-0' },
			{ index: 1, prompt: 'Prompt 1', expectedAction: 'action-1' }
		];

		const { sessionSalt, sessionId, encryptedProof } = await prepareChallenge(
			sharedSecret.buffer,
			instructions,
			serverSecret
		);

		// Simulate client deriving keys correctly
		const k0 = await deriveK0(sharedSecret, sessionSalt);
		const answers = instructions.map((i) => i.expectedAction);
		const clientKfinal = await deriveKfinal(k0, answers);

		// Client submits proof
		const submittedProofB64 = bytesToBase64(new Uint8Array(clientKfinal));

		const isValid = await validateChallenge(
			serverSecret,
			sessionId,
			encryptedProof,
			submittedProofB64
		);

		expect(isValid).toBe(true);
	});

	it('validateChallenge returns false for wrong proof', async () => {
		const sharedSecret = randomBytes(32);
		const serverSecret = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Prompt 0', expectedAction: 'action-0' }
		];

		const { sessionId, encryptedProof } = await prepareChallenge(
			sharedSecret.buffer,
			instructions,
			serverSecret
		);

		// Wrong proof
		const wrongProof = bytesToBase64(randomBytes(32));

		const isValid = await validateChallenge(serverSecret, sessionId, encryptedProof, wrongProof);

		expect(isValid).toBe(false);
	});

	it('validateChallenge returns false for proof with one wrong answer', async () => {
		const sharedSecret = randomBytes(32);
		const serverSecret = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Prompt 0', expectedAction: 'action-0' },
			{ index: 1, prompt: 'Prompt 1', expectedAction: 'action-1' },
			{ index: 2, prompt: 'Prompt 2', expectedAction: 'action-2' }
		];

		const { sessionSalt, sessionId, encryptedProof } = await prepareChallenge(
			sharedSecret.buffer,
			instructions,
			serverSecret
		);

		// Client derives keys but gets one answer wrong
		const k0 = await deriveK0(sharedSecret, sessionSalt);
		const wrongAnswers = ['action-0', 'WRONG-ACTION', 'action-2'];
		const clientKfinal = await deriveKfinal(k0, wrongAnswers);

		const submittedProofB64 = bytesToBase64(new Uint8Array(clientKfinal));

		const isValid = await validateChallenge(
			serverSecret,
			sessionId,
			encryptedProof,
			submittedProofB64
		);

		expect(isValid).toBe(false);
	});

	it('client can decrypt steps in order', async () => {
		const sharedSecret = randomBytes(32);
		const serverSecret = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Split pane', expectedAction: 'split-vertical' },
			{ index: 1, prompt: 'Next window', expectedAction: 'next-window' },
			{ index: 2, prompt: 'Kill pane', expectedAction: 'kill-pane' }
		];

		const { sessionSalt, encryptedSteps } = await prepareChallenge(
			sharedSecret.buffer,
			instructions,
			serverSecret
		);

		// Client derives K0
		const k0 = await deriveK0(sharedSecret, sessionSalt);

		// Client decrypts step 0
		const step0 = await decryptStep(k0, encryptedSteps[0]);
		expect(step0.prompt).toBe('Split pane');

		// Client solves step 0, derives K1
		const k1 = await deriveNextKey(k0, 'split-vertical', 0);

		// Client decrypts step 1
		const step1 = await decryptStep(k1, encryptedSteps[1]);
		expect(step1.prompt).toBe('Next window');

		// Client solves step 1, derives K2
		const k2 = await deriveNextKey(k1, 'next-window', 1);

		// Client decrypts step 2
		const step2 = await decryptStep(k2, encryptedSteps[2]);
		expect(step2.prompt).toBe('Kill pane');
	});

	it('client cannot skip steps', async () => {
		const sharedSecret = randomBytes(32);
		const serverSecret = randomBytes(32);
		const instructions: Instruction[] = [
			{ index: 0, prompt: 'Step 0', expectedAction: 'action-0' },
			{ index: 1, prompt: 'Step 1', expectedAction: 'action-1' },
			{ index: 2, prompt: 'Step 2', expectedAction: 'action-2' }
		];

		const { sessionSalt, encryptedSteps } = await prepareChallenge(
			sharedSecret.buffer,
			instructions,
			serverSecret
		);

		const k0 = await deriveK0(sharedSecret, sessionSalt);

		// Try to decrypt step 2 with K0 (skipping steps 0 and 1)
		await expect(decryptStep(k0, encryptedSteps[2])).rejects.toThrow();
	});
});
