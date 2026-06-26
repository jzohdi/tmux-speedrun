import { describe, expect, it } from 'vitest';

import { createTmuxStore } from './tmux-state.svelte';
import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';
import {
	createPane,
	createSession,
	createWindow,
	findPaneById,
	splitPane,
	type Pane
} from '$lib/utils/pane-tree';

describe('createTmuxStore session killing', () => {
	it('allows killing the last remaining session', async () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		const wasKilled = store.killSession();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(wasKilled).toBe(true);
		expect(store.sessionCount).toBe(0);
		expect(store.attachedSessionIndex).toBeNull();
		expect(store.isDetached).toBe(true);
		expect(store.focusedPane?.mode).toBe('default');
	});

	it('attaches to another remaining session after killing the active one', () => {
		tmuxConfigStore.resetForTesting();
		const signals: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				signals.push(`${signal.type}:${signal.sessionName ?? ''}`);
			}
		});

		store.createSession('worktree', true);
		signals.length = 0;
		store.killSession();

		expect(store.sessionCount).toBe(1);
		expect(store.attachedSession?.name).toBe('0');
		expect(signals).toContain('session-killed:worktree');
		expect(signals).toContain('session-attached:0');
	});
});

describe('createTmuxStore kill-window command', () => {
	it('kills the current session and still emits kill-window when closing the last window', () => {
		tmuxConfigStore.resetForTesting();
		const signals: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					signals.push(`command-executed:${signal.commandName}`);
					return;
				}

				if (signal.type === 'session-killed') {
					signals.push(`session-killed:${signal.sessionName ?? ''}`);
				}
			}
		});

		const wasHandled = store.executeRegisteredTmuxCommand('kill-window');

		expect(wasHandled).toBe(true);
		expect(store.sessionCount).toBe(0);
		expect(store.attachedSessionIndex).toBeNull();
		expect(store.isDetached).toBe(true);
		expect(store.focusedPane?.mode).toBe('default');
		expect(store.focusedPane?.history.at(-1)?.content).toBe('[killed session 0]');
		expect(signals).toContain('session-killed:0');
		expect(signals).toContain('command-executed:kill-window');
	});

	it('exits tmux instead of auto-attaching to another session when the last window is killed', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.createSession('worktree', false);
		store.executeRegisteredTmuxCommand('kill-window');

		expect(store.sessionCount).toBe(1);
		expect(store.sessions[0]?.name).toBe('worktree');
		expect(store.attachedSessionIndex).toBeNull();
		expect(store.isDetached).toBe(true);
		expect(store.focusedPane?.mode).toBe('default');
	});
});

describe('createTmuxStore reload config command', () => {
	it('reloads config from default mode via tmux source-file', () => {
		tmuxConfigStore.resetForTesting();
		tmuxConfigStore.setFileText('set -g prefix C-a');
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.processCommand('tmux source-file ~/.tmux.conf');

		expect(store.focusedPane?.history.at(-1)?.content).toBe(
			'[tmux config reloaded from ~/.tmux.conf]'
		);
		expect(tmuxConfigStore.activeConfig.prefixKey?.key).toBe('a');
		expect(commandNames).toContain('reload-config');
	});

	it('reloads config from tmux mode via source alias', () => {
		tmuxConfigStore.resetForTesting();
		tmuxConfigStore.setFileText('bind-key y kill-session');
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.setMode('tmux');
		store.processCommand('source ~/.tmux.conf');

		expect(store.focusedPane?.history.at(-1)?.content).toBe(
			'[tmux config reloaded from ~/.tmux.conf]'
		);
		expect(tmuxConfigStore.activeConfig.bindings.some((binding) => binding.key === 'y')).toBe(true);
		expect(commandNames).toContain('reload-config');
	});

	it('opens vi for tmux.conf and saves with :wq', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.processCommand('vi ~/.tmux.conf');
		expect(store.focusedPane?.mode).toBe('editor');
		expect(store.focusedPane?.editorState?.insertMode).toBe(true);

		store.setConfigEditorBuffer('bind-key y kill-session');
		store.setConfigEditorInsertMode(false);
		store.setConfigEditorCommandLine('wq');
		store.saveConfigEditor();

		expect(tmuxConfigStore.fileText).toBe('bind-key y kill-session');
		expect(store.focusedPane?.mode).toBe('tmux');
		expect(store.focusedPane?.history.at(-1)?.content).toBe('[wrote ~/.tmux.conf]');
	});

	it('emits canonical command names for executed bound tmux commands', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.executeRegisteredTmuxCommand('kill-session');

		expect(commandNames).toContain('kill-session');
	});

	it('emits new-window for the new-window binding text', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.executeRegisteredTmuxCommand('new-window');

		expect(commandNames).toContain('new-window');
		expect(commandNames).not.toContain('new-session');
		expect(store.windowCount).toBe(2);
	});

	it('executes split-window -h as split-vertical, not split-horizontal', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.executeRegisteredTmuxCommand('split-window -h');

		expect(commandNames).toContain('split-vertical');
		expect(commandNames).not.toContain('split-horizontal');
		expect(store.paneCount).toBe(2);
	});
});

