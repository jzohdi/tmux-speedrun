/**
 * CLI loopback OAuth callback receiver (issue #35, interface §4.5).
 *
 * Binds a localhost HTTP server on 127.0.0.1:<ephemeral>; the adapted GitHub
 * callback redirects the browser here with `?token=&state=`. We verify the CSRF
 * `state`, capture the token, show a friendly close-tab page, and resolve.
 */

import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export type LoopbackResult = { token: string };

export type LoopbackServer = {
	port: number;
	cliState: string;
	/** Resolves when GET /callback?token=&state= arrives with state === cliState.
	 *  Rejects on timeout (default 300s) or state mismatch. Always closes the socket. */
	waitForToken(timeoutMs?: number): Promise<LoopbackResult>;
	close(): void;
};

const CLOSE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tmux-speedrun</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 4rem;">
<h1>✓ Signed in</h1><p>You can close this tab and return to your terminal.</p>
<script>history.replaceState(null, "", "/")</script></body></html>`;

/** URL-safe random CLI CSRF token, [A-Za-z0-9_-]{32}. */
function generateCliState(): string {
	return randomBytes(24).toString('base64url').slice(0, 32).padEnd(32, '0');
}

export function startLoopbackServer(): Promise<LoopbackServer> {
	return new Promise((resolve, reject) => {
		const cliState = generateCliState();
		let resolveToken: ((r: LoopbackResult) => void) | null = null;
		let rejectToken: ((e: Error) => void) | null = null;

		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? '/', 'http://127.0.0.1');
			if (req.method !== 'GET' || url.pathname !== '/callback') {
				res.writeHead(404).end('Not found');
				return;
			}

			const state = url.searchParams.get('state');
			const token = url.searchParams.get('token');

			if (state !== cliState || !token) {
				res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid callback');
				rejectToken?.(new Error('Loopback state mismatch or missing token'));
				return;
			}

			res.writeHead(200, { 'Content-Type': 'text/html' }).end(CLOSE_PAGE);
			resolveToken?.({ token });
		});

		server.on('error', reject);

		// Bind to loopback only — never 0.0.0.0.
		server.listen(0, '127.0.0.1', () => {
			const port = (server.address() as AddressInfo).port;

			resolve({
				port,
				cliState,
				waitForToken(timeoutMs = 300_000): Promise<LoopbackResult> {
					return new Promise<LoopbackResult>((res, rej) => {
						const timer = setTimeout(() => {
							rej(new Error('Timed out waiting for browser login'));
						}, timeoutMs);

						const settle =
							<T>(fn: (v: T) => void) =>
							(v: T) => {
								clearTimeout(timer);
								server.close();
								fn(v);
							};
						resolveToken = settle(res);
						rejectToken = settle(rej);
					});
				},
				close(): void {
					server.close();
				}
			});
		});
	});
}
