import { describe, expect, it } from 'vitest';

import {
	clampCopyCursor,
	createCopySurface,
	extractCopySurfaceText,
	getCopySurfaceRow,
	getCopySurfaceSelectionRows,
	moveCopyCursor
} from './tmux-copy-surface';

describe('tmux copy surface', () => {
	it('includes formatted history and the live input line', () => {
		const surface = createCopySurface({
			mode: 'tmux',
			inputValue: 'ls',
			history: [
				{ type: 'input', content: 'tmux', timestamp: 1, mode: 'tmux' },
				{ type: 'output', content: 'attached', timestamp: 2 }
			]
		});

		expect(surface.rows.map((row) => row.text)).toEqual(['% tmux', 'attached', '% ls']);
	});

	it('creates an input row even when history is empty', () => {
		const surface = createCopySurface({
			mode: 'default',
			inputValue: '',
			history: []
		});

		expect(surface.rows.map((row) => row.text)).toEqual(['$ ']);
	});

	it('clamps cursors to the available row and column bounds', () => {
		const surface = createCopySurface({
			mode: 'tmux',
			inputValue: 'ls',
			history: [{ type: 'output', content: 'hello', timestamp: 1 }]
		});

		expect(clampCopyCursor(surface, { row: 99, column: 99 })).toEqual({
			row: 1,
			column: 3
		});
		expect(clampCopyCursor(surface, { row: -5, column: -2 })).toEqual({
			row: 0,
			column: 0
		});
	});

	it('extracts text from a single row', () => {
		const surface = createCopySurface({
			mode: 'tmux',
			inputValue: '',
			history: [{ type: 'output', content: 'hello world', timestamp: 1 }]
		});

		expect(extractCopySurfaceText(surface, { row: 0, column: 6 }, { row: 0, column: 10 })).toBe(
			'world'
		);
	});

	it('moves the cursor across rows while clamping to row length', () => {
		const surface = createCopySurface({
			mode: 'tmux',
			inputValue: 'ls',
			history: [{ type: 'output', content: 'alpha\nbe', timestamp: 1 }]
		});

		expect(moveCopyCursor(surface, { row: 0, column: 4 }, 'down')).toEqual({
			row: 1,
			column: 1
		});
		expect(moveCopyCursor(surface, { row: 1, column: 1 }, 'down')).toEqual({
			row: 2,
			column: 1
		});
		expect(moveCopyCursor(surface, { row: 2, column: 1 }, 'left')).toEqual({
			row: 2,
			column: 0
		});
		expect(moveCopyCursor(surface, { row: 2, column: 1 }, 'home')).toEqual({
			row: 2,
			column: 0
		});
		expect(moveCopyCursor(surface, { row: 1, column: 0 }, 'end')).toEqual({
			row: 1,
			column: 1
		});
	});

	it('extracts text across multiple rows in either direction', () => {
		const surface = createCopySurface({
			mode: 'tmux',
			inputValue: 'ls',
			history: [{ type: 'output', content: 'alpha\nbeta', timestamp: 1 }]
		});

		const expected = 'pha\nbe';

		expect(extractCopySurfaceText(surface, { row: 0, column: 2 }, { row: 1, column: 1 })).toBe(
			expected
		);
		expect(extractCopySurfaceText(surface, { row: 1, column: 1 }, { row: 0, column: 2 })).toBe(
			expected
		);
	});

	it('returns row-based selection segments for highlighting', () => {
		const surface = createCopySurface({
			mode: 'tmux',
			inputValue: 'ls',
			history: [{ type: 'output', content: 'alpha\nbeta', timestamp: 1 }]
		});

		expect(getCopySurfaceSelectionRows(surface, { row: 0, column: 2 }, { row: 2, column: 1 })).toEqual(
			[
				{ row: 0, text: 'alpha', startColumn: 2, endColumn: 5 },
				{ row: 1, text: 'beta', startColumn: 0, endColumn: 4 },
				{ row: 2, text: '% ls', startColumn: 0, endColumn: 2 }
			]
		);
	});

	it('keeps long logical lines unwrapped in the surface model', () => {
		const surface = createCopySurface({
			mode: 'tmux',
			inputValue: 'a'.repeat(40),
			history: []
		});

		expect(surface.rows).toHaveLength(1);
		expect(getCopySurfaceRow(surface, 0)?.text.length).toBe(42);
	});
});
