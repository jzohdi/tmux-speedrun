<script lang="ts">
	import type { TmuxWindow, Pane } from '$lib/utils/pane-tree';

	type InputModeState = {
		/** Whether input mode is active */
		active: boolean;
		/** The action label to display (e.g., "rename-window") */
		actionLabel: string;
		/** Current input value */
		value: string;
	};

	type StatusBarProps = {
		/** Name of the current session */
		sessionName?: string;
		/** List of windows */
		windows: TmuxWindow[];
		/** Currently active window index */
		activeWindowIndex: number;
		/** Currently focused pane (for showing pane info) */
		focusedPane: Pane | null;
		/** Whether prefix mode is active */
		prefixActive: boolean;
		/** Whether the current pane is zoomed */
		isZoomed?: boolean;
		/** Input mode state for rename-style commands */
		inputMode?: InputModeState;
		/** Callback when input value changes */
		onInputChange?: (value: string) => void;
		/** Callback when input is submitted (Enter pressed) */
		onInputSubmit?: (value: string) => void;
		/** Callback when input is cancelled (Escape pressed) */
		onInputCancel?: () => void;
	};

	let {
		sessionName = 'tmux-speedrun',
		windows,
		activeWindowIndex,
		focusedPane,
		prefixActive,
		isZoomed = false,
		inputMode,
		onInputChange,
		onInputSubmit,
		onInputCancel
	}: StatusBarProps = $props();

	// Ref to the input element for auto-focus
	let inputRef = $state<HTMLInputElement | null>(null);

	// Auto-focus the input when input mode becomes active
	$effect(() => {
		if (inputMode?.active && inputRef) {
			requestAnimationFrame(() => {
				inputRef?.focus();
			});
		}
	});

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
	 * In real tmux, a zoomed pane shows a 'Z' flag after the window name.
	 */
	function getWindowList(): string {
		return windows
			.map((w, i) => {
				const isActive = i === activeWindowIndex;
				const indicator = isActive ? '*' : '-';
				// Show 'Z' flag when the active window has a zoomed pane
				const zoomFlag = isActive && isZoomed ? 'Z' : '';
				return `${i}:${w.name}${zoomFlag}${indicator}`;
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

	/**
	 * Handle input keydown events.
	 */
	function handleInputKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onInputCancel?.();
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			onInputSubmit?.(inputMode?.value ?? '');
			return;
		}
	}

	/**
	 * Handle input change.
	 */
	function handleInputChange(event: Event): void {
		const target = event.target as HTMLInputElement;
		onInputChange?.(target.value);
	}
</script>

{#if inputMode?.active}
	<!-- Input mode: orange bar with inline input -->
	<div class="status-bar input-mode">
		<div class="input-mode-content">
			<span class="input-mode-label">({inputMode.actionLabel})</span>
			<input
				type="text"
				class="status-input"
				bind:this={inputRef}
				value={inputMode.value}
				oninput={handleInputChange}
				onkeydown={handleInputKeyDown}
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
			/>
		</div>
	</div>
{:else}
	<!-- Normal status bar -->
	<div class="status-bar">
		<div class="status-left">
			<span class="status-session">[{sessionName}]</span>
			<span class="status-windows">{getWindowList()}</span>
		</div>

		<div class="status-center">
			{#if prefixActive}
				<span class="status-prefix">-- PREFIX --</span>
			{:else if isZoomed}
				<span class="status-zoomed">-- ZOOMED --</span>
			{/if}
		</div>

		<div class="status-right">
			<span class="status-mode">{getModeText()}</span>
			<span class="status-time">{formatTime(currentTime)}</span>
			<span class="status-date">{formatDate(currentTime)}</span>
		</div>
	</div>
{/if}

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

	/* Input mode: orange background like real tmux */
	.status-bar.input-mode {
		background: #d19a66;
		justify-content: flex-start;
	}

	.input-mode-content {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
	}

	.input-mode-label {
		font-weight: 600;
		white-space: nowrap;
	}

	.status-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #1c1c1c;
		font-family: inherit;
		font-size: inherit;
		font-weight: 500;
		caret-color: #1c1c1c;
		padding: 0;
		margin: 0;
	}

	.status-input::placeholder {
		color: rgba(0, 0, 0, 0.4);
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

	.status-zoomed {
		background: #8be9fd;
		color: #1c1c1c;
		padding: 0 8px;
		border-radius: 2px;
		font-weight: 600;
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
