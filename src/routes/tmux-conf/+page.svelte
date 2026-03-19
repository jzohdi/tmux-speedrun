<script lang="ts">
	import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';
	import { parseTmuxConf, TMUX_CONFIG_PATH } from '$lib/utils/tmux-conf';
	import {
		getPrefixKeyDisplay,
		getPrefixKeybindings,
		type Keybinding
	} from '$lib/data/keybindings';

	let draftText = $state(tmuxConfigStore.fileText);
	let lastActionMessage = $state('');

	const parsedDraft = $derived(parseTmuxConf(draftText));
	const activeWarnings = $derived(tmuxConfigStore.activeWarnings);
	const hasDraftChanges = $derived(draftText !== tmuxConfigStore.fileText);
	const hasUnappliedChanges = $derived(tmuxConfigStore.hasUnappliedChanges || hasDraftChanges);
	const prefixDisplay = $derived(getPrefixKeyDisplay());
	const keybindingPreview = $derived(getPrefixKeybindings().slice(0, 8));
	const draftWarningCount = $derived(parsedDraft.warnings.length);
	const appliedWarningCount = $derived(activeWarnings.length);

	function handleSave(): void {
		tmuxConfigStore.setFileText(draftText);
		lastActionMessage = `Saved ${TMUX_CONFIG_PATH}`;
	}

	function handleApply(): void {
		tmuxConfigStore.setFileText(draftText);
		tmuxConfigStore.applySavedConfig();
		lastActionMessage = `Applied ${TMUX_CONFIG_PATH}`;
	}

	function handleResetDraft(): void {
		draftText = tmuxConfigStore.fileText;
		lastActionMessage = 'Reverted unsaved edits';
	}

	function formatBinding(binding: Keybinding): string {
		if (binding.withCtrl) {
			return `prefix, Ctrl+${binding.keyDisplay}`;
		}

		return `prefix, ${binding.keyDisplay}`;
	}
</script>

<svelte:head>
	<title>tmux.conf | tmux-speedrun</title>
	<meta
		name="description"
		content="Edit tmux.conf in the browser, validate supported directives, and apply live tmux keybinding overrides."
	/>
</svelte:head>

