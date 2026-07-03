/**
 * CLI-login OAuth state helper + loopback-redirect guard.
 *
 * Issue #35, interface §4.2. Carries `{ port, cliState }` through the GitHub
 * OAuth round-trip (HMAC-signed with `getSessionSecret()`, mirroring
 * `session.ts`) and, in the callback, decides whether the minted session token
 * may be handed back over loopback.
 *
 * Security-critical (invariant AUTH1): the minted token leaves the server ONLY
 * when `buildLoopbackCallbackUrl` returns a non-null loopback URL; every other
 * outcome falls back to the home redirect (never an open redirect).
 */

import { getSessionSecret } from '$lib/server/env';
import {
	bytesToBase64,
	base64ToBytes,
	stringToBytes,
	bytesToString,
	constantTimeEqual
} from '$lib/crypto';

export type CliLoginState = { port: number; cliState: string };

/** Opaque CLI CSRF token: URL-safe, bounded length. */
const CLI_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

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

/** Sign {port, cliState} into the tmux_cli_login cookie value. */
export async function signCliLoginState(state: CliLoginState): Promise<string> {
	const payloadB64 = bytesToBase64Url(stringToBytes(JSON.stringify(state)));
	const signature = await signPayload(payloadB64);
	return `${payloadB64}.${bytesToBase64Url(signature)}`;
}

/** Verify + parse. null on bad signature / malformed / wrong field types (never throws). */
export async function verifyCliLoginState(raw: string): Promise<CliLoginState | null> {
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
			typeof payload.port !== 'number' ||
			typeof payload.cliState !== 'string'
		) {
			return null;
		}

		return { port: payload.port, cliState: payload.cliState };
	} catch {
		return null;
	}
}

/**
 * Return the loopback callback URL ONLY when every constraint holds, else null:
 * host is 127.0.0.1 or localhost, scheme http, path /callback, port an integer
 * in [1024, 65535], cliState within the opaque-token charset. token + cliState
 * are URL-encoded into the query (`?token=<t>&state=<cliState>`).
 *
 * A null return means the callback must fall back to the normal home redirect
 * (never an open redirect / token-exfiltration vector) — invariant AUTH1.
 */
export function buildLoopbackCallbackUrl(args: {
	port: number;
	cliState: string;
	token: string;
}): string | null {
	const { port, cliState, token } = args;

	if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return null;
	if (!CLI_STATE_PATTERN.test(cliState)) return null;

	const url = new URL(`http://127.0.0.1:${port}/callback`);
	url.searchParams.set('token', token);
	url.searchParams.set('state', cliState);
	return url.toString();
}
