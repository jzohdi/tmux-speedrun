<script lang="ts">
	import { getAllChallengeMetadata } from '$lib/data/challenges';
	import { createLeaderboardQuery, getEntriesForChallenge } from '$lib/queries/leaderboard';
	import Pager from './Pager.svelte';

	type LeaderboardPagerProps = {
		onQuit: () => void;
		onToggleMaximize?: () => void;
		containerRef?: HTMLDivElement | null;
	};

	let {
		onQuit,
		onToggleMaximize,
		containerRef = $bindable(null)
	}: LeaderboardPagerProps = $props();

	// Same query key as the Terminal's instance, so TanStack dedupes/caches;
	// mounting with stale data triggers a background refetch. Rendering reads
	// the reactive result directly, so loading → data transitions update live.
	const leaderboardQuery = createLeaderboardQuery();

	const challenges = getAllChallengeMetadata();
</script>

<Pager
	{onQuit}
	{onToggleMaximize}
	bind:containerRef
	ariaLabel="Leaderboard viewer - use arrow keys or j/k to scroll, q to quit"
>
	<div class="lb-header">
		<span>LEADERBOARD(1)</span>
		<span>tmux-speedrun Leaderboards</span>
		<span>LEADERBOARD(1)</span>
	</div>

	<p class="lb-tip">
		Tip: run 'tsr lb &lt;challenge-number&gt;' to view a single challenge's leaderboard.
	</p>

	{#if leaderboardQuery.isPending}
		<p class="lb-message">Loading leaderboards...</p>
	{:else if leaderboardQuery.isError}
		<p class="lb-message lb-error">Unable to load leaderboards. Try again later.</p>
	{:else}
		{#each challenges as challenge (challenge.index)}
			{@const entries = getEntriesForChallenge(leaderboardQuery.data, challenge.index)}
			<section class="lb-section">
				<h2 class="lb-section-title">CHALLENGE {challenge.index} — {challenge.difficultyLabel}</h2>
				{#if entries.length === 0}
					<p class="lb-empty">No entries yet. Be the first to complete this challenge!</p>
				{:else}
					<div class="lb-table">
						<div class="lb-row lb-columns">
							<span class="lb-rank">RANK</span>
							<span class="lb-username">USERNAME</span>
							<span class="lb-time">TIME</span>
						</div>
						{#each entries as entry (entry.rank)}
							<div class="lb-row">
								<span class="lb-rank">#{entry.rank}</span>
								<span class="lb-username">{entry.username}</span>
								<span class="lb-time">{entry.time}</span>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	{/if}
</Pager>

<style>
	.lb-header {
		display: flex;
		justify-content: space-between;
		font-weight: bold;
		padding: 8px 0;
	}

	.lb-tip {
		margin: 8px 0 16px;
		color: #50fa7b;
	}

	.lb-message {
		margin: 16px 0;
		color: #e0e0e0;
	}

	.lb-error {
		color: #ff5555;
	}

	.lb-section {
		margin: 16px 0;
	}

	.lb-section-title {
		font-size: 14px;
		font-weight: bold;
		color: #8be9fd;
		margin: 0 0 8px 0;
	}

	.lb-empty {
		margin: 8px 0;
		padding-left: 16px;
		color: #e0e0e0;
	}

	.lb-table {
		padding-left: 16px;
	}

	.lb-row {
		display: flex;
		gap: 16px;
		margin: 2px 0;
	}

	.lb-columns {
		color: #8be9fd;
		font-weight: bold;
	}

	.lb-rank {
		min-width: 48px;
	}

	.lb-username {
		min-width: 160px;
		color: #50fa7b;
	}

	.lb-columns .lb-username {
		color: #8be9fd;
	}

	.lb-time {
		color: #e0e0e0;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.lb-username {
			min-width: 100px;
		}
	}
</style>
