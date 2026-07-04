/**
 * In-memory cookie jar for one CLI command run.
 *
 * Carries the httpOnly challenge/pending cookies (`tmux_challenge_session`,
 * `tmux_pending_result`) across start/finish/record with no server change
 * (issue #35, interface §2.1). Memory only; never persisted.
 *
 * The `httpOnly` flag only blocks browser JS, not an HTTP client — so reading
 * `Set-Cookie` and replaying it as a `Cookie` header carries the whole session.
 */

export type StoredCookie = { name: string; value: string };

/** Attributes are ignored for matching (single-origin client); we only care
 *  about the leading `name=value` and whether the Set-Cookie is a delete. */
function isDeleteCookie(attributes: string[]): boolean {
	for (const attr of attributes) {
		const [rawKey, ...rest] = attr.split('=');
		const key = rawKey.trim().toLowerCase();
		const value = rest.join('=').trim();

		if (key === 'max-age') {
			const maxAge = Number(value);
			if (Number.isFinite(maxAge) && maxAge <= 0) return true;
		}
		if (key === 'expires' && value) {
			const expires = Date.parse(value);
			if (Number.isFinite(expires) && expires <= Date.now()) return true;
		}
	}
	return false;
}

export class CookieJar {
	private cookies = new Map<string, string>();

	/** Ingest a response's Set-Cookie headers (response.headers.getSetCookie()). */
	storeFromResponse(res: Response): void {
		// getSetCookie() is available in Node ≥ 20 and the WHATWG fetch spec.
		const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
		if (typeof getSetCookie === 'function') {
			this.storeSetCookies(getSetCookie.call(res.headers));
			return;
		}
		const single = res.headers.get('set-cookie');
		if (single) this.storeSetCookies([single]);
	}

	/** Ingest raw Set-Cookie header lines (testable entry point). */
	storeSetCookies(setCookieLines: string[]): void {
		for (const line of setCookieLines) {
			if (!line) continue;
			const parts = line.split(';');
			const first = parts[0] ?? '';
			const eq = first.indexOf('=');
			if (eq < 0) continue;

			const name = first.slice(0, eq).trim();
			const value = first.slice(eq + 1).trim();
			if (!name) continue;

			if (isDeleteCookie(parts.slice(1))) {
				this.cookies.delete(name);
			} else {
				this.cookies.set(name, value);
			}
		}
	}

	/** Serialize all live cookies as a single Cookie request-header value, or undefined if empty. */
	header(): string | undefined {
		if (this.cookies.size === 0) return undefined;
		return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ');
	}

	get(name: string): string | undefined {
		return this.cookies.get(name);
	}

	/** Manual seed (e.g. tmux_session from the token store). */
	set(name: string, value: string): void {
		this.cookies.set(name, value);
	}

	clear(): void {
		this.cookies.clear();
	}
}
