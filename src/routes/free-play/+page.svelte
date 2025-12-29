<script lang="ts">
	import { ChallengeTerminal, type TmuxSignal } from '$lib/components/tmux';

	// Component ref
	let terminalRef = $state<ReturnType<typeof ChallengeTerminal> | null>(null);

	/**
	 * Handle signals from the terminal.
	 * In free-play mode, we just let the terminal manage its own state.
	 */
	function handleSignal(signal: TmuxSignal): void {
		// Clear input after command signals
		if (signal.type === 'command') {
			terminalRef?.clearInput();
		}
	}

	// Auto-focus terminal on mount
	$effect(() => {
		terminalRef?.focus();
	});
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
