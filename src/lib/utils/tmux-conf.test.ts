import { describe, expect, it } from 'vitest';
import { parseTmuxConf } from './tmux-conf';

describe('parseTmuxConf', () => {
	it('parses prefix, unbinds, and supported bindings', () => {
		const parsed = parseTmuxConf(`
set -g prefix C-a
unbind-key d
bind-key y kill-session
bind-key Left select-pane -L
		`.trim());

		expect(parsed.prefixKey?.key).toBe('a');
		expect(parsed.modeKeys).toBeNull();
		expect(parsed.unboundKeys.map((binding) => binding.key)).toContain('d');
		expect(
			parsed.bindings
				.filter((binding) => binding.kind === 'command')
				.map((binding) => binding.commandName)
		).toContain('kill-session');
		expect(
			parsed.bindings
				.filter((binding) => binding.kind === 'command')
				.map((binding) => binding.commandName)
		).toContain('select-pane');
		expect(parsed.warnings).toHaveLength(0);
	});

	it('warns on unsupported directives and malformed lines', () => {
		const parsed = parseTmuxConf(`
setw -g mouse on
bind-key
set -g prefix
		`.trim());

		expect(parsed.warnings.map((warning) => warning.code)).toContain('unsupported-directive');
		expect(parsed.warnings.map((warning) => warning.code)).toContain('missing-bind-key');
		expect(parsed.warnings.map((warning) => warning.code)).toContain('missing-prefix-value');
	});

	it('ignores send-prefix remap helpers without warning', () => {
		const parsed = parseTmuxConf(`
set -g prefix C-a
unbind C-b
bind-key C-a send-prefix
		`.trim());

		expect(parsed.prefixKey?.key).toBe('a');
		expect(parsed.bindings).toHaveLength(0);
		expect(parsed.warnings).toHaveLength(0);
	});

	it('parses mode-keys and copy-mode table bindings', () => {
		const parsed = parseTmuxConf(`
set -g mode-keys vi
unbind-key -T copy-mode-vi Space
bind-key -T copy-mode-vi y send -X copy-pipe-and-cancel
		`.trim());

		expect(parsed.modeKeys).toBe('vi');
		expect(parsed.unboundKeys).toContainEqual(
			expect.objectContaining({
				table: 'copy-mode-vi',
				eventCode: 'Space'
			})
		);
		expect(parsed.bindings).toContainEqual(
			expect.objectContaining({
				table: 'copy-mode-vi',
				kind: 'copy-mode-action',
				action: 'copy-selection-and-cancel'
			})
		);
		expect(parsed.warnings).toHaveLength(0);
	});
});