describe('createTmuxStore copy mode foundations', () => {
	it('creates and clears copy mode state for the focused pane', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		const copyState = store.enterCopyMode({
			initialState: {
				cursor: { row: 3, column: 7 },
				viewportTopRow: 2
			}
		});

		expect(copyState.activeKeyTable).toBe('copy-mode');
		expect(store.focusedPane?.copyState).toEqual({
			activeKeyTable: 'copy-mode',
			cursor: { row: 3, column: 7 },
			viewportTopRow: 2,
			selectionAnchor: null,
			dragAnchor: null
		});

		store.exitCopyMode();

		expect(store.focusedPane?.copyState).toBeNull();
	});

	it('uses copy-mode-vi when tmux.conf sets mode-keys to vi', () => {
		tmuxConfigStore.resetForTesting();
		tmuxConfigStore.setFileText('set -g mode-keys vi');
		tmuxConfigStore.applySavedConfig();
		const store = createTmuxStore();

		store.enterCopyMode();

		expect(store.focusedPane?.copyState?.activeKeyTable).toBe('copy-mode-vi');
	});

	it('clears copy selection while preserving cursor position', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.enterCopyMode({
			initialState: {
				cursor: { row: 5, column: 9 },
				selectionAnchor: { row: 2, column: 1 },
				dragAnchor: { row: 4, column: 3 }
			}
		});

		store.clearCopySelection();

		expect(store.focusedPane?.copyState).toEqual({
			activeKeyTable: 'copy-mode',
			cursor: { row: 5, column: 9 },
			viewportTopRow: 0,
			selectionAnchor: null,
			dragAnchor: null
		});
	});

	it('preserves copy mode state on the original pane across window switching', () => {
		tmuxConfigStore.resetForTesting();
		const firstSession = createSession('0');
		const originalPane = firstSession.windows[0]?.paneTree;
		if (!originalPane || originalPane.type !== 'pane') {
			throw new Error('Expected first session to start with a pane');
		}

		originalPane.copyState = {
			activeKeyTable: 'copy-mode-vi',
			cursor: { row: 8, column: 2 },
			viewportTopRow: 0,
			selectionAnchor: null,
			dragAnchor: null
		};

		const secondWindow = createWindow('notes');
		const store = createTmuxStore({
			initialState: {
				sessions: [
					{
						...firstSession,
						windows: [firstSession.windows[0], secondWindow]
					}
				],
				attachedSessionIndex: 0,
				shellPane: createPane('default'),
				pasteBuffers: []
			}
		});
		const originalPaneId = originalPane.id;

		store.switchWindow(1);

		expect(store.focusedPane?.copyState).toBeNull();

		store.switchWindow(0);

		const restoredPane = findPaneById(store.windows[0].paneTree, originalPaneId);

		expect(restoredPane?.copyState).toEqual({
			activeKeyTable: 'copy-mode-vi',
			cursor: { row: 8, column: 2 },
			viewportTopRow: 0,
			selectionAnchor: null,
			dragAnchor: null
		});
	});
});

describe('createTmuxStore paste buffer foundations', () => {
	it('stores newest paste buffers first with generated names', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		const firstBuffer = store.pushPasteBuffer('alpha');
		const secondBuffer = store.pushPasteBuffer('beta');

		expect(firstBuffer?.name).toBe('buffer0001');
		expect(secondBuffer?.name).toBe('buffer0002');
		expect(store.latestPasteBuffer).toEqual(secondBuffer);
		expect(store.pasteBuffers.map((buffer) => buffer.content)).toEqual(['beta', 'alpha']);
	});

	it('keeps paste buffers across session changes and clears them on reset', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.pushPasteBuffer('copied-text');
		store.createSession('worktree', true);
		store.detachSession();
		store.attachSession('0');

		expect(store.latestPasteBuffer?.content).toBe('copied-text');

		store.reset();

		expect(store.pasteBuffers).toEqual([]);
		expect(store.latestPasteBuffer).toBeNull();
		expect(store.focusedPane?.copyState).toBeNull();
	});
});

