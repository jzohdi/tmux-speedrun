/**
 * Tmux State Store
 *
 * A Svelte 5 reactive store that manages the complete tmux simulation state.
 * Handles windows, panes, focus, modes, and emits signals for challenge integration.
 */

import {
	createInitialState,
	createSession,
	createWindow,
	createPane,
	findPaneById,
	collectAllPanes,
	countPanes,
	getFirstPane,
	splitPane,
	removePane,
	updatePane,
	addPaneHistory,
	clearPaneHistory,
	setPaneMode,
	setPaneInput,
	findPaneInDirection,
	getNextPane,
	getPreviousPane,
	type TmuxState,
	type TmuxSession,
	type TmuxWindow,
	type TmuxSignal,
	type TmuxSignalType,
	type PaneNode,
	type Pane,
	type PaneMode,
	type SplitDirection,
	type HistoryEntry
} from '$lib/utils/pane-tree';

import {
	executeCommand,
	type ExecuteResult,
	type CommandIdType,
	type CommandResult,
	type SessionOperation
} from '$lib/utils/tmux-commands';

function formatPaneList(panes: Pane[], focusedId: string): string {
	const currentPanes =
		typeof window !== 'undefined'
			? Array.from(document.querySelectorAll('.pane-container')).map((node) => {
					const bounds = node.getBoundingClientRect();
					return {
						width: Math.round(bounds.width),
						height: Math.round(bounds.height)
					};
				})
			: panes.map(() => ({
					width: 160,
					height: 24
				}));
	return panes
		.map((pane, index) => {
			const isActive = pane.id === focusedId;
			const activeMarker = isActive ? ' (active)' : '';
			// Format: "0: [160x24] [history 0/2000, 0 bytes] %0 (active)"
			const percentFull = Math.round((pane.history.length / 2000) * 100);
			return `${index}: [${currentPanes[index].width}x${currentPanes[index].height}] [history ${pane.history.length}/2000, 0 bytes] %${percentFull}${activeMarker}`;
		})
		.join('\n');
}

/**
 * Format a date for session list output.
 */
function formatSessionDate(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		year: 'numeric',
		hour12: false
	});
}

/**
 * Format session list output (simulates 'tmux ls' / 'tmux list-sessions').
 * Format: "0: 2 windows (created Mon Dec 29 13:37:03 2025) (attached)"
 */
function formatSessionList(sessions: TmuxSession[], attachedSessionIndex: number | null): string {
	return sessions
		.map((session, index) => {
			const windowCount = session.windows.length;
			const windowWord = windowCount === 1 ? 'window' : 'windows';
			const dateStr = formatSessionDate(session.createdAt);
			const attachedMarker = index === attachedSessionIndex ? ' (attached)' : '';

			return `${session.name}: ${windowCount} ${windowWord} (created ${dateStr})${attachedMarker}`;
		})
		.join('\n');
}

/**
 * Format window list output (simulates 'tmux lsw' / 'tmux list-windows').
 * Format: "0: bash* (1 panes) [160x48] [layout abcd] @0 (active)"
 *
 * Window flags:
 * - `*` - current window (active)
 * - `-` - last window
 */
function formatWindowList(windows: TmuxWindow[], activeWindowIndex: number): string {
	if (windows.length === 0) {
		return '';
	}

	// Get window dimensions from DOM if available, otherwise use defaults
	const isBrowser = typeof globalThis.window !== 'undefined' && typeof document !== 'undefined';
	const getDimensions = (): { width: number; height: number } => {
		if (isBrowser) {
			const container = document.querySelector('.pane-grid-container');
			if (container) {
				const bounds = container.getBoundingClientRect();
				return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
			}
		}
		return { width: 160, height: 48 };
	};

	const dimensions = getDimensions();

	return windows
		.map((tmuxWindow, index) => {
			const paneCount = countPanes(tmuxWindow.paneTree);
			const paneWord = paneCount === 1 ? 'pane' : 'panes';
			const isActive = index === activeWindowIndex;

			// Window flag: * for active, - for last (we don't track last window, so just use * for now)
			const flag = isActive ? '*' : '';

			// Layout ID (simplified - just use a hash of the window ID)
			const layoutId = tmuxWindow.id.slice(0, 4);

			// Active marker
			const activeMarker = isActive ? ' (active)' : '';

			return `${index}: ${tmuxWindow.name}${flag} (${paneCount} ${paneWord}) [${dimensions.width}x${dimensions.height}] [layout ${layoutId}] @${index}${activeMarker}`;
		})
		.join('\n');
}

// ============================================================================
// STORE OPTIONS
// ============================================================================

export type TmuxStoreOptions = {
	/**
	 * Callback when a signal is emitted.
	 * Used for challenge integration.
	 */
	onSignal?: (signal: TmuxSignal) => void;

	/**
	 * Initial state override (for testing or resuming).
	 */
	initialState?: TmuxState;
};

// ============================================================================
// STORE FACTORY
// ============================================================================

/**
 * Create a reactive tmux state store.
 *
 * @example
 * ```svelte
 * <script>
 *   import { createTmuxStore } from '$lib/stores/tmux-state.svelte';
 *
 *   const tmux = createTmuxStore({
 *     onSignal: (signal) => console.log('Signal:', signal)
 *   });
 *
 *   // Access reactive state
 *   $: console.log(tmux.activeWindow);
 *
 *   // Perform actions
 *   tmux.splitPane('vertical');
 * </script>
 * ```
 */
