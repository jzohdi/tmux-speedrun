/**
 * ECDH (Elliptic Curve Diffie-Hellman) key exchange using Web Crypto API.
 *
 * ECDH allows two parties to establish a shared secret over an insecure channel.
 * We use the P-256 (secp256r1) curve.
 *
 * Flow:
 * 1. Each party generates an ephemeral key pair
 * 2. They exchange public keys
 * 3. Each derives the same shared secret using their private key and the other's public key
 * 4. The shared secret is used as input to a KDF (HKDF) to derive symmetric keys
 */

/**
 * Generate an ephemeral ECDH key pair on the P-256 curve.
 *
 * @returns Key pair with extractable public key for exchange
 */
export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
	return crypto.subtle.generateKey(
		{
			name: 'ECDH',
			namedCurve: 'P-256'
		},
		true, // Extractable (public key needs to be exported)
		['deriveBits']
	);
}

/**
 * Export a public key to JWK format for transmission.
 *
 * @param publicKey - The public key to export
 * @returns JWK representation of the public key
 */
export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
	return crypto.subtle.exportKey('jwk', publicKey);
}

/**
 * Import a public key from JWK format.
 *
 * @param jwk - JWK representation of a P-256 public key
 * @returns Imported CryptoKey for ECDH operations
 */
export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'jwk',
		jwk,
		{
			name: 'ECDH',
			namedCurve: 'P-256'
		},
		true, // Extractable
		[] // No key usages for public key (deriveBits uses private key)
	);
}

/**
 * Derive a shared secret using ECDH.
 *
 * @param privateKey - Our private key
 * @param publicKey - The other party's public key
 * @returns 32-byte (256-bit) shared secret
 */
export async function deriveSharedSecret(
	privateKey: CryptoKey,
	publicKey: CryptoKey
): Promise<ArrayBuffer> {
	return crypto.subtle.deriveBits(
		{
			name: 'ECDH',
			public: publicKey
		},
		privateKey,
		256 // Output size in bits (P-256 produces 256 bits)
	);
}

/**
 * Perform ECDH key exchange: import remote public key and derive shared secret.
 *
 * This is a convenience function that combines import and derivation.
 *
 * @param privateKey - Our private key
 * @param remotePublicKeyJwk - Remote party's public key in JWK format
 * @returns 32-byte shared secret
 */
export async function ecdhExchange(
	privateKey: CryptoKey,
	remotePublicKeyJwk: JsonWebKey
): Promise<ArrayBuffer> {
	const remotePublicKey = await importPublicKeyJwk(remotePublicKeyJwk);

	return deriveSharedSecret(privateKey, remotePublicKey);
}

/**
 * Complete key pair generation and export for transmission.
 *
 * @returns Object with keyPair and exported publicKeyJwk
 */
export async function generateKeyPairForExchange(): Promise<{
	keyPair: CryptoKeyPair;
	publicKeyJwk: JsonWebKey;
}> {
	const keyPair = await generateEcdhKeyPair();
	const publicKeyJwk = await exportPublicKeyJwk(keyPair.publicKey);

	return { keyPair, publicKeyJwk };
}
