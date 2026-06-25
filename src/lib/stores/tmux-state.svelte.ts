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
	generatePasteBufferName,
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
	rotatePanes,
	swapPaneContent,
	type TmuxState,
	type TmuxSession,
	type TmuxWindow,
	type TmuxSignal,
	type TmuxSignalType,
	type PaneNode,
	type Pane,
	type PaneMode,
	type PaneCopyState,
	type SplitDirection,
	type HistoryEntry,
	type TmuxPasteBuffer
} from '$lib/utils/pane-tree';

import {
	executeCommand,
	type CommandIdType,
	type CommandResult,
	type SessionOperation,
	type PaneOperation,
	type WindowOperation,
	type ConfigOperation
} from '$lib/utils/tmux-commands';
import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';
import { TMUX_CONFIG_PATH } from '$lib/utils/tmux-conf';

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

export type EnterCopyModeOptions = {
	paneId?: string;
	initialState?: Partial<PaneCopyState>;
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

	function isDetachedState(): boolean {
		return state.attachedSessionIndex === null;
	}

	function getAttachedSessionState(): TmuxSession | null {
		if (state.attachedSessionIndex === null) {
			return null;
		}

		return state.sessions[state.attachedSessionIndex] ?? null;
	}

	function getActiveWindowState(): TmuxWindow | null {
		const currentAttachedSession = getAttachedSessionState();
		if (!currentAttachedSession) {
			return null;
		}

		return currentAttachedSession.windows[currentAttachedSession.activeWindowIndex] ?? null;
	}

	function getFocusedPaneState(): Pane | null {
		if (isDetachedState()) {
			return state.shellPane;
		}

		const currentAttachedSession = getAttachedSessionState();
		const currentActiveWindow = getActiveWindowState();
		if (!currentAttachedSession || !currentActiveWindow) {
			return null;
		}

		return findPaneById(currentActiveWindow.paneTree, currentAttachedSession.focusedPaneId);
	}

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

	function createDefaultCopyState(overrides: Partial<PaneCopyState> = {}): PaneCopyState {
		const defaultCopyModeTable =
			tmuxConfigStore.activeConfig.modeKeys === 'vi' ? 'copy-mode-vi' : 'copy-mode';

		return {
			activeKeyTable: overrides.activeKeyTable ?? defaultCopyModeTable,
			cursor: overrides.cursor ?? { row: 0, column: 0 },
			viewportTopRow: overrides.viewportTopRow ?? 0,
			selectionAnchor: overrides.selectionAnchor ?? null,
			dragAnchor: overrides.dragAnchor ?? null
		};
	}

	function getPaneCopyState(paneId?: string): PaneCopyState | null {
		if (isDetachedState()) {
			return state.shellPane.copyState;
		}

		const currentActiveWindow = getActiveWindowState();
		if (!currentActiveWindow) {
			return null;
		}

		const targetPaneId = paneId ?? getFocusedPaneState()?.id;
		if (!targetPaneId) {
			return null;
		}

		return findPaneById(currentActiveWindow.paneTree, targetPaneId)?.copyState ?? null;
	}

	function setPaneCopyState(copyState: PaneCopyState | null, paneId?: string): void {
		if (isDetachedState()) {
			updateShellPane({ copyState });
			return;
		}

		const currentActiveWindow = getActiveWindowState();
		if (!currentActiveWindow) {
			return;
		}

		const targetPaneId = paneId ?? getFocusedPaneState()?.id;
		if (!targetPaneId) {
			return;
		}

		const newTree = updatePane(currentActiveWindow.paneTree, targetPaneId, { copyState });

		updateActiveWindowTree(newTree);
	}

	function enterCopyMode(options: EnterCopyModeOptions = {}): PaneCopyState {
		const copyState = createDefaultCopyState(options.initialState);

		setPaneCopyState(copyState, options.paneId);

		return copyState;
	}

	function exitCopyMode(paneId?: string): void {
		setPaneCopyState(null, paneId);
	}

	function clearCopySelection(paneId?: string): void {
		const currentCopyState = getPaneCopyState(paneId);

		if (!currentCopyState) {
			return;
		}

		setPaneCopyState(
			{
				...currentCopyState,
				selectionAnchor: null,
				dragAnchor: null
			},
			paneId
		);
	}

	function getLatestPasteBufferState(): TmuxPasteBuffer | null {
		return state.pasteBuffers[0] ?? null;
	}

	function pushPasteBuffer(content: string, name?: string): TmuxPasteBuffer | null {
		if (!content) {
			return null;
		}

		const buffer: TmuxPasteBuffer = {
			name: name ?? generatePasteBufferName(),
			content,
			createdAt: Date.now()
		};

		state = {
			...state,
			pasteBuffers: [buffer, ...state.pasteBuffers]
		};

		return buffer;
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
	 * Switch to the next or previous session relative to the attached one,
	 * wrapping around the session list.
	 *
	 * No-op when detached or when only one session exists (matches tmux, which
	 * silently stays put rather than erroring).
	 *
	 * @returns true if the attached session changed
	 */
	function switchSessionRelative(direction: 'next' | 'previous'): boolean {
		if (state.attachedSessionIndex === null) {
			return false;
		}

		const sessionTotal = state.sessions.length;
		if (sessionTotal <= 1) {
			return false;
		}

		const currentIndex = state.attachedSessionIndex;
		const nextIndex =
			direction === 'next'
				? (currentIndex + 1) % sessionTotal
				: (currentIndex - 1 + sessionTotal) % sessionTotal;

		return attachSessionByTarget(nextIndex);
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
	 * @returns true if killed, false if not found or no session is attached
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

		const killedSession = state.sessions[sessionIndex];
		const previousAttachedIndex = state.attachedSessionIndex;
		const newSessions = state.sessions.filter((_, i) => i !== sessionIndex);

		// Adjust attached session index if needed
		let newAttachedIndex = previousAttachedIndex;

		if (previousAttachedIndex === sessionIndex) {
			// Killing the attached session exits tmux when no sessions remain.
			if (newSessions.length === 0) {
				newAttachedIndex = null;
			} else {
				// Otherwise, attach to the previous session, or the first remaining one.
				newAttachedIndex = Math.max(0, sessionIndex - 1);
				if (newAttachedIndex >= newSessions.length) {
					newAttachedIndex = newSessions.length - 1;
				}
			}
		} else if (previousAttachedIndex !== null && sessionIndex < previousAttachedIndex) {
			// Killed a session before the attached one - adjust index
			newAttachedIndex = previousAttachedIndex - 1;
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

		// If we attached to a different remaining session, emit that signal too.
		if (newAttachedIndex !== null && newAttachedIndex !== previousAttachedIndex) {
			const newAttachedSession = newSessions[newAttachedIndex];
			emitSignal('session-attached', {
				sessionId: newAttachedSession.id,
				sessionName: newAttachedSession.name
			});
			triggerInputFocus();
		} else if (newAttachedIndex === null && previousAttachedIndex === sessionIndex) {
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
					addHistory({
						type: 'error',
						content: `can't find session: ${operation.target}`,
						timestamp: Date.now()
					});
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
			case 'switch': {
				// Relative session switch. Silent no-op when detached or only one
				// session exists, mirroring next-window/previous-window behavior.
				switchSessionRelative(operation.direction);
				break;
			}
			case 'kill-server': {
				const killed = killServer();
				if (killed) {
					setMode('default');
					addHistory({
						type: 'system',
						content: '[killed server]',
						timestamp: Date.now()
					});
				} else {
					addHistory({
						type: 'error',
						content: 'no server running',
						timestamp: Date.now()
					});
				}
				break;
			}
		}
	}

	/**
	 * Handle a pane operation from a command result.
	 * This bridges the command system with the pane management methods.
	 */
	function handlePaneOperation(operation: PaneOperation): void {
		switch (operation.type) {
			case 'split': {
				splitFocusedPane(operation.direction);
				break;
			}
			case 'kill': {
				// Note: When executed via text command/command-prompt, skip confirmation
				// This matches real tmux behavior where text commands execute immediately
				if (paneCount > 1) {
					closeFocusedPane();
				} else if (windowCount > 1) {
					// Last pane in window - close window
					closeWindow();
					addHistory({
						type: 'system',
						content: '[window closed]',
						timestamp: Date.now()
					});
				} else {
					// Last pane in last window - detach
					const detachedName = detachFromSession();
					if (detachedName !== null) {
						setMode('default');
						addHistory({
							type: 'system',
							content: `[exited (from session ${detachedName})]`,
							timestamp: Date.now()
						});
					}
				}
				break;
			}
			case 'toggle-zoom': {
				if (paneCount > 1) {
					togglePaneZoom();
				}
				break;
			}
			case 'rotate': {
				if (paneCount > 1) {
					rotateWindowPanes();
				}
				break;
			}
			case 'swap': {
				if (paneCount > 1) {
					if (operation.direction === 'next') {
						swapPaneWithNext();
					} else {
						swapPaneWithPrevious();
					}
				}
				break;
			}
			case 'focus': {
				moveFocus(operation.direction);
				break;
			}
			case 'focus-next': {
				focusNextPane();
				break;
			}
			case 'focus-previous': {
				focusPreviousPane();
				break;
			}
			case 'focus-last': {
				focusLastPane();
				break;
			}
		}
	}

	/**
	 * Handle a window operation from a command result.
	 * This bridges the command system with the window management methods.
	 */
	function handleWindowOperation(operation: WindowOperation): void {
		switch (operation.type) {
			case 'create': {
				createNewWindow(operation.name);
				break;
			}
			case 'close': {
				const targetIndex = operation.index ?? activeWindowIndex;
				const success = killWindow(operation.index);
				if (!success) {
					addHistory({
						type: 'error',
						content: `window ${targetIndex} not found`,
						timestamp: Date.now()
					});
				}
				break;
			}
			case 'switch': {
				if (operation.index >= 0 && operation.index < windowCount) {
					switchWindow(operation.index);
				} else {
					addHistory({
						type: 'error',
						content: `window ${operation.index} not found`,
						timestamp: Date.now()
					});
				}
				break;
			}
			case 'next': {
				nextWindow();
				break;
			}
			case 'previous': {
				previousWindow();
				break;
			}
			case 'rename': {
				renameWindow(operation.name, operation.index);
				break;
			}
			case 'last': {
				// Toggle to previous window (tmux "last-window" behavior)
				if (windowCount > 1) {
					previousWindow();
				}
				break;
			}
			case 'list': {
				const output = generateOutput('window-list');
				if (output) {
					addHistory({ type: 'output', content: output, timestamp: Date.now() });
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
	 * This low-level helper refuses to close the last remaining window.
	 *
	 * @param index - Window index to close (defaults to active window)
	 * @returns true if closed, false if the index is invalid or it is the last window
	 */
	function closeWindow(index?: number): boolean {
		const currentSession = attachedSession;
		if (!currentSession) {
			return false;
		}

		const targetIndex = index ?? currentSession.activeWindowIndex;
		if (targetIndex < 0 || targetIndex >= currentSession.windows.length) {
			return false;
		}

		// Guard: cannot close last window
		if (currentSession.windows.length <= 1) {
			return false;
		}

		const closedWindow = currentSession.windows[targetIndex];
		const newWindows = currentSession.windows.filter((_, i) => i !== targetIndex);

		// Adjust active index if needed
		let newActiveIndex = currentSession.activeWindowIndex;
		if (targetIndex <= currentSession.activeWindowIndex) {
			newActiveIndex = Math.max(0, currentSession.activeWindowIndex - 1);
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
	 * Kill the attached session and always return to the default shell.
	 * Unlike kill-session, this does not auto-attach to another remaining session.
	 *
	 * @returns The killed session name, or null if no session was attached
	 */
	function killAttachedSessionAndDetach(): string | null {
		const currentAttachedIndex = state.attachedSessionIndex;
		if (currentAttachedIndex === null) {
			return null;
		}

		const killedSession = state.sessions[currentAttachedIndex];

		state = {
			...state,
			sessions: state.sessions.filter((_, index) => index !== currentAttachedIndex),
			attachedSessionIndex: null
		};

		emitSignal('session-killed', {
			sessionId: killedSession.id,
			sessionName: killedSession.name
		});

		triggerInputFocus();

		return killedSession.name;
	}

	/**
	 * Kill the tmux server: destroy every session and detach to the shell.
	 *
	 * No-op when no sessions exist (no server running). Emits a session-killed
	 * signal for each destroyed session so challenge tracking and listeners stay
	 * consistent with single-session kills.
	 *
	 * @returns true if any sessions were destroyed
	 */
	function killServer(): boolean {
		if (state.sessions.length === 0) {
			return false;
		}

		const killedSessions = state.sessions;

		state = {
			...state,
			sessions: [],
			attachedSessionIndex: null
		};

		for (const session of killedSessions) {
			emitSignal('session-killed', {
				sessionId: session.id,
				sessionName: session.name
			});
		}

		triggerInputFocus();

		return true;
	}

	/**
	 * Kill a window by index.
	 * If the target is the session's last window, destroy the session and exit tmux mode.
	 *
	 * @param index - Window index to kill (defaults to active window)
	 * @returns true if the command succeeded
	 */
	function killWindow(index?: number): boolean {
		const currentSession = attachedSession;
		if (!currentSession) {
			return false;
		}

		const targetIndex = index ?? currentSession.activeWindowIndex;
		if (targetIndex < 0 || targetIndex >= currentSession.windows.length) {
			return false;
		}

		if (currentSession.windows.length === 1) {
			const killedSessionName = killAttachedSessionAndDetach();
			if (killedSessionName === null) {
				return false;
			}

			addHistory({
				type: 'system',
				content: `[killed session ${killedSessionName}]`,
				timestamp: Date.now()
			});

			return true;
		}

		return closeWindow(targetIndex);
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

		// Clear zoom if the zoomed pane is being closed, or if only one pane remains
		const shouldClearZoom = activeWindow.zoomedPaneId === closedPaneId || allPanes.length <= 1;

		// Update the tree and zoom state together
		if (state.attachedSessionIndex !== null) {
			state = {
				...state,
				sessions: state.sessions.map((session, sessionIdx) => {
					if (sessionIdx !== state.attachedSessionIndex) {
						return session;
					}

					return {
						...session,
						windows: session.windows.map((w, windowIdx) =>
							windowIdx === session.activeWindowIndex
								? {
										...w,
										paneTree: newTree,
										zoomedPaneId: shouldClearZoom ? null : w.zoomedPaneId
									}
								: w
						)
					};
				})
			};
		}

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

	/**
	 * Toggle zoom on the focused pane.
	 * When zoomed, the focused pane takes up the entire window.
	 * Toggling again restores the original pane layout.
	 *
	 * Note: Zoom only works when there are multiple panes in the window.
	 */
	function togglePaneZoom(): boolean {
		if (!attachedSession || !activeWindow) {
			return false;
		}

		// Only allow zoom when there are multiple panes
		if (paneCount <= 1) {
			return false;
		}

		const currentZoomedPaneId = activeWindow.zoomedPaneId;
		let newZoomedPaneId: string | null;

		if (currentZoomedPaneId === null) {
			// Not zoomed - zoom the focused pane
			newZoomedPaneId = focusedPaneId;
		} else {
			// Already zoomed - unzoom (restore original layout)
			newZoomedPaneId = null;
		}

		// Update the window's zoomedPaneId
		state = {
			...state,
			sessions: state.sessions.map((session, sessionIdx) => {
				if (sessionIdx !== state.attachedSessionIndex) {
					return session;
				}

				return {
					...session,
					windows: session.windows.map((w, windowIdx) =>
						windowIdx === session.activeWindowIndex ? { ...w, zoomedPaneId: newZoomedPaneId } : w
					)
				};
			})
		};

		// Emit signal for challenge tracking
		emitSignal('pane-split', {
			paneId: focusedPaneId,
			metadata: { action: 'toggle-zoom', zoomed: newZoomedPaneId !== null }
		});

		return true;
	}

	/**
	 * Rotate panes in the current window.
	 *
	 * This rotates the content (history, mode, inputValue) of panes in the window
	 * while keeping the structural layout unchanged. The rotation is based on
	 * creation order - each pane's content moves to the next pane in creation sequence.
	 *
	 * Example with 3 panes created in order A, B, C:
	 * - A's content → C
	 * - B's content → A
	 * - C's content → B
	 *
	 * @returns true if rotation was performed, false if not possible
	 */
	function rotateWindowPanes(): boolean {
		if (!activeWindow) {
			return false;
		}

		// Only rotate when there are multiple panes
		if (paneCount <= 1) {
			return false;
		}

		const newTree = rotatePanes(activeWindow.paneTree);
		updateActiveWindowTree(newTree);

		// Emit signal for challenge tracking
		emitSignal('pane-split', {
			paneId: focusedPaneId,
			metadata: { action: 'rotate-panes' }
		});

		return true;
	}

	/**
	 * Swap the focused pane's content with the next pane (higher index, wraps around).
	 *
	 * Panes are ordered by their index in the collected panes array (0, 1, 2, ...).
	 * If the focused pane is at index N, this swaps with pane at index (N+1) % total.
	 *
	 * After swapping, focus moves to the target pane so the user's cursor stays
	 * with their original content (which is now in the target pane's position).
	 *
	 * @returns true if swap was performed, false if not possible
	 */
	function swapPaneWithNext(): boolean {
		if (!activeWindow) {
			return false;
		}

		// Only swap when there are multiple panes
		if (paneCount <= 1) {
			return false;
		}

		const allPanes = collectAllPanes(activeWindow.paneTree);
		const currentIndex = allPanes.findIndex((p) => p.id === focusedPaneId);

		if (currentIndex === -1) {
			return false;
		}

		// Get the next pane (wrap around)
		const nextIndex = (currentIndex + 1) % allPanes.length;
		const targetPane = allPanes[nextIndex];

		const newTree = swapPaneContent(activeWindow.paneTree, focusedPaneId, targetPane.id);
		updateActiveWindowTree(newTree);

		// Move focus to the target pane (where our original content now lives)
		setFocusedPane(targetPane.id);

		// Emit signal for challenge tracking
		emitSignal('pane-split', {
			paneId: targetPane.id,
			metadata: { action: 'swap-pane', direction: 'next' }
		});

		return true;
	}

	/**
	 * Swap the focused pane's content with the previous pane (lower index, wraps around).
	 *
	 * Panes are ordered by their index in the collected panes array (0, 1, 2, ...).
	 * If the focused pane is at index N, this swaps with pane at index (N-1+total) % total.
	 *
	 * After swapping, focus moves to the target pane so the user's cursor stays
	 * with their original content (which is now in the target pane's position).
	 *
	 * @returns true if swap was performed, false if not possible
	 */
	function swapPaneWithPrevious(): boolean {
		if (!activeWindow) {
			return false;
		}

		// Only swap when there are multiple panes
		if (paneCount <= 1) {
			return false;
		}

		const allPanes = collectAllPanes(activeWindow.paneTree);
		const currentIndex = allPanes.findIndex((p) => p.id === focusedPaneId);

		if (currentIndex === -1) {
			return false;
		}

		// Get the previous pane (wrap around)
		const prevIndex = (currentIndex - 1 + allPanes.length) % allPanes.length;
		const targetPane = allPanes[prevIndex];

		const newTree = swapPaneContent(activeWindow.paneTree, focusedPaneId, targetPane.id);
		updateActiveWindowTree(newTree);

		// Move focus to the target pane (where our original content now lives)
		setFocusedPane(targetPane.id);

		// Emit signal for challenge tracking
		emitSignal('pane-split', {
			paneId: targetPane.id,
			metadata: { action: 'swap-pane', direction: 'previous' }
		});

		return true;
	}

	// ========================================================================
	// PANE CONTENT OPERATIONS
	// ========================================================================

	/**
	 * Add a history entry to a pane.
	 */
	function addHistory(entry: HistoryEntry, paneId?: string): void {
		// When detached, add history to the shell pane
		if (isDetachedState()) {
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

	function updateFocusedEditorState(updates: Partial<NonNullable<Pane['editorState']>>): void {
		const currentPane = getFocusedPaneState();
		if (!currentPane?.editorState) {
			return;
		}

		updateFocusedPane({
			editorState: {
				...currentPane.editorState,
				...updates
			}
		});
	}

	function openConfigEditor(): void {
		const currentPane = getFocusedPaneState();
		if (!currentPane) {
			return;
		}

		const nextMode = currentPane.mode;
		updateFocusedPane({
			mode: 'editor',
			previousMode: nextMode,
			editorState: {
				filePath: TMUX_CONFIG_PATH,
				buffer: tmuxConfigStore.fileText,
				insertMode: true,
				commandLine: '',
				isDirty: false
			},
			inputValue: ''
		});
		triggerInputFocus();
	}

	function closeConfigEditor(discard = false): void {
		const currentPane = getFocusedPaneState();
		if (!currentPane?.editorState) {
			return;
		}

		const previousMode = currentPane.previousMode ?? 'default';
		const historyMessage = discard
			? `[discarded changes to ${currentPane.editorState.filePath}]`
			: `[wrote ${currentPane.editorState.filePath}]`;

		updateFocusedPane({
			mode: previousMode,
			previousMode: undefined,
			editorState: undefined
		});

		addHistory({
			type: 'system',
			content: historyMessage,
			timestamp: Date.now()
		});
		triggerInputFocus();
	}

	function saveConfigEditor(): void {
		const currentPane = getFocusedPaneState();
		if (!currentPane?.editorState) {
			return;
		}

		tmuxConfigStore.setFileText(currentPane.editorState.buffer);
		closeConfigEditor(false);
	}

	function setConfigEditorBuffer(buffer: string): void {
		const currentPane = getFocusedPaneState();
		if (!currentPane?.editorState) {
			return;
		}

		updateFocusedEditorState({
			buffer,
			isDirty: buffer !== tmuxConfigStore.fileText
		});
	}

	function setConfigEditorInsertMode(insertMode: boolean): void {
		updateFocusedEditorState({
			insertMode
		});
	}

	function setConfigEditorCommandLine(commandLine: string): void {
		updateFocusedEditorState({
			commandLine
		});
	}

	function handleConfigOperation(operation: ConfigOperation): void {
		if (operation.type !== 'reload') {
			return;
		}

		const result = tmuxConfigStore.reloadFromPath(operation.path);
		if (!result.ok) {
			addHistory({
				type: 'error',
				content: result.error ?? `can't read ${operation.path}`,
				timestamp: Date.now()
			});
			return;
		}

		addHistory({
			type: 'system',
			content: `[tmux config reloaded from ${result.path}]`,
			timestamp: Date.now()
		});

		for (const warning of result.warnings) {
			const warningPrefix = warning.severity === 'error' ? 'error' : 'warning';
			addHistory({
				type: warning.severity === 'error' ? 'error' : 'system',
				content: `[tmux.conf ${warningPrefix}] line ${warning.line}: ${warning.message}`,
				timestamp: Date.now()
			});
		}
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

	function executeRegisteredTmuxCommand(commandText: string): boolean {
		if (!focusedPane || focusedPane.mode !== 'tmux') {
			return false;
		}

		const execution = executeCommand(commandText, focusedPane.id, focusedPane.mode);
		if (!execution || !execution.result.handled) {
			return false;
		}

		const { result, commandName } = execution;

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

		if (result.exitBehavior === 'close-pane-or-detach') {
			if (paneCount > 1) {
				closeFocusedPane();
				addHistory({
					type: 'system',
					content: '[pane closed]',
					timestamp: Date.now()
				});
			} else {
				const detachedSessionName = detachFromSession();
				setMode('default');
				addHistory({
					type: 'system',
					content: `[detached (from session ${detachedSessionName ?? '0'})]`,
					timestamp: Date.now()
				});
			}
		}

		if (result.sessionOperation) {
			handleSessionOperation(result.sessionOperation);
		}

		if (result.paneOperation) {
			handlePaneOperation(result.paneOperation);
		}

		if (result.windowOperation) {
			handleWindowOperation(result.windowOperation);
		}

		if (result.configOperation) {
			handleConfigOperation(result.configOperation);
		}

		emitSignal('command-executed', {
			commandName,
			command: commandName,
			paneId: focusedPane.id
		});

		triggerInputFocus();
		return true;
	}

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

		if (
			trimmedCommand === `vi ${TMUX_CONFIG_PATH}` ||
			trimmedCommand === `vim ${TMUX_CONFIG_PATH}`
		) {
			openConfigEditor();
			return;
		}

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

					if (result.configOperation) {
						handleConfigOperation(result.configOperation);
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
							case 'kill-server': {
								// Kill background sessions from the shell; stay in default mode.
								const killed = killServer();
								addHistory({
									type: killed ? 'system' : 'error',
									content: killed ? '[killed server]' : 'no server running',
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

			if (executeRegisteredTmuxCommand(trimmedCommand)) {
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
			return state.sessions;
		},
		get attachedSessionIndex() {
			return state.attachedSessionIndex;
		},
		get attachedSession() {
			return getAttachedSessionState();
		},
		get sessionCount() {
			return state.sessions.length;
		},
		get isDetached() {
			return isDetachedState();
		},
		get pasteBuffers() {
			return state.pasteBuffers;
		},
		get latestPasteBuffer() {
			return getLatestPasteBufferState();
		},

		// Window/Pane state (scoped to attached session, or shell pane when detached)
		get windows() {
			return getAttachedSessionState()?.windows ?? [];
		},
		get activeWindowIndex() {
			return getAttachedSessionState()?.activeWindowIndex ?? 0;
		},
		get activeWindow() {
			return getActiveWindowState();
		},
		get focusedPaneId() {
			return isDetachedState()
				? state.shellPane.id
				: (getAttachedSessionState()?.focusedPaneId ?? '');
		},
		get focusedPane() {
			return getFocusedPaneState();
		},
		get allPanesInActiveWindow() {
			if (isDetachedState()) {
				return [state.shellPane];
			}

			const currentActiveWindow = getActiveWindowState();

			return currentActiveWindow ? collectAllPanes(currentActiveWindow.paneTree) : [];
		},
		get paneCount() {
			if (isDetachedState()) {
				return 1;
			}

			const currentActiveWindow = getActiveWindowState();

			return currentActiveWindow ? countPanes(currentActiveWindow.paneTree) : 0;
		},
		get windowCount() {
			return getAttachedSessionState()?.windows.length ?? 0;
		},
		get zoomedPaneId() {
			return getActiveWindowState()?.zoomedPaneId ?? null;
		},
		get isZoomed() {
			return (getActiveWindowState()?.zoomedPaneId ?? null) !== null;
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
		killWindow,
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
		togglePaneZoom,
		rotatePanes: rotateWindowPanes,
		swapPaneWithNext,
		swapPaneWithPrevious,

		// Pane content
		addHistory,
		clearHistory,
		setMode,
		exitManMode,
		setInput,
		updateFocusedPane,
		openConfigEditor,
		closeConfigEditor,
		saveConfigEditor,
		setConfigEditorBuffer,
		setConfigEditorInsertMode,
		setConfigEditorCommandLine,
		setPaneCopyState,
		enterCopyMode,
		exitCopyMode,
		clearCopySelection,
		pushPasteBuffer,

		// Prefix mode
		togglePrefix,
		activatePrefix,
		deactivatePrefix,

		// Command processing
		processCommand,
		executeRegisteredTmuxCommand,
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
