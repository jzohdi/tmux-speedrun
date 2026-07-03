<script lang="ts">
	type Command = { command: string; description: string };

	// Mirrors the CLI's command surface (interface §9.2). Kept in sync with the
	// `tmux-speedrun help` output.
	const commands: Command[] = [
		{ command: 'tmux-speedrun help', description: 'List available commands.' },
		{ command: 'tmux-speedrun login', description: 'Sign in with GitHub via the browser.' },
		{ command: 'tmux-speedrun logout', description: 'Clear the stored session.' },
		{ command: 'tmux-speedrun whoami', description: 'Show your verified GitHub username.' },
		{ command: 'tmux-speedrun leaderboard [id]', description: 'View the leaderboard for a challenge.' },
		{ command: 'tmux-speedrun practice [category]', description: 'Run offline practice drills.' },
		{ command: 'tmux-speedrun challenge <id>', description: 'Run challenge 0–5 against native tmux.' }
	];
</script>

<svelte:head>
	<title>CLI | tmux-speedrun</title>
	<meta
		name="description"
		content="Install and use the tmux-speedrun CLI: run challenges and practice against your own native tmux, sign in with GitHub, and view the leaderboard from the terminal."
	/>
</svelte:head>

<main class="cli-page">
	<div class="page-shell">
		<header class="page-header">
			<a href="/" class="back-link">Back</a>
			<div class="header-main">
				<h1 class="page-title">tmux-speedrun CLI</h1>
				<p class="page-subtitle">
					Run the challenges and practice flows against your <strong>own native tmux</strong> instead of
					the browser-emulated terminal — no emulation, your real tmux config, the same leaderboard.
				</p>
			</div>
		</header>

		<div class="content">
			<section class="card">
				<h2>Install</h2>
				<p class="lead">Requires Node.js ≥ 20 and tmux ≥ 3.0.</p>
				<pre class="code-block"><code># Run without installing
npx tmux-speedrun help

# Or install globally
npm install -g tmux-speedrun
tmux-speedrun help</code></pre>
			</section>

			<section class="card">
				<h2>Commands</h2>
				<ul class="command-list">
					{#each commands as entry (entry.command)}
						<li>
							<code>{entry.command}</code>
							<span>{entry.description}</span>
						</li>
					{/each}
				</ul>
			</section>

			<section class="card">
				<h2>Sign in with GitHub</h2>
				<p>
					<code>tmux-speedrun login</code> opens your browser to complete the standard GitHub OAuth flow.
					On success the verified GitHub username is handed back to the waiting CLI over a local
					loopback address and stored so your challenge times record under that identity.
				</p>
				<p class="note">
					As on the website, the username attached to a leaderboard entry is
					<strong>server-verified</strong> — never supplied by the client — so times can't be spoofed.
				</p>
			</section>

			<section class="card highlight">
				<h2>Environment isolation</h2>
				<p>
					Challenges and practice run inside a <strong>dedicated tmux server on a private socket</strong>
					(<code>tmux -L tmux-speedrun-&lt;session&gt;</code>) with its own generated config, fully separate
					from your everyday tmux.
				</p>
				<ul class="guarantee-list">
					<li>Prompted commands like <code>kill-session</code> or <code>kill-server</code> can only touch the isolated server.</li>
					<li>Your real tmux sessions are never referenced and never affected.</li>
					<li>The isolated server is torn down cleanly on exit or interrupt.</li>
				</ul>
			</section>

			<section class="card">
				<h2>Supported platforms</h2>
				<p>
					macOS, Linux, and Windows via WSL. tmux is not native to Windows, so a WSL environment is
					required there. <code>challenge</code> and <code>practice</code> check for a compatible
					<code>tmux</code> and exit with an install hint if it is missing or too old.
				</p>
			</section>
		</div>
	</div>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #0d0d0d;
		color: #e0e0e0;
		font-family:
			'Space Grotesk',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	.cli-page {
		min-height: 100vh;
		padding: 24px;
	}

	.page-shell {
		max-width: 880px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.page-header {
		display: flex;
		gap: 18px;
		align-items: baseline;
	}

	.back-link {
		color: #9ea3a8;
		text-decoration: none;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
	}

	.page-title {
		margin: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 28px;
		font-weight: 600;
	}

	.page-subtitle {
		margin: 6px 0 0;
		max-width: 760px;
		color: #8d9399;
		line-height: 1.5;
		font-size: 14px;
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.card {
		background: #111;
		border: 1px solid #202020;
		border-radius: 10px;
		padding: 20px;
	}

	.card.highlight {
		border-color: rgba(50, 255, 150, 0.25);
		background: linear-gradient(180deg, rgba(50, 255, 150, 0.04), #111);
	}

	.card h2 {
		margin: 0 0 14px;
		font-size: 17px;
		font-weight: 600;
	}

	.card p {
		margin: 0 0 12px;
		line-height: 1.6;
		font-size: 14px;
		color: #c4c8cc;
	}

	.card p:last-child {
		margin-bottom: 0;
	}

	.lead {
		color: #8d9399 !important;
	}

	.note {
		color: #8d9399 !important;
		font-size: 13px !important;
	}

	code {
		font-family: 'JetBrains Mono', monospace;
		background: #151515;
		border: 1px solid #242424;
		padding: 2px 5px;
		border-radius: 6px;
		font-size: 13px;
		color: #50fa7b;
	}

	.code-block {
		margin: 0;
		padding: 16px;
		background: #0d0d0d;
		border: 1px solid #202020;
		border-radius: 8px;
		overflow-x: auto;
	}

	.code-block code {
		background: none;
		border: none;
		padding: 0;
		color: #e7e7e7;
		font-size: 13px;
		line-height: 1.6;
		white-space: pre;
	}

	.command-list,
	.guarantee-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.command-list li {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.command-list li code {
		align-self: flex-start;
	}

	.command-list li span {
		color: #8d9399;
		font-size: 13px;
	}

	.guarantee-list {
		gap: 10px;
	}

	.guarantee-list li {
		position: relative;
		padding-left: 20px;
		line-height: 1.6;
		font-size: 14px;
		color: #c4c8cc;
	}

	.guarantee-list li::before {
		content: '▸';
		position: absolute;
		left: 0;
		color: #50fa7b;
	}

	@media (max-width: 640px) {
		.cli-page {
			padding: 16px;
		}

		.page-title {
			font-size: 22px;
		}

		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}
	}
</style>
