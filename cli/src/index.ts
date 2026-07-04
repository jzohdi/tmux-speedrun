/**
 * tmux-speedrun CLI entrypoint (issue #35, interface §9).
 *
 * NOTE: the `#!/usr/bin/env node` shebang is injected by tsup at build time
 * (see tsup.config.ts `banner`). Do not add one here — a second shebang below
 * line 1 is a syntax error and breaks the built binary.
 *
 * Parses args, resolves config + stored session, builds the API client, and
 * dispatches to the matching command. Exit codes: 0 success, 1 runtime error,
 * 2 usage error.
 */

import { parseArgs } from './args';
import { resolveConfig } from './config';
import { loadSession } from './auth/token-store';
import { ApiClient } from './api/client';
import { setColorEnabled, error } from './ui/output';
import type { Command, CommandContext } from './commands/types';
import { EXIT_RUNTIME } from './commands/types';
import { helpCommand } from './commands/help';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { whoamiCommand } from './commands/whoami';
import { leaderboardCommand } from './commands/leaderboard';
import { practiceCommand } from './commands/practice';
import { challengeCommand } from './commands/challenge';

const COMMANDS: Record<string, Command> = {
	help: helpCommand,
	login: loginCommand,
	logout: logoutCommand,
	whoami: whoamiCommand,
	leaderboard: leaderboardCommand,
	practice: practiceCommand,
	challenge: challengeCommand
};

async function main(): Promise<number> {
	const { command, positionals, options } = parseArgs(process.argv.slice(2));

	if (options.noColor || process.env.NO_COLOR) setColorEnabled(false);

	const config = resolveConfig(options);
	const session = loadSession();
	const api = new ApiClient({
		baseUrl: config.baseUrl,
		sessionToken: session?.token
	});

	const ctx: CommandContext = { api, options, session };
	const cmd = COMMANDS[command] ?? helpCommand;
	return cmd.run(ctx, positionals);
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		error((err as Error).message);
		process.exit(EXIT_RUNTIME);
	});
