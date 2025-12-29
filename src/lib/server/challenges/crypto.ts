/**
 * Server-side cryptographic operations for the challenge system.
 *
 * This module implements:
 * - K0 derivation from ECDH shared secret
 * - Key chain derivation (K0 → K1 → K2 → ... → Kfinal)
 * - Step encryption with chained keys
 * - Proof encryption/validation for stateless verification
 *
 * Key Chain Flow:
 * 1. K0 = HKDF(sharedSecret, sessionSalt, "k0")
 * 2. K1 = HKDF(K0, SHA256(answer0), "step-1")
 * 3. K2 = HKDF(K1, SHA256(answer1), "step-2")
 * 4. ...
 * 5. Kfinal = last derived key (used as proof of completion)
 */

import type { Instruction, EncryptedStep, StepPayload } from './types';
import {
	hkdf,
	sha256,
	aesGcmEncrypt,
	aesGcmDecrypt,
	generateNonce,
	bytesToBase64,
	base64ToBytes,
	stringToBytes,
	bytesToString,
	randomBytes,
	constantTimeEqual
} from '$lib/crypto';

/**
 * Size of the session salt in bytes.
 */
export const SESSION_SALT_SIZE = 16;

/**
 * Generate a random session salt for K0 derivation.
 *
 * @returns 16-byte random salt
 */
export function generateSessionSalt(): Uint8Array<ArrayBuffer> {
	return randomBytes(SESSION_SALT_SIZE);
}

/**
 * Derive K0 (initial key) from ECDH shared secret and session salt.
 *
 * @param sharedSecret - ECDH shared secret (32 bytes)
 * @param sessionSalt - Session-specific salt (16 bytes)
 * @returns K0 as ArrayBuffer (32 bytes)
 */
export async function deriveK0(
	sharedSecret: ArrayBuffer | Uint8Array<ArrayBuffer>,
	sessionSalt: Uint8Array<ArrayBuffer>
): Promise<ArrayBuffer> {
	return hkdf(sharedSecret, sessionSalt, 'k0', 32);
}

/**
 * Derive the next key in the chain using the current key and answer.
 *
 * Kn+1 = HKDF(Kn, SHA256(answer), "step-{n+1}")
 *
 * @param currentKey - Current key (Kn)
 * @param answer - The canonical answer (e.g., "split-vertical" or "rename-window:swift-tiger-42")
 * @param stepIndex - The index of the step that was answered (0-based)
 * @returns Next key (Kn+1) as ArrayBuffer
 */
export async function deriveNextKey(
	currentKey: ArrayBuffer | Uint8Array<ArrayBuffer>,
	answer: string,
	stepIndex: number
): Promise<ArrayBuffer> {
	const answerHash = await sha256(answer);

	return hkdf(currentKey, new Uint8Array(answerHash), `step-${stepIndex + 1}`, 32);
}

/**
 * Derive the complete key chain from K0 through all answers.
 *
 * Returns an array of keys: [K0, K1, K2, ..., Kfinal]
 * where Kfinal is the key after the last answer.
 *
 * @param k0 - Initial key (K0)
 * @param answers - Array of canonical answers in order
 * @returns Array of derived keys (length = answers.length + 1)
 */
export async function deriveKeyChain(
	k0: ArrayBuffer | Uint8Array<ArrayBuffer>,
	answers: string[]
): Promise<ArrayBuffer[]> {
	const keys: ArrayBuffer[] = [k0 instanceof Uint8Array ? k0.buffer : k0];

	let currentKey: ArrayBuffer | Uint8Array<ArrayBuffer> = k0;

	for (let i = 0; i < answers.length; i++) {
		const nextKey = await deriveNextKey(currentKey, answers[i], i);
		keys.push(nextKey);
		currentKey = nextKey;
	}

	return keys;
}

/**
 * Get Kfinal (the proof) by deriving through all answers.
 *
 * @param k0 - Initial key
 * @param answers - All canonical answers in order
 * @returns Kfinal as ArrayBuffer
 */
