<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		getAllChallengeMetadata,
		getChallengePoolCount,
		isValidChallengeId
	} from '$lib/data/challenges';
	import {
		createLeaderboardQuery,
		getEntriesForChallenge,
		type LeaderboardEntry
	} from '$lib/queries/leaderboard';
	import Manpage from './Manpage.svelte';

	type TerminalMode = 'default' | 'list' | 'leaderboard' | 'man';

	type HistoryEntry = {
		type: 'input' | 'output' | 'error' | 'header';
		content: string;
	};

	// Initialize the leaderboard query - fetches data in background
	const leaderboardQuery = createLeaderboardQuery();

	let inputValue = $state('');
	let history = $state<HistoryEntry[]>([
		{ type: 'header', content: 'tmux-speedrun v1.0.0' },
		{ type: 'output', content: "Type 'help' for available commands." },
		{ type: 'output', content: '' }
	]);
	let mode = $state<TerminalMode>('default');
	let selectedIndex = $state(0);
	let listData = $state<Array<{ id: string; display: string }>>([]);
	let leaderboardData = $state<{ challengeId: string; entries: LeaderboardEntry[] } | null>(null);

	let inputRef = $state<HTMLInputElement | null>(null);
	let terminalRef = $state<HTMLDivElement | null>(null);
	let containerRef = $state<HTMLButtonElement | null>(null);
	let manpageRef = $state<HTMLDivElement | null>(null);
	let historyLengthBeforeMode = $state(0); // Track history length to clear on quit
	let isMaximized = $state(false);

	function scrollToBottom() {
		if (terminalRef) {
			requestAnimationFrame(() => {
				if (terminalRef) {
					terminalRef.scrollTop = terminalRef.scrollHeight;
				}
			});
		}
	}

	function addOutput(content: string, type: HistoryEntry['type'] = 'output') {
		history = [...history, { type, content }];
		scrollToBottom();
	}

	async function clearAndResetMode() {
		// Remove the header lines that were added when entering the mode
		if (historyLengthBeforeMode > 0) {
			history = history.slice(0, historyLengthBeforeMode);
		}
		mode = 'default';
		selectedIndex = 0;
		listData = [];
		leaderboardData = null;
		historyLengthBeforeMode = 0;
		// Wait for Svelte to update the DOM, then focus the input
		await tick();
		inputRef?.focus();
	}

	function showHelp() {
		addOutput('');
		addOutput('AVAILABLE COMMANDS', 'header');
		addOutput('──────────────────', 'header');
		addOutput('');
		addOutput('  tsr ls              List all available challenges');
		addOutput('  tsr lb <num>        View leaderboard for a challenge');
		addOutput('  tsr start <num>     Start a challenge (e.g. tsr start 0)');
		addOutput('  tsr free-play       Practice keybindings in free play mode');
		addOutput('  tsr practice        Learn tmux commands step by step');
		addOutput('  man tmux            Show tmux command reference');
		addOutput('  clear               Clear the terminal');
		addOutput('  help                Show this help message');
		addOutput('');
	}

	function showChallengeList() {
		const challenges = getAllChallengeMetadata();
		historyLengthBeforeMode = history.length; // Track before adding output
		mode = 'list';
		selectedIndex = 0;
		listData = challenges.map((c) => ({
			id: String(c.index), // Use 0-based index for routing
			display: `Challenge ${c.index}  [${c.difficultyLabel}]  ${c.instructionCount} commands`
		}));

		addOutput('');
		addOutput(' Enter to start, q to quit');
		addOutput('');
	}

	function showLeaderboard(challengeIndex: string | number) {
		const numericIndex =
			typeof challengeIndex === 'string' ? parseInt(challengeIndex, 10) : challengeIndex;

		const maxIndex = getChallengePoolCount() - 1;
		if (Number.isNaN(numericIndex) || !isValidChallengeId(numericIndex)) {
			addOutput(`Error: Invalid challenge ID '${challengeIndex}'.`, 'error');
			addOutput(`Use "tsr ls" to see available challenges (0-${maxIndex}).`, 'error');
			return;
		}

		historyLengthBeforeMode = history.length; // Track before adding output
		mode = 'leaderboard';

		addOutput('');
		addOutput(`LEADERBOARD: CHALLENGE ${numericIndex}`, 'header');
		addOutput('─'.repeat(40), 'header');
		addOutput('');

		// Handle query states
		// Note: In TanStack Query v6 for Svelte 5, the query result is reactive but not a store
		if (leaderboardQuery.isPending) {
			addOutput('  Loading leaderboard...');
			leaderboardData = { challengeId: String(numericIndex), entries: [] };
		} else if (leaderboardQuery.isError) {
			addOutput('  Unable to load leaderboard. Try again later.', 'error');
			leaderboardData = { challengeId: String(numericIndex), entries: [] };
		} else {
			// Get entries from query data
			const entries = getEntriesForChallenge(leaderboardQuery.data, numericIndex);
			leaderboardData = { challengeId: String(numericIndex), entries };

			if (entries.length === 0) {
				addOutput('  No entries yet. Be the first to complete this challenge!');
			} else {
				addOutput('  RANK    USERNAME              TIME');
				addOutput('  ────    ────────              ────');
				for (const entry of entries) {
					const rankStr = `#${entry.rank}`.padEnd(6);
					const nameStr = entry.username.padEnd(20);
					addOutput(`  ${rankStr}  ${nameStr}  ${entry.time}`);
				}
			}
		}

		addOutput('');
		addOutput('  Press q to return');
		addOutput('');
	}

	function showManPage() {
		historyLengthBeforeMode = history.length;
		mode = 'man';
	}

	function startChallenge(challengeIndex: string | number) {
		const numericIndex =
			typeof challengeIndex === 'string' ? parseInt(challengeIndex, 10) : challengeIndex;

		const maxIndex = getChallengePoolCount() - 1;
		if (Number.isNaN(numericIndex) || !isValidChallengeId(numericIndex)) {
			addOutput(`Error: Invalid challenge ID '${challengeIndex}'.`, 'error');
			addOutput(`Use "tsr ls" to see available challenges (0-${maxIndex}).`, 'error');
			return;
		}

		addOutput(`Starting Challenge ${numericIndex}...`);
		goto(`/challenge/${numericIndex}`);
	}

	function processCommand(cmd: string) {
		const trimmed = cmd.trim();
		if (!trimmed) return;

		addOutput(`$ ${trimmed}`, 'input');

		const parts = trimmed.split(/\s+/);
		const command = parts[0].toLowerCase();
		const args = parts.slice(1);

		if (command === 'help') {
			showHelp();
			return;
		}

		if (command === 'clear') {
			history = [
				{ type: 'header', content: 'tmux-speedrun v1.0.0' },
				{ type: 'output', content: "Type 'help' for available commands." },
				{ type: 'output', content: '' }
			];
			return;
		}

		if (command === 'man' && args[0] === 'tmux') {
			showManPage();
			return;
		}

		if (command === 'tsr') {
			const subcommand = args[0];

			if (subcommand === 'ls') {
				showChallengeList();
				return;
			}

			if (subcommand === 'lb') {
				const challengeNum = args[1];
				if (!challengeNum) {
					addOutput('Usage: tsr lb <number>', 'error');
					addOutput('Example: tsr lb 1', 'error');
					return;
				}
				showLeaderboard(challengeNum);
				return;
			}

			if (subcommand === 'start') {
				const challengeNum = args[1];
				if (!challengeNum) {
					addOutput('Usage: tsr start <number>', 'error');
					addOutput('Example: tsr start 1', 'error');
					return;
				}
				startChallenge(challengeNum);
				return;
			}

			if (subcommand === 'free-play') {
				addOutput('Entering free play mode...');
				goto('/free-play');
				return;
			}

			if (subcommand === 'practice') {
				addOutput('Entering practice mode...');
				goto('/practice');
				return;
			}

			addOutput(`Unknown subcommand: ${subcommand}`, 'error');
			addOutput('Available: ls, lb, start, free-play, practice', 'error');
			return;
		}

		addOutput(`Command not found: ${command}`, 'error');
		addOutput("Type 'help' for available commands.", 'error');
	}

	function toggleMaximize() {
		isMaximized = !isMaximized;
	}

	function handleKeyDown(event: KeyboardEvent) {
		// Global: Ctrl+Enter or Cmd+Enter to toggle maximize
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			toggleMaximize();
			return;
		}

		// Handle navigation modes
		if (mode === 'list') {
			if (event.key === 'ArrowUp' || event.key === 'k') {
				event.preventDefault();
				selectedIndex = Math.max(0, selectedIndex - 1);
				return;
			}
			if (event.key === 'ArrowDown' || event.key === 'j') {
				event.preventDefault();
				selectedIndex = Math.min(listData.length - 1, selectedIndex + 1);
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				const selected = listData[selectedIndex];
				if (selected) {
					clearAndResetMode();
					startChallenge(selected.id);
				}
				return;
			}
			if (event.key === 'q' || event.key === 'Escape') {
				event.preventDefault();
				clearAndResetMode();
				return;
			}
			return;
		}

		if (mode === 'leaderboard') {
			if (event.key === 'q' || event.key === 'Escape') {
				event.preventDefault();
				clearAndResetMode();
				return;
			}
			return;
		}

		// Man mode handles its own keyboard events via the Manpage component
		if (mode === 'man') {
			return;
		}

		// Default mode - process commands
		if (event.key === 'Enter') {
			event.preventDefault();
			processCommand(inputValue);
			inputValue = '';
		}
	}

	function focusInput() {
		if (mode === 'default') {
			inputRef?.focus();
		} else if (mode === 'man' && manpageRef) {
			manpageRef.focus();
		} else {
			containerRef?.focus();
		}
	}

	// Scroll to bottom when history changes
	$effect(() => {
		if (history.length > 0) {
			scrollToBottom();
		}
	});

	// Focus the container when entering non-default modes
	$effect(() => {
		if (mode !== 'default' && containerRef) {
			containerRef.focus();
		}
	});

	// Toggle body overflow when maximized to hide page scrollbar
	$effect(() => {
		if (typeof document !== 'undefined') {
			if (isMaximized) {
				document.body.style.overflow = 'hidden';
			} else {
				document.body.style.overflow = '';
			}
		}

		// Cleanup on unmount
		return () => {
			if (typeof document !== 'undefined') {
				document.body.style.overflow = '';
			}
		};
	});
