/**
 * Signed "pending result" cookie helper (iteration 2 — PR #36 feedback).
 *
 * An anonymous finish no longer records immediately. Instead the result
 * (challengeId + durationMs) is deferred behind this short-lived, HMAC-signed
 * cookie so it can be attached to a verified GitHub identity after a later
 * login, or to a free-text name at record time.
 *
 * The cookie value is `${base64url(JSON(payload))}.${base64url(hmacSha256(payloadB64))}`,
 * signed with the existing SESSION_SECRET (same scheme as the auth session
 * cookie). A tampered/expired/garbage token verifies as `null`, so `durationMs`
 * and `challengeId` cannot be forged between finish and record. The username is
 * NEVER stored in this cookie — identity is always resolved at record time.
 *
 * See `.agent/interface.md` §I2.
 */

import type { Cookies } from '@sveltejs/kit';
import {
	getSessionSecret,
	PENDING_RESULT_COOKIE_NAME,
	PENDING_RESULT_COOKIE_OPTIONS
} from '$lib/server/env';
import {
	bytesToBase64,
	base64ToBytes,
	stringToBytes,
	bytesToString,
	constantTimeEqual
} from '$lib/crypto';

/** Payload embedded in the signed pending-result cookie. */
export type PendingResultPayload = {
	challengeId: number; // challenge index (0-based), matches the route param
	durationMs: number;
	sessionId: string; // challenge crypto session id — replay guard at record time
	iat: number; // issued-at, epoch ms
};

/** What verify returns to callers (iat dropped). */
export type PendingResult = {
	challengeId: number;
	durationMs: number;
	sessionId: string;
};

/** Single source of truth for pending-result expiry (1h) — equals the challenge TTL. */
export const MAX_PENDING_RESULT_AGE_MS = 60 * 60 * 1000;

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
export async function createPendingResultToken(payload: PendingResultPayload): Promise<string> {
	const payloadB64 = bytesToBase64Url(stringToBytes(JSON.stringify(payload)));
	const signature = await signPayload(payloadB64);
	return `${payloadB64}.${bytesToBase64Url(signature)}`;
}

/**
 * Verify signature + parse. Returns { challengeId, durationMs } on success, else null.
 * Returns null for: bad format, signature mismatch, malformed JSON, wrong field types,
 * and when `now - iat > MAX_PENDING_RESULT_AGE_MS`. Never throws on invalid input.
 */
export async function verifyPendingResultToken(raw: string): Promise<PendingResult | null> {
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
			typeof payload.challengeId !== 'number' ||
			typeof payload.durationMs !== 'number' ||
			typeof payload.sessionId !== 'string' ||
			typeof payload.iat !== 'number'
		) {
			return null;
		}

		// Expiry: reject tokens older than the max age (single source of truth).
		if (Date.now() - payload.iat > MAX_PENDING_RESULT_AGE_MS) {
			return null;
		}

		return {
			challengeId: payload.challengeId,
			durationMs: payload.durationMs,
			sessionId: payload.sessionId
		};
	} catch {
		return null;
	}
}

/** Set the signed pending-result cookie (PENDING_RESULT_COOKIE_NAME + PENDING_RESULT_COOKIE_OPTIONS). */
export async function setPendingResultCookie(
	cookies: Cookies,
	payload: PendingResultPayload
): Promise<void> {
	const token = await createPendingResultToken(payload);
	cookies.set(PENDING_RESULT_COOKIE_NAME, token, PENDING_RESULT_COOKIE_OPTIONS);
}

/** Delete the pending-result cookie (path '/'). */
export function clearPendingResultCookie(cookies: Cookies): void {
	cookies.delete(PENDING_RESULT_COOKIE_NAME, { path: '/' });
}
