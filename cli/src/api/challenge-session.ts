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
	deriveNextKey,
	decryptStep,
	type DecryptedStep,
	type EncryptedStep
} from '$lib/client/challenge-core';
import type { ApiClient } from './client';

export type StartResponse = {
	serverPublicKeyJwk: JsonWebKey;
	sessionSaltB64: string;
	steps: EncryptedStep[];
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
		k0: ArrayBuffer
	) {
		this.encryptedSteps = steps;
		this.currentKeyRaw = k0;
		this.totalStepsValue = steps.length;
	}

	/** POST /api/challenge/start { challengeId, clientPublicKeyJwk }; derive K0; capture cookies. */
	static async start(api: ApiClient, challengeId: number): Promise<CliChallengeSession> {
		const { keyPair, publicKeyJwk } = await generateKeyPairForExchange();

		const data = await api.postJson<StartResponse>('/api/challenge/start', {
			challengeId,
			clientPublicKeyJwk: publicKeyJwk
		});

		const sharedSecret = await ecdhExchange(keyPair.privateKey, data.serverPublicKeyJwk);
		const sessionSalt = base64ToBytes(data.sessionSaltB64);
		const k0 = await deriveK0(sharedSecret, sessionSalt);

		return new CliChallengeSession(api, challengeId, data.steps, k0);
	}

	/** Decrypt the current (not-yet-solved) step for prompting. */
	async decryptCurrentStep(): Promise<DecryptedStep> {
		if (this.currentStepIndexValue >= this.totalStepsValue) {
			throw new Error('No more steps to decrypt');
		}
		return decryptStep(this.currentKeyRaw, this.encryptedSteps[this.currentStepIndexValue]);
	}

	/**
	 * Trial-decrypt step n+1 with K(n+1)=deriveNextKey(Kn, answer, n). On success
	 * advance + return true; on the LAST step accept without a trial-decrypt and
	 * store Kfinal. On failure return false and stay put. Pure-local; no network.
	 */
	async submitAnswer(answer: string): Promise<boolean> {
		if (this.currentStepIndexValue >= this.totalStepsValue) return false;

		const nextKey = await deriveNextKey(this.currentKeyRaw, answer, this.currentStepIndexValue);

		// Last step: no next step to trial-decrypt — store Kfinal (the proof).
		if (this.currentStepIndexValue + 1 >= this.totalStepsValue) {
			this.currentKeyRaw = nextKey;
			this.currentStepIndexValue++;
			return true;
		}

		try {
			await decryptStep(nextKey, this.encryptedSteps[this.currentStepIndexValue + 1]);
			this.currentKeyRaw = nextKey;
			this.currentStepIndexValue++;
			return true;
		} catch {
			return false;
		}
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
