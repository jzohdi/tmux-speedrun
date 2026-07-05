/**
 * State observation (issue #35 §6.2; issue #45 interface §4).
 *
 * Queries the isolated tmux server for `TmuxState` snapshots and diffs them
 * into `StateDelta`s. Issue #45 turns the event sink into a real channel: the
 * observer tails it by byte offset, filters runner-origin lines through a
 * suppression queue (invariant SUP1), and surfaces the surviving event names
 * as `delta.commandEvents` — so actions with no state footprint (e.g.
 * selecting the already-active window) are still observable. The run loop's
 * recovery boundary is `resetBaseline()` (nothing before it can produce a
 * delta) and its exit classification is `drainDelta()`.
 */

import { statSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import type { IsolatedTmuxServer } from './server';
import type { TmuxResult } from './client';
import type { PaneInfo, StateDelta, TmuxState } from '../engine/types';
import { expectedSinkEventsFor } from './config';

const PANE_FORMAT = [
	'#{session_name}',
	'#{window_index}',
	'#{window_name}',
	'#{window_active}',
	'#{pane_id}',
	'#{pane_active}',
	'#{pane_left}',
	'#{pane_top}',
	'#{pane_width}',
	'#{pane_height}',
	'#{window_zoomed_flag}',
	'#{pane_in_mode}',
	'#{pane_mode}'
].join('\t');

/** How long a suppression entry may wait for its sink line (run-shell is async). */
const SUPPRESSION_TTL_MS = 2000;
const SUPPRESSION_QUEUE_CAP = 256;

const EMPTY_STATE: TmuxState = Object.freeze({
	sessions: [],
	windows: [],
	panes: [],
	activePaneId: null,
	activeWindow: null,
	buffers: []
});

function parsePanes(stdout: string): PaneInfo[] {
	const panes: PaneInfo[] = [];
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		const f = line.split('\t');
		if (f.length < 12) continue;
		panes.push({
			sessionName: f[0],
			windowIndex: Number(f[1]),
			windowName: f[2],
			paneId: f[4],
			active: f[5] === '1',
			left: Number(f[6]),
			top: Number(f[7]),
			width: Number(f[8]),
			height: Number(f[9]),
			zoomed: f[10] === '1',
			// pane_in_mode counts clients in tree mode ("2") — any non-zero is in a mode.
			inMode: Number(f[11]) > 0,
			mode: f[12] ? f[12] : null
		});
	}
	return panes;
}

type SuppressionEntry = { event: string; expiresAt: number };

export class TmuxObserver {
	/** Shared baseline for watch ticks, resetBaseline and drainDelta (§4.1). */
	private baseline: TmuxState | null = null;
	/** Last successful snapshot, so a dead-server drain still has a meaningful prev. */
	private lastKnown: TmuxState | null = null;
	private sinkOffset = 0;
	private suppression: SuppressionEntry[] = [];
	/** Filtered user events read from the sink but not yet attached to a delta. */
	private pendingEvents: string[] = [];

	constructor(private server: IsolatedTmuxServer) {
		try {
			// Pre-run sink lines (e.g. the initial new-session's hooks) are never read.
			this.sinkOffset = statSync(server.eventSink).size;
		} catch {
			this.sinkOffset = 0;
		}
	}

	/**
	 * Accounted exec (SUP1): pushes the sink events this exec will cause onto
	 * the suppression queue, then delegates. EVERY runner-origin exec that can
	 * fire an installed hook while a run is live must go through this.
	 */
	exec(args: string[]): Promise<TmuxResult> {
		this.expectEvents(expectedSinkEventsFor(args, this.server.liveHooks));
		return this.server.exec(args);
	}

	/**
	 * Suppression accounting without executing anything — for runner-origin
	 * actions that fire hooks but are not observer execs (e.g. the run loop's
	 * first spawned attach client).
	 */
	expectEvents(events: string[]): void {
		const expiresAt = Date.now() + SUPPRESSION_TTL_MS;
		for (const event of events) {
			this.suppression.push({ event, expiresAt });
		}
		if (this.suppression.length > SUPPRESSION_QUEUE_CAP) {
			this.suppression.splice(0, this.suppression.length - SUPPRESSION_QUEUE_CAP);
		}
	}

	async snapshot(): Promise<TmuxState> {
		const [sessRes, paneRes, bufRes] = await Promise.all([
			this.exec(['list-sessions', '-F', '#{session_name}\t#{session_attached}']),
			this.exec(['list-panes', '-a', '-F', PANE_FORMAT]),
			this.exec(['list-buffers', '-F', '#{buffer_name}'])
		]);

		const sessions = sessRes.stdout
			.split('\n')
			.map((l) => l.split('\t')[0])
			.filter(Boolean);

		const panes = parsePanes(paneRes.stdout);

		const windowsMap = new Map<
			string,
			{ session: string; index: number; name: string; active: boolean }
		>();
		for (const p of panes) {
			const key = `${p.sessionName}:${p.windowIndex}`;
			if (!windowsMap.has(key)) {
				windowsMap.set(key, {
					session: p.sessionName,
					index: p.windowIndex,
					name: p.windowName,
					active: false
				});
			}
		}
		const windows = Array.from(windowsMap.values());

		const activePane = panes.find((p) => p.active) ?? null;
		const activePaneId = activePane?.paneId ?? null;
		const activeWindow = activePane
			? { session: activePane.sessionName, index: activePane.windowIndex }
			: null;

		const buffers = bufRes.stdout
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);

