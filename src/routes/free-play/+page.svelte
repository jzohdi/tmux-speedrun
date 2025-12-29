<script lang="ts">
	import { ChallengeTerminal, type TmuxSignal } from '$lib/components/tmux';
	import { onMount, tick } from 'svelte';

	// Component ref
	let terminalRef = $state<ReturnType<typeof ChallengeTerminal> | null>(null);

	// Debug state - track last signals
	let lastSignal = $state<TmuxSignal | null>(null);
	let signalHistory = $state<Array<{ id: number; signal: TmuxSignal; timestamp: Date }>>([]);
	let signalIdCounter = $state(0);

	/**
	 * Handle signals from the terminal.
	 * In free-play mode, we track signals for debugging.
	 */
	function handleSignal(signal: TmuxSignal): void {
		// Track signal for debugging with unique ID
		lastSignal = signal;
		signalIdCounter += 1;
		signalHistory = [
			{ id: signalIdCounter, signal, timestamp: new Date() },
			...signalHistory.slice(0, 9) // Keep last 10
		];

		// Clear input after any command signals
		if (signal.type === 'command' || signal.type === 'command-executed') {
			terminalRef?.clearInput();
		}
	}

	function clearSignalHistory(): void {
		signalHistory = [];
		lastSignal = null;
	}

	// Auto-focus terminal on mount
	$effect(() => {

	});

	onMount(async() => {
		await tick();
		terminalRef?.focus();
	})
</script>

<svelte:head>
	<title>Free Play | tmux-speedrun</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="free-play-page">
	<div class="bg-grid"></div>

	<div class="page-layout">
		<!-- Header -->
		<header class="page-header">
			<a href="/" class="back-link">← Back</a>
			<h1 class="page-title">Free Play</h1>
			<span class="page-subtitle">Practice tmux keybindings</span>
		</header>

		<!-- Terminal Section -->
		<section class="terminal-section">
			<ChallengeTerminal
				bind:this={terminalRef}
				onSignal={handleSignal}
				disabled={false}
			/>
		</section>

		<!-- Debug Panel -->
		<aside class="debug-panel">
			<div class="debug-header">
				<h3 class="debug-title">🔍 Signal Debug</h3>
				<button class="clear-btn" onclick={clearSignalHistory}>Clear</button>
			</div>

			{#if lastSignal}
				<div class="last-signal">
					<div class="signal-label">Last Signal (Challenge Key):</div>
					{#if lastSignal.type === 'command-executed'}
						<div class="signal-key">
							<code class="command-name">{lastSignal.commandName}</code>
						</div>
						<div class="signal-detail">
							<span class="detail-label">Type:</span>
							<code>{lastSignal.type}</code>
						</div>
						<div class="signal-detail">
							<span class="detail-label">Raw Command:</span>
							<code>{lastSignal.command}</code>
						</div>
					{:else}
						<div class="signal-detail">
							<span class="detail-label">Type:</span>
							<code>{lastSignal.type}</code>
						</div>
						{#if lastSignal.command}
							<div class="signal-detail">
								<span class="detail-label">Command:</span>
								<code>{lastSignal.command}</code>
							</div>
						{/if}
					{/if}
				</div>
			{:else}
				<div class="no-signal">No signals yet. Try a command!</div>
			{/if}

			{#if signalHistory.length > 0}
				<div class="signal-history">
					<div class="history-label">Recent Signals:</div>
					{#each signalHistory as entry (entry.id)}
						<div class="history-entry" class:executed={entry.signal.type === 'command-executed'}>
							<span class="history-type">{entry.signal.type}</span>
							{#if entry.signal.type === 'command-executed'}
								<code class="history-cmd">{entry.signal.commandName}</code>
							{:else if entry.signal.command}
								<code class="history-cmd">{entry.signal.command}</code>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</aside>
	</div>
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #0d0d0d;
		color: #e0e0e0;
		font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.free-play-page {
		min-height: 100vh;
		position: relative;
	}

	.bg-grid {
		position: fixed;
		inset: 0;
		background-image:
			linear-gradient(rgba(50, 255, 150, 0.02) 1px, transparent 1px),
			linear-gradient(90deg, rgba(50, 255, 150, 0.02) 1px, transparent 1px);
		background-size: 60px 60px;
		pointer-events: none;
		z-index: 0;
	}

	.page-layout {
		position: relative;
		z-index: 1;
		max-width: 900px;
		margin: 0 auto;
		padding: 32px 24px;
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: 24px;
		margin-bottom: 32px;
	}

	.back-link {
		font-size: 14px;
		color: #50fa7b;
		text-decoration: none;
		font-family: 'JetBrains Mono', monospace;
		transition: opacity 0.2s ease;
	}

	.back-link:hover {
		opacity: 0.7;
	}

	.page-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 24px;
		font-weight: 600;
		color: #ffffff;
		margin: 0;
	}

	.page-subtitle {
		font-size: 14px;
		color: #666;
	}

	.terminal-section {
		height: 500px;
	}

	/* Debug Panel */
	.debug-panel {
		margin-top: 24px;
		padding: 16px;
		background: #1a1a1a;
		border: 1px solid #2d2d2d;
		border-radius: 8px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
	}

	.debug-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
		padding-bottom: 12px;
		border-bottom: 1px solid #2d2d2d;
	}

	.debug-title {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: #8be9fd;
	}

	.clear-btn {
		padding: 4px 12px;
		background: #2d2d2d;
		border: 1px solid #3d3d3d;
		border-radius: 4px;
		color: #a0a0a0;
		font-family: inherit;
		font-size: 12px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.clear-btn:hover {
		background: #3d3d3d;
		color: #e0e0e0;
	}

	.last-signal {
		padding: 12px;
		background: #0d0d0d;
		border-radius: 6px;
		margin-bottom: 16px;
	}

	.signal-label {
		font-size: 11px;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 8px;
	}

	.signal-key {
		margin-bottom: 12px;
	}

	.signal-key .command-name {
		display: inline-block;
		padding: 8px 16px;
		background: linear-gradient(135deg, #50fa7b20, #50fa7b10);
		border: 1px solid #50fa7b;
		border-radius: 4px;
		color: #50fa7b;
		font-size: 16px;
		font-weight: 600;
	}

	.signal-detail {
		display: flex;
		gap: 8px;
		margin-top: 6px;
		color: #a0a0a0;
	}

	.detail-label {
		color: #666;
	}

	.signal-detail code {
		color: #f8f8f2;
	}

	.no-signal {
		color: #666;
		font-style: italic;
		text-align: center;
		padding: 24px;
	}

	.signal-history {
		border-top: 1px solid #2d2d2d;
		padding-top: 12px;
	}

	.history-label {
		font-size: 11px;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 8px;
	}

	.history-entry {
		display: flex;
		gap: 12px;
		padding: 6px 8px;
		border-radius: 4px;
		margin-bottom: 4px;
		background: #0d0d0d;
	}

	.history-entry.executed {
		background: #50fa7b10;
		border-left: 2px solid #50fa7b;
	}

	.history-type {
		color: #666;
		min-width: 140px;
	}

	.history-entry.executed .history-type {
		color: #50fa7b;
	}

	.history-cmd {
		color: #f8f8f2;
	}

	@media (max-width: 640px) {
		.page-layout {
			padding: 20px 16px;
		}

		.page-header {
			flex-wrap: wrap;
			gap: 12px;
		}

		.page-title {
			font-size: 20px;
		}
	}
</style>
