import { parseTmuxConf, TMUX_CONFIG_PATH } from '$lib/utils/tmux-conf';

const TMUX_CONFIG_STORAGE_KEY = 'tmux-speedrun:tmux-conf:file';
const DEFAULT_TMUX_CONF_TEXT = '';

export type TmuxConfigWarning = ReturnType<typeof parseTmuxConf>['warnings'][number];

type ActiveConfigSnapshot = ReturnType<typeof parseTmuxConf>;

function cloneWarnings(warnings: TmuxConfigWarning[]): TmuxConfigWarning[] {
	return warnings.map((warning) => ({ ...warning }));
}

function canUseLocalStorage(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredConfigText(): string {
	if (!canUseLocalStorage()) {
		return DEFAULT_TMUX_CONF_TEXT;
	}

	const storedValue = window.localStorage.getItem(TMUX_CONFIG_STORAGE_KEY);
	if (storedValue === null) {
		return DEFAULT_TMUX_CONF_TEXT;
	}

	return storedValue;
}

function writeStoredConfigText(text: string): void {
	if (!canUseLocalStorage()) {
		return;
	}

	window.localStorage.setItem(TMUX_CONFIG_STORAGE_KEY, text);
}

/**
 * Wrap parseTmuxConf with a single-entry cache keyed on the input text, so the
 * config is only re-parsed when its text actually changes. The getters still read
 * the underlying `$state` directly, so reactivity (and freshness in tests) is
 * preserved — this just avoids re-parsing on every access, which happens on every
 * keystroke via the keybinding lookup path.
 */
function createCachedParser(): (text: string) => ActiveConfigSnapshot {
	let cachedText: string | null = null;
	let cached: ActiveConfigSnapshot | null = null;

	return (text: string) => {
		if (cachedText !== text || cached === null) {
			cachedText = text;
			cached = parseTmuxConf(text);
		}

		return cached;
	};
}

function createTmuxConfigStore() {
	const parseFile = createCachedParser();
	const parseApplied = createCachedParser();
	const initialText = readStoredConfigText();
	let fileText = $state(initialText);
	let appliedText = $state(initialText);

	function setFileText(nextText: string): void {
		fileText = nextText;
		writeStoredConfigText(nextText);
	}

	function applySavedConfig(): ActiveConfigSnapshot {
		appliedText = fileText;

		return parseApplied(appliedText);
	}

	function resetForTesting(): void {
		fileText = DEFAULT_TMUX_CONF_TEXT;
		appliedText = DEFAULT_TMUX_CONF_TEXT;

		if (canUseLocalStorage()) {
			window.localStorage.removeItem(TMUX_CONFIG_STORAGE_KEY);
		}
	}

	function loadConfigTextForPath(path: string): string | null {
		if (path === TMUX_CONFIG_PATH || path === '.tmux.conf') {
			return fileText;
		}

		return null;
	}

	function reloadFromPath(path: string): {
		ok: boolean;
		path: string;
		warnings: TmuxConfigWarning[];
		error?: string;
	} {
		const targetText = loadConfigTextForPath(path);
		if (targetText === null) {
			return {
				ok: false,
				path,
				warnings: [],
				error: `can't read ${path}: no such file`
			};
		}

		appliedText = targetText;

		return {
			ok: true,
			path,
			warnings: cloneWarnings(parseApplied(appliedText).warnings)
		};
	}

	return {
		get fileText() {
			return fileText;
		},
		get appliedText() {
			return appliedText;
		},
		get hasUnappliedChanges() {
			return fileText !== appliedText;
		},
		get fileConfig() {
			return parseFile(fileText);
		},
		get activeConfig() {
			return parseApplied(appliedText);
		},
		get fileWarnings() {
			return cloneWarnings(parseFile(fileText).warnings);
		},
		get activeWarnings() {
			return cloneWarnings(parseApplied(appliedText).warnings);
		},
		setFileText,
		applySavedConfig,
		reloadFromPath,
		resetForTesting
	};
}

export const tmuxConfigStore = createTmuxConfigStore();
