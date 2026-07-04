/**
 * Shared command types (issue #35, interface §9.2). Each command exports a
 * `run(ctx, positionals)` returning a process exit code: 0 success, 1 runtime
 * error, 2 usage error.
 */

import type { ApiClient } from '../api/client';
import type { GlobalOptions } from '../args';
import type { StoredSession } from '../auth/token-store';

export type CommandContext = {
	api: ApiClient;
	options: GlobalOptions;
	session: StoredSession | null;
};

export type Command = {
	run(ctx: CommandContext, positionals: string[]): Promise<number>;
};

export const EXIT_OK = 0;
export const EXIT_RUNTIME = 1;
export const EXIT_USAGE = 2;
