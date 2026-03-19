import { executeCommand, type CommandIdType, CommandId } from '$lib/utils/tmux-commands';

export const TMUX_CONFIG_PATH = '~/.tmux.conf';

export type TmuxConfigWarning = {
	line: number;
	severity: 'warning' | 'error';
	code: string;
	message: string;
	content: string;
};

export type TmuxBindingKey = {
	key: string;
	withCtrl?: boolean;
	withShift?: boolean;
	keyDisplay: string;
	tmuxNotation: string;
};

export type TmuxConfigBinding = TmuxBindingKey & {
	commandName: CommandIdType;
	commandText?: string;
	source: 'default' | 'config';
	line?: number;
};

export type ParsedTmuxConf = {
	prefixKey: TmuxBindingKey | null;
	unboundKeys: TmuxBindingKey[];
	bindings: TmuxConfigBinding[];
	warnings: TmuxConfigWarning[];
};

type BoundCommandResolution =
	| {
			type: 'binding';
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

export function parseTmuxBindingKey(token: string): TmuxBindingKey | null {
	const normalized = normalizeKeyToken(token);
	const ctrlMatch = /^C-(.)$/i.exec(normalized);
	if (ctrlMatch) {
		return createCtrlBinding(ctrlMatch[1]);
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

export function createBindingLookupKey(binding: TmuxBindingKey): string {
	const parts: string[] = [];

	if (binding.withCtrl) {
		parts.push('Ctrl');
	}
	if (binding.withShift) {
		parts.push('Shift');
	}

	parts.push(binding.key);

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
			type: 'binding',
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
		type: 'binding',
		commandName: execution.commandName,
		commandText: trimmedCommand
	};
}

function parseBindDirective(tokens: string[], lineNumber: number, rawLine: string): ParsedTmuxConf {
	const warnings: TmuxConfigWarning[] = [];
	const flags = tokens.slice(1).filter((token) => token.startsWith('-'));
	const positionalTokens = tokens.slice(1).filter((token) => !token.startsWith('-'));

	if (flags.includes('-n')) {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-bind-flag',
			message: 'prefixless key bindings are not supported in the browser',
			content: rawLine
		});
	}

	const keyToken = positionalTokens[0];
	if (!keyToken) {
		warnings.push({
			line: lineNumber,
			severity: 'error',
			code: 'missing-bind-key',
			message: 'bind-key is missing a key',
			content: rawLine
		});

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
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

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
	}

	const commandText = positionalTokens.slice(1).join(' ');
	const resolution = resolveBoundCommand(commandText);
	if (resolution.type === 'ignored') {
		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
	}

	if (resolution.type === 'unsupported') {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-bind-command',
			message: resolution.message,
			content: rawLine
		});

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
	}

	return {
		prefixKey: null,
		unboundKeys: [],
		bindings: [
			{
				...bindingKey,
				commandName: resolution.commandName,
				commandText: resolution.commandText,
				source: 'config',
				line: lineNumber
			}
		],
		warnings
	};
}

function parseUnbindDirective(tokens: string[], lineNumber: number, rawLine: string): ParsedTmuxConf {
	const warnings: TmuxConfigWarning[] = [];
	const positionalTokens = tokens.slice(1).filter((token) => !token.startsWith('-'));
	const keyToken = positionalTokens[0];

	if (!keyToken) {
		warnings.push({
			line: lineNumber,
			severity: 'error',
			code: 'missing-unbind-key',
			message: 'unbind-key is missing a key',
			content: rawLine
		});

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
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

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
	}

	return {
		prefixKey: null,
		unboundKeys: [bindingKey],
		bindings: [],
		warnings
	};
}

function parseSetDirective(tokens: string[], lineNumber: number, rawLine: string): ParsedTmuxConf {
	const warnings: TmuxConfigWarning[] = [];
	const positionalTokens = tokens.slice(1).filter((token) => !token.startsWith('-'));
	const optionName = positionalTokens[0];
	const optionValue = positionalTokens[1];

	if (optionName !== 'prefix') {
		warnings.push({
			line: lineNumber,
			severity: 'warning',
			code: 'unsupported-set-option',
			message: `unsupported tmux option: ${optionName ?? '(missing option)'}`,
			content: rawLine
		});

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
	}

	if (!optionValue) {
		warnings.push({
			line: lineNumber,
			severity: 'error',
			code: 'missing-prefix-value',
			message: 'prefix option is missing a key value',
			content: rawLine
		});

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
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

		return {
			prefixKey: null,
			unboundKeys: [],
			bindings: [],
			warnings
		};
	}

	return {
		prefixKey,
		unboundKeys: [],
		bindings: [],
		warnings
	};
}

export function parseTmuxConf(text: string): ParsedTmuxConf {
	const warnings: TmuxConfigWarning[] = [];
	const unboundKeys: TmuxBindingKey[] = [];
	const bindings: TmuxConfigBinding[] = [];
	let prefixKey: TmuxBindingKey | null = null;
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
			parsedLine = {
				prefixKey: null,
				unboundKeys: [],
				bindings: [],
				warnings: [
					{
						line: lineNumber,
						severity: 'warning',
						code: 'unsupported-directive',
						message: `unsupported tmux.conf directive: ${directive}`,
						content: rawLine
					}
				]
			};
		}

		warnings.push(...parsedLine.warnings);

		if (parsedLine.prefixKey) {
			prefixKey = parsedLine.prefixKey;
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
		unboundKeys,
		bindings,
		warnings
	};
}
