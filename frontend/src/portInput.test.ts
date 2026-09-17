import { describe, expect, it } from 'vitest';
import { isAcceptablePortDraft, isValidPortDraft, nextPortDraft } from './portInput';

describe('port draft validity', () => {
  it('accepts empty and every integer port from 1 to 65535', () => {
    expect(isValidPortDraft('')).toBe(true);
    expect(isValidPortDraft('1')).toBe(true);
    expect(isValidPortDraft('80')).toBe(true);
    expect(isValidPortDraft('65535')).toBe(true);
  });

  it('rejects 0, leading zeros, overflow, decimals and text', () => {
    for (const draft of ['0', '001', '65536', '12.5', 'abc', '', '000', '065535']) {
      if (draft === '') continue;
      expect(isValidPortDraft(draft), draft).toBe(false);
    }
  });
});

describe('port draft preview', () => {
  it('appends text at the caret', () => {
    const draft = nextPortDraft({
      currentValue: '80',
      selectionStart: 2,
      selectionEnd: 2,
      inputType: 'insertText',
      data: '0',
    });
    expect(draft).toBe('800');
    expect(isAcceptablePortDraft({
      currentValue: '80',
      selectionStart: 2,
      selectionEnd: 2,
      inputType: 'insertText',
      data: '0',
    })).toBe(true);
  });

  it('replaces the selected text', () => {
    const draft = nextPortDraft({
      currentValue: '44300',
      selectionStart: 1,
      selectionEnd: 3,
      inputType: 'replaceText',
      data: '55',
    });
    expect(draft).toBe('45500');
  });

  it('previews paste and drop content through data transfer', () => {
    const paste = nextPortDraft({
      currentValue: '443',
      selectionStart: 0,
      selectionEnd: 3,
      inputType: 'insertFromPaste',
      data: null,
      dataTransferText: '65535',
    });
    const drop = nextPortDraft({
      currentValue: '127',
      selectionStart: 3,
      selectionEnd: 3,
      inputType: 'insertFromDrop',
      data: null,
      dataTransferText: '0001',
    });
    expect(paste).toBe('65535');
    expect(drop).toBe('1270001');
  });

  it('previews backspace and range deletion', () => {
    const backspace = nextPortDraft({
      currentValue: '443',
      selectionStart: 3,
      selectionEnd: 3,
      inputType: 'deleteContentBackward',
    });
    const rangeDeletion = nextPortDraft({
      currentValue: '44300',
      selectionStart: 0,
      selectionEnd: 5,
      inputType: 'deleteByCut',
    });
    expect(backspace).toBe('44');
    expect(rangeDeletion).toBe('');
  });

  it('returns null for unsupported input types', () => {
    expect(nextPortDraft({
      currentValue: '443',
      selectionStart: 0,
      selectionEnd: 3,
      inputType: 'historyUndo',
    })).toBeNull();
  });
});
