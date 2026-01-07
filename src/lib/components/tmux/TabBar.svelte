<script lang="ts">
	import type { TmuxWindow } from '$lib/utils/pane-tree';

	type TabBarProps = {
		/** List of windows to display as tabs */
		windows: TmuxWindow[];
		/** Index of the currently active window */
		activeIndex: number;
		/** Callback when a tab is clicked */
		onTabClick?: (index: number) => void;
		/** Callback when tabs are reordered via drag */
		onReorder?: (fromIndex: number, toIndex: number) => void;
	};

	let { windows, activeIndex, onTabClick, onReorder }: TabBarProps = $props();

	// Drag state
	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	/**
	 * Handle tab click.
	 */
	function handleTabClick(index: number): void {
		if (onTabClick) {
			onTabClick(index);
		}
	}

	/**
	 * Handle drag start.
	 */
	function handleDragStart(event: DragEvent, index: number): void {
		draggedIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(index));
		}
	}

	/**
	 * Handle drag over.
	 */
	function handleDragOver(event: DragEvent, index: number): void {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		dragOverIndex = index;
	}

	/**
	 * Handle drag leave.
	 */
	function handleDragLeave(): void {
		dragOverIndex = null;
	}

	/**
	 * Handle drop.
	 */
	function handleDrop(event: DragEvent, toIndex: number): void {
		event.preventDefault();
		if (draggedIndex !== null && draggedIndex !== toIndex && onReorder) {
			onReorder(draggedIndex, toIndex);
		}
		draggedIndex = null;
		dragOverIndex = null;
	}

	/**
	 * Handle drag end.
	 */
	function handleDragEnd(): void {
		draggedIndex = null;
		dragOverIndex = null;
	}

	/**
	 * Get tab display text.
	 */
	function getTabLabel(window: TmuxWindow, index: number): string {
		return `${index}:${window.name}`;
	}
</script>

<div class="tab-bar">
	<div class="tabs">
		{#each windows as window, index (window.id)}
			<button
				class="tab"
				class:active={index === activeIndex}
				class:dragging={index === draggedIndex}
				class:drag-over={index === dragOverIndex && index !== draggedIndex}
				draggable="true"
				onclick={() => handleTabClick(index)}
				ondragstart={(e) => handleDragStart(e, index)}
				ondragover={(e) => handleDragOver(e, index)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, index)}
				ondragend={handleDragEnd}
			>
				<span class="tab-indicator">{index === activeIndex ? '*' : ''}</span>
				<span class="tab-label">{getTabLabel(window, index)}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.tab-bar {
		display: flex;
		align-items: center;
		background: #2d2d2d;
		border-bottom: 1px solid #3d3d3d;
		padding: 0 8px;
		height: 32px;
		flex-shrink: 0;
	}

	.tabs {
		display: flex;
		gap: 2px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tabs::-webkit-scrollbar {
		display: none;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 12px;
		background: transparent;
		border: none;
		border-radius: 4px 4px 0 0;
		color: #808080;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		user-select: none;
	}

	.tab:hover {
		background: #3d3d3d;
		color: #a0a0a0;
	}

	.tab.active {
		background: #1c1c1c;
		color: #50fa7b;
	}

	.tab.dragging {
		opacity: 0.5;
	}

	.tab.drag-over {
		background: #4d4d4d;
		border-left: 2px solid #50fa7b;
	}

	.tab-indicator {
		color: #50fa7b;
		font-weight: bold;
		min-width: 8px;
	}

	.tab-label {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}
</style>