<main class="config-page">
	<div class="page-shell">
		<header class="page-header">
			<a href="/" class="back-link">Back</a>
			<div class="header-main">
				<h1 class="page-title">{TMUX_CONFIG_PATH}</h1>
				<p class="page-subtitle">
					Edit the virtual file here, then apply it or reload it from the terminal with
					<code>tmux source-file ~/.tmux.conf</code>.
				</p>
			</div>
		</header>

		<div class="workspace">
			<section class="editor-section">
				<div class="editor-toolbar">
					<div class="editor-meta">
						<div class="editor-path">{TMUX_CONFIG_PATH}</div>
						<div class="editor-state">
							<span>{hasUnappliedChanges ? 'Not applied' : 'Applied'}</span>
							<span>Prefix {prefixDisplay}</span>
							{#if lastActionMessage}
								<span>{lastActionMessage}</span>
							{/if}
						</div>
					</div>
					<div class="actions">
						<button class="secondary" onclick={handleResetDraft} disabled={!hasDraftChanges}>
							Revert
						</button>
						<button class="secondary" onclick={handleSave}>Save</button>
						<button class="primary" onclick={handleApply}>Save and apply</button>
					</div>
				</div>
				<div class="editor-frame">
					<div class="editor-gutter">
						{#each draftText.split('\n') as _, index}
							<span>{index + 1}</span>
						{/each}
					</div>
					<textarea
						class="config-editor"
						bind:value={draftText}
						spellcheck="false"
						autocomplete="off"
					></textarea>
				</div>
			</section>

			<aside class="sidebar">
				<section class="sidebar-section">
					<h2>Runtime</h2>
					<dl class="meta-list">
						<div>
							<dt>Active prefix</dt>
							<dd>{prefixDisplay}</dd>
						</div>
						<div>
							<dt>Draft warnings</dt>
							<dd>{draftWarningCount}</dd>
						</div>
						<div>
							<dt>Applied warnings</dt>
							<dd>{appliedWarningCount}</dd>
						</div>
					</dl>
				</section>

				<section class="sidebar-section">
					<h2>Supported directives</h2>
					<ul class="plain-list">
						<li><code>set -g prefix C-a</code></li>
						<li><code>unbind-key x</code></li>
						<li><code>bind-key y kill-session</code></li>
						<li><code>bind-key Left select-pane -L</code></li>
					</ul>
				</section>

				<section class="sidebar-section">
					<h2>Live bindings</h2>
					<ul class="binding-list">
						{#each keybindingPreview as binding}
							<li>
								<code>{formatBinding(binding)}</code>
								<span>{binding.commandName}</span>
							</li>
						{/each}
					</ul>
				</section>

				<section class="sidebar-section">
					<h2>Draft warnings</h2>
					{#if parsedDraft.warnings.length === 0}
						<p class="empty-state">No warnings.</p>
					{:else}
						<ul class="warning-list">
							{#each parsedDraft.warnings as warning}
								<li class:warning={warning.severity === 'warning'} class:error={warning.severity === 'error'}>
									<strong>Line {warning.line}</strong>
									<span>{warning.message}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section class="sidebar-section">
					<h2>Applied warnings</h2>
					{#if activeWarnings.length === 0}
						<p class="empty-state">Applied cleanly.</p>
					{:else}
						<ul class="warning-list">
							{#each activeWarnings as warning}
								<li class:warning={warning.severity === 'warning'} class:error={warning.severity === 'error'}>
									<strong>Line {warning.line}</strong>
									<span>{warning.message}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</aside>
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

	.config-page {
		min-height: 100vh;
		padding: 24px;
	}

	.page-shell {
		max-width: 1280px;
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

	.page-subtitle code,
	.sidebar-section code,
	.binding-list code {
		font-family: 'JetBrains Mono', monospace;
		background: #151515;
		border: 1px solid #242424;
		padding: 2px 5px;
		border-radius: 6px;
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 20px;
	}

	.editor-section,
	.sidebar-section {
		background: #111;
		border: 1px solid #202020;
		border-radius: 10px;
	}

	.editor-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		padding: 16px;
		border-bottom: 1px solid #202020;
	}

	.editor-meta {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.editor-path {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		color: #f3f4f6;
	}

	.editor-state {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		font-size: 12px;
		color: #8d9399;
	}

	.editor-frame {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr);
		min-height: 620px;
	}

	.editor-gutter {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0;
		padding: 16px 10px 16px 0;
		background: #0d0d0d;
		border-right: 1px solid #202020;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		line-height: 1.55;
		color: #5d6369;
	}

	.actions {
		display: flex;
		gap: 10px;
		flex-shrink: 0;
	}

	button {
		border: 1px solid #2a2a2a;
		cursor: pointer;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		padding: 10px 14px;
		border-radius: 8px;
		transition:
			background-color 140ms ease,
			border-color 140ms ease,
			color 140ms ease;
	}

	button.primary {
		background: #d7dadc;
		color: #111;
		border-color: #d7dadc;
	}

	button.secondary {
		background: #171717;
		color: #d0d0d0;
	}

	button:hover:not(:disabled) {
		background: #202020;
		border-color: #363636;
	}

	button.primary:hover:not(:disabled) {
		background: #ffffff;
		border-color: #ffffff;
		color: #111;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.config-editor {
		width: 100%;
		min-height: 620px;
		border: none;
		outline: none;
		resize: none;
		background: #111;
		color: #e7e7e7;
		padding: 16px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		line-height: 1.55;
		box-sizing: border-box;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.sidebar-section {
		padding: 16px;
	}

	.sidebar-section h2 {
		margin: 0 0 14px;
		font-size: 15px;
		font-weight: 600;
	}

	.meta-list {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.meta-list div {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		font-size: 13px;
	}

	.meta-list dt {
		color: #8d9399;
	}

	.meta-list dd {
		margin: 0;
		font-family: 'JetBrains Mono', monospace;
		color: #f3f4f6;
	}

	.plain-list,
	.binding-list,
	.warning-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.plain-list li,
	.binding-list li,
	.warning-list li {
		line-height: 1.45;
		font-size: 13px;
	}

	.binding-list li {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.binding-list span {
		color: #8d9399;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
	}

	.warning-list li {
		padding-top: 10px;
		border-top: 1px solid #1c1c1c;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.warning-list li:first-child {
		padding-top: 0;
		border-top: none;
	}

	.warning-list li.warning strong {
		color: #f3c16d;
	}

	.warning-list li.error strong {
		color: #ef8d8d;
	}

	.warning-list li span {
		color: #8d9399;
	}

	.empty-state {
		color: #8a8a8a;
		margin: 0;
		font-size: 13px;
	}

	@media (max-width: 980px) {
		.workspace {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.config-page {
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

		.actions {
			width: 100%;
			flex-direction: column;
		}

		.editor-toolbar {
			flex-direction: column;
		}

		.editor-frame {
			grid-template-columns: 40px minmax(0, 1fr);
		}
	}
</style>
