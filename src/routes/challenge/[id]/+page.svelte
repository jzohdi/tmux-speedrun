<script lang="ts">
	import { page } from '$app/state';
	import { getChallengeById, getDifficultyLabel } from '$lib/data/challenges';

	const challengeId = $derived(page.params.id);
	const challenge = $derived(getChallengeById(challengeId));
</script>

<svelte:head>
	<title>{challenge ? `${challenge.name} | tmux-speedrun` : 'Challenge Not Found'}</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="challenge-page">
	<div class="bg-grid"></div>

	{#if challenge}
		<div class="challenge-container">
			<div class="challenge-header">
				<a href="/" class="back-link">← Back to Home</a>
				<h1 class="challenge-title">{challenge.name}</h1>
				<p class="challenge-description">{challenge.description}</p>
				<div class="challenge-meta">
					<span class="difficulty">
						Difficulty: <strong>{getDifficultyLabel(challenge.difficulty)}</strong>
					</span>
					<span class="commands">
						Commands: <strong>{challenge.commandNames.length}</strong>
					</span>
				</div>
			</div>

			<div class="placeholder-content">
				<div class="placeholder-icon">🚧</div>
				<h2>Challenge Mode Coming Soon</h2>
				<p>
					This challenge is not yet implemented. The interactive tmux challenge experience will be
					available in a future update.
				</p>
				<a href="/" class="return-button">Return to Terminal</a>
			</div>
		</div>
	{:else}
		<div class="challenge-container">
			<div class="placeholder-content">
				<div class="placeholder-icon">❌</div>
				<h2>Challenge Not Found</h2>
				<p>The challenge "{challengeId}" does not exist.</p>
				<a href="/" class="return-button">Return to Terminal</a>
			</div>
		</div>
	{/if}
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
			linear-gradient(rgba(50, 255, 150, 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgba(50, 255, 150, 0.03) 1px, transparent 1px);
		background-size: 50px 50px;
		pointer-events: none;
		z-index: 0;
	}

	.challenge-container {
		position: relative;
		z-index: 1;
		max-width: 700px;
		margin: 0 auto;
		padding: 60px 24px;
	}

	.challenge-header {
		text-align: center;
		margin-bottom: 48px;
	}

	.back-link {
		display: inline-block;
		font-size: 14px;
		color: #50fa7b;
		text-decoration: none;
		margin-bottom: 24px;
		font-family: 'JetBrains Mono', monospace;
		transition: opacity 0.2s ease;
	}

	.back-link:hover {
		opacity: 0.8;
	}

	.challenge-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 2.5rem;
		font-weight: 700;
		margin: 0 0 16px;
		color: #fff;
	}

	.challenge-description {
		font-size: 1.1rem;
		line-height: 1.6;
		color: #888;
		margin: 0 0 24px;
	}

	.challenge-meta {
		display: flex;
		justify-content: center;
		gap: 32px;
		font-size: 14px;
		color: #666;
	}

	.challenge-meta strong {
		color: #50fa7b;
	}

	.placeholder-content {
		text-align: center;
		padding: 60px 24px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 12px;
	}

	.placeholder-icon {
		font-size: 4rem;
		margin-bottom: 24px;
	}

	.placeholder-content h2 {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0 0 16px;
		color: #fff;
	}

	.placeholder-content p {
		font-size: 1rem;
		line-height: 1.6;
		color: #888;
		margin: 0 0 32px;
		max-width: 400px;
		margin-left: auto;
		margin-right: auto;
	}

	.return-button {
		display: inline-block;
		padding: 12px 28px;
		background: #50fa7b;
		color: #0d0d0d;
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
		border-radius: 8px;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.return-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(80, 250, 123, 0.3);
	}
</style>

