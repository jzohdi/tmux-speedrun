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

function createTmuxConfigStore() {
	const initialText = readStoredConfigText();
	let fileText = $state(initialText);
	let appliedText = $state(initialText);
	let revision = $state(0);

	function bumpRevision(): void {
		revision += 1;
	}

	function setFileText(nextText: string): void {
		fileText = nextText;
		writeStoredConfigText(nextText);
		bumpRevision();
	}

	function applySavedConfig(): ActiveConfigSnapshot {
		appliedText = fileText;
		bumpRevision();

		return parseTmuxConf(appliedText);
	}

	function resetForTesting(): void {
		fileText = DEFAULT_TMUX_CONF_TEXT;
		appliedText = DEFAULT_TMUX_CONF_TEXT;
		revision = 0;

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
		bumpRevision();

		return {
			ok: true,
			path,
			warnings: cloneWarnings(parseTmuxConf(appliedText).warnings)
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
			return parseTmuxConf(fileText);
		},
		get activeConfig() {
			return parseTmuxConf(appliedText);
		},
		get fileWarnings() {
			return cloneWarnings(parseTmuxConf(fileText).warnings);
		},
		get activeWarnings() {
			return cloneWarnings(parseTmuxConf(appliedText).warnings);
		},
		get revision() {
			return revision;
		},
		setFileText,
		applySavedConfig,
		reloadFromPath,
		resetForTesting
	};
}

export const tmuxConfigStore = createTmuxConfigStore();
