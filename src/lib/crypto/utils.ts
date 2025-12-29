/**
 * Utility functions for cryptographic operations.
 *
 * Provides Base64 encoding/decoding and ArrayBuffer manipulation
 * for use with Web Crypto API.
 */

/**
 * Encode a Uint8Array to a Base64 string.
 *
 * @param bytes - The bytes to encode
 * @returns Base64 encoded string
 */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';

	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}

	return btoa(binary);
}

/**
 * Decode a Base64 string to a Uint8Array.
 *
 * @param base64 - The Base64 string to decode
 * @returns Decoded bytes
 * @throws Error if the string is not valid Base64
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}

/**
 * Convert an ArrayBuffer to a Uint8Array.
 *
 * @param buffer - The ArrayBuffer to convert
 * @returns Uint8Array view of the buffer
 */
export function bufferToBytes(buffer: ArrayBuffer): Uint8Array<ArrayBuffer> {
	return new Uint8Array(buffer);
}

/**
 * Convert a string to a Uint8Array using UTF-8 encoding.
 *
 * @param str - The string to encode
 * @returns UTF-8 encoded bytes
 */
export function stringToBytes(str: string): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(str);
}

/**
 * Convert a Uint8Array to a string using UTF-8 decoding.
 *
 * @param bytes - The bytes to decode
 * @returns Decoded string
 */
export function bytesToString(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

/**
 * Generate cryptographically secure random bytes.
 *
 * @param length - Number of bytes to generate
 * @returns Random bytes
 */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
	return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Constant-time comparison of two byte arrays.
 * Prevents timing attacks by always comparing all bytes.
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns true if arrays are equal, false otherwise
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;

	for (let i = 0; i < a.length; i++) {
		result |= a[i] ^ b[i];
	}

	return result === 0;
}

/**
 * Concatenate multiple Uint8Arrays into one.
 *
 * @param arrays - Arrays to concatenate
 * @returns Combined array
 */
export function concatBytes(...arrays: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
	const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
	const result = new Uint8Array(totalLength);

	let offset = 0;

	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}

	return result;
}

