/**
 * State observation (issue #35, interface §6.2).
 *
 * Queries the isolated tmux server for a `TmuxState` snapshot and diffs two
 * snapshots into a `StateDelta`. Change source is (1) tmux hooks writing to the
 * event sink and (2) a poll fallback; each trigger → snapshot → diff → callback.
 * `diff` is pure and unit-testable with synthetic states.
 */

import type { IsolatedTmuxServer } from './server';
import type { PaneInfo, StateDelta, TmuxState } from '../engine/types';

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
	'#{pane_in_mode}'
].join('\t');

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
			inMode: f[11] === '1'
		});
	}
	return panes;
}

export class TmuxObserver {
	constructor(private server: IsolatedTmuxServer) {}

	async snapshot(): Promise<TmuxState> {
		const [sessRes, paneRes, bufRes] = await Promise.all([
			this.server.exec(['list-sessions', '-F', '#{session_name}\t#{session_attached}']),
			this.server.exec(['list-panes', '-a', '-F', PANE_FORMAT]),
			this.server.exec(['list-buffers', '-F', '#{buffer_name}'])
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
			const show = await this.server.exec(['show-buffer']);
			if (show.code === 0) topBufferSample = show.stdout;
		}

		return { sessions, windows, panes, activePaneId, activeWindow, buffers, topBufferSample };
	}

	/** Pure diff of two snapshots into a StateDelta. */
	diff(prev: TmuxState, next: TmuxState, ctx?: { seedInput?: string }): StateDelta {
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
		const enteredCopyMode = next.panes.some((p) => p.inMode && !prevInMode.has(p.paneId));

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
			pasteObserved
		};
	}

	/**
	 * Watch for changes: a poll loop (safety net) re-snapshots on an interval and
	 * emits a delta whenever the state changed. Hooks write to the event sink as
	 * extra triggers but the poll alone guarantees progress.
	 */
	watch(
		onDelta: (d: StateDelta) => void,
		opts?: { intervalMs?: number; seedInput?: string }
	): { stop(): void } {
		let prev: TmuxState | null = null;
		let stopped = false;

		const tick = async () => {
			if (stopped) return;
			try {
				const next = await this.snapshot();
				if (prev) {
					const d = this.diff(prev, next, { seedInput: opts?.seedInput });
					if (hasChange(d)) onDelta(d);
				}
				prev = next;
			} catch {
				// transient tmux error — ignore, retry next tick
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
		d.bufferAdded !== undefined ||
		d.bufferRemoved ||
		d.pasteObserved === true
	);
}