</script>

<button
	class="terminal-container"
	class:maximized={isMaximized}
	bind:this={containerRef}
	onclick={focusInput}
	onkeydown={handleKeyDown}
	aria-label="Terminal emulator"
	tabindex="0"
>
	<!-- Terminal Header -->
	<div class="terminal-header">
		<div class="terminal-buttons">
			<span class="terminal-button close"></span>
			<span class="terminal-button minimize"></span>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<span
				class="terminal-button maximize"
				role="button"
				tabindex="-1"
				title={isMaximized ? 'Restore (Ctrl+Enter)' : 'Maximize (Ctrl+Enter)'}
				onclick={(e) => {
					e.stopPropagation();
					toggleMaximize();
				}}
			></span>
		</div>
		<span class="terminal-title">tmux-speedrun</span>
		<div class="terminal-buttons invisible">
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
		</div>
	</div>

	<!-- Terminal Body -->
	<div class="terminal-body" class:man-mode={mode === 'man'} bind:this={terminalRef}>
		{#if mode === 'man'}
			<Manpage
				onQuit={clearAndResetMode}
				onToggleMaximize={toggleMaximize}
				bind:containerRef={manpageRef}
			/>
		{:else}
			<!-- History -->
			{#each history as entry}
				<div class="terminal-line {entry.type}">
					{entry.content}
				</div>
			{/each}

			<!-- Interactive List (for tsr ls) -->
			{#if mode === 'list'}
				<div class="challenge-list">
					{#each listData as item, i}
						<div class="challenge-item" class:selected={i === selectedIndex}>
							<span class="selector">{i === selectedIndex ? '▸' : ' '}</span>
							<span class="challenge-text">{item.display}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Input Line (only in default mode) -->
			{#if mode === 'default'}
				<div class="input-line">
					<span class="prompt">$</span>
					<input
						type="text"
						class="terminal-input"
						bind:value={inputValue}
						bind:this={inputRef}
						autocomplete="off"
						autocorrect="off"
						autocapitalize="off"
						spellcheck="false"
					/>
				</div>
			{/if}
		{/if}
	</div>
</button>

<style>
	.terminal-container {
		width: 100%;
		max-width: 900px;
		background: #1c1c1c;
		border-radius: 10px;
		overflow: hidden;
		box-shadow:
			0 25px 50px -12px rgba(0, 0, 0, 0.5),
			0 0 0 1px rgba(255, 255, 255, 0.05);
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 14px;
		line-height: 1.6;
		display: block;
		text-align: left;
		transition: all 0.2s ease-out;
		z-index: 1;
	}

	.terminal-container.maximized {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		max-width: none;
		border-radius: 0;
		z-index: 9999;
		display: flex;
		flex-direction: column;
	}

	.terminal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: #2d2d2d;
		border-bottom: 1px solid #3d3d3d;
	}

	.terminal-buttons {
		display: flex;
		gap: 8px;
	}

	.terminal-buttons.invisible {
		visibility: hidden;
	}

	.terminal-button {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #4d4d4d;
	}

	.terminal-button.close {
		background: #ff5f56;
	}

	.terminal-button.minimize {
		background: #ffbd2e;
	}

	.terminal-button.maximize {
		background: #27ca40;
		cursor: pointer;
	}

	.terminal-button.maximize:hover {
		background: #32d74b;
		transform: scale(1.1);
	}

	.terminal-title {
		color: #a0a0a0;
		font-size: 13px;
		font-weight: 500;
	}

	.terminal-body {
		padding: 20px;
		height: 450px;
		overflow-y: auto;
		background: #1c1c1c;
		position: relative;
	}

	.maximized .terminal-body {
		height: auto;
		flex: 1;
		min-height: 0;
	}

	.terminal-body.man-mode {
		overflow: hidden;
		padding: 0;
	}

	.terminal-body::-webkit-scrollbar {
		width: 8px;
	}

	.terminal-body::-webkit-scrollbar-track {
		background: #1c1c1c;
	}

	.terminal-body::-webkit-scrollbar-thumb {
		background: #3d3d3d;
		border-radius: 4px;
	}

	.terminal-line {
		white-space: pre-wrap;
		word-break: break-word;
		color: #e0e0e0;
		min-height: 1.6em;
	}

	.terminal-line.input {
		color: #50fa7b;
	}

	.terminal-line.error {
		color: #ff5555;
	}

	.terminal-line.header {
		color: #8be9fd;
		font-weight: 600;
	}

	.challenge-list {
		margin: 8px 0;
	}

	.challenge-item {
		display: flex;
		align-items: center;
		padding: 4px 8px;
		color: #e0e0e0;
		transition: background 0.1s ease;
	}

	.challenge-item.selected {
		background: #3d3d3d;
		color: #50fa7b;
	}

	.selector {
		color: #50fa7b;
		margin-right: 12px;
		font-weight: bold;
	}

	.challenge-text {
		flex: 1;
	}

	.input-line {
		display: flex;
		align-items: center;
		margin-top: 4px;
	}

	.prompt {
		color: #50fa7b;
		margin-right: 8px;
		font-weight: bold;
	}

	.terminal-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #e0e0e0;
		font-family: inherit;
		font-size: inherit;
		caret-color: #50fa7b;
	}

	.terminal-input::placeholder {
		color: #4d4d4d;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.terminal-container {
			font-size: 12px;
			border-radius: 0;
		}

		.terminal-body {
			padding: 12px;
			min-height: 300px;
		}
	}
</style>
