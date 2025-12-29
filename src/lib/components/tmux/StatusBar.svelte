<script lang="ts">
	import type { TmuxWindow, Pane } from '$lib/utils/pane-tree';

	type StatusBarProps = {
		/** List of windows */
		windows: TmuxWindow[];
		/** Currently active window index */
		activeWindowIndex: number;
		/** Currently focused pane (for showing pane info) */
		focusedPane: Pane | null;
		/** Whether prefix mode is active */
		prefixActive: boolean;
	};

	let { windows, activeWindowIndex, focusedPane, prefixActive }: StatusBarProps = $props();

	// Current time (updated every second)
	let currentTime = $state(new Date());

	// Update time every second
	$effect(() => {
		const interval = setInterval(() => {
			currentTime = new Date();
		}, 1000);

		return () => clearInterval(interval);
	});

	/**
	 * Format time as HH:MM.
	 */
	function formatTime(date: Date): string {
		return date.toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
	}

	/**
	 * Format date as DD-MMM-YY.
	 */
	function formatDate(date: Date): string {
		return date.toLocaleDateString('en-US', {
			day: '2-digit',
			month: 'short',
			year: '2-digit'
		});
	}

	/**
	 * Get window list for status bar.
	 */
	function getWindowList(): string {
		return windows
			.map((w, i) => {
				const indicator = i === activeWindowIndex ? '*' : '-';
				return `${i}:${w.name}${indicator}`;
			})
			.join(' ');
	}

	/**
	 * Get mode indicator text.
	 */
	function getModeText(): string {
		if (prefixActive) {
			return 'prefix';
		}
		if (!focusedPane) {
			return '';
		}
		switch (focusedPane.mode) {
			case 'man':
				return 'man';
			case 'tmux':
				return 'tmux';
			default:
				return 'bash';
		}
	}
</script>

<div class="status-bar">
	<div class="status-left">
		<span class="status-session">[tmux-speedrun]</span>
		<span class="status-windows">{getWindowList()}</span>
	</div>

	<div class="status-center">
		{#if prefixActive}
			<span class="status-prefix">-- PREFIX --</span>
		{/if}
	</div>

	<div class="status-right">
		<span class="status-mode">{getModeText()}</span>
		<span class="status-time">{formatTime(currentTime)}</span>
		<span class="status-date">{formatDate(currentTime)}</span>
	</div>
</div>

<style>
	.status-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #50fa7b;
		color: #1c1c1c;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 12px;
		font-weight: 500;
		padding: 2px 8px;
		height: 24px;
		flex-shrink: 0;
	}

	.status-left {
		display: flex;
		gap: 16px;
		align-items: center;
	}

	.status-session {
		font-weight: 600;
	}

	.status-windows {
		opacity: 0.8;
	}

	.status-center {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
	}

	.status-prefix {
		background: #ffb86c;
		color: #1c1c1c;
		padding: 0 8px;
		border-radius: 2px;
		font-weight: 600;
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	.status-right {
		display: flex;
		gap: 16px;
		align-items: center;
	}

	.status-mode {
		background: rgba(0, 0, 0, 0.2);
		padding: 0 6px;
		border-radius: 2px;
	}

	.status-time {
		font-weight: 600;
	}

	.status-date {
		opacity: 0.8;
	}
</style>

