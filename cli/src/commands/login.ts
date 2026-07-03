/**
 * `tmux-speedrun login` — browser OAuth via loopback (issue #35, interface §9.2).
 *
 * Starts a localhost callback receiver, opens the browser to the CLI-login
 * endpoint, waits for the verified session token, and stores it (0600).
 */

import type { Command } from './types';
import { EXIT_OK, EXIT_RUNTIME } from './types';
import { startLoopbackServer } from '../auth/loopback-server';
import { decodeSessionToken, saveSession } from '../auth/token-store';
import { openBrowser } from '../util/open';
import { resolveConfig } from '../config';
import { info, success, error, dim } from '../ui/output';

export const loginCommand: Command = {
	async run(ctx): Promise<number> {
		const { baseUrl } = resolveConfig(ctx.options);
		const server = await startLoopbackServer();
		const url = `${baseUrl}/api/auth/cli/login?port=${server.port}&state=${server.cliState}`;

		info('Opening your browser to sign in with GitHub…');
		info(dim(`If it doesn't open, paste this URL:\n  ${url}`));
		void openBrowser(url);

		try {
			const { token } = await server.waitForToken();
			const decoded = decodeSessionToken(token);
			if (!decoded) {
				error('Received an invalid session token.');
				return EXIT_RUNTIME;
			}
			saveSession({
				token,
				username: decoded.username,
				githubId: decoded.githubId,
				savedAt: Date.now()
			});
			success(`Signed in as ${decoded.username}.`);
			return EXIT_OK;
		} catch (err) {
			server.close();
			error(`Login failed: ${(err as Error).message}`);
			return EXIT_RUNTIME;
		}
	}
};
