/**
 * Prompt variations for each tmux command.
 *
 * Each command has 4-6 different phrasings to:
 * 1. Prevent memorization of exact prompts
 * 2. Add variety to the challenge experience
 * 3. Teach users that commands can be described many ways
 *
 * Variations are randomly selected during instruction generation.
 */

/**
 * Map of command name to array of prompt variations.
 * Each variation should be clear and unambiguous.
 */
export const PROMPT_VARIATIONS: Record<string, string[]> = {
	// Session Management
	'new-session': [
		'Create a new tmux session',
		'Start a new tmux session',
		'Initialize a fresh tmux session',
		'Begin a new session',
		'Spawn a new tmux session'
	],
	'attach-session': [
		'Attach to an existing session',
		'Connect to a tmux session',
		'Rejoin an existing session',
		'Reattach to a session',
		'Resume a tmux session'
	],
	detach: [
		'Detach from the current session',
		'Disconnect from this session',
		'Leave the current session running',
		'Exit without closing the session',
		'Detach from tmux'
	],
	'list-sessions': [
		'List all tmux sessions',
		'Show active sessions',
		'Display all running sessions',
		'View the session list',
		'See all tmux sessions'
	],
	'kill-session': [
		'Kill a tmux session',
		'Terminate a session',
		'Close and destroy a session',
		'End a tmux session',
		'Shut down a session'
	],
	'next-session': [
		'Switch to the next session',
		'Move to the next tmux session',
		'Go to the next session',
		'Cycle forward to the next session',
		'Advance to the next session'
	],
	'previous-session': [
		'Switch to the previous session',
		'Move to the previous tmux session',
		'Go back to the previous session',
		'Cycle backward to the previous session',
		'Return to the prior session'
	],
	'kill-server': [
		'Kill the tmux server and every session',
		'Destroy all sessions and the tmux server',
		'Shut down the entire tmux server',
		'Terminate the tmux server and all its sessions',
		'Stop the tmux server, killing all sessions'
	],

	// Window Management
	'new-window': [
		'Create a new window',
		'Open a new window',
		'Add a new window',
		'Spawn a fresh window',
		'Create another window'
	],
	'next-window': [
		'Move to the next window',
		'Switch to the next window',
		'Go to the next window',
		'Navigate forward one window',
		'Cycle to the next window'
	],
	'previous-window': [
		'Move to the previous window',
		'Switch to the previous window',
		'Go back one window',
		'Navigate to the prior window',
		'Cycle to the previous window'
	],
	'select-window': [
		'Select a window by number',
		'Jump to a specific window',
		'Switch to window by index',
		'Go to a numbered window',
		'Navigate to window by number'
	],
	'rename-window': [
		"Rename this window to '{input}'",
		"Change the window name to '{input}'",
		"Set the window title to '{input}'",
		"Give this window the name '{input}'",
		"Rename the current window to '{input}'"
	],
	'kill-window': [
		'Kill the current window',
		'Close this window',
		'Terminate the current window',
		'Destroy this window',
		'End the current window'
	],
	'list-windows': [
		'List all windows',
		'Show the window list',
		'Display all windows',
		'View available windows',
		'See all windows in this session'
	],
	'last-window': [
		'Switch to the last active window',
		'Go to the most recently active window',
		'Jump to the last used window',
		'Return to the last window',
		'Toggle to the last used window'
	],

	// Pane Management
	'split-horizontal': [
		'Split the pane horizontally',
		'Create a horizontal split',
		'Divide the pane top and bottom',
		'Split into top and bottom panes',
		'Add a horizontal divider'
	],
	'split-vertical': [
		'Split the pane vertically',
		'Create a vertical split',
		'Divide the pane left and right',
		'Split into left and right panes',
		'Add a vertical divider'
	],
	'kill-pane': [
		'Kill the current pane',
		'Close this pane',
		'Terminate the active pane',
		'Remove this pane',
		'Destroy the current pane'
	],
	'toggle-zoom': [
		'Toggle pane zoom',
		'Maximize or restore this pane',
		'Toggle fullscreen for this pane',
		'Zoom in or out of the pane',
		'Toggle pane to fullscreen'
	],
	// NOTE: resize-pane removed - Ctrl+Arrow conflicts with macOS Mission Control
	'swap-pane': [
		'Swap this pane with another',
		'Exchange pane positions',
		'Switch this pane with adjacent',
		'Trade pane locations',
		'Move pane by swapping'
	],
	'rotate-panes': [
		'Rotate panes in this window',
		'Cycle pane positions',
		'Shift all panes around',
		'Rotate the pane layout',
		'Spin the pane arrangement'
	],

	// Navigation
	'select-pane': [
		'Move to a different pane',
		'Select another pane',
		'Navigate to adjacent pane',
		'Switch to neighboring pane',
		'Jump to another pane'
	],
	'last-pane': [
		'Switch to the last active pane',
		'Go to the previous pane',
		'Return to the last pane',
		'Toggle to the prior pane',
		'Jump back to last pane'
	],
	'display-panes': [
		'Display pane numbers',
		'Show pane indices',
		'Reveal pane numbers',
		'Flash the pane numbers',
		'Display pane identifiers'
	],

	// Miscellaneous
	'copy-mode': [
		'Enter copy mode',
		'Start copy mode',
		'Begin text selection mode',
		'Activate copy mode',
		'Switch to copy mode'
	],
	'paste-buffer': [
		'Paste from the buffer',
		'Insert copied text',
		'Paste the clipboard',
		'Paste from tmux buffer',
		'Insert buffer contents'
	],
	'list-buffers': [
		'List all paste buffers',
		'Show every paste buffer',
		'Display the paste buffer list',
		'View all tmux paste buffers',
		'See the list of paste buffers'
	],
	'show-buffer': [
		'Show the contents of the latest paste buffer',
		'Print the most recent buffer contents',
		'Display the contents of the top paste buffer',
		'Output the most recent buffer to the screen',
		'Reveal the latest paste buffer contents'
	],
	'command-prompt': [
		'Open the command prompt',
		'Enter command mode',
		'Show the tmux prompt',
		'Access the command line',
		'Open tmux command input'
	],
	'show-time': [
		'Display the clock',
		'Show the current time',
		'Display time in pane',
		'Show a clock overlay',
		'View the time'
	],
	'reload-config': [
		'Reload the tmux configuration',
		'Refresh tmux settings',
		'Source the config file',
		'Reload tmux.conf',
		'Apply configuration changes'
	],

	// Rename-style commands with input (templates use {input} placeholder)
	'rename-session': [
		"Rename this session to '{input}'",
		"Change the session name to '{input}'",
		"Set the session name to '{input}'",
		"Give this session the name '{input}'",
		"Rename the current session to '{input}'"
	]
};

