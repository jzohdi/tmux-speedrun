import { executeCommand, type CommandIdType, CommandId } from '$lib/utils/tmux-commands';

export const TMUX_CONFIG_PATH = '~/.tmux.conf';

export type TmuxModeKeys = 'vi' | 'emacs';
export type TmuxKeyTable = 'prefix' | 'copy-mode' | 'copy-mode-vi';
export type CopyModeAction =
	| 'begin-selection'
	| 'copy-selection-and-cancel'
	| 'cancel'
	| 'clear-selection'
	| 'cursor-left'
	| 'cursor-right'
	| 'cursor-up'
	| 'cursor-down'
	| 'start-of-line'
	| 'end-of-line';

export type TmuxConfigWarning = {
	line: number;
	severity: 'warning' | 'error';
	code: string;
	message: string;
	content: string;
};

export type TmuxBindingKey = {
	key: string;
	eventCode?: string;
	withCtrl?: boolean;
	withShift?: boolean;
	withAltOrMeta?: boolean;
	keyDisplay: string;
	tmuxNotation: string;
};

export type TmuxTableBindingKey = TmuxBindingKey & {
	table: TmuxKeyTable;
};

export type TmuxConfigBinding = TmuxTableBindingKey & {
	kind: 'command' | 'copy-mode-action';
	source: 'default' | 'config';
	line?: number;
} & (
		| {
				kind: 'command';
				commandName: CommandIdType;
				commandText?: string;
		  }
		| {
				kind: 'copy-mode-action';
				action: CopyModeAction;
		  }
	);

export type ParsedTmuxConf = {
	prefixKey: TmuxBindingKey | null;
	modeKeys: TmuxModeKeys | null;
	unboundKeys: TmuxTableBindingKey[];
	bindings: TmuxConfigBinding[];
	warnings: TmuxConfigWarning[];
};

type BoundCommandResolution =
	| {
			type: 'command';
			commandName: CommandIdType;
			commandText?: string;
	  }
	| {
			type: 'ignored';
	  }
	| {
			type: 'unsupported';
			message: string;
	  };

type CopyModeActionResolution =
	| {
			type: 'copy-mode-action';
			action: CopyModeAction;
	  }
	| {
			type: 'ignored';
	  }
	| {
			type: 'unsupported';
			message: string;
	  };

const SPECIAL_COMMAND_MAP = new Map<string, CommandIdType>([
	['display-panes', CommandId.DISPLAY_PANES],
	['copy-mode', CommandId.COPY_MODE],
	['paste-buffer', CommandId.PASTE_BUFFER],
	['command-prompt', CommandId.COMMAND_PROMPT],
	['show-time', CommandId.SHOW_TIME]
]);

