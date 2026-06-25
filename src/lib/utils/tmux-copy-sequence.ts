export const COPY_PASTE_SEQUENCE_ACTION = 'copy-paste-sequence';

export function createCopyPasteSequenceAction(copyText: string): string {
	return `${COPY_PASTE_SEQUENCE_ACTION}:${copyText}`;
}
