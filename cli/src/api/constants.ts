/**
 * Cookie names shared with the web server (issue #35). Mirrored here as plain
 * constants so the CLI does not import `$lib/server/env` (which depends on
 * SvelteKit-only `$env`/`$app` modules). Keep in sync with `src/lib/server/env.ts`.
 */

export const SESSION_COOKIE_NAME = 'tmux_session';
export const CHALLENGE_COOKIE_NAME = 'tmux_challenge_session';
export const PENDING_RESULT_COOKIE_NAME = 'tmux_pending_result';
