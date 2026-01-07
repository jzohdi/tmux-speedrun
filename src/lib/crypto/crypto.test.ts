/**
 * Tests for the crypto module.
 *
 * Tests cover:
 * - Base64 encoding/decoding
 * - HKDF key derivation
 * - AES-GCM encryption/decryption
 * - ECDH key exchange
 */

import { describe, it, expect } from 'vitest';
import {
	bytesToBase64,
	base64ToBytes,
	stringToBytes,
	bytesToString,
	randomBytes,
	constantTimeEqual,
	concatBytes
} from './utils';
import { hkdf, sha256, sha256Bytes } from './hkdf';
import {
	AES_GCM_NONCE_SIZE,
	aesGcmEncrypt,
	aesGcmDecrypt,
	encryptString,
	decryptString,
	generateNonce
} from './aes-gcm';
import {
	generateEcdhKeyPair,
	exportPublicKeyJwk,
	importPublicKeyJwk,
	deriveSharedSecret,
	ecdhExchange,
	generateKeyPairForExchange
} from './ecdh';

/**
 * Utility Function Tests
 */
describe('Utility Functions', () => {
	describe('Base64 Encoding', () => {
		it('round-trips bytes through Base64', () => {
			const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
			const encoded = bytesToBase64(original);
			const decoded = base64ToBytes(encoded);

			expect(decoded).toEqual(original);
		});

		it('encodes empty array', () => {
			const empty = new Uint8Array(0);
			const encoded = bytesToBase64(empty);
			const decoded = base64ToBytes(encoded);

			expect(decoded).toEqual(empty);
		});

		it('produces valid Base64 characters', () => {
			const bytes = randomBytes(100);
			const encoded = bytesToBase64(bytes);

			// Base64 should only contain A-Z, a-z, 0-9, +, /, =
			const validChars = /^[A-Za-z0-9+/=]*$/;
			expect(validChars.test(encoded)).toBe(true);
		});
	});

	describe('String Encoding', () => {
		it('round-trips strings through UTF-8', () => {
			const original = 'Hello, World! 🎉';
			const bytes = stringToBytes(original);
			const decoded = bytesToString(bytes);

			expect(decoded).toBe(original);
		});

		it('handles empty string', () => {
			const empty = '';
			const bytes = stringToBytes(empty);
			const decoded = bytesToString(bytes);

			expect(decoded).toBe(empty);
		});
	});

	describe('Random Bytes', () => {
		it('generates requested length', () => {
			const bytes16 = randomBytes(16);
			const bytes32 = randomBytes(32);

			expect(bytes16.length).toBe(16);
			expect(bytes32.length).toBe(32);
		});

		it('generates different values each time', () => {
			const a = randomBytes(32);
			const b = randomBytes(32);

			expect(a).not.toEqual(b);
		});
	});

	describe('Constant Time Comparison', () => {
		it('returns true for equal arrays', () => {
			const a = new Uint8Array([1, 2, 3, 4, 5]);
			const b = new Uint8Array([1, 2, 3, 4, 5]);

			expect(constantTimeEqual(a, b)).toBe(true);
		});

		it('returns false for different arrays', () => {
			const a = new Uint8Array([1, 2, 3, 4, 5]);
			const b = new Uint8Array([1, 2, 3, 4, 6]);

			expect(constantTimeEqual(a, b)).toBe(false);
		});

		it('returns false for different lengths', () => {
			const a = new Uint8Array([1, 2, 3, 4, 5]);
			const b = new Uint8Array([1, 2, 3, 4]);

			expect(constantTimeEqual(a, b)).toBe(false);
		});

		it('handles empty arrays', () => {
			const a = new Uint8Array(0);
			const b = new Uint8Array(0);

			expect(constantTimeEqual(a, b)).toBe(true);
		});
	});

	describe('Concat Bytes', () => {
		it('concatenates multiple arrays', () => {
			const a = new Uint8Array([1, 2]);
			const b = new Uint8Array([3, 4]);
			const c = new Uint8Array([5, 6]);

			const result = concatBytes(a, b, c);

			expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
		});

		it('handles empty arrays', () => {
			const a = new Uint8Array([1, 2]);
			const empty = new Uint8Array(0);

			const result = concatBytes(a, empty);

			expect(result).toEqual(new Uint8Array([1, 2]));
		});
	});
});

/**
 * HKDF Tests
 */
