/**
 * Runtime config for the CLI (issue #35, interface §10).
 *
 * baseUrl precedence: --server flag > TMUX_SPEEDRUN_API env > pinned production
 * origin. configDir: $XDG_CONFIG_HOME/tmux-speedrun or ~/.config/tmux-speedrun.
 */

import type { GlobalOptions } from './args';
import { configDir } from './auth/token-store';

export type ResolvedConfig = { baseUrl: string; configDir: string };

/**
 * Pinned production origin. Overridable via `--server <url>` or the
 * `TMUX_SPEEDRUN_API` env var (used for dev against `http://localhost:5173`).
 * Update this constant to the canonical deployment origin.
 */
export const DEFAULT_API_ORIGIN = 'https://tmux-speedrun.vercel.app';

/** Strip a trailing slash so path joins produce clean URLs. */
function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

export function resolveConfig(options: GlobalOptions): ResolvedConfig {
	const fromEnv = process.env.TMUX_SPEEDRUN_API;
	const baseUrl = trimTrailingSlash(
		options.server || (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_API_ORIGIN)
	);

	return { baseUrl, configDir: configDir() };
}
