import { describe, expect, it } from 'vitest';

import { createTmuxStore } from './tmux-state.svelte';
import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';

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
