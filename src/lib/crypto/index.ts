/**
 * Cryptographic utilities for the challenge system.
 *
 * This module provides:
 * - ECDH key exchange for establishing shared secrets
 * - HKDF for deriving keys from shared secrets
 * - AES-GCM for authenticated encryption
 * - Utility functions for encoding/decoding
 *
 * All functions use the Web Crypto API, which is available in both
 * browsers and Node.js (v15+).
 */

// Utility functions
export {
	bytesToBase64,
	base64ToBytes,
	bufferToBytes,
	stringToBytes,
	bytesToString,
	randomBytes,
	constantTimeEqual,
	concatBytes
} from './utils';

// HKDF key derivation
export { hkdf, hkdfDeriveAesKey, sha256, sha256Bytes } from './hkdf';

// AES-GCM encryption
export {
	AES_GCM_NONCE_SIZE,
	importAesGcmKey,
	aesGcmEncrypt,
	aesGcmDecrypt,
	encryptString,
	decryptString,
	generateNonce
} from './aes-gcm';

// ECDH key exchange
export {
	generateEcdhKeyPair,
	exportPublicKeyJwk,
	importPublicKeyJwk,
	deriveSharedSecret,
	ecdhExchange,
	generateKeyPairForExchange
} from './ecdh';