export function createTmuxStore(options: TmuxStoreOptions = {}) {
	const { onSignal, initialState } = options;

	// ========================================================================
	// CORE REACTIVE STATE
	// ========================================================================

	let state = $state<TmuxState>(initialState ?? createInitialState());
	let prefixActive = $state(false);
	let lastFocusedPaneId = $state<string | null>(null);
	/**
	 * Counter that increments whenever input focus should be refreshed.
	 * Used to trigger focus in PaneView even when focusedPaneId hasn't changed.
	 */
	let focusTrigger = $state(0);

	// ========================================================================
	// DERIVED STATE
	// ========================================================================

	// Session-level derived state
	const sessions = $derived(state.sessions);
	const attachedSessionIndex = $derived(state.attachedSessionIndex);
	const attachedSession = $derived(
		state.attachedSessionIndex !== null ? state.sessions[state.attachedSessionIndex] : null
	);
	const sessionCount = $derived(state.sessions.length);
	const isDetached = $derived(state.attachedSessionIndex === null);

	// Shell pane (used when not attached to any session)
	const shellPane = $derived(state.shellPane);

	// Window/Pane derived state (scoped to the attached session, or shell pane when detached)
	const windows = $derived(attachedSession?.windows ?? []);
	const activeWindowIndex = $derived(attachedSession?.activeWindowIndex ?? 0);
	const activeWindow = $derived(
		attachedSession?.windows[attachedSession.activeWindowIndex] ?? null
	);
	const focusedPaneId = $derived(
		isDetached ? shellPane.id : (attachedSession?.focusedPaneId ?? '')
	);
	const focusedPane = $derived.by(() => {
		if (isDetached) {
			return shellPane;
		}

		if (activeWindow) {
			return findPaneById(activeWindow.paneTree, attachedSession?.focusedPaneId ?? '');
		}

		return null;
	});
	const allPanesInActiveWindow = $derived.by(() => {
		if (isDetached) {
			return [shellPane];
		}

		return activeWindow ? collectAllPanes(activeWindow.paneTree) : [];
	});
	const paneCount = $derived(isDetached ? 1 : activeWindow ? countPanes(activeWindow.paneTree) : 0);
	const windowCount = $derived(attachedSession?.windows.length ?? 0);

	// ========================================================================
	// SIGNAL EMISSION
	// ========================================================================

	function emitSignal(type: TmuxSignalType, data: Partial<TmuxSignal> = {}): void {
		if (onSignal) {
			onSignal({ type, ...data });
		}
	}

	// ========================================================================
	// STATE MUTATION HELPERS
	// ========================================================================

	function generateOutput(type: CommandResult['generateOutput']): string | null {
		switch (type) {
			case 'pane-list':
				return formatPaneList(allPanesInActiveWindow, focusedPaneId);
			case 'session-list':
				return formatSessionList(sessions, attachedSessionIndex);
			case 'window-list':
				return formatWindowList(windows, activeWindowIndex);
			default:
				return null;
		}
	}

	/**
	 * Update the pane tree of the active window in the attached session.
	 */
	function updateActiveWindowTree(newTree: PaneNode): void {
		if (state.attachedSessionIndex === null) {
			return;
		}

		state = {
			...state,
			sessions: state.sessions.map((session, sessionIdx) => {
				if (sessionIdx !== state.attachedSessionIndex) {
					return session;
				}

				return {
					...session,
					windows: session.windows.map((w, windowIdx) =>
						windowIdx === session.activeWindowIndex ? { ...w, paneTree: newTree } : w
					)
				};
			})
		};
	}

	/**
	 * Update a property on the attached session.
	 */
	function updateAttachedSession(updates: Partial<Omit<TmuxSession, 'id' | 'createdAt'>>): void {
		if (state.attachedSessionIndex === null) {
			return;
		}

		state = {
			...state,
			sessions: state.sessions.map((session, idx) =>
				idx === state.attachedSessionIndex ? { ...session, ...updates } : session
			)
		};
	}

	/**
	 * Update the shell pane (used when detached).
	 */
	function updateShellPane(updates: Partial<Omit<Pane, 'type' | 'id'>>): void {
		state = {
			...state,
			shellPane: { ...state.shellPane, ...updates }
		};
	}

	function setFocusedPane(paneId: string): void {
		if (!attachedSession) {
			console.debug('[TmuxStore] setFocusedPane - no attachedSession');
			return;
		}

		console.debug(
			'[TmuxStore] setFocusedPane - paneId:',
			paneId,
			'currentFocusedPaneId:',
			attachedSession.focusedPaneId
		);

		if (attachedSession.focusedPaneId !== paneId) {
			lastFocusedPaneId = attachedSession.focusedPaneId;
			updateAttachedSession({ focusedPaneId: paneId });
			console.debug('[TmuxStore] setFocusedPane - updated focusedPaneId to:', paneId);
			emitSignal('focus-changed', { paneId });
		} else {
			console.debug('[TmuxStore] setFocusedPane - paneId unchanged, skipping update');
		}
		// Always trigger focus refresh when explicitly focusing a pane
		console.debug('[TmuxStore] setFocusedPane - triggering input focus');
		triggerInputFocus();
	}

	/**
	 * Trigger a focus refresh on the currently focused pane's input.
	 * Call this after operations that should maintain focus (e.g., command output).
	 * Increments synchronously - the PaneView effect handles the DOM timing via tick().
	 */
	function triggerInputFocus(): void {
		focusTrigger++;
	}

	// ========================================================================
	// SESSION OPERATIONS
	// ========================================================================

	/**
	 * Create a new session.
	 *
	 * @param name - Optional session name (defaults to numeric index)
	 * @param attach - Whether to attach to the new session immediately (default: true)
	 * @returns The index of the new session
	 */
	function createNewSession(name?: string, attach = true): number {
		const newSession = createSession(name);
		const newSessionIndex = state.sessions.length;

		state = {
			...state,
			sessions: [...state.sessions, newSession],
			attachedSessionIndex: attach ? newSessionIndex : state.attachedSessionIndex
		};

		emitSignal('session-created', {
			sessionId: newSession.id,
			sessionName: newSession.name
		});

		if (attach) {
			emitSignal('session-attached', {
				sessionId: newSession.id,
				sessionName: newSession.name
			});
			// Focus the new session's pane input
			triggerInputFocus();
		}

		return newSessionIndex;
	}

	/**
	 * Find a session by index or name.
	 *
	 * @param target - Session index (number) or session name (string)
	 * @returns The session index, or -1 if not found
	 */
	function findSessionIndex(target: number | string): number {
		if (typeof target === 'number') {
			if (target >= 0 && target < state.sessions.length) {
				return target;
			}

			return -1;
		}

		// Search by name
		return state.sessions.findIndex((s) => s.name === target);
	}

	/**
	 * Attach to a session by index or name.
	 *
	 * @param target - Session index (0, 1, 2...) or session name
	 * @returns true if attached, false if session not found
	 */
	function attachSessionByTarget(target: number | string): boolean {
		const sessionIndex = findSessionIndex(target);

		if (sessionIndex === -1) {
			return false;
		}

		if (state.attachedSessionIndex === sessionIndex) {
			// Already attached to this session
			return true;
		}

		const targetSession = state.sessions[sessionIndex];

		state = {
			...state,
			attachedSessionIndex: sessionIndex
		};

		emitSignal('session-attached', {
			sessionId: targetSession.id,
			sessionName: targetSession.name
		});

		// Focus the session's pane input
		triggerInputFocus();

		return true;
	}

	/**
	 * Detach from the current session.
	 * The session continues to exist in the background.
	 * Returns the name of the detached session for display purposes.
	 */
	function detachFromSession(): string | null {
		if (state.attachedSessionIndex === null) {
			return null;
		}

		const detachedSession = state.sessions[state.attachedSessionIndex];
		const detachedSessionName = detachedSession.name;

		state = {
			...state,
			attachedSessionIndex: null
		};

		emitSignal('session-detached', {
			sessionId: detachedSession.id,
			sessionName: detachedSessionName
		});

		// Focus the shell pane input after detaching
		triggerInputFocus();

		return detachedSessionName;
	}

	/**
	 * Kill (destroy) a session.
	 *
	 * @param target - Session index or name. If not provided, kills the attached session.
	 * @returns true if killed, false if not found or cannot kill
	 */
	function killSessionByTarget(target?: number | string): boolean {
		let sessionIndex: number;

		if (target === undefined) {
			// Kill the attached session
			if (state.attachedSessionIndex === null) {
				return false;
			}
			sessionIndex = state.attachedSessionIndex;
		} else {
			sessionIndex = findSessionIndex(target);
			if (sessionIndex === -1) {
				return false;
			}
		}

		// Cannot kill the last session
		if (state.sessions.length <= 1) {
			return false;
		}

		const killedSession = state.sessions[sessionIndex];
		const newSessions = state.sessions.filter((_, i) => i !== sessionIndex);

		// Adjust attached session index if needed
		let newAttachedIndex = state.attachedSessionIndex;

		if (state.attachedSessionIndex === sessionIndex) {
			// We're killing the attached session - attach to the previous one, or first available
			newAttachedIndex = Math.max(0, sessionIndex - 1);
			if (newAttachedIndex >= newSessions.length) {
				newAttachedIndex = newSessions.length - 1;
			}
		} else if (state.attachedSessionIndex !== null && sessionIndex < state.attachedSessionIndex) {
			// Killed a session before the attached one - adjust index
			newAttachedIndex = state.attachedSessionIndex - 1;
		}

		state = {
			...state,
			sessions: newSessions,
			attachedSessionIndex: newAttachedIndex
		};

		emitSignal('session-killed', {
			sessionId: killedSession.id,
			sessionName: killedSession.name
		});

		// If we attached to a new session, emit that signal too
		if (newAttachedIndex !== null && newAttachedIndex !== state.attachedSessionIndex) {
			const newAttachedSession = newSessions[newAttachedIndex];
			emitSignal('session-attached', {
				sessionId: newAttachedSession.id,
				sessionName: newAttachedSession.name
			});
			triggerInputFocus();
		}

		return true;
	}

	/**
	 * Rename a session.
	 *
	 * @param name - New name for the session
	 * @param target - Session index or name. If not provided, renames the attached session.
	 * @returns true if renamed, false if session not found
	 */
	function renameSessionByTarget(name: string, target?: number | string): boolean {
		let sessionIndex: number;

		if (target === undefined) {
			// Rename the attached session
			if (state.attachedSessionIndex === null) {
				return false;
			}
			sessionIndex = state.attachedSessionIndex;
		} else {
			sessionIndex = findSessionIndex(target);
			if (sessionIndex === -1) {
				return false;
			}
		}

		const oldName = state.sessions[sessionIndex].name;

		state = {
			...state,
			sessions: state.sessions.map((session, idx) =>
				idx === sessionIndex ? { ...session, name } : session
			)
		};

		emitSignal('session-renamed', {
			sessionId: state.sessions[sessionIndex].id,
			sessionName: name,
			metadata: { oldName }
		});

		// Restore focus to the pane input after renaming
		triggerInputFocus();

		return true;
	}

	/**
	 * Check if currently attached to a session.
	 */
	function isAttached(): boolean {
		return state.attachedSessionIndex !== null;
	}

	/**
	 * Handle a session operation from a command result.
	 * This bridges the command system with the session management methods.
	 */
	function handleSessionOperation(operation: SessionOperation): void {
		switch (operation.type) {
			case 'create': {
				createNewSession(operation.name, operation.attach ?? true);
				addHistory({
					type: 'system',
					content: `[new session created]`,
					timestamp: Date.now()
				});
				break;
			}
			case 'attach': {
				const success = attachSessionByTarget(operation.target);
				if (!success) {
					addHistory({
						type: 'error',
						content: `can't find session: ${operation.target}`,
						timestamp: Date.now()
					});
				} else {
					addHistory({
						type: 'system',
						content: `[attached to session ${operation.target}]`,
						timestamp: Date.now()
					});
				}
				break;
			}
			case 'detach': {
				const detachedName = detachFromSession();
				if (detachedName !== null) {
					setMode('default');
					addHistory({
						type: 'system',
						content: `[detached (from session ${detachedName})]`,
						timestamp: Date.now()
					});
				}
				break;
			}
			case 'kill': {
				const targetSession =
					operation.target !== undefined
						? state.sessions[findSessionIndex(operation.target)]
						: attachedSession;
				const sessionName = targetSession?.name ?? 'unknown';
				const success = killSessionByTarget(operation.target);
				if (!success) {
					if (state.sessions.length <= 1) {
						addHistory({
							type: 'error',
							content: `can't kill last session`,
							timestamp: Date.now()
						});
					} else {
						addHistory({
							type: 'error',
							content: `can't find session: ${operation.target}`,
							timestamp: Date.now()
						});
					}
				} else {
					addHistory({
						type: 'system',
						content: `[killed session ${sessionName}]`,
						timestamp: Date.now()
					});
				}
				break;
			}
			case 'rename': {
				const success = renameSessionByTarget(operation.name, operation.target);
				if (!success) {
					addHistory({
						type: 'error',
						content: `can't find session: ${operation.target}`,
						timestamp: Date.now()
					});
				} else {
					addHistory({
						type: 'system',
						content: `[renamed session to ${operation.name}]`,
						timestamp: Date.now()
					});
				}
				break;
			}
		}
	}

	// ========================================================================
	// WINDOW OPERATIONS
	// ========================================================================

	/**
	 * Create a new window.
	 *
	 * @param name - Optional name for the window
	 */
	function createNewWindow(name?: string): void {
		if (!attachedSession) {
			return;
		}

		const newWindow = createWindow(name);
		const newWindowIndex = attachedSession.windows.length;

		updateAttachedSession({
			windows: [...attachedSession.windows, newWindow],
			activeWindowIndex: newWindowIndex,
			focusedPaneId: (newWindow.paneTree as Pane).id
		});

		emitSignal('window-created', { windowId: newWindow.id });
		// Focus the new window's pane input
		triggerInputFocus();
	}

	/**
	 * Close a window by index.
	 * Cannot close if it's the last window.
	 *
	 * @param index - Window index to close (defaults to active window)
	 * @returns true if closed, false if refused (last window)
	 */
	function closeWindow(index?: number): boolean {
		if (!attachedSession) {
			return false;
		}

		const targetIndex = index ?? attachedSession.activeWindowIndex;

		// Guard: cannot close last window
		if (attachedSession.windows.length <= 1) {
			return false;
		}

		const closedWindow = attachedSession.windows[targetIndex];
		const newWindows = attachedSession.windows.filter((_, i) => i !== targetIndex);

		// Adjust active index if needed
		let newActiveIndex = attachedSession.activeWindowIndex;
		if (targetIndex <= attachedSession.activeWindowIndex) {
			newActiveIndex = Math.max(0, attachedSession.activeWindowIndex - 1);
		}
		if (newActiveIndex >= newWindows.length) {
			newActiveIndex = newWindows.length - 1;
		}

		const newActiveWindow = newWindows[newActiveIndex];
		const firstPane = getFirstPane(newActiveWindow.paneTree);

		updateAttachedSession({
			windows: newWindows,
			activeWindowIndex: newActiveIndex,
			focusedPaneId: firstPane.id
		});

		emitSignal('window-closed', { windowId: closedWindow.id });

		// Focus the new active window's pane input
		triggerInputFocus();

		return true;
	}

	/**
	 * Switch to a window by index.
	 *
	 * @param index - Window index to switch to
	 */
	function switchWindow(index: number): void {
		if (!attachedSession) {
			return;
		}

		if (index < 0 || index >= attachedSession.windows.length) {
			return;
		}

		if (index === attachedSession.activeWindowIndex) {
			return;
		}

		const targetWindow = attachedSession.windows[index];
		const firstPane = getFirstPane(targetWindow.paneTree);

		updateAttachedSession({
			activeWindowIndex: index,
			focusedPaneId: firstPane.id
		});

		emitSignal('window-switched', { windowId: targetWindow.id });
		// Focus the switched window's pane input
		triggerInputFocus();
	}

	/**
	 * Switch to the next window (wraps around).
	 */
	function nextWindow(): void {
		if (!attachedSession) {
			return;
		}

		const newIndex = (attachedSession.activeWindowIndex + 1) % attachedSession.windows.length;
		switchWindow(newIndex);
	}

	/**
	 * Switch to the previous window (wraps around).
	 */
	function previousWindow(): void {
		if (!attachedSession) {
			return;
		}

		const newIndex =
			(attachedSession.activeWindowIndex - 1 + attachedSession.windows.length) %
			attachedSession.windows.length;
		switchWindow(newIndex);
	}

	/**
	 * Rename a window.
	 *
	 * @param index - Window index to rename (defaults to active window)
	 * @param name - New name for the window
	 */
	function renameWindow(name: string, index?: number): void {
		if (!attachedSession) {
			return;
		}

		const targetIndex = index ?? attachedSession.activeWindowIndex;

		if (targetIndex < 0 || targetIndex >= attachedSession.windows.length) {
			return;
		}

		updateAttachedSession({
			windows: attachedSession.windows.map((w, i) => (i === targetIndex ? { ...w, name } : w))
		});

		emitSignal('window-renamed', {
			windowId: attachedSession.windows[targetIndex].id,
			metadata: { name }
		});

		// Restore focus to the pane input after renaming
		triggerInputFocus();
	}

	/**
	 * Reorder windows (for drag and drop).
	 *
	 * @param fromIndex - Original index
	 * @param toIndex - New index
	 */
	function reorderWindows(fromIndex: number, toIndex: number): void {
		if (!attachedSession) {
			return;
		}

		if (
			fromIndex < 0 ||
			fromIndex >= attachedSession.windows.length ||
			toIndex < 0 ||
			toIndex >= attachedSession.windows.length ||
			fromIndex === toIndex
		) {
			return;
		}

		const newWindows = [...attachedSession.windows];
		const [removed] = newWindows.splice(fromIndex, 1);
		newWindows.splice(toIndex, 0, removed);

		// Adjust active index
		let newActiveIndex = attachedSession.activeWindowIndex;
		if (fromIndex === attachedSession.activeWindowIndex) {
			newActiveIndex = toIndex;
		} else if (
			fromIndex < attachedSession.activeWindowIndex &&
			toIndex >= attachedSession.activeWindowIndex
		) {
			newActiveIndex--;
		} else if (
			fromIndex > attachedSession.activeWindowIndex &&
			toIndex <= attachedSession.activeWindowIndex
		) {
			newActiveIndex++;
		}

		updateAttachedSession({
			windows: newWindows,
			activeWindowIndex: newActiveIndex
		});
	}

	// ========================================================================
	// PANE OPERATIONS
	// ========================================================================

	/**
	 * Split the focused pane.
	 *
	 * @param direction - 'horizontal' (top/bottom) or 'vertical' (left/right)
	 */
	function splitFocusedPane(direction: SplitDirection): void {
		if (!activeWindow) {
			console.debug('[TmuxStore] splitFocusedPane - no activeWindow');
			return;
		}

		console.debug(
			'[TmuxStore] splitFocusedPane - direction:',
			direction,
			'currentFocusedPaneId:',
			focusedPaneId
		);

		const result = splitPane(activeWindow.paneTree, focusedPaneId, direction);

		if (!result) {
			console.debug('[TmuxStore] splitFocusedPane - splitPane returned null');
			return;
		}

		console.debug('[TmuxStore] splitFocusedPane - newPaneId:', result.newPane.id);

		updateActiveWindowTree(result.tree);

		// Focus the new pane
		console.debug('[TmuxStore] splitFocusedPane - calling setFocusedPane with:', result.newPane.id);
		setFocusedPane(result.newPane.id);

		console.debug(
			'[TmuxStore] splitFocusedPane - after setFocusedPane, focusedPaneId is:',
			focusedPaneId
		);

		emitSignal('pane-split', {
			paneId: result.newPane.id,
			direction
		});
	}

	/**
	 * Close the focused pane.
	 * Cannot close if it's the last pane in the window.
	 *
	 * @returns true if closed, false if refused (last pane)
	 */
	function closeFocusedPane(): boolean {
		if (!activeWindow) {
			return false;
		}

		// Guard: cannot close last pane
		if (countPanes(activeWindow.paneTree) <= 1) {
			return false;
		}

		const closedPaneId = focusedPaneId;
		const newTree = removePane(activeWindow.paneTree, closedPaneId);

		if (!newTree) {
			return false;
		}

		// Find a new pane to focus (prefer the previous pane, or first pane)
		const allPanes = collectAllPanes(newTree);
		let newFocusedPane: Pane;

		if (lastFocusedPaneId && allPanes.find((p) => p.id === lastFocusedPaneId)) {
			newFocusedPane = allPanes.find((p) => p.id === lastFocusedPaneId)!;
		} else {
			newFocusedPane = getFirstPane(newTree);
		}

		updateActiveWindowTree(newTree);
		setFocusedPane(newFocusedPane.id);

		emitSignal('pane-closed', { paneId: closedPaneId });
		return true;
	}

	/**
	 * Focus a pane by ID.
	 */
	function focusPane(paneId: string): void {
		if (!activeWindow) {
			return;
		}

		const pane = findPaneById(activeWindow.paneTree, paneId);
		if (pane) {
			setFocusedPane(paneId);
		}
	}

	/**
	 * Move focus in a direction.
	 *
	 * @param direction - 'up', 'down', 'left', 'right'
	 */
	function moveFocus(direction: 'up' | 'down' | 'left' | 'right'): void {
		if (!activeWindow) {
			console.debug('[TmuxStore] moveFocus - no activeWindow');
			return;
		}

		console.debug('[TmuxStore] moveFocus - direction:', direction, 'currentPaneId:', focusedPaneId);
		console.debug(
			'[TmuxStore] moveFocus - paneTree:',
			JSON.stringify(activeWindow.paneTree, null, 2)
		);

		const targetPane = findPaneInDirection(activeWindow.paneTree, focusedPaneId, direction);

		console.debug('[TmuxStore] moveFocus - targetPane:', targetPane?.id ?? 'null');

		if (targetPane) {
			setFocusedPane(targetPane.id);
		} else {
			console.debug('[TmuxStore] moveFocus - no pane found in direction:', direction);
		}
	}

	/**
	 * Move focus to the next pane (cycles).
	 */
	function focusNextPane(): void {
		if (!activeWindow) {
			return;
		}

		const nextPane = getNextPane(activeWindow.paneTree, focusedPaneId);
		setFocusedPane(nextPane.id);
	}

	/**
	 * Move focus to the previous pane (cycles).
	 */
	function focusPreviousPane(): void {
		if (!activeWindow) {
			return;
		}

		const prevPane = getPreviousPane(activeWindow.paneTree, focusedPaneId);
		setFocusedPane(prevPane.id);
	}

	/**
	 * Move focus to the last focused pane.
	 */
	function focusLastPane(): void {
		if (!activeWindow || !lastFocusedPaneId) {
			return;
		}

		const pane = findPaneById(activeWindow.paneTree, lastFocusedPaneId);
		if (pane) {
			setFocusedPane(lastFocusedPaneId);
		}
	}

	// ========================================================================
	// PANE CONTENT OPERATIONS
	// ========================================================================

	/**
	 * Add a history entry to a pane.
	 */
	function addHistory(entry: HistoryEntry, paneId?: string): void {
		// When detached, add history to the shell pane
		if (isDetached) {
			updateShellPane({
				history: [...state.shellPane.history, entry]
			});
			return;
		}

		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? focusedPaneId;
		const newTree = addPaneHistory(activeWindow.paneTree, targetPaneId, entry);
		updateActiveWindowTree(newTree);
	}

	/**
	 * Clear a pane's history.
	 */
	function clearHistory(paneId?: string): void {
		// When detached, clear the shell pane history
		if (isDetached) {
			updateShellPane({ history: [] });
			return;
		}

		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? focusedPaneId;
		const newTree = clearPaneHistory(activeWindow.paneTree, targetPaneId);
		updateActiveWindowTree(newTree);
	}

	/**
	 * Set a pane's mode.
	 * When entering man mode, stores the current mode as previousMode.
	 * When exiting man mode (via exitManMode), restores the previous mode.
	 */
	function setMode(mode: PaneMode, paneId?: string): void {
		// When detached, set mode on the shell pane
		if (isDetached) {
			const oldMode = state.shellPane.mode;

			// When entering man mode, store the current mode so we can restore it later
			if (mode === 'man' && oldMode !== 'man') {
				updateShellPane({ previousMode: oldMode, mode });
			} else {
				updateShellPane({ mode });
			}

			if (oldMode !== mode) {
				emitSignal('mode-changed', {
					paneId: state.shellPane.id,
					newMode: mode,
					metadata: { oldMode }
				});

				// Special signals for tmux enter/exit
				if (mode === 'tmux' && oldMode === 'default') {
					emitSignal('tmux-entered', { paneId: state.shellPane.id });
				} else if (mode === 'default' && oldMode === 'tmux') {
					emitSignal('tmux-exited', { paneId: state.shellPane.id });
				}
			}
			return;
		}

		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? focusedPaneId;
		const oldPane = findPaneById(activeWindow.paneTree, targetPaneId);
		const oldMode = oldPane?.mode;

		// When entering man mode, store the current mode so we can restore it later
		if (mode === 'man' && oldMode !== 'man') {
			const treeWithPreviousMode = updatePane(activeWindow.paneTree, targetPaneId, {
				previousMode: oldMode
			});
			const newTree = setPaneMode(treeWithPreviousMode, targetPaneId, mode);
			updateActiveWindowTree(newTree);
		} else {
			const newTree = setPaneMode(activeWindow.paneTree, targetPaneId, mode);
			updateActiveWindowTree(newTree);
		}

		if (oldMode !== mode) {
			emitSignal('mode-changed', {
				paneId: targetPaneId,
				newMode: mode,
				metadata: { oldMode }
			});

			// Special signals for tmux enter/exit
			if (mode === 'tmux' && oldMode === 'default') {
				emitSignal('tmux-entered', { paneId: targetPaneId });
			} else if (mode === 'default' && oldMode === 'tmux') {
				emitSignal('tmux-exited', { paneId: targetPaneId });
			}
		}
	}

	/**
	 * Exit man mode and restore the previous mode.
	 * If no previous mode is stored, defaults to 'default'.
	 */
	function exitManMode(paneId?: string): void {
		// When detached, exit man mode on the shell pane
		if (isDetached) {
			if (state.shellPane.mode !== 'man') {
				return;
			}

			// Restore the previous mode, default to 'default' if not set
			const modeToRestore = state.shellPane.previousMode ?? 'default';

			updateShellPane({
				previousMode: undefined,
				mode: modeToRestore
			});

			emitSignal('mode-changed', {
				paneId: state.shellPane.id,
				newMode: modeToRestore,
				metadata: { oldMode: 'man' }
			});

			// Emit tmux-entered if restoring to tmux mode (unlikely when detached)
			if (modeToRestore === 'tmux') {
				emitSignal('tmux-entered', { paneId: state.shellPane.id });
			}

			// Restore focus to the pane input after exiting man mode
			triggerInputFocus();
			return;
		}

		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? focusedPaneId;
		const pane = findPaneById(activeWindow.paneTree, targetPaneId);

		if (!pane || pane.mode !== 'man') {
			return;
		}

		// Restore the previous mode, default to 'default' if not set
		const modeToRestore = pane.previousMode ?? 'default';

		// Clear previousMode and set the restored mode
		const treeWithClearedPrevious = updatePane(activeWindow.paneTree, targetPaneId, {
			previousMode: undefined
		});
		const newTree = setPaneMode(treeWithClearedPrevious, targetPaneId, modeToRestore);
		updateActiveWindowTree(newTree);

		emitSignal('mode-changed', {
			paneId: targetPaneId,
			newMode: modeToRestore,
			metadata: { oldMode: 'man' }
		});

		// Emit tmux-entered if restoring to tmux mode
		if (modeToRestore === 'tmux') {
			emitSignal('tmux-entered', { paneId: targetPaneId });
		}

		// Restore focus to the pane input after exiting man mode
		triggerInputFocus();
	}

	/**
	 * Set a pane's input value.
	 */
	function setInput(value: string, paneId?: string): void {
		// When detached, set input on the shell pane
		if (isDetached) {
			updateShellPane({ inputValue: value });
			return;
		}

		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? focusedPaneId;
		const newTree = setPaneInput(activeWindow.paneTree, targetPaneId, value);
		updateActiveWindowTree(newTree);
	}

	/**
	 * Update arbitrary pane properties.
	 */
	function updateFocusedPane(updates: Partial<Omit<Pane, 'type' | 'id'>>): void {
		if (!activeWindow) {
			return;
		}

		const newTree = updatePane(activeWindow.paneTree, focusedPaneId, updates);
		updateActiveWindowTree(newTree);
	}

	// ========================================================================
	// PREFIX MODE
	// ========================================================================

	/**
	 * Toggle prefix mode.
	 */
	function togglePrefix(): void {
		prefixActive = !prefixActive;
	}

	/**
	 * Activate prefix mode.
	 */
	function activatePrefix(): void {
		prefixActive = true;
	}

	/**
	 * Deactivate prefix mode.
	 */
	function deactivatePrefix(): void {
		prefixActive = false;
	}

	// ========================================================================
	// COMMAND PROCESSING
	// ========================================================================

	/**
	 * Process a command in the focused pane.
	 * This handles mode switching and command recording.
	 *
	 * @param command - The command string
	 */
	function processCommand(command: string): void {
		if (!focusedPane) {
			return;
		}

		const trimmedCommand = command.trim();

		// Don't process empty commands
		if (!trimmedCommand) {
			return;
		}

		// Add to history as input (include mode for proper prompt display)
		addHistory({
			type: 'input',
			content: trimmedCommand,
			timestamp: Date.now(),
			mode: focusedPane.mode
		});

		// Clear input
		setInput('');

		// Handle mode-switching commands in default mode
		if (focusedPane.mode === 'default') {
			// Handle 'man tmux' command
			if (trimmedCommand === 'man tmux') {
				setMode('man');
				return;
			}

			// Handle 'clear' command
			if (trimmedCommand === 'clear') {
				clearHistory();
				return;
			}

			// Handle basic "tmux" command - create new session or attach to existing
			if (trimmedCommand === 'tmux') {
				if (state.sessions.length === 0) {
					// No sessions exist - create one
					createNewSession(undefined, true);
				} else if (state.attachedSessionIndex === null) {
					// Have sessions but not attached - attach to first
					attachSessionByTarget(0);
				}
				// If already attached, just switch to tmux mode
				setMode('tmux');
				addHistory({
					type: 'system',
					content: '[tmux session started]',
					timestamp: Date.now()
				});
				return;
			}

			// Try to execute tmux commands through the command registry
			// This ensures proper signal emission for challenge tracking
			if (trimmedCommand.startsWith('tmux ')) {
				const execution = executeCommand(trimmedCommand, focusedPane.id, focusedPane.mode);

				if (execution && execution.result.handled) {
					const { result, commandName } = execution;

					// Handle output/error/system messages
					if (result.output) {
						addHistory({
							type: 'output',
							content: result.output,
							timestamp: Date.now()
						});
					}

					if (result.error) {
						addHistory({
							type: 'error',
							content: result.error,
							timestamp: Date.now()
						});
						triggerInputFocus();
						// Emit signal even for errors so challenge can track attempts
						emitSignal('command-executed', {
							commandName,
							command: commandName,
							paneId: focusedPane.id
						});
						return;
					}

					if (result.system) {
						addHistory({
							type: 'system',
							content: result.system,
							timestamp: Date.now()
						});
					}

					// Handle generated output (like session-list)
					if (result.generateOutput) {
						const output = generateOutput(result.generateOutput);
						if (output) {
							addHistory({ type: 'output', content: output, timestamp: Date.now() });
						}
					}

					// Handle session operations (attach, new-session, etc.)
					if (result.sessionOperation) {
						const op = result.sessionOperation;

						switch (op.type) {
							case 'attach': {
								const success = attachSessionByTarget(op.target);
								if (!success) {
									addHistory({
										type: 'error',
										content: `can't find session: ${op.target}`,
										timestamp: Date.now()
									});
									triggerInputFocus();
									// Still emit signal for challenge tracking
									emitSignal('command-executed', {
										commandName,
										command: commandName,
										paneId: focusedPane.id
									});
									return;
								}
								setMode('tmux');
								addHistory({
									type: 'system',
									content: `[attached to session ${attachedSession?.name ?? '0'}]`,
									timestamp: Date.now()
								});
								break;
							}
							case 'create': {
								createNewSession(op.name, op.attach ?? true);
								setMode('tmux');
								addHistory({
									type: 'system',
									content: `[new session created: ${attachedSession?.name ?? '0'}]`,
									timestamp: Date.now()
								});
								break;
							}
							default:
								// Other session operations (detach, kill, rename) shouldn't happen in default mode
								break;
						}
					}

					// Emit command-executed signal for challenge tracking
					emitSignal('command-executed', {
						commandName,
						command: commandName,
						paneId: focusedPane.id
					});

					triggerInputFocus();
					return;
				}
			}

			// Unknown command in default mode
			addHistory({
				type: 'error',
				content: `command not found: ${trimmedCommand.split(' ')[0]}`,
				timestamp: Date.now()
			});
			// Ensure focus stays on input after error
			triggerInputFocus();
			return;
		}

		// In tmux mode, handle special commands first, then try the command registry
		if (focusedPane.mode === 'tmux') {
			// Handle 'man tmux' command - switch to man mode while preserving tmux state
			if (trimmedCommand === 'man tmux') {
				setMode('man');
				return;
			}

			const execution = executeCommand(trimmedCommand, focusedPane.id, focusedPane.mode);

			if (execution && execution.result.handled) {
				const { result, commandName } = execution;

				// Apply command result side effects
				if (result.output) {
					addHistory({
						type: 'output',
						content: result.output,
						timestamp: Date.now()
					});
				}

				if (result.error) {
					addHistory({
						type: 'error',
						content: result.error,
						timestamp: Date.now()
					});
				}

				if (result.system) {
					addHistory({
						type: 'system',
						content: result.system,
						timestamp: Date.now()
					});
				}

				if (result.clearHistory) {
					clearHistory();
				}

				if (result.newMode) {
					setMode(result.newMode);
				}

				if (result.signal) {
					emitSignal(result.signal.type as TmuxSignalType, result.signal.data);
				}

				if (result.generateOutput) {
					const output = generateOutput(result.generateOutput);
					if (output) {
						addHistory({ type: 'output', content: output, timestamp: Date.now() });
					}
				}

				// Handle special exit behavior
				if (result.exitBehavior === 'close-pane-or-detach') {
					if (paneCount > 1) {
						// Multiple panes: close current pane and focus another
						closeFocusedPane();
						addHistory({
							type: 'system',
							content: '[pane closed]',
							timestamp: Date.now()
						});
					} else {
						// Single pane: detach from tmux session (preserves session in background)
						const detachedSessionName = detachFromSession();
						setMode('default');
						addHistory({
							type: 'system',
							content: `[detached (from session ${detachedSessionName ?? '0'})]`,
							timestamp: Date.now()
						});
					}
				}

				// Handle session operations
				if (result.sessionOperation) {
					handleSessionOperation(result.sessionOperation);
				}

				// Emit command-executed signal for challenge tracking (type-safe)
				// Use commandName as the answer (canonical name like 'list-sessions')
				// NOT trimmedCommand (which is what user typed like 'tmux ls')
				emitSignal('command-executed', {
					commandName,
					command: commandName,
					paneId: focusedPane.id
				});

				// Ensure focus stays on input after command execution
				triggerInputFocus();
				return;
			}

			// Command not found in registry - show error
			addHistory({
				type: 'error',
				content: `tmux: unknown command: ${trimmedCommand.split(' ')[0]}`,
				timestamp: Date.now()
			});

			// Emit unrecognized command signal (not type-safe, just raw command)
			emitSignal('command', { command: trimmedCommand, paneId: focusedPane.id });

			// Ensure focus stays on input after command processing
			triggerInputFocus();
		}
	}

	/**
	 * (called from keybinding handler).
	 * emits a type-safe 'command-executed' signal for telling outside
	 * world that a command was executed.
	 *
	 * @param value - value for commands that require input (e.g., rename)
	 * @param commandName - command id (string union type)
	 */
	function executeTmuxCommand(commandName: CommandIdType, value?: string): void {
		if (!focusedPane || focusedPane.mode !== 'tmux') {
			return;
		}

		// Format the command with optional value for display
		const fullCommand = value ? `${commandName}:${value}` : commandName;

		// Emit type-safe command-executed signal for challenge tracking
		emitSignal('command-executed', {
			commandName,
			command: fullCommand,
			paneId: focusedPane.id
		});
	}

	// ========================================================================
	// OUTPUT GENERATION (for prefix keybindings)
	// ========================================================================

	/**
	 * Output the window list to history.
	 * Used by prefix + w keybinding to show the same output as 'tmux lsw'.
	 */
	function outputWindowList(): void {
		const output = generateOutput('window-list');
		if (output) {
			addHistory({ type: 'output', content: output, timestamp: Date.now() });
		}
		triggerInputFocus();
	}

	/**
	 * Output the pane list to history.
	 * Used for consistency with outputWindowList.
	 */
	function outputPaneList(): void {
		const output = generateOutput('pane-list');
		if (output) {
			addHistory({ type: 'output', content: output, timestamp: Date.now() });
		}
		triggerInputFocus();
	}

	/**
	 * Output the session list to history.
	 * Used for consistency with outputWindowList.
	 */
	function outputSessionList(): void {
		const output = generateOutput('session-list');
		if (output) {
			addHistory({ type: 'output', content: output, timestamp: Date.now() });
		}
		triggerInputFocus();
	}

	// ========================================================================
	// RESET
	// ========================================================================

	function reset(): void {
		state = initialState ?? createInitialState();
		prefixActive = false;
		lastFocusedPaneId = null;
	}

	// ========================================================================
	// RETURN STORE INTERFACE
	// ========================================================================

	return {
		// Reactive state (read-only via getters)
		// Session-level state
		get sessions() {
			return sessions;
		},
		get attachedSessionIndex() {
			return attachedSessionIndex;
		},
		get attachedSession() {
			return attachedSession;
		},
		get sessionCount() {
			return sessionCount;
		},
		get isDetached() {
			return isDetached;
		},

		// Window/Pane state (scoped to attached session, or shell pane when detached)
		get windows() {
			return windows;
		},
		get activeWindowIndex() {
			return activeWindowIndex;
		},
		get activeWindow() {
			return activeWindow;
		},
		get focusedPaneId() {
			return focusedPaneId;
		},
		get focusedPane() {
			return focusedPane;
		},
		get allPanesInActiveWindow() {
			return allPanesInActiveWindow;
		},
		get paneCount() {
			return paneCount;
		},
		get windowCount() {
			return windowCount;
		},
		get prefixActive() {
			return prefixActive;
		},
		/**
		 * Counter that increments when input focus should be refreshed.
		 * Pass this to PaneView to trigger focus updates.
		 */
		get focusTrigger() {
			return focusTrigger;
		},

		// Session operations
		createSession: createNewSession,
		attachSession: attachSessionByTarget,
		detachSession: detachFromSession,
		killSession: killSessionByTarget,
		renameSession: renameSessionByTarget,
		isAttached,

		// Window operations
		createWindow: createNewWindow,
		closeWindow,
		switchWindow,
		nextWindow,
		previousWindow,
		renameWindow,
		reorderWindows,

		// Pane operations
		splitPane: splitFocusedPane,
		closePane: closeFocusedPane,
		focusPane,
		moveFocus,
		focusNextPane,
		focusPreviousPane,
		focusLastPane,

		// Pane content
		addHistory,
		clearHistory,
		setMode,
		exitManMode,
		setInput,
		updateFocusedPane,

		// Prefix mode
		togglePrefix,
		activatePrefix,
		deactivatePrefix,

		// Command processing
		processCommand,
		executeTmuxCommand,

		// Output generation (for prefix keybindings)
		outputWindowList,
		outputPaneList,
		outputSessionList,

		// Reset
		reset
	};
}

/**
 * Type for the tmux store.
 */
export type TmuxStore = ReturnType<typeof createTmuxStore>;
