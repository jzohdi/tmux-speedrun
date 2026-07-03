/**
 * In-memory cookie jar for one CLI command run.
 *
 * TDD STUB — issue #35, interface §2.1. Carries the httpOnly challenge/pending
 * cookies (`tmux_challenge_session`, `tmux_pending_result`) across
 * start/finish/record with no server change. Memory only; never persisted.
 *
 * Methods throw so tdd tests fail on the missing feature, not an import error.
 */

export type StoredCookie = { name: string; value: string };

const NOT_IMPLEMENTED = 'cookie-jar: not implemented (tdd stub)';

export class CookieJar {
	/** Ingest a response's Set-Cookie headers (response.headers.getSetCookie()). */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	storeFromResponse(res: Response): void {
		throw new Error(NOT_IMPLEMENTED);
	}

	/** Ingest raw Set-Cookie header lines (testable entry point). */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	storeSetCookies(setCookieLines: string[]): void {
		throw new Error(NOT_IMPLEMENTED);
	}

	/** Serialize all live cookies as a single Cookie request-header value, or undefined if empty. */
	header(): string | undefined {
		throw new Error(NOT_IMPLEMENTED);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	get(name: string): string | undefined {
		throw new Error(NOT_IMPLEMENTED);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	set(name: string, value: string): void {
		throw new Error(NOT_IMPLEMENTED);
	}

	clear(): void {
		throw new Error(NOT_IMPLEMENTED);
	}
}
