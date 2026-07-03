/**
 * Open a URL in the user's default browser (issue #35, plan §3.1).
 *
 * A tiny cross-platform shim (macOS `open`, Windows `start`, Linux `xdg-open`)
 * so we avoid a runtime dependency. Best-effort — resolves even if the launcher
 * fails (the caller also prints the URL to paste manually).
 */

import { spawn } from 'node:child_process';

export function openBrowser(url: string): Promise<void> {
	return new Promise((resolve) => {
		let command: string;
		let args: string[];

		switch (process.platform) {
			case 'darwin':
				command = 'open';
				args = [url];
				break;
			case 'win32':
				command = 'cmd';
				args = ['/c', 'start', '""', url];
				break;
			default:
				command = 'xdg-open';
				args = [url];
		}

		try {
			const child = spawn(command, args, { stdio: 'ignore', detached: true });
			child.on('error', () => resolve());
			child.unref();
			resolve();
		} catch {
			resolve();
		}
	});
}
