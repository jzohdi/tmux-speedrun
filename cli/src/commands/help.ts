/**
 * `tmux-speedrun help` — list commands (issue #35, interface §9.3).
 */

import type { Command } from './types';
import { EXIT_OK } from './types';
import { bold, cyan, dim, info } from '../ui/output';

const HELP = `${bold('tmux-speedrun')} — run tmux challenges & practice against your native tmux

${bold('Usage:')} tmux-speedrun <command> [options]

${bold('Commands:')}
  ${cyan('help')}                 Show this help
  ${cyan('login')}                Sign in with GitHub (opens your browser)
  ${cyan('logout')}               Clear the stored session
  ${cyan('whoami')}               Show the signed-in GitHub username
  ${cyan('leaderboard')} [id]     Show the leaderboard (all challenges, or one by id)
  ${cyan('practice')} [category]  Practice tmux commands offline against native tmux
  ${cyan('challenge')} <id>       Run challenge 0–5 against native tmux

${bold('Options:')}
  --server <url>   Override the API base URL (or set TMUX_SPEEDRUN_API)
  --json           Machine-readable output (leaderboard / whoami)
  --no-color       Disable coloured output
  --verbose        Extra diagnostic output
  -h, --help       Show help

${dim('Requires tmux ≥ 3.0. On Windows, run inside WSL.')}
${dim('Challenges run in a fully isolated tmux server on a private socket — your')}
${dim('real tmux sessions are never touched, and everything is torn down on exit.')}`;

export const helpCommand: Command = {
	async run(): Promise<number> {
		info(HELP);
		return EXIT_OK;
	}
};