describe('createTmuxStore session navigation', () => {
	it('cycles forward through sessions with next-session, wrapping around', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.createSession('1', true);
		store.createSession('2', true);
		expect(store.attachedSessionIndex).toBe(2);

		expect(store.executeRegisteredTmuxCommand('next-session')).toBe(true);
		expect(store.attachedSessionIndex).toBe(0); // wraps 2 -> 0

		store.executeRegisteredTmuxCommand('next-session');
		expect(store.attachedSessionIndex).toBe(1);
	});

	it('cycles backward through sessions with previous-session, wrapping around', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.createSession('1', true);
		store.createSession('2', true);
		expect(store.attachedSessionIndex).toBe(2);

		store.executeRegisteredTmuxCommand('previous-session');
		expect(store.attachedSessionIndex).toBe(1);

		store.executeRegisteredTmuxCommand('previous-session'); // 1 -> 0
		store.executeRegisteredTmuxCommand('previous-session'); // 0 -> wraps to 2
		expect(store.attachedSessionIndex).toBe(2);
	});

	it('is a no-op when only one session exists', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		expect(store.attachedSessionIndex).toBe(0);

		store.executeRegisteredTmuxCommand('next-session');
		expect(store.attachedSessionIndex).toBe(0);

		store.executeRegisteredTmuxCommand('previous-session');
		expect(store.attachedSessionIndex).toBe(0);
	});

	it('is a no-op when detached, even with multiple sessions', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.createSession('1', true);
		store.createSession('2', true);
		store.detachSession();
		expect(store.attachedSessionIndex).toBeNull();

		store.executeRegisteredTmuxCommand('next-session');
		expect(store.attachedSessionIndex).toBeNull();

		store.executeRegisteredTmuxCommand('previous-session');
		expect(store.attachedSessionIndex).toBeNull();
	});

	it('emits command-executed and session-attached when switching sessions', () => {
		tmuxConfigStore.resetForTesting();
		const signals: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					signals.push(`cmd:${signal.commandName}`);
				}
				if (signal.type === 'session-attached') {
					signals.push('session-attached');
				}
			}
		});
		store.createSession('1', true);
		signals.length = 0;

		store.executeRegisteredTmuxCommand('next-session'); // 1 -> 0
		expect(store.attachedSessionIndex).toBe(0);
		expect(signals).toContain('cmd:next-session');
		expect(signals).toContain('session-attached');
	});
});

describe('createTmuxStore kill-server command', () => {
	it('destroys every session and returns to the shell (tmux mode)', () => {
		tmuxConfigStore.resetForTesting();
		const signals: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					signals.push(`cmd:${signal.commandName}`);
				}
				if (signal.type === 'session-killed') {
					signals.push('session-killed');
				}
			}
		});
		store.createSession('alpha', true);
		store.createSession('beta', true);
		expect(store.sessionCount).toBe(3);

		const handled = store.executeRegisteredTmuxCommand('kill-server');

		expect(handled).toBe(true);
		expect(store.sessionCount).toBe(0);
		expect(store.attachedSessionIndex).toBeNull();
		expect(store.isDetached).toBe(true);
		expect(store.focusedPane?.mode).toBe('default');
		expect(store.focusedPane?.history.at(-1)?.content).toBe('[killed server]');
		expect(signals).toContain('cmd:kill-server');
		// One session-killed signal per destroyed session.
		expect(signals.filter((s) => s === 'session-killed')).toHaveLength(3);
	});

	it('kills background sessions when run from the shell', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.createSession('bg', false); // exists in background; still attached to session 0
		store.detachSession();
		expect(store.isDetached).toBe(true);
		expect(store.sessionCount).toBe(2);

		store.processCommand('tmux kill-server');

		expect(store.sessionCount).toBe(0);
		expect(store.focusedPane?.mode).toBe('default');
		expect(store.focusedPane?.history.at(-1)?.content).toBe('[killed server]');
	});

	it('reports no server running when there are no sessions', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.executeRegisteredTmuxCommand('kill-server'); // kills the only session
		expect(store.sessionCount).toBe(0);

		store.processCommand('tmux kill-server'); // nothing left to kill

		expect(store.sessionCount).toBe(0);
		expect(store.focusedPane?.history.at(-1)?.content).toBe('no server running');
	});

	it('reports no server running via the registered-command path when no sessions exist', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.executeRegisteredTmuxCommand('kill-server'); // kills the only session
		expect(store.sessionCount).toBe(0);

		store.executeRegisteredTmuxCommand('kill-server'); // nothing left to kill

		expect(store.sessionCount).toBe(0);
		expect(store.focusedPane?.history.at(-1)?.content).toBe('no server running');
	});
});

