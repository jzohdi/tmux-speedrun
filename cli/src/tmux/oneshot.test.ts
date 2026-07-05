/**
 * ONESHOT completeness net (invariant OS1 — issue #45 R2, plan §8.1,
 * interface §10-R2): every pool command's step must be completable by
 * performing ANY ONE of its documented input forms exactly once, from any
 * reachable run state — including the minimal state (1 session, 1 window,
 * 1 pane, attached, 0 buffers).
 *
 * This test parses every `TMUX_COMMANDS.shortcut` string and asserts each
 * documented input form is covered by a write-first channel:
 *  - a `KEY_REBINDS` entry (prefix keys),
 *  - a `COMMAND_ALIASES` name (typed forms), or
 *  - an EXPLICIT named exemption with a guaranteed non-input channel.
 * Silent skips are forbidden: an unparseable form fails the test, so a
 * future pool command added without a detection channel fails CI instead of
 * shipping an unwinnable step.
 *
 * (The copy-paste sequence step is a documented multi-action procedure and
 * is not a TMUX_COMMANDS entry, so it needs no exemption here — OS1 exempts
 * it by design.)
 */

import { describe, expect, it } from 'vitest';
// Relative import, not `$lib`: the root vitest `server` project resolves
// `$lib` through the SvelteKit plugin, but this file must also work under a
// bare vitest invocation where only real paths resolve. (tsup aliases `$lib`
// at build time only — tests never go through tsup.)
import { TMUX_COMMANDS } from '../../../src/lib/data/tmux-commands';
import * as configModule from './config';

type KeyRebind = { key: string; repeat?: boolean; events: readonly string[]; command: string };
type CommandAlias = { names: readonly string[]; events: readonly string[]; command: string };

const { KEY_REBINDS, COMMAND_ALIASES } = configModule as unknown as {
	KEY_REBINDS?: readonly KeyRebind[];
	COMMAND_ALIASES?: readonly CommandAlias[];
};

/** bind-key key specs are written quoted in the conf ("';'"); normalize for lookups. */
const bareKey = (key: string) => key.replace(/^'(.*)'$/, '$1');

type ParsedForm =
	| { source: string; kind: 'key'; keys: string[] }
	| { source: string; kind: 'typed'; word: string };

/**
 * Tolerant parser for the heterogeneous shortcut formats in
 * `src/lib/data/tmux-commands.ts`: 'prefix + <0-9>', 'prefix + { or }',
 * 'prefix + Ctrl+o', 'prefix + Arrow', 'prefix + ,' (note: the comma IS the
 * key), 'tmux ls, tmux list-sessions', bare typed forms with '<arg>'
 * placeholders. Returns an error string when a form cannot be classified —
 * the caller must FAIL on it, never skip it.
 */
function parseShortcut(shortcut: string): ParsedForm[] | string {
	// Split on ', ' (comma-space), not ',': 'prefix + ,' documents the comma key.
	const forms = shortcut
		.split(', ')
		.map((f) => f.trim())
		.filter(Boolean);
	if (forms.length === 0) return `no input forms in '${shortcut}'`;

	const parsed: ParsedForm[] = [];
	for (const form of forms) {
		const prefixMatch = form.match(/^prefix \+ (.+)$/);
		if (prefixMatch) {
			const spec = prefixMatch[1].trim();
			let keys: string[] | null = null;
			if (spec === '<0-9>') keys = '0123456789'.split('');
			else if (spec === '{ or }') keys = ['{', '}'];
			else if (spec === 'Ctrl+o') keys = ['C-o'];
			else if (spec === 'Arrow') keys = ['Up', 'Down', 'Left', 'Right'];
			else if (/^\S$/.test(spec)) keys = [spec];
			if (!keys) return `unparseable key spec '${spec}' in '${shortcut}'`;
			parsed.push({ source: form, kind: 'key', keys });
			continue;
		}
		// Typed forms: 'tmux <command> …' or a bare '<command> …'.
		const typedMatch = form.match(/^(?:tmux )?([A-Za-z][A-Za-z-]*)(?:\s|$)/);
		if (typedMatch) {
			parsed.push({ source: form, kind: 'typed', word: typedMatch[1] });
			continue;
		}
		return `unparseable form '${form}' in '${shortcut}'`;
	}
	return parsed;
}

