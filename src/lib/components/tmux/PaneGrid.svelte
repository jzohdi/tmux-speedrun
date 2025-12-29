<script lang="ts">
	import { isPane, isSplit, type PaneNode, type Pane } from '$lib/utils/pane-tree';
	import PaneView from './PaneView.svelte';
	import PaneGrid from './PaneGrid.svelte';

	type PaneGridProps = {
		/** The pane tree node to render */
		node: PaneNode;
		/** ID of the currently focused pane */
		focusedPaneId: string;
		/** Callback when input changes in a pane */
		onInputChange?: (paneId: string, value: string) => void;
		/** Callback when Enter is pressed in a pane */
		onSubmit?: (paneId: string, value: string) => void;
		/** Callback when a pane is clicked for focus */
		onFocusPane?: (paneId: string) => void;
		/** Callback to exit man mode for a pane */
		onExitMan?: (paneId: string) => void;
		/** Callback for key events to be handled at the top level */
		onKeyDown?: (event: KeyboardEvent) => void;
	};

	let {
		node,
		focusedPaneId,
		onInputChange,
		onSubmit,
		onFocusPane,
		onExitMan,
		onKeyDown
	}: PaneGridProps = $props();

	/**
	 * Handle input change for a specific pane.
	 */
	function handleInputChange(paneId: string): (value: string) => void {
		return (value: string) => {
			if (onInputChange) {
				onInputChange(paneId, value);
			}
		};
	}

	/**
	 * Handle submit for a specific pane.
	 */
	function handleSubmit(paneId: string): (value: string) => void {
		return (value: string) => {
			if (onSubmit) {
				onSubmit(paneId, value);
			}
		};
	}

	/**
	 * Handle focus for a specific pane.
	 */
	function handleFocus(paneId: string): () => void {
		return () => {
			if (onFocusPane) {
				onFocusPane(paneId);
			}
		};
	}

	/**
	 * Handle exit man for a specific pane.
	 */
	function handleExitMan(paneId: string): () => void {
		return () => {
			if (onExitMan) {
				onExitMan(paneId);
			}
		};
	}
</script>

{#if isPane(node)}
	<!-- Render a single pane -->
	<div class="pane-container">
		<PaneView
			pane={node}
			isFocused={node.id === focusedPaneId}
			onInputChange={handleInputChange(node.id)}
			onSubmit={handleSubmit(node.id)}
			onFocus={handleFocus(node.id)}
			onExitMan={handleExitMan(node.id)}
			{onKeyDown}
		/>
	</div>
{:else if isSplit(node)}
	<!-- Render a split container with two children -->
	<div
		class="split-container"
		class:horizontal={node.direction === 'horizontal'}
		class:vertical={node.direction === 'vertical'}
	>
		<div class="split-first">
			<PaneGrid
				node={node.first}
				{focusedPaneId}
				{onInputChange}
				{onSubmit}
				{onFocusPane}
				{onExitMan}
				{onKeyDown}
			/>
		</div>
		<div class="split-divider"></div>
		<div class="split-second">
			<PaneGrid
				node={node.second}
				{focusedPaneId}
				{onInputChange}
				{onSubmit}
				{onFocusPane}
				{onExitMan}
				{onKeyDown}
			/>
		</div>
	</div>
{/if}

<style>
	/* Single pane fills its container */
	.pane-container {
		width: 100%;
		height: 100%;
		min-height: 0;
		min-width: 0;
		flex: 1;
	}

	/* Split container is a flex container */
	.split-container {
		display: flex;
		width: 100%;
		height: 100%;
		min-height: 0;
		min-width: 0;
		flex: 1;
	}

	/* Horizontal split: stacked top/bottom */
	.split-container.horizontal {
		flex-direction: column;
	}

	/* Vertical split: side by side */
	.split-container.vertical {
		flex-direction: row;
	}

	/* First and second children each take 50% */
	.split-first,
	.split-second {
		flex: 1 1 50%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}

	/* Divider between panes */
	.split-divider {
		flex-shrink: 0;
		background: #3d3d3d;
	}

	.split-container.horizontal .split-divider {
		height: 2px;
		width: 100%;
	}

	.split-container.vertical .split-divider {
		width: 2px;
		height: 100%;
	}
</style>

