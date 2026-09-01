/**
 * Type definitions for the challenge system.
 *
 * The challenge flow:
 * 1. Client requests challenge start with ECDH public key
 * 2. Server generates randomized instructions, encrypts them with chained keys
 * 3. Server returns all encrypted steps upfront
 * 4. Client decrypts steps progressively by deriving keys from correct answers
 * 5. Client submits final proof (Kfinal) to validate completion
 */

/**
 * A single instruction in a challenge (server-side, plaintext).
 * This is what gets encrypted before sending to the client.
 */
export type Instruction = {
	/** Zero-based position in the instruction sequence */
	index: number;
	/** Human-readable prompt shown to the user (e.g., "Split pane vertically") */
	prompt: string;
	/**
	 * Canonical action name used as KDF salt.
	 * For simple commands: "split-vertical"
	 * For input commands: "rename-window:swift-tiger-42"
	 */
	expectedAction: string;
	/**
	 * For input commands, the random string the user must type.
	 * Undefined for simple commands.
	 */
	requiredInput?: string;
	/**
	 * Optional text that should be preloaded into the terminal input before the user acts.
	 * Used for composite steps like copy-then-paste where the text must exist in the pane.
	 */
	seedInput?: string;
};

/**
 * The payload that gets encrypted in each step.
 * Client sees this after successful decryption.
 *
 * Note: We intentionally do NOT include the shortcut here.
 * Users should learn shortcuts from documentation or 'man tmux'.
 */
export type StepPayload = {
	/** The prompt describing what the user should do */
	prompt: string;
	/**
	 * For input commands, the string the user must type.
	 * The client needs this to know what to validate.
	 */
	requiredInput?: string;
	/** Optional text to preload into the terminal input for the step */
	seedInput?: string;
};

/**
 * An encrypted step delivered to the client.
 * Client must derive the correct key to decrypt.
 */
export type EncryptedStep = {
	index: number;
	nonceB64: string;
	ciphertextB64: string;
};

/**
 * Request body for POST /api/challenge/start
 */
export type StartChallengeRequest = {
	challengeId: number;
	clientPublicKeyJwk: JsonWebKey;
	/**
	 * Opt in to receiving a final-check step (see StartChallengeResponse.steps).
	 * Omitted by legacy clients.
	 */
	finalCheck?: boolean;
};

/**
 * Response body for POST /api/challenge/start
 */
export type StartChallengeResponse = {
	serverPublicKeyJwk: JsonWebKey;
	sessionSaltB64: string;
	/**
	 * The encrypted real steps — plus, when the request set `finalCheck: true`,
	 * one trailing final-check step encrypted under Kfinal. The final-check
	 * step is never displayed; clients trial-decrypt it to verify the last
	 * real answer locally.
	 */
	steps: EncryptedStep[];
	/** Number of REAL steps (excludes the final-check step, when present). */
	totalSteps: number;
};

/**
 * Request body for POST /api/challenge/finish
 */
export type FinishChallengeRequest = {
	proofB64: string;
};

/**
 * Response body for POST /api/challenge/finish
 */
export type FinishChallengeResponse = {
	valid: boolean;
	durationMs: number;
	leaderboardPosition?: number;
};

/**
 * Session data stored in the signed cookie.
 * This enables stateless validation on the server.
 */
export type ChallengeSession = {
	challengeId: number;
	sessionKey: string;
	expectedProofEncrypted: string;
	startTime: number;
};
