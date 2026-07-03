/**
 * Persistent CLI session store (~/.config/tmux-speedrun/session.json, mode 0600).
 *
 * TDD STUB — issue #35, interface §4.6. `decodeSessionToken` decodes the
 * username/githubId from a signed session token WITHOUT verifying the HMAC
 * (the server verifies on use); it returns null on a malformed token.
 *
 * Bodies throw so tdd tests fail on the missing feature, not an import error.
 */

export type StoredSession = {
	token: string;
	username: string;
	githubId: number;
	savedAt: number;
};

const NOT_IMPLEMENTED = 'token-store: not implemented (tdd stub)';

export function sessionFilePath(): string {
	throw new Error(NOT_IMPLEMENTED);
}

export function loadSession(): StoredSession | null {
	throw new Error(NOT_IMPLEMENTED);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function saveSession(s: StoredSession): void {
	throw new Error(NOT_IMPLEMENTED);
}

export function clearSession(): void {
	throw new Error(NOT_IMPLEMENTED);
}

/**
 * Decode username/githubId locally from a session token WITHOUT verifying the
 * HMAC. Returns null on a malformed token.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function decodeSessionToken(token: string): { githubId: number; username: string } | null {
	throw new Error(NOT_IMPLEMENTED);
}
