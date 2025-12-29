/**
 * HKDF (HMAC-based Key Derivation Function) implementation using Web Crypto API.
 *
 * HKDF is used to derive cryptographic keys from input key material.
 * We use SHA-256 as the hash function.
 *
 * Reference: RFC 5869 - https://tools.ietf.org/html/rfc5869
 */

import { stringToBytes } from './utils';

/**
 * Derive a key using HKDF-SHA-256.
 *
 * @param ikm - Input Key Material (the source secret)
 * @param salt - Salt value (can be empty, but recommended to use random bytes)
 * @param info - Context and application-specific information
 * @param length - Desired output key length in bytes (default: 32 for AES-256)
 * @returns Derived key material as ArrayBuffer
 */
export async function hkdf(
	ikm: ArrayBuffer | Uint8Array<ArrayBuffer>,
	salt: ArrayBuffer | Uint8Array<ArrayBuffer>,
	info: string,
	length = 32
): Promise<ArrayBuffer> {
	// Import the input key material
	const keyMaterial = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, [
		'deriveBits'
	]);

	// Derive bits using HKDF
	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: salt,
			info: stringToBytes(info)
		},
		keyMaterial,
		length * 8 // Convert bytes to bits
	);

	return derivedBits;
}

/**
 * Derive an AES-GCM key using HKDF-SHA-256.
 *
 * This is a convenience function that returns a CryptoKey ready for AES-GCM operations.
 *
 * @param ikm - Input Key Material
 * @param salt - Salt value
 * @param info - Context information
 * @returns CryptoKey for AES-GCM encryption/decryption
 */
export async function hkdfDeriveAesKey(
	ikm: ArrayBuffer | Uint8Array<ArrayBuffer>,
	salt: ArrayBuffer | Uint8Array<ArrayBuffer>,
	info: string
): Promise<CryptoKey> {
	// Import the input key material
	const keyMaterial = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, [
		'deriveKey'
	]);

	// Derive an AES-GCM key
	const derivedKey = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: salt,
			info: stringToBytes(info)
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		true, // Extractable (needed for some operations)
		['encrypt', 'decrypt']
	);

	return derivedKey;
}

/**
 * Compute SHA-256 hash of a string.
 *
 * Used to hash canonical answers for key derivation.
 *
 * @param input - String to hash
 * @returns SHA-256 hash as ArrayBuffer
 */
export async function sha256(input: string): Promise<ArrayBuffer> {
	const data = stringToBytes(input);

	return crypto.subtle.digest('SHA-256', data);
}

/**
 * Compute SHA-256 hash and return as Uint8Array.
 *
 * @param input - String to hash
 * @returns SHA-256 hash as Uint8Array
 */
export async function sha256Bytes(input: string): Promise<Uint8Array> {
	const hash = await sha256(input);

	return new Uint8Array(hash);
}
