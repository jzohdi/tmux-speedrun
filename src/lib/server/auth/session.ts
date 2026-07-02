/**
 * Stateless, signed, cookie-based auth session (no DB session table).
 *
 * The cookie value is `${base64url(JSON(payload))}.${base64url(hmacSha256(payloadB64))}`,
 * signed with the existing SESSION_SECRET. A tampered payload or signature fails
 * verification and is treated as anonymous — so a client cannot forge a username.
 *
 * See `.agent/interface.md` §2.
 */

import type { Cookies } from '@sveltejs/kit';
import { getSessionSecret, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '$lib/server/env';
import {
	bytesToBase64,
	base64ToBytes,
	stringToBytes,
	bytesToString,
	constantTimeEqual
} from '$lib/crypto';

/** The session payload embedded in the signed cookie. */
export type SessionPayload = {
	githubId: number; // stable numeric GitHub id
	username: string; // GitHub login (verified)
	iat: number; // issued-at, epoch ms
};

/** The subset exposed to the app as event.locals.user. */
export type SessionUser = {
	githubId: number;
	username: string;
};

// --- base64url helpers (URL/cookie-safe, padding stripped) -----------------

function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
	// Restore standard base64 alphabet; atob tolerates missing padding.
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

/**
 * Serialize + sign a session payload into a cookie string value.
 */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
	const payloadB64 = bytesToBase64Url(stringToBytes(JSON.stringify(payload)));
	const signature = await signPayload(payloadB64);
	return `${payloadB64}.${bytesToBase64Url(signature)}`;
}

/**
 * Verify signature + parse. Returns the SessionUser on success, or null on any
 * failure (bad format, signature mismatch, malformed JSON, wrong field types).
 * Never throws for invalid input.
 */
export async function verifySessionToken(raw: string): Promise<SessionUser | null> {
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
		if (
			typeof payload !== 'object' ||
			payload === null ||
			typeof payload.githubId !== 'number' ||
			typeof payload.username !== 'string'
		) {
			return null;
		}

		return { githubId: payload.githubId, username: payload.username };
	} catch {
		return null;
	}
}

/** Set the signed session cookie (SESSION_COOKIE_NAME + SESSION_COOKIE_OPTIONS). */
export async function setSessionCookie(cookies: Cookies, payload: SessionPayload): Promise<void> {
	const token = await createSessionToken(payload);
	cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
}

/** Delete the session cookie (path '/'). */
export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}
