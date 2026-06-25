import type { HistoryEntry, Pane, PaneCopyCursor, PaneMode } from './pane-tree';

export type CopySurfaceRow = {
	index: number;
	text: string;
	source: 'history' | 'input';
	historyEntryIndex?: number;
	lineIndex: number;
};

export type CopySurface = {
	rows: CopySurfaceRow[];
};

export type CopySurfaceSelectionRow = {
	row: number;
	text: string;
	startColumn: number;
	endColumn: number;
};

export type CopyCursorMoveDirection = 'up' | 'down' | 'left' | 'right' | 'home' | 'end';

type CopySurfacePane = Pick<Pane, 'history' | 'inputValue' | 'mode'>;

function getPrompt(mode: PaneMode): string {
	if (mode === 'tmux') {
		return '%';
	}

	return '$';
}

function formatHistoryEntry(entry: HistoryEntry): string {
	if (entry.type === 'input') {
		const modePrompt = getPrompt(entry.mode ?? 'default');

		return `${modePrompt} ${entry.content}`;
	}

	return entry.content;
}

function splitIntoLogicalLines(text: string): string[] {
	return text.split('\n');
}

function getRowEndExclusive(text: string, column: number): number {
	if (text.length === 0) {
		return 0;
	}

	return Math.min(column + 1, text.length);
}

function compareCursors(a: PaneCopyCursor, b: PaneCopyCursor): number {
	if (a.row !== b.row) {
		return a.row - b.row;
	}

	return a.column - b.column;
}

export function createCopySurface(pane: CopySurfacePane): CopySurface {
	const rows: CopySurfaceRow[] = [];

	for (const [historyEntryIndex, entry] of pane.history.entries()) {
		const logicalLines = splitIntoLogicalLines(formatHistoryEntry(entry));

		for (const [lineIndex, line] of logicalLines.entries()) {
			rows.push({
				index: rows.length,
				text: line,
				source: 'history',
				historyEntryIndex,
				lineIndex
			});
		}
	}

	rows.push({
		index: rows.length,
		text: `${getPrompt(pane.mode)} ${pane.inputValue}`,
		source: 'input',
		lineIndex: 0
	});

	return { rows };
}

export function getCopySurfaceRow(surface: CopySurface, row: number): CopySurfaceRow | null {
	return surface.rows[row] ?? null;
}

export function clampCopyCursor(surface: CopySurface, cursor: PaneCopyCursor): PaneCopyCursor {
	const maxRow = Math.max(surface.rows.length - 1, 0);
	const row = Math.min(Math.max(cursor.row, 0), maxRow);
	const rowText = surface.rows[row]?.text ?? '';
	const maxColumn = Math.max(rowText.length - 1, 0);
	const column = Math.min(Math.max(cursor.column, 0), maxColumn);

	return { row, column };
}

export function moveCopyCursor(
	surface: CopySurface,
	cursor: PaneCopyCursor,
	direction: CopyCursorMoveDirection
): PaneCopyCursor {
	const current = clampCopyCursor(surface, cursor);

	switch (direction) {
		case 'left':
			return clampCopyCursor(surface, {
				row: current.row,
				column: current.column - 1
			});
		case 'right':
			return clampCopyCursor(surface, {
				row: current.row,
				column: current.column + 1
			});
		case 'up':
			return clampCopyCursor(surface, {
				row: current.row - 1,
				column: current.column
			});
		case 'down':
			return clampCopyCursor(surface, {
				row: current.row + 1,
				column: current.column
			});
		case 'home':
			return {
				row: current.row,
				column: 0
			};
		case 'end': {
			const rowText = surface.rows[current.row]?.text ?? '';

			return {
				row: current.row,
				column: Math.max(rowText.length - 1, 0)
			};
		}
	}
}

export function normalizeCopyRange(
	surface: CopySurface,
	start: PaneCopyCursor,
	end: PaneCopyCursor
): { start: PaneCopyCursor; end: PaneCopyCursor } {
	const clampedStart = clampCopyCursor(surface, start);
	const clampedEnd = clampCopyCursor(surface, end);

	if (compareCursors(clampedStart, clampedEnd) <= 0) {
		return {
			start: clampedStart,
			end: clampedEnd
		};
	}

	return {
		start: clampedEnd,
		end: clampedStart
	};
}

export function extractCopySurfaceText(
	surface: CopySurface,
	start: PaneCopyCursor,
	end: PaneCopyCursor
): string {
	const range = normalizeCopyRange(surface, start, end);
	const parts: string[] = [];

	for (let row = range.start.row; row <= range.end.row; row++) {
		const surfaceRow = surface.rows[row];

		if (!surfaceRow) {
			continue;
		}

		const startColumn = row === range.start.row ? range.start.column : 0;
		const endColumn =
			row === range.end.row
				? getRowEndExclusive(surfaceRow.text, range.end.column)
				: surfaceRow.text.length;

		parts.push(surfaceRow.text.slice(startColumn, endColumn));
	}

	return parts.join('\n');
}

export function getCopySurfaceSelectionRows(
	surface: CopySurface,
	start: PaneCopyCursor,
	end: PaneCopyCursor
): CopySurfaceSelectionRow[] {
	const range = normalizeCopyRange(surface, start, end);
	const rows: CopySurfaceSelectionRow[] = [];

	for (let row = range.start.row; row <= range.end.row; row++) {
		const surfaceRow = surface.rows[row];

		if (!surfaceRow) {
			continue;
		}

		const startColumn = row === range.start.row ? range.start.column : 0;
		const endColumn =
			row === range.end.row
				? getRowEndExclusive(surfaceRow.text, range.end.column)
				: surfaceRow.text.length;

		rows.push({
			row,
			text: surfaceRow.text,
			startColumn,
			endColumn
		});
	}

	return rows;
}