describe('HKDF', () => {
	it('derives 32-byte key by default', async () => {
		const ikm = randomBytes(32);
		const salt = randomBytes(16);

		const derived = await hkdf(ikm, salt, 'test-info');

		expect(derived.byteLength).toBe(32);
	});

	it('derives specified length', async () => {
		const ikm = randomBytes(32);
		const salt = randomBytes(16);

		const derived16 = await hkdf(ikm, salt, 'test', 16);
		const derived64 = await hkdf(ikm, salt, 'test', 64);

		expect(derived16.byteLength).toBe(16);
		expect(derived64.byteLength).toBe(64);
	});

	it('produces deterministic output', async () => {
		const ikm = new Uint8Array([1, 2, 3, 4, 5]);
		const salt = new Uint8Array([6, 7, 8, 9, 10]);

		const a = await hkdf(ikm, salt, 'test');
		const b = await hkdf(ikm, salt, 'test');

		expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
	});

	it('different info produces different keys', async () => {
		const ikm = randomBytes(32);
		const salt = randomBytes(16);

		const a = await hkdf(ikm, salt, 'info-a');
		const b = await hkdf(ikm, salt, 'info-b');

		expect(new Uint8Array(a)).not.toEqual(new Uint8Array(b));
	});

	it('different salt produces different keys', async () => {
		const ikm = randomBytes(32);
		const saltA = randomBytes(16);
		const saltB = randomBytes(16);

		const a = await hkdf(ikm, saltA, 'test');
		const b = await hkdf(ikm, saltB, 'test');

		expect(new Uint8Array(a)).not.toEqual(new Uint8Array(b));
	});
});

describe('SHA-256', () => {
	it('produces 32-byte hash', async () => {
		const hash = await sha256('test');

		expect(hash.byteLength).toBe(32);
	});

	it('produces deterministic output', async () => {
		const a = await sha256('test');
		const b = await sha256('test');

		expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
	});

	it('different inputs produce different hashes', async () => {
		const a = await sha256('test-a');
		const b = await sha256('test-b');

		expect(new Uint8Array(a)).not.toEqual(new Uint8Array(b));
	});

	it('sha256Bytes returns Uint8Array', async () => {
		const hash = await sha256Bytes('test');

		expect(hash).toBeInstanceOf(Uint8Array);
		expect(hash.length).toBe(32);
	});
});

/**
 * AES-GCM Tests
 */
describe('AES-GCM', () => {
	describe('Nonce Generation', () => {
		it('generates correct size nonce', () => {
			const nonce = generateNonce();

			expect(nonce.length).toBe(AES_GCM_NONCE_SIZE);
			expect(nonce.length).toBe(12);
		});

		it('generates unique nonces', () => {
			const a = generateNonce();
			const b = generateNonce();

			expect(a).not.toEqual(b);
		});
	});

	describe('Encryption/Decryption', () => {
		it('round-trips data', async () => {
			const key = randomBytes(32);
			const nonce = generateNonce();
			const plaintext = stringToBytes('Hello, World!');

			const ciphertext = await aesGcmEncrypt(key, nonce, plaintext);
			const decrypted = await aesGcmDecrypt(key, nonce, ciphertext);

			expect(decrypted).toEqual(plaintext);
		});

		it('ciphertext is longer than plaintext (includes auth tag)', async () => {
			const key = randomBytes(32);
			const nonce = generateNonce();
			const plaintext = stringToBytes('Hello');

			const ciphertext = await aesGcmEncrypt(key, nonce, plaintext);

			// AES-GCM adds a 16-byte authentication tag
			expect(ciphertext.length).toBe(plaintext.length + 16);
		});

		it('decryption fails with wrong key', async () => {
			const key1 = randomBytes(32);
			const key2 = randomBytes(32);
			const nonce = generateNonce();
			const plaintext = stringToBytes('Hello');

			const ciphertext = await aesGcmEncrypt(key1, nonce, plaintext);

			await expect(aesGcmDecrypt(key2, nonce, ciphertext)).rejects.toThrow();
		});

		it('decryption fails with wrong nonce', async () => {
			const key = randomBytes(32);
			const nonce1 = generateNonce();
			const nonce2 = generateNonce();
			const plaintext = stringToBytes('Hello');

			const ciphertext = await aesGcmEncrypt(key, nonce1, plaintext);

			await expect(aesGcmDecrypt(key, nonce2, ciphertext)).rejects.toThrow();
		});

		it('decryption fails with tampered ciphertext', async () => {
			const key = randomBytes(32);
			const nonce = generateNonce();
			const plaintext = stringToBytes('Hello');

			const ciphertext = await aesGcmEncrypt(key, nonce, plaintext);

			// Tamper with the ciphertext
			ciphertext[0] ^= 0xff;

			await expect(aesGcmDecrypt(key, nonce, ciphertext)).rejects.toThrow();
		});

		it('same plaintext with different nonces produces different ciphertext', async () => {
			const key = randomBytes(32);
			const plaintext = stringToBytes('Hello');

			const ct1 = await aesGcmEncrypt(key, generateNonce(), plaintext);
			const ct2 = await aesGcmEncrypt(key, generateNonce(), plaintext);

			expect(ct1).not.toEqual(ct2);
		});
	});

	describe('String Convenience Functions', () => {
		it('encryptString and decryptString round-trip', async () => {
			const key = randomBytes(32);
			const original = 'Hello, World! 🎉';

			const { nonceB64, ciphertextB64 } = await encryptString(key, original);
			const decrypted = await decryptString(key, nonceB64, ciphertextB64);

			expect(decrypted).toBe(original);
		});

		it('returns Base64 strings', async () => {
			const key = randomBytes(32);
			const { nonceB64, ciphertextB64 } = await encryptString(key, 'test');

			const validBase64 = /^[A-Za-z0-9+/=]*$/;
			expect(validBase64.test(nonceB64)).toBe(true);
			expect(validBase64.test(ciphertextB64)).toBe(true);
		});
	});
});