describe('createTmuxStore list-buffers command', () => {
	it('shows "no buffers" when there are none', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('list-buffers');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('no buffers');
	});

	it('lists buffers newest-first with byte counts', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello');
		store.pushPasteBuffer('world');

		store.executeRegisteredTmuxCommand('list-buffers');

		expect(store.focusedPane?.history.at(-1)?.content).toBe(
			'buffer0002: 5 bytes: "world"\nbuffer0001: 5 bytes: "hello"'
		);
	});

	it('resolves the lsb alias to the same buffer list', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello');

		store.executeRegisteredTmuxCommand('lsb');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('buffer0001: 5 bytes: "hello"');
	});

	it('collapses newlines in the preview but reports the full byte length', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('line1\nline2');

		store.executeRegisteredTmuxCommand('list-buffers');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('buffer0001: 11 bytes: "line1 line2"');
	});

	it('truncates long previews while keeping the true byte length', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('x'.repeat(60));

		store.executeRegisteredTmuxCommand('list-buffers');

		expect(store.focusedPane?.history.at(-1)?.content).toBe(
			`buffer0001: 60 bytes: "${'x'.repeat(50)}…"`
		);
	});

	it('emits command-executed for list-buffers', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.executeRegisteredTmuxCommand('list-buffers');

		expect(commandNames).toContain('list-buffers');
	});
});

describe('createTmuxStore show-buffer command', () => {
	it('shows "no buffers" when there are none', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('show-buffer');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('no buffers');
	});

	it('prints the latest buffer contents by default', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello');
		store.pushPasteBuffer('world');

		store.executeRegisteredTmuxCommand('show-buffer');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('world');
	});

	it('prints a specific buffer by name with -b', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello'); // buffer0001
		store.pushPasteBuffer('world'); // buffer0002

		store.executeRegisteredTmuxCommand('show-buffer -b buffer0001');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('hello');
	});

	it('prints multi-line buffer content verbatim', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('line1\nline2');

		store.executeRegisteredTmuxCommand('show-buffer');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('line1\nline2');
	});

	it('errors when the named buffer is not found', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello');

		store.executeRegisteredTmuxCommand('show-buffer -b buffer9999');

		expect(store.focusedPane?.history.at(-1)?.content).toBe("can't find buffer: buffer9999");
	});

	it('resolves the showb alias to the latest buffer', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello');

		store.executeRegisteredTmuxCommand('showb');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('hello');
	});

	it('shows the buffer from the shell with the tmux prefix', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello'); // global buffer, survives detach
		store.detachSession();
		expect(store.isDetached).toBe(true);

		store.processCommand('tmux show-buffer');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('hello');
	});

	it('emits command-executed for show-buffer', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});
		store.pushPasteBuffer('hello');

		store.executeRegisteredTmuxCommand('show-buffer');

		expect(commandNames).toContain('show-buffer');
	});
});

