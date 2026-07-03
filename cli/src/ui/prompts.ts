/**
 * Minimal interactive prompts (issue #35). Dependency-free readline wrappers for
 * yes/no confirmations (e.g. the post-finish "Save your time?" flow).
 */

import { createInterface } from 'node:readline';

/** Ask a yes/no question on stdin; returns true for y/yes (default no). */
export function confirm(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(`${question} [y/N] `, (answer) => {
			rl.close();
			resolve(/^y(es)?$/i.test(answer.trim()));
		});
	});
}
