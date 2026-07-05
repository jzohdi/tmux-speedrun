/**
 * Action detection: observed StateDelta → candidate canonical answer strings.
 *
 * Issue #35 interface §7 / issue #45 interface §5 (invariant DET1: pure &
 * deterministic over (delta, step)). Trial-decrypt is the correctness
 * authority, so the detector only needs to *include* the right candidate —
 * ambiguous deltas emit ALL plausible candidates and the key-chain filters
 * them. Issue #45 adds a command-event table over `delta.commandEvents` (the
 * observer's sink tail), so actions with no state footprint — selecting the
 * already-active window, detaching, listing — are detectable.
 *
 * Canonical answer forms (from `generator.ts` + `tmux-copy-sequence.ts`):
 *  - simple command → bare `cmd.name` (e.g. `split-vertical`, `kill-session`)
 *  - input command  → `${cmd.name}:${requiredInput}` (e.g. `rename-window:x`)
 *  - copy-paste step → `copy-paste-sequence:${seedInput}`
 */

import type { DecryptedStep } from '$lib/client/challenge-core';
import type { PaneInfo, StateDelta } from '../engine/types';
import { ZOOM_KEY_EVENT } from './config';

/** Synthetic event injected by the run loop when the private server died during an attach. */
export const SERVER_DIED_EVENT = 'speedrun-server-died';

/**
 * Sink event → candidate canonical answers (issue #45 interface §5.1).
 * Events without an entry (session-closed, window-renamed, …) are triggers
 * only. Over-emission is safe; the key chain filters.
 */
const EVENT_CANDIDATES: Record<string, readonly string[]> = {
	'after-select-window': ['select-window'],
	'after-next-window': ['next-window'],
	'after-previous-window': ['previous-window'],
	'after-last-window': ['last-window'],
	'after-select-pane': ['select-pane', 'last-pane'],
	'after-last-pane': ['last-pane'],
	'after-list-sessions': ['list-sessions'],
	'after-list-windows': ['list-windows'],
	'after-choose-tree': ['list-windows', 'list-sessions'],
	'after-list-keys': ['list-keys'],
	'after-list-buffers': ['list-buffers'],
	'after-show-buffer': ['show-buffer'],
	'after-delete-buffer': ['delete-buffer'],
	'after-capture-pane': ['capture-pane'],
	'after-paste-buffer': ['paste-buffer'],
	'after-copy-mode': ['copy-mode'],
	'after-clock-mode': ['show-time'],
	'after-display-panes': ['display-panes'],
	'after-command-prompt': ['command-prompt'],
	'after-source-file': ['reload-config'],
	'after-split-window': ['split-vertical', 'split-horizontal'],
	'after-new-window': ['new-window'],
	'after-new-session': ['new-session'],
	'after-break-pane': ['break-pane'],
	'after-join-pane': ['join-pane'],
	'after-swap-pane': ['swap-pane'],
	'after-swap-window': ['swap-window'],
	'after-rotate-window': ['rotate-panes'],
	'after-kill-pane': ['kill-pane'],
	'after-kill-window': ['kill-window'],
	'after-kill-session': ['kill-session'],
	// Bare rename candidates satisfy practice drills (which match on the bare
	// command name); challenge answers are always `rename-*:<text>`, so the
	// bare form is inert over-emission there.
	'after-rename-window': ['rename-window'],
	'after-rename-session': ['rename-session'],
	'client-detached': ['detach'],
	'client-attached': ['attach-session'],
	'after-attach-session': ['attach-session'],
	'after-switch-client': ['attach-session', 'next-session', 'previous-session'],
	[SERVER_DIED_EVENT]: ['kill-server', 'kill-session'],
	[ZOOM_KEY_EVENT]: ['toggle-zoom']
};

/**
 * When one of these events is present, the delta's window-nav classification
 * comes from the events alone: the generic activeWindowChanged multi-candidate
 * set would re-introduce `select-window` for a next/previous/last movement and
 * erase the targeted-vs-generic distinction (issue #45 defect 2). The config
 * guarantees every window-nav input path (keys AND typed forms) produces one
 * of these events; the state-diff set stays as the no-events safety net.
 */
const WINDOW_NAV_EVENTS = [
	'after-select-window',
	'after-next-window',
	'after-previous-window',
	'after-last-window'
];

/** True when `added` sits to the right of some existing pane (same row). */
function isVerticalSplit(added: PaneInfo, panes: PaneInfo[]): boolean {
	return panes.some((p) => p.paneId !== added.paneId && added.left > p.left && added.top === p.top);
}