export async function deriveKfinal(
	k0: ArrayBuffer | Uint8Array<ArrayBuffer>,
	answers: string[]
): Promise<ArrayBuffer> {
	let currentKey: ArrayBuffer | Uint8Array<ArrayBuffer> = k0;

	for (let i = 0; i < answers.length; i++) {
		currentKey = await deriveNextKey(currentKey, answers[i], i);
	}

	// Ensure we return an ArrayBuffer
	if (currentKey instanceof Uint8Array) {
		return currentKey.buffer;
	}

	return currentKey;
}

/**
 * Encrypt a step payload using the corresponding key.
 *
 * @param key - The key for this step (K0 for step 0, K1 for step 1, etc.)
 * @param payload - The step payload to encrypt
 * @returns Encrypted step with nonce and ciphertext
 */
export async function encryptStep(
	key: ArrayBuffer | Uint8Array<ArrayBuffer>,
	payload: StepPayload
): Promise<EncryptedStep> {
	const nonce = generateNonce();
	const plaintext = stringToBytes(JSON.stringify(payload));
	const ciphertext = await aesGcmEncrypt(key, nonce, plaintext);

	return {
		index: 0, // Will be set by caller
		nonceB64: bytesToBase64(nonce),
		ciphertextB64: bytesToBase64(ciphertext)
	};
}

/**
 * Decrypt a step payload using the corresponding key.
 *
 * @param key - The key for this step
 * @param encryptedStep - The encrypted step data
 * @returns Decrypted payload
 * @throws Error if decryption fails (wrong key)
 */
export async function decryptStep(
	key: ArrayBuffer | Uint8Array<ArrayBuffer>,
	encryptedStep: EncryptedStep
): Promise<StepPayload> {
	const nonce = base64ToBytes(encryptedStep.nonceB64);
	const ciphertext = base64ToBytes(encryptedStep.ciphertextB64);
	const plaintext = await aesGcmDecrypt(key, nonce, ciphertext);

	return JSON.parse(bytesToString(plaintext)) as StepPayload;
}

/**
 * Encrypt all steps for a challenge using the key chain.
 *
 * Step i is encrypted with key Ki (where K0 is derived from shared secret).
 *
 * @param keys - Array of keys [K0, K1, K2, ...] (must have at least instructions.length keys)
 * @param instructions - Array of instructions to encrypt
 * @returns Array of encrypted steps
 */
export async function encryptAllSteps(
	keys: ArrayBuffer[],
	instructions: Instruction[]
): Promise<EncryptedStep[]> {
	if (keys.length < instructions.length) {
		throw new Error(`Not enough keys: have ${keys.length}, need ${instructions.length}`);
	}

	const encryptedSteps: EncryptedStep[] = [];

	for (let i = 0; i < instructions.length; i++) {
		const instruction = instructions[i];
		const key = keys[i];

		// Create payload (what client sees after decryption)
		const payload: StepPayload = {
			prompt: instruction.prompt
		};

		// Include requiredInput if this is an input command
		if (instruction.requiredInput !== undefined) {
			payload.requiredInput = instruction.requiredInput;
		}

		const encrypted = await encryptStep(key, payload);
		encrypted.index = i;
		encryptedSteps.push(encrypted);
	}

	return encryptedSteps;
}

/**
 * Encrypt the expected proof (Kfinal) for storage in the session cookie.
 *
 * Uses a server-side secret key to encrypt the proof so only the server
 * can decrypt and verify it later.
 *
 * @param serverSecret - Server's secret key (should be from environment)
 * @param kfinal - The expected Kfinal proof
 * @param sessionId - Unique session identifier (used as additional context)
 * @returns Base64-encoded encrypted proof
 */
export async function encryptProof(
	serverSecret: Uint8Array<ArrayBuffer>,
	kfinal: ArrayBuffer,
	sessionId: string
): Promise<string> {
	// Derive an encryption key from the server secret and session ID
	const encryptionKey = await hkdf(serverSecret, stringToBytes(sessionId), 'proof-encryption', 32);

	const nonce = generateNonce();
	const ciphertext = await aesGcmEncrypt(encryptionKey, nonce, new Uint8Array(kfinal));

	// Combine nonce and ciphertext for storage
	const combined = new Uint8Array(nonce.length + ciphertext.length);
	combined.set(nonce, 0);
	combined.set(ciphertext, nonce.length);

	return bytesToBase64(combined);
}

