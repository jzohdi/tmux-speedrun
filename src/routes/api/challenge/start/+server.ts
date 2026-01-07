/**
 * POST /api/challenge/start
 *
 * Starts a new challenge session.
 *
 * Flow:
 * 1. Validate request (challengeId, clientPublicKeyJwk)
 * 2. Generate instructions for the challenge
 * 3. Perform ECDH key exchange to derive shared secret
 * 4. Derive key chain and encrypt all steps
 * 5. Set session cookie with encrypted proof
 * 6. Return encrypted steps and server public key
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateEcdhKeyPair, exportPublicKeyJwk, ecdhExchange, bytesToBase64 } from '$lib/crypto';
import { generateInstructions, isValidChallengeId, prepareChallenge } from '$lib/server/challenges';
import { parseStartRequest, type ChallengeSessionCookie } from '$lib/server/challenges/schemas';
import { getSessionSecret, CHALLENGE_COOKIE_NAME, COOKIE_OPTIONS } from '$lib/server/env';

export const POST: RequestHandler = async ({ request, cookies }) => {
	// Parse and validate request body
	let requestData;
	try {
		const body = await request.json();
		requestData = parseStartRequest(body);
	} catch (err) {
		if (err instanceof SyntaxError) {
			error(400, { message: 'Invalid JSON in request body' });
		}
		error(400, { message: 'Invalid request: ' + String(err) });
	}

	const { challengeId, clientPublicKeyJwk } = requestData;

	// Validate challenge ID
	if (!isValidChallengeId(challengeId)) {
		error(400, { message: `Invalid challenge ID: ${challengeId}` });
	}

	// Generate instructions for this challenge
	const instructions = generateInstructions(challengeId);

	// Generate server ECDH key pair
	const serverKeyPair = await generateEcdhKeyPair();
	const serverPublicKeyJwk = await exportPublicKeyJwk(serverKeyPair.publicKey);

	// Derive shared secret using client's public key
	let sharedSecret: ArrayBuffer;
	try {
		sharedSecret = await ecdhExchange(serverKeyPair.privateKey, clientPublicKeyJwk);
	} catch (err) {
		error(400, { message: 'Invalid client public key' });
	}

	// Get server secret for proof encryption
	const serverSecret = getSessionSecret();

	// Prepare challenge (derive keys, encrypt steps, encrypt proof)
	const { sessionSalt, sessionId, encryptedSteps, encryptedProof } = await prepareChallenge(
		sharedSecret,
		instructions,
		serverSecret
	);

	// Create session cookie data
	const sessionData: ChallengeSessionCookie = {
		challengeId,
		sessionId,
		encryptedProof,
		startTime: Date.now()
	};

	// Set session cookie
	cookies.set(CHALLENGE_COOKIE_NAME, JSON.stringify(sessionData), COOKIE_OPTIONS);

	// Return response
	return json({
		serverPublicKeyJwk,
		sessionSaltB64: bytesToBase64(sessionSalt),
		steps: encryptedSteps
	});
};
