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

// Export inferred types
export type StartChallengeRequestBody = z.infer<typeof startChallengeRequestSchema>;
export type FinishChallengeRequestBody = z.infer<typeof finishChallengeRequestSchema>;
export type ChallengeSessionCookie = z.infer<typeof challengeSessionSchema>;