/**
 * Decrypt and extract the expected proof from the session cookie.
 *
 * @param serverSecret - Server's secret key
 * @param encryptedProof - Base64-encoded encrypted proof
 * @param sessionId - The session ID used during encryption
 * @returns The expected Kfinal
 */
export async function decryptProof(
	serverSecret: Uint8Array<ArrayBuffer>,
	encryptedProof: string,
	sessionId: string
): Promise<Uint8Array<ArrayBuffer>> {
	// Derive the same encryption key
	const encryptionKey = await hkdf(serverSecret, stringToBytes(sessionId), 'proof-encryption', 32);

	const combined = base64ToBytes(encryptedProof);
	const nonce = combined.slice(0, 12);
	const ciphertext = combined.slice(12);

	return aesGcmDecrypt(encryptionKey, nonce, ciphertext);
}

/**
 * Verify that a submitted proof matches the expected proof.
 *
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param submittedProof - The proof submitted by the client
 * @param expectedProof - The expected proof from the session
 * @returns true if proofs match, false otherwise
 */
export function verifyProof(
	submittedProof: Uint8Array<ArrayBuffer>,
	expectedProof: Uint8Array<ArrayBuffer>
): boolean {
	return constantTimeEqual(submittedProof, expectedProof);
}

/**
 * Generate a unique session ID.
 *
 * @returns Base64-encoded random session ID
 */
export function generateSessionId(): string {
	return bytesToBase64(randomBytes(16));
}

/**
 * Complete server-side challenge preparation.
 *
 * This function performs all the cryptographic operations needed to start a challenge:
 * 1. Generate session salt and ID
 * 2. Derive K0 from shared secret
 * 3. Compute the complete key chain
 * 4. Encrypt all steps
 * 5. Encrypt the expected proof for cookie storage
 *
 * @param sharedSecret - ECDH shared secret with client
 * @param instructions - Generated challenge instructions
 * @param serverSecret - Server's secret key for proof encryption
 * @returns All data needed for the challenge start response and session cookie
 */
export async function prepareChallenge(
	sharedSecret: ArrayBuffer,
	instructions: Instruction[],
	serverSecret: Uint8Array<ArrayBuffer>
): Promise<{
	sessionSalt: Uint8Array<ArrayBuffer>;
	sessionId: string;
	encryptedSteps: EncryptedStep[];
	encryptedProof: string;
}> {
	// Generate session salt and ID
	const sessionSalt = generateSessionSalt();
	const sessionId = generateSessionId();

	// Derive K0
	const k0 = await deriveK0(sharedSecret, sessionSalt);

	// Extract expected actions for key chain derivation
	const answers = instructions.map((inst) => inst.expectedAction);

	// Derive complete key chain
	const keys = await deriveKeyChain(k0, answers);

	// Kfinal is the last key in the chain
	const kfinal = keys[keys.length - 1];

	// Encrypt all steps (step i uses key i)
	const encryptedSteps = await encryptAllSteps(keys, instructions);

	// Encrypt proof for cookie storage
	const encryptedProof = await encryptProof(serverSecret, kfinal, sessionId);

	return {
		sessionSalt,
		sessionId,
		encryptedSteps,
		encryptedProof
	};
}

/**
 * Validate a challenge completion.
 *
 * @param serverSecret - Server's secret key
 * @param sessionId - Session ID from cookie
 * @param encryptedProof - Encrypted proof from cookie
 * @param submittedProofB64 - Base64-encoded proof submitted by client
 * @returns true if the challenge was completed correctly
 */
export async function validateChallenge(
	serverSecret: Uint8Array<ArrayBuffer>,
	sessionId: string,
	encryptedProof: string,
	submittedProofB64: string
): Promise<boolean> {
	try {
		// Decrypt the expected proof
		const expectedProof = await decryptProof(serverSecret, encryptedProof, sessionId);

		// Decode the submitted proof
		const submittedProof = base64ToBytes(submittedProofB64);

		// Compare using constant-time comparison
		return verifyProof(submittedProof, expectedProof);
	} catch {
		// Decryption or decoding failed
		return false;
	}
}
