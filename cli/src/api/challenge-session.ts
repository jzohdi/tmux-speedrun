/**
 * CLI challenge session — Node analogue of the browser `ChallengeSession`
 * (issue #35, interface §3), using `challenge-core` + `ApiClient`. Mirrors the
 * crypto flow in `challenge.ts` exactly; differs only in transport (explicit
 * base URL + cookie jar instead of `credentials:'include'`).
 */

import {
	generateKeyPairForExchange,
	ecdhExchange,
	base64ToBytes,
	bytesToBase64,
	bufferToBytes
} from '$lib/crypto';
import {
	deriveK0,
	decryptStep,
	tryAdvanceKey,
	resolveTotalSteps,
	type DecryptedStep,
	type EncryptedStep
} from '$lib/client/challenge-core';
import type { ApiClient } from './client';

export type StartResponse = {
	serverPublicKeyJwk: JsonWebKey;
	sessionSaltB64: string;
	steps: EncryptedStep[];
	/**
	 * Number of REAL steps. When the server honored `finalCheck: true`, `steps`
	 * has one extra trailing final-check step (encrypted under Kfinal) used
	 * only to verify the last real answer. Absent on legacy servers.
	 */
	totalSteps?: number;
};

export type FinishResponse = {
	valid: boolean;
	durationMs: number;
	recorded?: boolean;
	leaderboardPosition?: number;
	username?: string | null;
	message?: string;
};

export type RecordResponse = {
	recorded: true;
	leaderboardPosition?: number;
	username: string | null;
};

export class CliChallengeSession {
	private encryptedSteps: EncryptedStep[];
	private currentKeyRaw: ArrayBuffer;
	private currentStepIndexValue = 0;
	private totalStepsValue: number;

	private constructor(
		private api: ApiClient,
		public readonly challengeId: number,
		steps: EncryptedStep[],
		totalSteps: number,
		k0: ArrayBuffer
	) {
		this.encryptedSteps = steps;
		this.currentKeyRaw = k0;
		// REAL steps only — `steps` may carry one extra trailing final-check
		// step (encrypted under Kfinal), never displayed or counted.
		this.totalStepsValue = totalSteps;
	}

	/** POST /api/challenge/start { challengeId, clientPublicKeyJwk, finalCheck }; derive K0; capture cookies. */
	static async start(api: ApiClient, challengeId: number): Promise<CliChallengeSession> {
		const { keyPair, publicKeyJwk } = await generateKeyPairForExchange();

		const data = await api.postJson<StartResponse>('/api/challenge/start', {
			challengeId,
			clientPublicKeyJwk: publicKeyJwk,
			// Opt in to the final-check step so the last answer is verified
			// locally like every other step (wrong ≠ failed challenge).
			finalCheck: true
		});

		const totalSteps = resolveTotalSteps(data.steps, data.totalSteps);

		const sharedSecret = await ecdhExchange(keyPair.privateKey, data.serverPublicKeyJwk);
		const sessionSalt = base64ToBytes(data.sessionSaltB64);
		const k0 = await deriveK0(sharedSecret, sessionSalt);

		return new CliChallengeSession(api, challengeId, data.steps, totalSteps, k0);
	}

	/** Decrypt the current (not-yet-solved) step for prompting. */
	async decryptCurrentStep(): Promise<DecryptedStep> {
		if (this.currentStepIndexValue >= this.totalStepsValue) {
			throw new Error('No more steps to decrypt');
		}
		return decryptStep(this.currentKeyRaw, this.encryptedSteps[this.currentStepIndexValue]);
	}

	/**
	 * Trial-decrypt step n+1 with K(n+1)=deriveNextKey(Kn, answer, n). On
	 * success advance + return true; on failure return false and stay put —
	 * for EVERY step, including the last, which verifies against the server's
	 * final-check step (a wrong final command no longer corrupts the proof and
	 * fails the run). Pure-local; no network.
	 */
	async submitAnswer(answer: string): Promise<boolean> {
		if (this.currentStepIndexValue >= this.totalStepsValue) return false;

		// `encryptedSteps[i + 1]` is the next real step, or the final-check step
		// on the last one (undefined only against a legacy server — see
		// tryAdvanceKey for the fallback behavior).
		const nextKey = await tryAdvanceKey(
			this.currentKeyRaw,
			answer,
			this.currentStepIndexValue,
			this.encryptedSteps[this.currentStepIndexValue + 1]
		);
		if (nextKey === null) return false;

		this.currentKeyRaw = nextKey;
		this.currentStepIndexValue++;
		return true;
	}

	isComplete(): boolean {
		return this.currentStepIndexValue >= this.totalStepsValue;
	}

	currentStepIndex(): number {
		return this.currentStepIndexValue;
	}

	totalSteps(): number {
		return this.totalStepsValue;
	}

	/** POST /api/challenge/finish { proofB64 = base64(Kfinal) }. Requires isComplete(). */
	async finish(): Promise<FinishResponse> {
		if (!this.isComplete()) {
			throw new Error('Cannot finish incomplete challenge');
		}
		const proofB64 = bytesToBase64(bufferToBytes(this.currentKeyRaw));
		return this.api.postJson<FinishResponse>('/api/challenge/finish', { proofB64 });
	}

	/** POST /api/challenge/record (empty body). Identity resolved server-side from tmux_session. */
	async record(): Promise<RecordResponse> {
		return this.api.postJson<RecordResponse>('/api/challenge/record', {});
	}
}
