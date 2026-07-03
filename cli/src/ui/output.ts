/**
 * Console output helpers (issue #35). Thin wrappers so commands share a single
 * output style and colour is centrally toggleable (`--no-color`).
 */

const ESC = String.fromCharCode(27);
let colorEnabled = true;

export function setColorEnabled(enabled: boolean): void {
	colorEnabled = enabled;
}

function paint(code: string, text: string): string {
	return colorEnabled ? `${ESC}[${code}m${text}${ESC}[0m` : text;
}

export const bold = (t: string) => paint('1', t);
export const dim = (t: string) => paint('2', t);
export const green = (t: string) => paint('32', t);
export const red = (t: string) => paint('31', t);
export const cyan = (t: string) => paint('36', t);

export function info(message: string): void {
	process.stdout.write(`${message}\n`);
}

export function success(message: string): void {
	process.stdout.write(`${green('✓')} ${message}\n`);
}

export function error(message: string): void {
	process.stderr.write(`${red('✗')} ${message}\n`);
}