/**
 * Get a random prompt variation for a command.
 *
 * @param commandName - The canonical command name (e.g., 'split-vertical')
 * @returns A random prompt string
 * @throws Error if no variations exist for the command
 */
export function getRandomPrompt(commandName: string): string {
	const variations = PROMPT_VARIATIONS[commandName];

	if (!variations || variations.length === 0) {
		throw new Error(`No prompt variations defined for command: ${commandName}`);
	}

	const randomIndex = Math.floor(Math.random() * variations.length);

	return variations[randomIndex];
}

/**
 * Get a random prompt for an input command, with the placeholder replaced.
 *
 * @param commandName - The canonical command name (e.g., 'rename-window')
 * @param input - The required input string to insert
 * @returns A prompt with {input} replaced by the actual value
 */
export function getRandomPromptWithInput(commandName: string, input: string): string {
	const template = getRandomPrompt(commandName);

	return template.replace('{input}', input);
}

/**
 * Check if a command has prompt variations defined.
 *
 * @param commandName - The command name to check
 * @returns true if variations exist
 */
export function hasPromptVariations(commandName: string): boolean {
	const variations = PROMPT_VARIATIONS[commandName];

	return variations !== undefined && variations.length > 0;
}

/**
 * Get all command names that have prompt variations.
 * Useful for validation.
 */
export function getCommandsWithVariations(): string[] {
	return Object.keys(PROMPT_VARIATIONS);
}