describe('createTmuxStore delete-buffer command', () => {
	it('shows "no buffers" when there are none', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('delete-buffer');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('no buffers');
	});

	it('deletes the most recent buffer by default', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello'); // buffer0001
		store.pushPasteBuffer('world'); // buffer0002 (latest)

		store.executeRegisteredTmuxCommand('delete-buffer');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('[deleted buffer buffer0002]');
		expect(store.pasteBuffers).toHaveLength(1);
		expect(store.latestPasteBuffer?.content).toBe('hello');
	});

	it('deletes a specific buffer by name with -b', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello'); // buffer0001
		store.pushPasteBuffer('world'); // buffer0002

		store.executeRegisteredTmuxCommand('delete-buffer -b buffer0001');

		expect(store.pasteBuffers.some((buffer) => buffer.name === 'buffer0001')).toBe(false);
		expect(store.latestPasteBuffer?.content).toBe('world');
	});

	it('errors and leaves buffers untouched when the named buffer is not found', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello');

		store.executeRegisteredTmuxCommand('delete-buffer -b buffer9999');

		expect(store.focusedPane?.history.at(-1)?.content).toBe("can't find buffer: buffer9999");
		expect(store.pasteBuffers).toHaveLength(1);
	});

	it('leaves an empty list when the only buffer is deleted, and show-buffer then reports none', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('only');

		store.executeRegisteredTmuxCommand('delete-buffer');

		expect(store.pasteBuffers).toHaveLength(0);
		expect(store.latestPasteBuffer).toBeNull();

		store.executeRegisteredTmuxCommand('show-buffer');
		expect(store.focusedPane?.history.at(-1)?.content).toBe('no buffers');
	});

	it('resolves the deleteb alias to delete the latest buffer', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.pushPasteBuffer('hello'); // buffer0001
		store.pushPasteBuffer('world'); // buffer0002 (latest)

		store.executeRegisteredTmuxCommand('deleteb');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('[deleted buffer buffer0002]');
		expect(store.latestPasteBuffer?.content).toBe('hello');
	});

	it('emits command-executed for delete-buffer', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});
		store.pushPasteBuffer('hello');

		store.executeRegisteredTmuxCommand('delete-buffer');

		expect(commandNames).toContain('delete-buffer');
	});
});

describe('createTmuxStore capture-pane command', () => {
	it('captures the focused pane history into a new buffer', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.addHistory({ type: 'output', content: 'hello', timestamp: Date.now() });

		store.executeRegisteredTmuxCommand('capture-pane');

		expect(store.latestPasteBuffer?.content).toBe('hello');
		expect(store.focusedPane?.history.at(-1)?.content).toBe('[captured pane to buffer buffer0001]');
	});

	it('joins multiple history entries with newlines', () => {
		tmuxConfigStore.resetForTesting();
		// Seed two history entries via initialState (a single addHistory works, but
		// two sequential ones are unreliable outside a reactive context).
		const session = createSession('0');
		const pane = findPaneById(session.windows[0].paneTree, session.focusedPaneId);
		if (!pane) {
			throw new Error('expected a focused pane');
		}
		pane.history = [
			{ type: 'output', content: 'line1', timestamp: 1 },
			{ type: 'output', content: 'line2', timestamp: 2 }
		];
		const store = createTmuxStore({
			initialState: {
				sessions: [session],
				attachedSessionIndex: 0,
				shellPane: createPane('default'),
				pasteBuffers: []
			}
		});

		store.executeRegisteredTmuxCommand('capture-pane');

		expect(store.latestPasteBuffer?.content).toBe('line1\nline2');
	});

	it('reports nothing to capture when the pane history is empty', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('capture-pane');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('[nothing to capture]');
		expect(store.latestPasteBuffer).toBeNull();
	});

	it('produces a buffer that show-buffer can display', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.addHistory({ type: 'output', content: 'captured text', timestamp: Date.now() });

		store.executeRegisteredTmuxCommand('capture-pane');
		store.executeRegisteredTmuxCommand('show-buffer');

		expect(store.focusedPane?.history.at(-1)?.content).toBe('captured text');
	});

	it('resolves the capturep alias', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.addHistory({ type: 'output', content: 'hello', timestamp: Date.now() });

		store.executeRegisteredTmuxCommand('capturep');

		expect(store.latestPasteBuffer?.content).toBe('hello');
		expect(store.focusedPane?.history.at(-1)?.content).toBe('[captured pane to buffer buffer0001]');
	});

	it('emits command-executed for capture-pane', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.executeRegisteredTmuxCommand('capture-pane');

		expect(commandNames).toContain('capture-pane');
	});
});