/** True when `added` sits below some existing pane (same column). */
function isHorizontalSplit(added: PaneInfo, panes: PaneInfo[]): boolean {
	return panes.some((p) => p.paneId !== added.paneId && added.top > p.top && added.left === p.left);
}

export function deriveCandidates(delta: StateDelta, step: DecryptedStep): string[] {
	const candidates: string[] = [];
	const add = (c: string) => {
		if (!candidates.includes(c)) candidates.push(c);
	};

	const commandEvents = delta.commandEvents ?? [];
	const movedPanes = delta.movedPanes ?? [];

	// --- Command events (issue #45, §5.1) -------------------------------------
	for (const event of commandEvents) {
		for (const candidate of EVENT_CANDIDATES[event] ?? []) add(candidate);
	}

	// --- Copy-paste step (uses the server-delivered seed text) ---------------
	if (step.seedInput !== undefined && (delta.pasteObserved || delta.bufferAdded !== undefined)) {
		add(`copy-paste-sequence:${step.seedInput}`);
	}

	// --- Rename commands: the input form only for a rename TO the required
	// text; the bare form (practice matching) for any observed rename ---------
	if (delta.renamedWindow) {
		add('rename-window');
		if (step.requiredInput !== undefined && delta.renamedWindow.to === step.requiredInput) {
			add(`rename-window:${step.requiredInput}`);
		}
	}
	if (delta.renamedSession) {
		add('rename-session');
		if (step.requiredInput !== undefined && delta.renamedSession.to === step.requiredInput) {
			add(`rename-session:${step.requiredInput}`);
		}
	}

	// --- Session-level structural changes ------------------------------------
	if (delta.sessionCountDelta > 0) {
		add('new-session');
	}
	if (delta.sessionCountDelta < 0) {
		// A killed session cascades into its windows and panes; with
		// `exit-empty off` an EMPTY live server means the last session was
		// killed OR the server was killed — emit both, the key chain decides.
		add('kill-session');
		add('kill-window');
		add('kill-pane');
		if (delta.next.sessions.length === 0) add('kill-server');
	}

	// --- Pane splits (only meaningful when a pane was added) -----------------
	for (const added of delta.addedPanes) {
		if (isVerticalSplit(added, delta.next.panes)) add('split-vertical');
		if (isHorizontalSplit(added, delta.next.panes)) add('split-horizontal');
	}

	// --- Window / pane count changes (no new session) ------------------------
	if (delta.sessionCountDelta === 0) {
		if (delta.windowCountDelta > 0) {
			// A new window; a pane that left its source window means break-pane.
			add('new-window');
			add('break-pane');
		}
		if (delta.windowCountDelta < 0) {
			add('kill-window');
		}
		if (delta.windowCountDelta === 0 && delta.paneCountDelta < 0) {
			add('kill-pane');
		}
	}

	// A pane appeared while another window lost/closed one → join-pane.
	if (delta.paneCountDelta > 0 && delta.windowCountDelta <= 0 && delta.removedPaneIds.length > 0) {
		add('join-pane');
	}

	// A pane that MOVED between windows (ids stable, no count change).
	if (movedPanes.length > 0) {
		add('join-pane');
		add('swap-pane');
		add('swap-window');
		if (delta.windowCountDelta > 0) add('break-pane');
	}

	// --- Navigation (intentionally ambiguous → multi-candidate) --------------
	if (delta.activePaneChanged) {
		add('select-pane');
		add('last-pane');
	}
	const hasWindowNavEvent = WINDOW_NAV_EVENTS.some((e) => commandEvents.includes(e));
	if (delta.activeWindowChanged && !hasWindowNavEvent) {
		add('select-window');
		add('next-window');
		add('previous-window');
		add('last-window');
	}
	if (delta.activeSessionChanged) {
		add('next-session');
		add('previous-session');
	}

	// --- Pane modes -----------------------------------------------------------
	if (delta.zoomToggled) add('toggle-zoom');
	if (delta.enteredCopyMode) add('copy-mode');
	if (delta.enteredMode === 'clock-mode') add('show-time');
	if (delta.enteredMode === 'tree-mode') {
		add('list-windows');
		add('list-sessions');
	}

	// --- Buffers ---------------------------------------------------------------
	if (delta.bufferAdded !== undefined) {
		add('paste-buffer');
		add('capture-pane');
		add('show-buffer');
		add('list-buffers');
	}
	if (delta.bufferRemoved) add('delete-buffer');

	return candidates;
}
