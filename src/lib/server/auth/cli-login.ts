/**
 * CLI-login OAuth state helper + loopback-redirect guard.
 *
 * TDD STUB — implementation stage (issue #35, interface §4.2). Carries
 * `{ port, cliState }` through the GitHub OAuth round-trip (HMAC-signed with
 * `getSessionSecret()`, mirroring `session.ts`) and, in the callback, decides
 * whether the minted session token may be handed back over loopback.
 *
 * Security-critical (invariant AUTH1): the minted token leaves the server ONLY
 * when `buildLoopbackCallbackUrl` returns a non-null loopback URL; every other
 * outcome falls back to the home redirect (never an open redirect).
 *
 * Bodies throw so tdd tests fail on the missing feature, not an import error.
 */

export type CliLoginState = { port: number; cliState: string };

const NOT_IMPLEMENTED = 'cli-login: not implemented (tdd stub)';

/** Sign {port, cliState} into the tmux_cli_login cookie value. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function signCliLoginState(state: CliLoginState): Promise<string> {
	throw new Error(NOT_IMPLEMENTED);
}

/** Verify + parse. null on bad signature / malformed / wrong field types (never throws). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function verifyCliLoginState(raw: string): Promise<CliLoginState | null> {
	throw new Error(NOT_IMPLEMENTED);
}

/**
 * Return the loopback callback URL ONLY when every constraint holds, else null:
 * host is 127.0.0.1 or localhost, scheme http, path /callback, port an integer
 * in [1024, 65535]. token + cliState are URL-encoded into the query.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildLoopbackCallbackUrl(args: {
	port: number;
	cliState: string;
	token: string;
}): string | null {
	throw new Error(NOT_IMPLEMENTED);
}
