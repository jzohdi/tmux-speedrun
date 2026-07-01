/**
 * Zod schemas for challenge API validation.
 *
 * These schemas validate incoming request bodies at the API boundary.
 * All external data must be validated before use.
 */

import { z } from 'zod';

/**
 * Schema for JWK (JSON Web Key) for ECDH P-256 public keys.
 *
 * We only accept P-256 curve keys with required fields.
 */
export const jwkPublicKeySchema = z.object({
	kty: z.literal('EC'),
	crv: z.literal('P-256'),
	x: z.string().min(1),
	y: z.string().min(1),
	// Ensure no private key component is sent
	d: z.undefined().optional()
});

/**
 * Request schema for POST /api/challenge/start
 */
export const startChallengeRequestSchema = z.object({
	challengeId: z.number().int().min(0).max(5),
	clientPublicKeyJwk: jwkPublicKeySchema
});

/**
 * Request schema for POST /api/challenge/finish
 */
export const finishChallengeRequestSchema = z.object({
	proofB64: z.string().min(1)
});

/**
 * Request schema for POST /api/challenge/record (iteration 2 — PR #36 feedback).
 *
 * Lets a signed-out user attach an optional free-text name to a deferred result.
 * Signed-in users always use their verified identity — the body username is
 * ignored server-side. Shape validation only requires an optional string; the
 * sanitizer (`parseRecordRequest`) trims, strips control chars, and enforces the
 * final 32-char display cap (so an over-long name is truncated, not rejected).
 */
export const recordChallengeRequestSchema = z.object({
	username: z.string().optional()
});

/**
 * Schema for the session cookie payload.
 * This is what gets serialized/deserialized from the cookie.
 */
export const challengeSessionSchema = z.object({
	challengeId: z.number().int().min(0),
	sessionId: z.string().min(1),
	encryptedProof: z.string().min(1),
	startTime: z.number().int().positive()
});

/**
 * Parse and validate start challenge request.
 *
 * @param data - Raw request body
 * @returns Validated request data
 * @throws ZodError if validation fails
 */
export function parseStartRequest(data: unknown) {
	return startChallengeRequestSchema.parse(data);
}

/**
 * Parse and validate finish challenge request.
 *
 * @param data - Raw request body
 * @returns Validated request data
 * @throws ZodError if validation fails
 */
export function parseFinishRequest(data: unknown) {
	return finishChallengeRequestSchema.parse(data);
}

/**
 * Parse and validate session cookie.
 *
 * @param data - Parsed JSON from cookie
 * @returns Validated session data
 * @throws ZodError if validation fails
 */
export function parseSessionCookie(data: unknown) {
	return challengeSessionSchema.parse(data);
}

/**
 * Parse + sanitize the record request.
 *
 * Trims, strips control characters (0x00–0x1F and DEL), and caps length at 32.
 * An empty / whitespace-only name normalizes to `undefined` (→ Anonymous).
 * Svelte auto-escapes on render, so display is XSS-safe.
 *
 * @param data - Raw request body
 * @returns `{ username: string | undefined }`
 * @throws ZodError if the shape is invalid (e.g. non-string username)
 */
export function parseRecordRequest(data: unknown): { username: string | undefined } {
	const { username } = recordChallengeRequestSchema.parse(data);

	if (username === undefined) {
		return { username: undefined };
	}

	// Strip control characters (code point <= 0x1F, or DEL 0x7F).
	let stripped = '';
	for (let i = 0; i < username.length; i++) {
		const code = username.charCodeAt(i);
		if (code > 0x1f && code !== 0x7f) {
			stripped += username[i];
		}
	}

	const cleaned = stripped.trim();
	if (cleaned.length === 0) {
		return { username: undefined };
	}

	return { username: cleaned.slice(0, 32) };
}

// Export inferred types
export type StartChallengeRequestBody = z.infer<typeof startChallengeRequestSchema>;
export type FinishChallengeRequestBody = z.infer<typeof finishChallengeRequestSchema>;
export type RecordChallengeRequestBody = z.infer<typeof recordChallengeRequestSchema>;
export type ChallengeSessionCookie = z.infer<typeof challengeSessionSchema>;
