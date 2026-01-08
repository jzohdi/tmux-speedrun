<script lang="ts">
	import { isPane, isSplit, findPaneById, type PaneNode } from '$lib/utils/pane-tree';
	import PaneView from './PaneView.svelte';
	import PaneGrid from './PaneGrid.svelte';

	/**
	 * Clock overlay state passed down to panes.
	 */
	type ClockState = {
		paneId: string;
		timeString: string;
	};

	type PaneGridProps = {
		/** The pane tree node to render */
		node: PaneNode;
		/** ID of the currently focused pane */
		focusedPaneId: string;
		/** Counter that increments when focus should be refreshed */
		focusTrigger?: number;
		/** Clock overlay state - shows time on specific pane */
		clockState?: ClockState | null;
		/** ID of the zoomed pane (when zoomed, only this pane is rendered) */
		zoomedPaneId?: string | null;
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
		focusTrigger,
		clockState,
		zoomedPaneId,
		onInputChange,
		onSubmit,
		onFocusPane,
		onExitMan,
		onKeyDown
	}: PaneGridProps = $props();

	// When zoomed, find the zoomed pane and render only that
	const zoomedPane = $derived(zoomedPaneId ? findPaneById(node, zoomedPaneId) : null);

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

{#if zoomedPane}
	<!-- Zoomed mode: render only the zoomed pane at full size -->
	<div class="pane-container zoomed">
		<PaneView
			pane={zoomedPane}
			isFocused={zoomedPane.id === focusedPaneId}
			{focusTrigger}
			{clockState}
			onInputChange={handleInputChange(zoomedPane.id)}
			onSubmit={handleSubmit(zoomedPane.id)}
			onFocus={handleFocus(zoomedPane.id)}
			onExitMan={handleExitMan(zoomedPane.id)}
			{onKeyDown}
		/>
	</div>
{:else if isPane(node)}
	<!-- Render a single pane -->
	<div class="pane-container">
		<PaneView
			pane={node}
			isFocused={node.id === focusedPaneId}
			{focusTrigger}
			{clockState}
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
				{focusTrigger}
				{clockState}
				{zoomedPaneId}
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
				{focusTrigger}
				{clockState}
				{zoomedPaneId}
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
		/**
		 * Critical for nested splits:
		 * Make each split child a flex container so the nested PaneGrid root
		 * can size via flex (rather than relying on height: 100% through an
		 * auto-sized parent, which breaks nested horizontal/column splits).
		 */
		display: flex;
		flex-direction: column;
	}

	/**
	 * Ensure the nested PaneGrid root element fills the split child.
	 * 
	 * Critical: Override height: 100% with auto, but KEEP width: 100%.
	 * 
	 * Why height: auto?
	 *   When the parent (split-first/split-second) is inside a row flex (vertical split),
	 *   it has no explicit height—only stretch. height: 100% doesn't resolve properly,
	 *   so we use auto to let flex: 1 control the height.
	 * 
	 * Why NOT width: auto?
	 *   The nested element may be a flex container (split-container) whose children
	 *   size as 50% of the parent width. If we set width: auto, that creates a circular
	 *   dependency (50% of auto = 0), collapsing the layout. We keep width: 100% because
	 *   the parent split-first/split-second has a definite width from flex sizing.
	 */
	.split-first > :global(*),
	.split-second > :global(*) {
		flex: 1;
		min-height: 0;
		min-width: 0;
		height: auto;
		/* width stays at 100% from the element's own class - DO NOT set width: auto */
	}

	/* Divider between panes */
	.split-divider {
		flex-shrink: 0;
		background: #3d3d3d;
	}

	/* Use direct child combinator (>) to prevent styles from leaking into nested splits */
	.split-container.horizontal > .split-divider {
		height: 2px;
		width: 100%;
	}

	.split-container.vertical > .split-divider {
		width: 2px;
		height: 100%;
	}
</style>