function tokenizeConfigLine(line: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;
	let index = 0;

	while (index < line.length) {
		const char = line[index];

		if (quote) {
			if (char === '\\' && index + 1 < line.length) {
				current += line[index + 1];
				index += 2;
				continue;
			}

			if (char === quote) {
				quote = null;
				index++;
				continue;
			}

			current += char;
			index++;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			index++;
			continue;
		}

		if (char === '#' && (index === 0 || /\s/.exec(line[index - 1]) !== null)) {
			break;
		}

		if (/\s/.exec(char) !== null) {
			if (current) {
				tokens.push(current);
				current = '';
			}
			index++;
			continue;
		}

		if (char === '\\' && index + 1 < line.length) {
			current += line[index + 1];
			index += 2;
			continue;
		}

		current += char;
		index++;
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

function normalizeKeyToken(token: string): string {
	if (token === '""') {
		return '"';
	}

	return token;
}

function createEmptyParsedConfig(warnings: TmuxConfigWarning[] = []): ParsedTmuxConf {
	return {
		prefixKey: null,
		modeKeys: null,
		unboundKeys: [],
		bindings: [],
		warnings
	};
}

function createCtrlBinding(key: string): TmuxBindingKey | null {
	if (key.length !== 1) {
		return null;
	}

	return {
		key: key.toLowerCase(),
		withCtrl: true,
		keyDisplay: `Ctrl+${key.toLowerCase()}`,
		tmuxNotation: `C-${key.toLowerCase()}`
	};
}

function createLiteralBinding(key: string, tmuxNotation?: string): TmuxBindingKey {
	return {
		key,
		keyDisplay: key,
		tmuxNotation: tmuxNotation ?? key
	};
}

function createSpecialBinding(
	key: string,
	keyDisplay: string,
	tmuxNotation: string,
	eventCode?: string
): TmuxBindingKey {
	return {
		key,
		eventCode,
		keyDisplay,
		tmuxNotation
	};
}

function withAltOrMeta(binding: TmuxBindingKey): TmuxBindingKey {
	return {
		...binding,
		withAltOrMeta: true,
		keyDisplay: `Alt+${binding.keyDisplay}`,
		tmuxNotation: `M-${binding.tmuxNotation}`
	};
}

export function parseTmuxBindingKey(token: string): TmuxBindingKey | null {
	const normalized = normalizeKeyToken(token);
	const metaMatch = /^M-(.+)$/iu.exec(normalized);
	if (metaMatch) {
		const baseBinding = parseTmuxBindingKey(metaMatch[1]);

		return baseBinding ? withAltOrMeta(baseBinding) : null;
	}

	const ctrlMatch = /^C-(.+)$/iu.exec(normalized);
	if (ctrlMatch) {
		if (ctrlMatch[1].toLowerCase() === 'space') {
			return {
				key: ' ',
				eventCode: 'Space',
				withCtrl: true,
				keyDisplay: 'Ctrl+Space',
				tmuxNotation: 'C-Space'
			};
		}

		return createCtrlBinding(ctrlMatch[1]);
	}

	if (normalized === 'Space') {
		return createSpecialBinding(' ', 'Space', 'Space', 'Space');
	}

	if (normalized === 'Escape') {
		return createSpecialBinding('Escape', 'Escape', 'Escape');
	}

	if (normalized === 'Enter') {
		return createSpecialBinding('Enter', 'Enter', 'Enter');
	}

	if (normalized === 'Home') {
		return createSpecialBinding('Home', 'Home', 'Home');
	}

	if (normalized === 'End') {
		return createSpecialBinding('End', 'End', 'End');
	}

	if (normalized === 'Up') {
		return createLiteralBinding('ArrowUp', 'Up');
	}

	if (normalized === 'Down') {
		return createLiteralBinding('ArrowDown', 'Down');
	}

	if (normalized === 'Left') {
		return createLiteralBinding('ArrowLeft', 'Left');
	}

	if (normalized === 'Right') {
		return createLiteralBinding('ArrowRight', 'Right');
	}

	if (normalized.length === 1) {
		return createLiteralBinding(normalized);
	}

	return null;
}

export function parseTmuxPrefixKey(token: string): TmuxBindingKey | null {
	return parseTmuxBindingKey(token);
}

export function createBindingLookupKey(binding: TmuxTableBindingKey): string {
	const parts: string[] = [];

	parts.push(binding.table);

	if (binding.withCtrl) {
		parts.push('Ctrl');
	}
	if (binding.withAltOrMeta) {
		parts.push('Meta');
	}
	if (binding.withShift) {
		parts.push('Shift');
	}

	parts.push(binding.eventCode ?? binding.key);

	return parts.join('+');
}

function resolveBoundCommand(commandText: string): BoundCommandResolution {
	const trimmedCommand = commandText.trim();
	if (!trimmedCommand) {
		return {
			type: 'unsupported',
			message: 'binding is missing a command'
		};
	}

	if (trimmedCommand === 'send-prefix') {
		return {
			type: 'ignored'
		};
	}

	const specialCommand = SPECIAL_COMMAND_MAP.get(trimmedCommand);
	if (specialCommand) {
		return {
			type: 'command',
			commandName: specialCommand
		};
	}

	const execution = executeCommand(trimmedCommand, 'config-pane', 'tmux');
	if (!execution) {
		return {
			type: 'unsupported',
			message: `unsupported bound command: ${trimmedCommand}`
		};
	}

	return {
		type: 'command',
		commandName: execution.commandName,
		commandText: trimmedCommand
	};
}

const COPY_MODE_ACTION_MAP = new Map<string, CopyModeAction>([
	['begin-selection', 'begin-selection'],
	['copy-selection-and-cancel', 'copy-selection-and-cancel'],
	['copy-pipe-and-cancel', 'copy-selection-and-cancel'],
	['cancel', 'cancel'],
	['clear-selection', 'clear-selection'],
	['cursor-left', 'cursor-left'],
	['cursor-right', 'cursor-right'],
	['cursor-up', 'cursor-up'],
	['cursor-down', 'cursor-down'],
	['start-of-line', 'start-of-line'],
	['end-of-line', 'end-of-line']
]);

function resolveCopyModeAction(commandText: string): CopyModeActionResolution {
	const tokens = tokenizeConfigLine(commandText.trim());
	const commandName = tokens[0];

	if (!commandName) {
		return {
			type: 'unsupported',
			message: 'binding is missing a copy-mode command'
		};
	}

	if (commandName !== 'send' && commandName !== 'send-keys') {
		return {
			type: 'unsupported',
			message: `unsupported copy-mode binding command: ${commandText.trim()}`
		};
	}

	const sendIndex = tokens.indexOf('-X');
	const actionToken = sendIndex >= 0 ? tokens[sendIndex + 1] : undefined;

	if (!actionToken) {
		return {
			type: 'unsupported',
			message: `unsupported copy-mode binding command: ${commandText.trim()}`
		};
	}

	const action = COPY_MODE_ACTION_MAP.get(actionToken);
	if (!action) {
		return {
			type: 'unsupported',
			message: `unsupported copy-mode action: ${actionToken}`
		};
	}

	return {
		type: 'copy-mode-action',
		action
	};
}

function parseKeyTableToken(token: string): TmuxKeyTable | null {
	if (token === 'copy-mode' || token === 'copy-mode-vi') {
		return token;
	}

	return null;
}

function parseBindLikeDirective(
	tokens: string[],
	lineNumber: number,
	rawLine: string
): {
	table: TmuxKeyTable;
	positionalTokens: string[];
	warnings: TmuxConfigWarning[];
} {
	const positionalTokens: string[] = [];
	const warnings: TmuxConfigWarning[] = [];
	let table: TmuxKeyTable = 'prefix';
	let parsingOptions = true;

	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];

		if (!parsingOptions) {
			positionalTokens.push(token);
			continue;
		}

		if (token === '-n') {
			warnings.push({
				line: lineNumber,
				severity: 'warning',
				code: 'unsupported-bind-flag',
				message: 'prefixless key bindings are not supported in the browser',
				content: rawLine
			});
			continue;
		}

		if (token === '-T') {
			const nextToken = tokens[index + 1];
			if (!nextToken) {
				warnings.push({
					line: lineNumber,
					severity: 'error',
					code: 'missing-key-table',
					message: 'bind-key is missing a key table after -T',
					content: rawLine
				});
				continue;
			}

			const parsedTable = parseKeyTableToken(nextToken);
			if (!parsedTable) {
				warnings.push({
					line: lineNumber,
					severity: 'warning',
					code: 'unsupported-key-table',
					message: `unsupported key table: ${nextToken}`,
					content: rawLine
				});
			} else {
				table = parsedTable;
			}

			index++;
			continue;
		}

		const compactTableMatch = /^-T(.+)$/u.exec(token);
		if (compactTableMatch) {
			const parsedTable = parseKeyTableToken(compactTableMatch[1]);
			if (!parsedTable) {
				warnings.push({
					line: lineNumber,
					severity: 'warning',
					code: 'unsupported-key-table',
					message: `unsupported key table: ${compactTableMatch[1]}`,
					content: rawLine
				});
			} else {
				table = parsedTable;
			}
			continue;
		}

		if (token.startsWith('-')) {
			continue;
		}

		parsingOptions = false;
		positionalTokens.push(token);
	}

	return {
		table,
		positionalTokens,
		warnings
	};
}

