import { describe, expect, it } from 'vitest';
import { PageSizeCss, SheetHeightCss } from '../../src/shell/print.ts';

describe('print page size', () => {
  it('names standard papers with their orientation', () => {
    expect(PageSizeCss(11906, 16838)).toBe('A4 portrait');
    expect(PageSizeCss(16838, 11906)).toBe('A4 landscape');
    expect(PageSizeCss(15840, 12240)).toBe('letter landscape');
  });
  it('gives other sizes in millimetres', () => {
    expect(PageSizeCss(7200, 7200)).toBe('127.00mm 127.00mm');
  });
  it('keeps a sheet within the paper', () => {
    // A4 in twips is a little taller than the A4 paper CSS names.
    expect(SheetHeightCss(11906, 16838)).toBe(`calc(min(${16838 / 15}px, 297mm) - 1px)`);
    expect(SheetHeightCss(16838, 11906)).toBe(`calc(min(${11906 / 15}px, 210mm) - 1px)`);
    expect(SheetHeightCss(7200, 7200)).toBe('calc(min(480px, 127mm) - 1px)');
  });
});
