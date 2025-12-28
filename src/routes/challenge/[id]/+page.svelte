<script lang="ts">
	import ChallengeTerminal from '$lib/components/ChallengeTerminal.svelte';
	import PromptBox from '$lib/components/PromptBox.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let terminalRef = $state<ReturnType<typeof ChallengeTerminal> | null>(null);

	// TODO: This will be dynamic based on current step
	const currentPrompt = $derived('Start a new tmux session');

	function handleCommand(command: string) {
		// TODO: Implement command validation and challenge progression
		console.log('Command received:', command);
	}

	// Focus the terminal on mount
	$effect(() => {
		terminalRef?.focus();
	});
</script>

<svelte:head>
	<title>Challenge {data.challengeIndex} | tmux-speedrun</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="challenge-page">
	<div class="bg-grid"></div>

	<div class="challenge-layout">
		<!-- Header -->
		<header class="challenge-header">
			<a href="/" class="back-link">← Back</a>
			<span class="challenge-label">Challenge {data.challengeIndex}</span>
		</header>

		<!-- Prompt Box -->
		<section class="prompt-section">
			<PromptBox
				prompt={currentPrompt}
				currentStep={1}
				totalSteps={data.challenge.commandNames.length}
			/>
		</section>

		<!-- Terminal -->
		<section class="terminal-section">
			<ChallengeTerminal
				bind:this={terminalRef}
				onCommand={handleCommand}
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

	.challenge-page {
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

	.challenge-layout {
		position: relative;
		z-index: 1;
		max-width: 800px;
		margin: 0 auto;
		padding: 32px 24px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.challenge-header {
		display: flex;
		align-items: center;
		gap: 24px;
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

	.challenge-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: 500;
		color: #666;
	}

	.prompt-section {
		/* Container for prompt */
	}

	.terminal-section {
		/* Container for terminal */
	}

	@media (max-width: 640px) {
		.challenge-layout {
			padding: 20px 16px;
			gap: 20px;
		}
	}
</style>
