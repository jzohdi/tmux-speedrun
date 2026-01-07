/**
 * AES-GCM encryption and decryption using Web Crypto API.
 *
 * AES-GCM provides authenticated encryption with associated data (AEAD).
 * We use:
 * - 256-bit keys
 * - 96-bit (12 byte) nonces (IVs)
 * - 128-bit authentication tags (default)
 *
 * CRITICAL: Never reuse a nonce with the same key!
 * Always generate a fresh random nonce for each encryption.
 */

import { randomBytes, stringToBytes, bytesToString } from './utils';

/**
 * Standard nonce size for AES-GCM (96 bits = 12 bytes).
 * This is the recommended size per NIST SP 800-38D.
 */
export const AES_GCM_NONCE_SIZE = 12;

/**
 * Import raw key bytes as an AES-GCM CryptoKey.
 *
 * @param keyBytes - 32 bytes (256 bits) of key material
 * @returns CryptoKey for AES-GCM operations
 */
export async function importAesGcmKey(
	keyBytes: ArrayBuffer | Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		keyBytes,
		{ name: 'AES-GCM', length: 256 },
		false, // Not extractable
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypt data using AES-GCM.
 *
 * @param key - AES-GCM key (CryptoKey or raw bytes)
 * @param nonce - 12-byte nonce (must be unique per encryption!)
 * @param plaintext - Data to encrypt
 * @returns Ciphertext with authentication tag appended
 */
export async function aesGcmEncrypt(
	key: CryptoKey | ArrayBuffer | Uint8Array<ArrayBuffer>,
	nonce: Uint8Array<ArrayBuffer>,
	plaintext: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
	// Import key if raw bytes provided
	const cryptoKey = key instanceof CryptoKey ? key : await importAesGcmKey(key);

	const ciphertext = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: nonce
		},
		cryptoKey,
		plaintext
	);

	return new Uint8Array(ciphertext);
}

/**
 * Decrypt data using AES-GCM.
 *
 * @param key - AES-GCM key (CryptoKey or raw bytes)
 * @param nonce - The same nonce used during encryption
 * @param ciphertext - Encrypted data with authentication tag
 * @returns Decrypted plaintext
 * @throws Error if authentication fails (wrong key or tampered data)
 */
export async function aesGcmDecrypt(
	key: CryptoKey | ArrayBuffer | Uint8Array<ArrayBuffer>,
	nonce: Uint8Array<ArrayBuffer>,
	ciphertext: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
	// Import key if raw bytes provided
	const cryptoKey = key instanceof CryptoKey ? key : await importAesGcmKey(key);

	const plaintext = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: nonce
		},
		cryptoKey,
		ciphertext
	);

	return new Uint8Array(plaintext);
}

/**
 * Encrypt a string and return Base64-encoded nonce and ciphertext.
 * Convenience function for encrypting JSON payloads.
 *
 * @param key - AES-GCM key
 * @param plaintext - String to encrypt
 * @returns Object with nonceB64 and ciphertextB64
 */
export async function encryptString(
	key: CryptoKey | ArrayBuffer | Uint8Array<ArrayBuffer>,
	plaintext: string
): Promise<{ nonceB64: string; ciphertextB64: string }> {
	const { bytesToBase64 } = await import('./utils');

	const nonce = randomBytes(AES_GCM_NONCE_SIZE);
	const plaintextBytes = stringToBytes(plaintext);
	const ciphertext = await aesGcmEncrypt(key, nonce, plaintextBytes);

	return {
		nonceB64: bytesToBase64(nonce),
		ciphertextB64: bytesToBase64(ciphertext)
	};
}

/**
 * Decrypt a Base64-encoded ciphertext back to a string.
 * Convenience function for decrypting JSON payloads.
 *
 * @param key - AES-GCM key
 * @param nonceB64 - Base64-encoded nonce
 * @param ciphertextB64 - Base64-encoded ciphertext
 * @returns Decrypted string
 * @throws Error if authentication fails
 */
export async function decryptString(
	key: CryptoKey | ArrayBuffer | Uint8Array<ArrayBuffer>,
	nonceB64: string,
	ciphertextB64: string
): Promise<string> {
	const { base64ToBytes } = await import('./utils');

	const nonce = base64ToBytes(nonceB64);
	const ciphertext = base64ToBytes(ciphertextB64);
	const plaintext = await aesGcmDecrypt(key, nonce, ciphertext);

	return bytesToString(plaintext);
}

/**
 * Generate a fresh random nonce for AES-GCM.
 *
 * @returns 12-byte random nonce
 */
export function generateNonce(): Uint8Array<ArrayBuffer> {
	return randomBytes(AES_GCM_NONCE_SIZE);
}