/**
 * Explicit named exemptions (interface §10-R2 — each with its guaranteed
 * channel). Anything not listed here MUST have a rebind/alias.
 */
const KEY_EXEMPTIONS: Record<string, string> = {
	d: 'detach — client-detached notification (run-loop drain classifies the exit)',
	c: 'new-window — always performable from minimal state; state-diff channel',
	'"': 'split-horizontal — state-diff channel',
	'%': 'split-vertical — state-diff channel',
	x: 'kill-pane — state-diff / cascade channel (recovers via the run loop)',
	'&': 'kill-window — state-diff / cascade channel (recovers via the run loop)',
	'[': 'copy-mode — enteredCopyMode state channel',
	',': 'rename-window — renamedWindow state channel',
	$: 'rename-session — renamedSession state channel'
};

const TYPED_EXEMPTIONS: Record<string, string> = {
	'kill-server': 'SERVER_DIED_EVENT synthesized by the run loop when the server dies'
};

describe('ONESHOT completeness — every documented input form has a channel (OS1, plan §8.5)', () => {
	it('covers every TMUX_COMMANDS shortcut form via KEY_REBINDS, COMMAND_ALIASES, or a named exemption', () => {
		expect(KEY_REBINDS, 'config.ts must export KEY_REBINDS (R2)').toBeDefined();
		expect(COMMAND_ALIASES, 'config.ts must export COMMAND_ALIASES (R2)').toBeDefined();

		const keyCovered = new Set((KEY_REBINDS ?? []).map((r) => bareKey(r.key)));
		const typedCovered = new Set((COMMAND_ALIASES ?? []).flatMap((a) => [...a.names]));

		const problems: string[] = [];
		for (const cmd of TMUX_COMMANDS) {
			const parsed = parseShortcut(cmd.shortcut);
			if (typeof parsed === 'string') {
				problems.push(`${cmd.name}: ${parsed}`);
				continue;
			}
			for (const form of parsed) {
				if (form.kind === 'key') {
					for (const key of form.keys) {
						if (!keyCovered.has(key) && !(key in KEY_EXEMPTIONS)) {
							problems.push(
								`${cmd.name}: key '${key}' (${form.source}) has no write-first rebind and no exemption`
							);
						}
					}
				} else if (!typedCovered.has(form.word) && !(form.word in TYPED_EXEMPTIONS)) {
					problems.push(
						`${cmd.name}: typed form '${form.word}' (${form.source}) has no alias interceptor and no exemption`
					);
				}
			}
		}
		expect(problems, `ONESHOT coverage gaps:\n${problems.join('\n')}`).toEqual([]);
	});

	it('every command contributes at least one parseable input form (no vacuous coverage)', () => {
		for (const cmd of TMUX_COMMANDS) {
			const parsed = parseShortcut(cmd.shortcut);
			expect(
				typeof parsed !== 'string' && parsed.length > 0,
				`${cmd.name}: '${cmd.shortcut}' produced no parsed forms${typeof parsed === 'string' ? ` (${parsed})` : ''}`
			).toBe(true);
		}
	});

	it('the exemption lists only name forms that are actually documented (no stale exemptions)', () => {
		const allKeys = new Set<string>();
		const allWords = new Set<string>();
		for (const cmd of TMUX_COMMANDS) {
			const parsed = parseShortcut(cmd.shortcut);
			if (typeof parsed === 'string') continue; // the coverage test reports these
			for (const form of parsed) {
				if (form.kind === 'key') form.keys.forEach((k) => allKeys.add(k));
				else allWords.add(form.word);
			}
		}
		for (const key of Object.keys(KEY_EXEMPTIONS)) {
			expect(allKeys.has(key), `stale key exemption '${key}' — no command documents it`).toBe(
				true
			);
		}
		for (const word of Object.keys(TYPED_EXEMPTIONS)) {
			expect(
				allWords.has(word),
				`stale typed exemption '${word}' — no command documents it`
			).toBe(true);
		}
	});
});
