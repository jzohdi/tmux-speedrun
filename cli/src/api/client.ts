/**
 * CLI API client: fetch wrapper + in-memory cookie jar (issue #35, interface §2.2).
 *
 * Carries the httpOnly challenge/pending cookies across requests via the jar,
 * and — when a session token is set — sends `Cookie: tmux_session=<token>` so
 * `finish`/`record` resolve `locals.user` server-side with no server change.
 */

import { CookieJar } from './cookie-jar';
import { SESSION_COOKIE_NAME } from './constants';

export type ApiClientOptions = { baseUrl: string; jar?: CookieJar; sessionToken?: string };

export class ApiError extends Error {
	readonly status: number;
	readonly serverMessage?: string;

	constructor(status: number, message: string, serverMessage?: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.serverMessage = serverMessage;
	}
}

export class ApiClient {
	readonly jar: CookieJar;
	private baseUrl: string;
	private sessionToken?: string;

	constructor(opts: ApiClientOptions) {
		this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
		this.jar = opts.jar ?? new CookieJar();
		this.sessionToken = opts.sessionToken;
	}

	/** Set/replace the bearer session token (seeds tmux_session on each request). */
	setSessionToken(token: string | undefined): void {
		this.sessionToken = token;
	}

	private cookieHeader(): string | undefined {
		const parts: string[] = [];
		const jarHeader = this.jar.header();
		if (jarHeader) parts.push(jarHeader);
		// Only add the session cookie if the jar isn't already carrying one.
		if (this.sessionToken && !this.jar.get(SESSION_COOKIE_NAME)) {
			parts.push(`${SESSION_COOKIE_NAME}=${this.sessionToken}`);
		}
		return parts.length > 0 ? parts.join('; ') : undefined;
	}

	private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
		const headers: Record<string, string> = {};
		const cookie = this.cookieHeader();
		if (cookie) headers['Cookie'] = cookie;
		if (body !== undefined) headers['Content-Type'] = 'application/json';

		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});

		this.jar.storeFromResponse(res);

		const text = await res.text();
		let parsed: unknown;
		try {
			parsed = text ? JSON.parse(text) : undefined;
		} catch {
			parsed = undefined;
		}

		if (!res.ok) {
			const serverMessage =
				parsed && typeof parsed === 'object' && 'message' in parsed
					? String((parsed as { message: unknown }).message)
					: undefined;
			throw new ApiError(
				res.status,
				serverMessage ?? `Request failed: ${res.status}`,
				serverMessage
			);
		}

		return parsed as T;
	}

	postJson<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('POST', path, body);
	}

	getJson<T>(path: string): Promise<T> {
		return this.request<T>('GET', path);
	}
}