		let topBufferSample: string | undefined;
		if (buffers.length > 0) {
			const show = await this.exec(['show-buffer']);
			if (show.code === 0) topBufferSample = show.stdout;
		}

		return { sessions, windows, panes, activePaneId, activeWindow, buffers, topBufferSample };
	}

	/** Pure diff of two snapshots into a StateDelta. */
	diff(
		prev: TmuxState,
		next: TmuxState,
		ctx?: { seedInput?: string; commandEvents?: string[] }
	): StateDelta {
		const prevPaneIds = new Set(prev.panes.map((p) => p.paneId));
		const nextPaneIds = new Set(next.panes.map((p) => p.paneId));

		const addedPanes = next.panes.filter((p) => !prevPaneIds.has(p.paneId));
		const removedPaneIds = prev.panes
			.filter((p) => !nextPaneIds.has(p.paneId))
			.map((p) => p.paneId);

		const renamedWindow = detectRename(
			prev.windows.map((w) => w.name),
			next.windows.map((w) => w.name)
		);
		const renamedSession = detectRename(prev.sessions, next.sessions);

		const prevActive = prev.panes.find((p) => p.active);
		const nextActive = next.panes.find((p) => p.active);
		const zoomToggled =
			Boolean(prevActive) && Boolean(nextActive) && prevActive!.zoomed !== nextActive!.zoomed;

		const prevInMode = new Set(prev.panes.filter((p) => p.inMode).map((p) => p.paneId));
		const enteredModePane = next.panes.find((p) => p.inMode && !prevInMode.has(p.paneId));
		const enteredMode = enteredModePane ? (enteredModePane.mode ?? undefined) : undefined;
		// Real copy mode only: clock/tree/etc. map to their own candidates. A pane
		// in a mode with no reported #{pane_mode} keeps the legacy copy-mode read.
		const enteredCopyMode =
			enteredModePane !== undefined &&
			(enteredModePane.mode === 'copy-mode' ||
				enteredModePane.mode === 'view-mode' ||
				enteredModePane.mode == null);

		const prevPaneById = new Map(prev.panes.map((p) => [p.paneId, p]));
		const movedPanes: StateDelta['movedPanes'] = [];
		for (const p of next.panes) {
			const before = prevPaneById.get(p.paneId);
			if (
				before &&
				(before.sessionName !== p.sessionName || before.windowIndex !== p.windowIndex)
			) {
				movedPanes.push({
					paneId: p.paneId,
					from: { session: before.sessionName, windowIndex: before.windowIndex },
					to: { session: p.sessionName, windowIndex: p.windowIndex }
				});
			}
		}

		const bufferAdded =
			next.buffers.length > prev.buffers.length || next.topBufferSample !== prev.topBufferSample
				? next.topBufferSample
				: undefined;
		const bufferRemoved = next.buffers.length < prev.buffers.length;

		const pasteObserved =
			ctx?.seedInput !== undefined && next.topBufferSample?.includes(ctx.seedInput) === true;

		return {
			prev,
			next,
			paneCountDelta: next.panes.length - prev.panes.length,
			sessionCountDelta: next.sessions.length - prev.sessions.length,
			windowCountDelta: next.windows.length - prev.windows.length,
			addedPanes,
			removedPaneIds,
			renamedWindow,
			renamedSession,
			activePaneChanged: (prev.activePaneId ?? null) !== (next.activePaneId ?? null),
			activeWindowChanged: JSON.stringify(prev.activeWindow) !== JSON.stringify(next.activeWindow),
			activeSessionChanged: prev.activeWindow?.session !== next.activeWindow?.session,
			zoomToggled,
			enteredCopyMode,
			bufferAdded,
			bufferRemoved,
			pasteObserved,
			commandEvents: ctx?.commandEvents ? [...ctx.commandEvents] : [],
			enteredMode,
			movedPanes
		};
	}

	/**
	 * Watch for changes: each tick tails the sink and re-snapshots, emitting a
	 * delta whenever the state changed OR a (post-suppression) command event
	 * arrived — a hook line alone is a real change (issue #45 defect 2).
	 */
	watch(
		onDelta: (d: StateDelta) => void,
		opts?: { intervalMs?: number; getSeedInput?: () => string | undefined }
	): { stop(): void } {
		let stopped = false;

		const tick = async () => {
			if (stopped) return;
			try {
				this.pendingEvents.push(...(await this.readNewSinkEvents()));
			} catch {
				// sink unreadable — retry next tick
			}
			try {
				const next = await this.snapshot();
				if (stopped) return;
				if (this.baseline) {
					const commandEvents = this.pendingEvents.splice(0);
					const d = this.diff(this.baseline, next, {
						commandEvents,
						seedInput: opts?.getSeedInput?.()
					});
					this.baseline = next;
					this.lastKnown = next;
					if (hasChange(d)) onDelta(d);
				} else {
					this.baseline = next;
					this.lastKnown = next;
				}
			} catch {
				// transient tmux error (or dead server) — keep pending events, retry
			}
		};

		const timer = setInterval(tick, opts?.intervalMs ?? 150);
		void tick();

		return {
			stop() {
				stopped = true;
				clearInterval(timer);
			}
		};
	}

	/**
	 * Recovery boundary: wait for straggling async run-shell writes, discard
	 * unread sink lines, clear the suppression queue, and re-baseline. After
	 * this only actions performed from now on can produce deltas. Never throws.
	 */
	async resetBaseline(opts?: { settleMs?: number }): Promise<void> {
		await sleep(opts?.settleMs ?? 300);
		try {
			this.sinkOffset = (await stat(this.server.eventSink)).size;
		} catch {
			// missing sink — keep the current offset
		}
		this.suppression = [];
		this.pendingEvents = [];
		try {
			const next = await this.snapshot();
			this.baseline = next;
			this.lastKnown = next;
		} catch {
			this.baseline = EMPTY_STATE;
		}
	}

	/**
	 * Exit-classification read for the run loop: settle, read remaining sink
	 * lines (suppression-filtered), append synthetic extraEvents (NOT
	 * filtered), snapshot (EMPTY_STATE when the server is dead), diff against
	 * the baseline and advance it. Returns the delta even when nothing changed.
	 * Never throws.
	 */
	async drainDelta(opts?: {
		settleMs?: number;
		extraEvents?: string[];
		seedInput?: string;
	}): Promise<StateDelta> {
		await sleep(opts?.settleMs ?? 300);
		let events = this.pendingEvents.splice(0);
		try {
			events = events.concat(await this.readNewSinkEvents());
		} catch {
			// sink unreadable — classify from state alone
		}
		events = events.concat(opts?.extraEvents ?? []);

		let next: TmuxState;
		try {
			next = await this.snapshot();
		} catch {
			next = EMPTY_STATE;
		}
		const prev = this.baseline ?? this.lastKnown ?? EMPTY_STATE;
		const delta = this.diff(prev, next, { commandEvents: events, seedInput: opts?.seedInput });
		this.baseline = next;
		if (next !== EMPTY_STATE) this.lastKnown = next;
		return delta;
	}

	/**
	 * Read new complete sink lines from the tracked byte offset, apply the
	 * suppression filter, and return the surviving user events (§4.2–§4.3).
	 * A trailing partial line is left for the next read.
	 */
	private async readNewSinkEvents(): Promise<string[]> {
		const size = (await stat(this.server.eventSink)).size;
		if (size < this.sinkOffset) this.sinkOffset = size; // truncated — resync
		if (size === this.sinkOffset) return [];

		const handle = await open(this.server.eventSink, 'r');
		let chunk: string;
		try {
			const length = size - this.sinkOffset;
			const buffer = Buffer.alloc(length);
			const { bytesRead } = await handle.read(buffer, 0, length, this.sinkOffset);
			chunk = buffer.subarray(0, bytesRead).toString('utf8');
		} finally {
			await handle.close();
		}

		const lastNewline = chunk.lastIndexOf('\n');
		if (lastNewline === -1) return [];
		const consumed = chunk.slice(0, lastNewline + 1);
		this.sinkOffset += Buffer.byteLength(consumed, 'utf8');

		const now = Date.now();
		this.suppression = this.suppression.filter((e) => e.expiresAt > now);

		const kept: string[] = [];
		for (const raw of consumed.split('\n')) {
			const line = raw.trim();
			if (!line) continue;
			const matchIndex = this.suppression.findIndex((e) => e.event === line);
			if (matchIndex !== -1) {
				this.suppression.splice(matchIndex, 1); // oldest matching entry
				continue;
			}
			kept.push(line);
		}
		return kept;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A single rename among an otherwise-stable name set → { from, to }. */
function detectRename(prev: string[], next: string[]): { from: string; to: string } | undefined {
	if (prev.length !== next.length) return undefined;
	const removed = prev.filter((n) => !next.includes(n));
	const added = next.filter((n) => !prev.includes(n));
	if (removed.length === 1 && added.length === 1) {
		return { from: removed[0], to: added[0] };
	}
	return undefined;
}

function hasChange(d: StateDelta): boolean {
	return (
		d.paneCountDelta !== 0 ||
		d.sessionCountDelta !== 0 ||
		d.windowCountDelta !== 0 ||
		d.addedPanes.length > 0 ||
		d.removedPaneIds.length > 0 ||
		Boolean(d.renamedWindow) ||
		Boolean(d.renamedSession) ||
		d.activePaneChanged ||
		d.activeWindowChanged ||
		d.activeSessionChanged ||
		d.zoomToggled ||
		d.enteredCopyMode ||
		d.enteredMode !== undefined ||
		d.bufferAdded !== undefined ||
		d.bufferRemoved ||
		d.pasteObserved === true ||
		d.commandEvents.length > 0 ||
		d.movedPanes.length > 0
	);
}