/**
 * ECDH Tests
 */
describe('ECDH', () => {
	it('generates valid key pair', async () => {
		const keyPair = await generateEcdhKeyPair();

		expect(keyPair.publicKey).toBeDefined();
		expect(keyPair.privateKey).toBeDefined();
		expect(keyPair.publicKey.type).toBe('public');
		expect(keyPair.privateKey.type).toBe('private');
	});

	it('exports public key to JWK', async () => {
		const keyPair = await generateEcdhKeyPair();
		const jwk = await exportPublicKeyJwk(keyPair.publicKey);

		expect(jwk.kty).toBe('EC');
		expect(jwk.crv).toBe('P-256');
		expect(jwk.x).toBeDefined();
		expect(jwk.y).toBeDefined();
		// Private key components should not be present
		expect(jwk.d).toBeUndefined();
	});

	it('imports public key from JWK', async () => {
		const keyPair = await generateEcdhKeyPair();
		const jwk = await exportPublicKeyJwk(keyPair.publicKey);
		const imported = await importPublicKeyJwk(jwk);

		expect(imported.type).toBe('public');
	});

	it('derives same shared secret on both sides', async () => {
		// Simulate client and server
		const clientKeyPair = await generateEcdhKeyPair();
		const serverKeyPair = await generateEcdhKeyPair();

		// Exchange public keys
		const clientPublicJwk = await exportPublicKeyJwk(clientKeyPair.publicKey);
		const serverPublicJwk = await exportPublicKeyJwk(serverKeyPair.publicKey);

		// Import each other's public keys
		const clientPublicKey = await importPublicKeyJwk(clientPublicJwk);
		const serverPublicKey = await importPublicKeyJwk(serverPublicJwk);

		// Derive shared secrets
		const clientSecret = await deriveSharedSecret(clientKeyPair.privateKey, serverPublicKey);
		const serverSecret = await deriveSharedSecret(serverKeyPair.privateKey, clientPublicKey);

		// Should be identical!
		expect(new Uint8Array(clientSecret)).toEqual(new Uint8Array(serverSecret));
	});

	it('ecdhExchange convenience function works', async () => {
		const clientKeyPair = await generateEcdhKeyPair();
		const serverKeyPair = await generateEcdhKeyPair();

		const clientPublicJwk = await exportPublicKeyJwk(clientKeyPair.publicKey);
		const serverPublicJwk = await exportPublicKeyJwk(serverKeyPair.publicKey);

		const clientSecret = await ecdhExchange(clientKeyPair.privateKey, serverPublicJwk);
		const serverSecret = await ecdhExchange(serverKeyPair.privateKey, clientPublicJwk);

		expect(new Uint8Array(clientSecret)).toEqual(new Uint8Array(serverSecret));
	});

	it('generateKeyPairForExchange returns both keypair and JWK', async () => {
		const { keyPair, publicKeyJwk } = await generateKeyPairForExchange();

		expect(keyPair.publicKey).toBeDefined();
		expect(keyPair.privateKey).toBeDefined();
		expect(publicKeyJwk.kty).toBe('EC');
	});

	it('shared secret is 32 bytes', async () => {
		const clientKeyPair = await generateEcdhKeyPair();
		const serverKeyPair = await generateEcdhKeyPair();

		const serverPublicKey = await importPublicKeyJwk(
			await exportPublicKeyJwk(serverKeyPair.publicKey)
		);

		const secret = await deriveSharedSecret(clientKeyPair.privateKey, serverPublicKey);

		expect(secret.byteLength).toBe(32);
	});

	it('different key pairs produce different shared secrets', async () => {
		const client1 = await generateEcdhKeyPair();
		const client2 = await generateEcdhKeyPair();
		const server = await generateEcdhKeyPair();

		const serverPublicKey = await importPublicKeyJwk(await exportPublicKeyJwk(server.publicKey));

		const secret1 = await deriveSharedSecret(client1.privateKey, serverPublicKey);
		const secret2 = await deriveSharedSecret(client2.privateKey, serverPublicKey);

		expect(new Uint8Array(secret1)).not.toEqual(new Uint8Array(secret2));
	});
});