describe('createTmuxStore list-keys command', () => {
	it('lists the default prefix key bindings', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('list-keys');

		const output = store.focusedPane?.history.at(-1)?.content ?? '';
		expect(output).toContain('bind-key -T prefix c new-window');
		expect(output).toContain('bind-key -T prefix % split-window -h');
	});

	it('resolves the lsk alias to the same binding list', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('lsk');

		expect(store.focusedPane?.history.at(-1)?.content ?? '').toContain(
			'bind-key -T prefix c new-window'
		);
	});

	it('reflects tmux.conf overrides (unbind and rebind)', () => {
		tmuxConfigStore.resetForTesting();
		tmuxConfigStore.setFileText('unbind-key d\nbind-key y kill-session');
		tmuxConfigStore.applySavedConfig();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('list-keys');

		const output = store.focusedPane?.history.at(-1)?.content ?? '';
		expect(output).toContain('bind-key -T prefix y kill-session');
		expect(output).not.toContain('bind-key -T prefix d detach');
	});

	it('emits command-executed for list-keys', () => {
		tmuxConfigStore.resetForTesting();
		const commandNames: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					commandNames.push(signal.commandName);
				}
			}
		});

		store.executeRegisteredTmuxCommand('list-keys');

		expect(commandNames).toContain('list-keys');
	});
});

describe('createTmuxStore break-pane command', () => {
	// Build an attached store whose single window has two panes, with the second
	// (split-off) pane focused. Seeding via initialState avoids the unreliable
	// derived reads of chaining splitPane + addHistory/togglePaneZoom in a test.
	function createTwoPaneStore(options: { focusedContent?: string; zoomFocused?: boolean } = {}) {
		const session = createSession('0');
		const window = session.windows[0];
		const rootPane = window.paneTree as Pane;
		const result = splitPane(window.paneTree, rootPane.id, 'horizontal');
		if (!result) {
			throw new Error('expected split to succeed');
		}

		window.paneTree = result.tree;
		session.focusedPaneId = result.newPane.id;
		if (options.focusedContent) {
			result.newPane.history = [{ type: 'output', content: options.focusedContent, timestamp: 1 }];
		}
		if (options.zoomFocused) {
			window.zoomedPaneId = result.newPane.id;
		}

		return createTmuxStore({
			initialState: {
				sessions: [session],
				attachedSessionIndex: 0,
				shellPane: createPane('default'),
				pasteBuffers: []
			}
		});
	}

	it('breaks the focused pane into a new active window', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();
		store.splitPane('horizontal'); // 2 panes, focused on the new one
		const movedPaneId = store.focusedPaneId;
		expect(store.windowCount).toBe(1);
		expect(store.paneCount).toBe(2);

		const handled = store.executeRegisteredTmuxCommand('break-pane');

		expect(handled).toBe(true);
		expect(store.windowCount).toBe(2);
		expect(store.activeWindowIndex).toBe(1);
		expect(store.paneCount).toBe(1); // new window holds the single moved pane
		expect(store.focusedPaneId).toBe(movedPaneId);

		// Source window collapsed back to a single pane.
		store.switchWindow(0);
		expect(store.paneCount).toBe(1);
	});

	it('is a no-op when the window has only one pane', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTmuxStore();

		store.executeRegisteredTmuxCommand('break-pane');

		expect(store.windowCount).toBe(1);
		expect(store.paneCount).toBe(1);
	});

	it('preserves the moved pane history', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTwoPaneStore({ focusedContent: 'kept' });

		store.executeRegisteredTmuxCommand('break-pane');

		expect(store.focusedPane?.history.some((entry) => entry.content === 'kept')).toBe(true);
	});

	it('clears the source window zoom when the zoomed pane is broken out', () => {
		tmuxConfigStore.resetForTesting();
		const store = createTwoPaneStore({ zoomFocused: true });
		expect(store.isZoomed).toBe(true);

		store.executeRegisteredTmuxCommand('break-pane');

		expect(store.isZoomed).toBe(false); // new window is not zoomed
		store.switchWindow(0);
		expect(store.isZoomed).toBe(false); // source window zoom cleared
	});

	it('emits command-executed and window-created when breaking a pane', () => {
		tmuxConfigStore.resetForTesting();
		const signals: string[] = [];
		const store = createTmuxStore({
			onSignal: (signal) => {
				if (signal.type === 'command-executed' && signal.commandName) {
					signals.push(`cmd:${signal.commandName}`);
				}
				if (signal.type === 'window-created') {
					signals.push('window-created');
				}
			}
		});
		store.splitPane('horizontal');
		signals.length = 0;

		store.executeRegisteredTmuxCommand('break-pane');

		expect(signals).toContain('cmd:break-pane');
		expect(signals).toContain('window-created');
	});
});
