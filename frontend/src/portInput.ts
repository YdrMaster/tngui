// Port input draft preview and validity rules shared by structured form controls.
import { PORT_MAX, PORT_MIN } from './formspec';

export const PORT_DRAFT_MAX_LENGTH = 5;

export interface PortInputEdit {
  currentValue: string;
  selectionStart: number;
  selectionEnd: number;
  inputType: string;
  data?: string | null;
  dataTransferText?: string | null;
}

/** Empty is a valid editing state. Other drafts must be a 1..65535 integer. */
export function isValidPortDraft(draft: string): boolean {
  if (draft === '') return true;
  if (draft.length > PORT_DRAFT_MAX_LENGTH) return false;
  if (!/^[1-9][0-9]{0,4}$/.test(draft)) return false;
  const port = Number(draft);
  return Number.isSafeInteger(port) && port >= PORT_MIN && port <= PORT_MAX;
}

/** Compute the resulting draft before the browser mutates the input. */
export function previewPortDraft(edit: PortInputEdit): string | null {
  const before = edit.currentValue.slice(0, edit.selectionStart);
  const after = edit.currentValue.slice(edit.selectionEnd);

  if (edit.inputType.startsWith('delete')) {
    if (
      edit.inputType === 'deleteContentBackward' &&
      edit.selectionStart === edit.selectionEnd &&
      edit.selectionStart > 0
    ) {
      return edit.currentValue.slice(0, edit.selectionStart - 1) + after;
    }
    if (
      edit.inputType === 'deleteContentForward' &&
      edit.selectionStart === edit.selectionEnd &&
      edit.selectionEnd < edit.currentValue.length
    ) {
      return before + edit.currentValue.slice(edit.selectionEnd + 1);
    }
    return before + after;
  }

  if (edit.inputType.startsWith('insert') || edit.inputType.startsWith('replace')) {
    const inserted = edit.data ?? edit.dataTransferText ?? '';
    return before + inserted + after;
  }

  return null;
}

/** Return a safe draft preview: `null` means the input type needs fallback handling. */
export function nextPortDraft(edit: PortInputEdit): string | null {
  const draft = previewPortDraft(edit);
  return draft === null ? null : draft;
}

/** Used by the input component to decide whether a draft may enter the control. */
export function isAcceptablePortDraft(edit: PortInputEdit): boolean {
  const draft = nextPortDraft(edit);
  return draft !== null && isValidPortDraft(draft);
}
