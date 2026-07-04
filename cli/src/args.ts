/**
 * Hand-rolled arg parsing (no deps).
 *
 * Issue #35, interface §9.1. Recognizes --server <url>, --no-color, --json,
 * --verbose, --help/-h. Unknown command or --help/-h → "help". Default (no
 * args) → "help". Options may be interspersed with positionals.
 */

export type GlobalOptions = {
	server?: string;
	noColor: boolean;
	json: boolean;
	verbose: boolean;
};

export type ParsedArgs = {
	command: string;
	positionals: string[];
	options: GlobalOptions;
};

const KNOWN_COMMANDS = new Set([
	'help',
	'login',
	'logout',
	'whoami',
	'leaderboard',
	'practice',
	'challenge'
]);

export function parseArgs(argv: string[]): ParsedArgs {
	const options: GlobalOptions = {
		server: undefined,
		noColor: false,
		json: false,
		verbose: false
	};
	const positionals: string[] = [];
	let command: string | null = null;
	let wantsHelp = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		switch (arg) {
			case '--help':
			case '-h':
				wantsHelp = true;
				break;
			case '--server':
				options.server = argv[++i];
				break;
			case '--no-color':
				options.noColor = true;
				break;
			case '--json':
				options.json = true;
				break;
			case '--verbose':
				options.verbose = true;
				break;
			default:
				if (arg.startsWith('-')) {
					// Unknown flag — ignore rather than misparse it as a positional.
					break;
				}
				if (command === null) {
					command = arg;
				} else {
					positionals.push(arg);
				}
		}
	}

	if (wantsHelp || command === null || !KNOWN_COMMANDS.has(command)) {
		command = 'help';
	}

	return { command, positionals, options };
}
