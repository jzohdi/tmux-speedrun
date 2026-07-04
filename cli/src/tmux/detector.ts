/**
 * Action detection: observed StateDelta → candidate canonical answer strings.
 *
 * Issue #35, interface §7 (invariant DET1: pure & deterministic over
 * (delta, step)). Trial-decrypt is the correctness authority, so the detector
 * only needs to *include* the right candidate — ambiguous deltas emit ALL
 * plausible candidates and the key-chain filters them.
 *
 * Canonical answer forms (from `generator.ts` + `tmux-copy-sequence.ts`):
 *  - simple command → bare `cmd.name` (e.g. `split-vertical`, `kill-session`)
 *  - input command  → `${cmd.name}:${requiredInput}` (e.g. `rename-window:x`)
 *  - copy-paste step → `copy-paste-sequence:${seedInput}`
 */

import type { DecryptedStep } from '$lib/client/challenge-core';
import type { PaneInfo, StateDelta } from '../engine/types';

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

	// --- Copy-paste step (uses the server-delivered seed text) ---------------
	if (step.seedInput !== undefined && (delta.pasteObserved || delta.bufferAdded !== undefined)) {
		add(`copy-paste-sequence:${step.seedInput}`);
	}

	// --- Rename (input) commands use step.requiredInput ----------------------
	if (delta.renamedWindow && step.requiredInput !== undefined) {
		add(`rename-window:${step.requiredInput}`);
	}
	if (delta.renamedSession && step.requiredInput !== undefined) {
		add(`rename-session:${step.requiredInput}`);
	}

	// --- Session-level structural changes ------------------------------------
	if (delta.sessionCountDelta > 0) {
		add('new-session');
	}
	if (delta.sessionCountDelta < 0) {
		// All sessions gone → the whole server was killed; otherwise one session.
		if (delta.next.sessions.length === 0) {
			add('kill-server');
		} else {
			add('kill-session');
		}
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

	// --- Navigation (intentionally ambiguous → multi-candidate) --------------
	if (delta.activePaneChanged) {
		add('select-pane');
		add('last-pane');
	}
	if (delta.activeWindowChanged) {
		add('select-window');
		add('next-window');
		add('previous-window');
		add('last-window');
	}
	if (delta.activeSessionChanged) {
		add('next-session');
		add('previous-session');
	}

	// --- Flags & buffers -----------------------------------------------------
	if (delta.zoomToggled) add('toggle-zoom');
	if (delta.enteredCopyMode) add('copy-mode');
	if (delta.bufferAdded !== undefined) {
		add('paste-buffer');
		add('capture-pane');
		add('show-buffer');
		add('list-buffers');
	}
	if (delta.bufferRemoved) add('delete-buffer');

	return candidates;
}