function parseBindDirective(tokens: string[], lineNumber: number, rawLine: string): ParsedTmuxConf {
	const { table, positionalTokens, warnings } = parseBindLikeDirective(tokens, lineNumber, rawLine);

	const keyToken = positionalTokens[0];
	if (!keyToken) {
		warnings.push({
			line: lineNumber,
			severity: 'error',
			code: 'missing-bind-key',
			message: 'bind-key is missing a key',
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	const bindingKey = parseTmuxBindingKey(keyToken);
	if (!bindingKey) {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-bind-key',
			message: `unsupported key binding: ${keyToken}`,
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	const commandText = positionalTokens.slice(1).join(' ');
	const resolution =
		table === 'prefix' ? resolveBoundCommand(commandText) : resolveCopyModeAction(commandText);
	if (resolution.type === 'ignored') {
		return createEmptyParsedConfig(warnings);
	}

	if (resolution.type === 'unsupported') {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-bind-command',
			message: resolution.message,
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	if (resolution.type === 'command') {
		return {
			prefixKey: null,
			modeKeys: null,
			unboundKeys: [],
			bindings: [
				{
					...bindingKey,
					table,
					kind: 'command',
					commandName: resolution.commandName,
					commandText: resolution.commandText,
					source: 'config',
					line: lineNumber
				}
			],
			warnings
		};
	}

	return {
		prefixKey: null,
		modeKeys: null,
		unboundKeys: [],
		bindings: [
			{
				...bindingKey,
				table,
				kind: 'copy-mode-action',
				action: resolution.action,
				source: 'config',
				line: lineNumber
			}
		],
		warnings
	};
}

function parseUnbindDirective(tokens: string[], lineNumber: number, rawLine: string): ParsedTmuxConf {
	const { table, positionalTokens, warnings } = parseBindLikeDirective(tokens, lineNumber, rawLine);
	const keyToken = positionalTokens[0];

	if (!keyToken) {
		warnings.push({
			line: lineNumber,
			severity: 'error',
			code: 'missing-unbind-key',
			message: 'unbind-key is missing a key',
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	const bindingKey = parseTmuxBindingKey(keyToken);
	if (!bindingKey) {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-unbind-key',
			message: `unsupported key for unbind-key: ${keyToken}`,
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	return {
		prefixKey: null,
		modeKeys: null,
		unboundKeys: [{ ...bindingKey, table }],
		bindings: [],
		warnings
	};
}

function parseSetDirective(tokens: string[], lineNumber: number, rawLine: string): ParsedTmuxConf {
	const warnings: TmuxConfigWarning[] = [];
	const positionalTokens = tokens.slice(1).filter((token) => !token.startsWith('-'));
	const optionName = positionalTokens[0];
	const optionValue = positionalTokens[1];

	if (optionName === 'mode-keys') {
		if (optionValue !== 'vi' && optionValue !== 'emacs') {
			warnings.push({
				line: lineNumber,
				severity: 'warning',
				code: 'unsupported-mode-keys',
				message: `unsupported mode-keys value: ${optionValue ?? '(missing value)'}`,
				content: rawLine
			});

			return createEmptyParsedConfig(warnings);
		}

		return {
			prefixKey: null,
			modeKeys: optionValue,
			unboundKeys: [],
			bindings: [],
			warnings
		};
	}

	if (optionName !== 'prefix') {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-set-option',
			message: `unsupported tmux option: ${optionName ?? '(missing option)'}`,
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	if (!optionValue) {
		warnings.push({
			line: lineNumber,
			severity: 'error',
			code: 'missing-prefix-value',
			message: 'prefix option is missing a key value',
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	const prefixKey = parseTmuxPrefixKey(optionValue);
	if (!prefixKey || prefixKey.withCtrl !== true) {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-prefix-key',
			message: `unsupported prefix key: ${optionValue}. Only Ctrl+<key> prefixes are supported.`,
			content: rawLine
		});

		return createEmptyParsedConfig(warnings);
	}

	return {
		prefixKey,
		modeKeys: null,
		unboundKeys: [],
		bindings: [],
		warnings
	};
}

export function parseTmuxConf(text: string): ParsedTmuxConf {
	const warnings: TmuxConfigWarning[] = [];
	const unboundKeys: TmuxTableBindingKey[] = [];
	const bindings: TmuxConfigBinding[] = [];
	let prefixKey: TmuxBindingKey | null = null;
	let modeKeys: TmuxModeKeys | null = null;
	const seenConfigBindings = new Map<string, number>();

	const lines = text.split(/\r?\n/u);
	for (const [lineIndex, rawLine] of lines.entries()) {
		const lineNumber = lineIndex + 1;
		const tokens = tokenizeConfigLine(rawLine);
		if (tokens.length === 0) {
			continue;
		}

		const directive = tokens[0];
		let parsedLine: ParsedTmuxConf;

		if (directive === 'set' || directive === 'set-option') {
			parsedLine = parseSetDirective(tokens, lineNumber, rawLine);
		} else if (directive === 'bind' || directive === 'bind-key') {
			parsedLine = parseBindDirective(tokens, lineNumber, rawLine);
		} else if (directive === 'unbind' || directive === 'unbind-key') {
			parsedLine = parseUnbindDirective(tokens, lineNumber, rawLine);
		} else {
			parsedLine = createEmptyParsedConfig([
				{
					line: lineNumber,
					severity: 'warning',
					code: 'unsupported-directive',
					message: `unsupported tmux.conf directive: ${directive}`,
					content: rawLine
				}
			]);
		}

		warnings.push(...parsedLine.warnings);

		if (parsedLine.prefixKey) {
			prefixKey = parsedLine.prefixKey;
		}
		if (parsedLine.modeKeys) {
			modeKeys = parsedLine.modeKeys;
		}

		for (const unboundKey of parsedLine.unboundKeys) {
			unboundKeys.push(unboundKey);
		}

		for (const binding of parsedLine.bindings) {
			const lookupKey = createBindingLookupKey(binding);
			const existingLine = seenConfigBindings.get(lookupKey);
			if (existingLine !== undefined) {
				warnings.push({
					line: binding.line ?? lineNumber,
					severity: 'warning',
					code: 'duplicate-binding',
					message: `key ${binding.tmuxNotation} overrides an earlier binding from line ${existingLine}`,
					content: rawLine
				});
			}
			seenConfigBindings.set(lookupKey, binding.line ?? lineNumber);
			bindings.push(binding);
		}
	}

	return {
		prefixKey,
		modeKeys,
		unboundKeys,
		bindings,
		warnings
	};
}
