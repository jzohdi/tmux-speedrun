<script lang="ts">
	import { goto } from '$app/navigation';
	import { CHALLENGES, getAllChallengesWithMeta, getDifficultyLabel } from '$lib/data/challenges';
	import { COMMAND_CATEGORIES, getCommandsByCategory } from '$lib/data/tmux-commands';

	type TerminalMode = 'default' | 'list' | 'leaderboard' | 'man';

	type HistoryEntry = {
		type: 'input' | 'output' | 'error' | 'header';
		content: string;
	};

	type LeaderboardEntry = {
		rank: number;
		username: string;
		time: string;
	};

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
	let containerRef = $state<HTMLDivElement | null>(null);
	let ignoreNextEnter = $state(false);

	// Leaderboard mock data (will be fetched from API later)
	const mockLeaderboard: Record<string, LeaderboardEntry[]> = {
		'basics-101': [
			{ rank: 1, username: 'speedster', time: '12.3s' },
			{ rank: 2, username: 'tmux_pro', time: '14.7s' },
			{ rank: 3, username: 'terminal_king', time: '18.2s' }
		],
		'pane-master': [
			{ rank: 1, username: 'pane_wizard', time: '25.1s' },
			{ rank: 2, username: 'split_master', time: '28.4s' }
		]
	};

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

	function clearAndResetMode() {
		mode = 'default';
		selectedIndex = 0;
		listData = [];
		leaderboardData = null;
	}

	function showHelp() {
		addOutput('');
		addOutput('╭─────────────────────────────────────────────────────────╮', 'header');
		addOutput('│                    AVAILABLE COMMANDS                    │', 'header');
		addOutput('╰─────────────────────────────────────────────────────────╯', 'header');
		addOutput('');
		addOutput('  tsr ls              List all available challenges');
		addOutput('  tsr lb <id>         View leaderboard for a challenge');
		addOutput('  tsr start <id>      Start a challenge');
		addOutput('  man tmux            Show tmux command reference');
		addOutput('  clear               Clear the terminal');
		addOutput('  help                Show this help message');
		addOutput('');
	}

	function showChallengeList() {
		const challenges = getAllChallengesWithMeta();
		mode = 'list';
		selectedIndex = 0;
		ignoreNextEnter = true; // Prevent immediate Enter key from starting challenge
		listData = challenges.map((c) => ({
			id: c.id,
			display: `${c.name} [${getDifficultyLabel(c.difficulty)}] - ${c.commandCount} commands`
		}));

		addOutput('');
		addOutput('╭─────────────────────────────────────────────────────────╮', 'header');
		addOutput('│                      CHALLENGES                          │', 'header');
		addOutput('╰─────────────────────────────────────────────────────────╯', 'header');
		addOutput('');
		addOutput('  Use ↑/↓ to navigate, Enter to start, q to quit');
		addOutput('');
	}

	function showLeaderboard(challengeId: string) {
		const challenge = CHALLENGES.find((c) => c.id === challengeId);
		if (!challenge) {
			addOutput(`Error: Challenge '${challengeId}' not found.`, 'error');
			addOutput('Use "tsr ls" to see available challenges.', 'error');
			return;
		}

		const entries = mockLeaderboard[challengeId] || [];
		mode = 'leaderboard';
		leaderboardData = { challengeId, entries };

		addOutput('');
		addOutput('╭─────────────────────────────────────────────────────────╮', 'header');
		addOutput(`│  LEADERBOARD: ${challenge.name.toUpperCase().padEnd(40)}│`, 'header');
		addOutput('╰─────────────────────────────────────────────────────────╯', 'header');
		addOutput('');

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
		addOutput('');
		addOutput('  Press q to return');
		addOutput('');
	}

	function showManPage() {
		mode = 'man';

		addOutput('');
		addOutput('╭─────────────────────────────────────────────────────────╮', 'header');
		addOutput('│                    TMUX(1) MANUAL                        │', 'header');
		addOutput('╰─────────────────────────────────────────────────────────╯', 'header');
		addOutput('');
		addOutput('NAME');
		addOutput('       tmux - terminal multiplexer');
		addOutput('');
		addOutput('DESCRIPTION');
		addOutput('       tmux enables multiple terminals in a single window.');
		addOutput('       The prefix key is Ctrl+b by default.');
		addOutput('');

		for (const category of COMMAND_CATEGORIES) {
			const commands = getCommandsByCategory(category.key);
			if (commands.length === 0) continue;

			addOutput(`${category.label.toUpperCase()}`);
			addOutput('');

			for (const cmd of commands) {
				addOutput(`       ${cmd.shortcut.padEnd(25)} ${cmd.description}`);
			}
			addOutput('');
		}

		addOutput('  Press q to return');
		addOutput('');
	}

	function startChallenge(challengeId: string) {
		const challenge = CHALLENGES.find((c) => c.id === challengeId);
		if (!challenge) {
			addOutput(`Error: Challenge '${challengeId}' not found.`, 'error');
			addOutput('Use "tsr ls" to see available challenges.', 'error');
			return;
		}

		addOutput(`Starting challenge: ${challenge.name}...`);
		goto(`/challenge/${challengeId}`);
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
				const challengeId = args[1];
				if (!challengeId) {
					addOutput('Usage: tsr lb <challenge-id>', 'error');
					addOutput('Example: tsr lb basics-101', 'error');
					return;
				}
				showLeaderboard(challengeId);
				return;
			}

			if (subcommand === 'start') {
				const challengeId = args[1];
				if (!challengeId) {
					addOutput('Usage: tsr start <challenge-id>', 'error');
					addOutput('Example: tsr start basics-101', 'error');
					return;
				}
				startChallenge(challengeId);
				return;
			}

			addOutput(`Unknown subcommand: ${subcommand}`, 'error');
			addOutput('Available: ls, lb, start', 'error');
			return;
		}

		addOutput(`Command not found: ${command}`, 'error');
		addOutput("Type 'help' for available commands.", 'error');
	}

	function handleKeyDown(event: KeyboardEvent) {
		// Handle navigation modes
		if (mode === 'list') {
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				selectedIndex = Math.max(0, selectedIndex - 1);
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				selectedIndex = Math.min(listData.length - 1, selectedIndex + 1);
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				// Ignore the Enter that triggered the list command
				if (ignoreNextEnter) {
					ignoreNextEnter = false;
					return;
				}
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
				addOutput('');
				return;
			}
			return;
		}

		if (mode === 'leaderboard' || mode === 'man') {
			if (event.key === 'q' || event.key === 'Escape') {
				event.preventDefault();
				clearAndResetMode();
				addOutput('');
				return;
			}
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

	// Handle global keyboard events for non-input modes
	function handleGlobalKeyDown(event: KeyboardEvent) {
		// Only handle keys when in interactive modes and terminal is focused
		if (mode === 'default') {
			return;
		}

		// Check if the terminal container or its children have focus
		const activeElement = document.activeElement;
		const isTerminalFocused = containerRef?.contains(activeElement) || activeElement === containerRef;
		if (!isTerminalFocused) {
			return;
		}

		handleKeyDown(event);
	}
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<div
	class="terminal-container"
	bind:this={containerRef}
	onclick={focusInput}
	onkeydown={handleKeyDown}
	role="application"
	aria-label="Terminal emulator"
	tabindex="0"
>
	<!-- Terminal Header -->
	<div class="terminal-header">
		<div class="terminal-buttons">
			<span class="terminal-button close"></span>
			<span class="terminal-button minimize"></span>
			<span class="terminal-button maximize"></span>
		</div>
		<span class="terminal-title">tmux-speedrun</span>
		<div class="terminal-buttons invisible">
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
		</div>
	</div>

	<!-- Terminal Body -->
	<div class="terminal-body" bind:this={terminalRef}>
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
				<span class="cursor"></span>
			</div>
		{/if}
	</div>
</div>

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
	}

	.terminal-title {
		color: #a0a0a0;
		font-size: 13px;
		font-weight: 500;
	}

	.terminal-body {
		padding: 20px;
		min-height: 400px;
		max-height: 500px;
		overflow-y: auto;
		background: #1c1c1c;
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

	.cursor {
		display: inline-block;
		width: 8px;
		height: 18px;
		background: #50fa7b;
		animation: blink 1s infinite;
		margin-left: 2px;
		vertical-align: middle;
	}

	@keyframes blink {
		0%,
		50% {
			opacity: 1;
		}
		51%,
		100% {
			opacity: 0;
		}
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

