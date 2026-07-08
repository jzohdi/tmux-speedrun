/**
 * Signed challenge-session cookie helper.
 *
 * The challenge session (challengeId, sessionId, encryptedProof, startTime) was
 * previously stored as PLAIN JSON in the cookie, which let a client rewrite
 * `startTime` (forging arbitrary — even negative — durations) or re-label the
 * proof under a different `challengeId`. The payload is now HMAC-signed with
 * the existing SESSION_SECRET, exactly like the auth session and pending-result
 * cookies, so the server's start-time and challenge binding are authoritative.
 *
 * The cookie value is `${base64url(JSON(payload))}.${base64url(hmacSha256(payloadB64))}`.
 * A tampered/garbage token verifies as `null` (never throws).
 */

import { getSessionSecret } from '$lib/server/env';
import { challengeSessionSchema, type ChallengeSessionCookie } from './schemas';
import {
	bytesToBase64,
	base64ToBytes,
	stringToBytes,
	bytesToString,
	constantTimeEqual
} from '$lib/crypto';

// --- base64url helpers (URL/cookie-safe, padding stripped) -----------------

function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
	return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'));
}

// --- HMAC-SHA-256 over the payload -----------------------------------------

async function signPayload(payloadB64: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		getSessionSecret(),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, stringToBytes(payloadB64));
	return new Uint8Array(signature);
}

/** Serialize + sign: `${base64url(JSON(payload))}.${base64url(hmacSha256(payloadB64))}`. */
export async function createChallengeSessionToken(
	payload: ChallengeSessionCookie
): Promise<string> {
	const payloadB64 = bytesToBase64Url(stringToBytes(JSON.stringify(payload)));
	const signature = await signPayload(payloadB64);
	return `${payloadB64}.${bytesToBase64Url(signature)}`;
}

/**
 * Verify signature + parse. Returns the session payload on success, or null on
 * any failure (bad format, signature mismatch, malformed JSON, wrong shape).
 * Never throws for invalid input.
 */
export async function verifyChallengeSessionToken(
	raw: string
): Promise<ChallengeSessionCookie | null> {
	try {
		if (!raw) return null;

		const parts = raw.split('.');
		if (parts.length !== 2) return null;

		const [payloadB64, signatureB64] = parts;
		if (!payloadB64 || !signatureB64) return null;

		const expectedSig = await signPayload(payloadB64);
		const providedSig = base64UrlToBytes(signatureB64);
		if (!constantTimeEqual(expectedSig, providedSig)) return null;

		const payload = JSON.parse(bytesToString(base64UrlToBytes(payloadB64)));
		return challengeSessionSchema.parse(payload);
	} catch {
		return null;
	}
}
