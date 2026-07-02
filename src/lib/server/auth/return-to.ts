/**
 * OAuth `return_to` open-redirect guard (iteration 2 — PR #36 feedback).
 *
 * To make login-after-finish seamless, the login route accepts a `return_to`
 * path and the callback redirects there. That value must be constrained to a
 * same-origin *local path* — never an absolute URL or a scheme — or it becomes
 * an open redirect. See `.agent/interface.md` §I3 / §I0.5.
 */

/** True if the string contains any ASCII control char (<= 0x20) or DEL (0x7F). */
function hasUnsafeChar(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x20 || code === 0x7f) return true;
	}
	return false;
}

/**
 * Sanitize an OAuth `return_to` value. Returns the path only when it is a safe,
 * same-origin local path; otherwise null.
 *
 * Accept: starts with a single '/', is not '//' or '/\', contains no scheme (no
 *   ':'), no backslashes, no whitespace/control chars. Reject everything else.
 * Callers fall back to a default ('/?signed_in=1') when this returns null.
 */
export function sanitizeReturnPath(raw: string | null | undefined): string | null {
	if (!raw) return null;

	// Must be a root-relative path.
	if (!raw.startsWith('/')) return null;

	// Reject protocol-relative ('//host') and backslash-smuggled ('/\host') hosts.
	if (raw.startsWith('//') || raw.startsWith('/\\')) return null;

	// No scheme (':'), no backslashes anywhere.
	if (raw.includes(':') || raw.includes('\\')) return null;

	// No whitespace or control characters.
	if (hasUnsafeChar(raw)) return null;

	return raw;
}
