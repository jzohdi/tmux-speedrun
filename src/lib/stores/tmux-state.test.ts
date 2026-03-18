import { describe, expect, it } from 'vitest';

import { createTmuxStore } from './tmux-state.svelte';

describe('createTmuxStore session killing', () => {
	it('allows killing the last remaining session', async () => {
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
