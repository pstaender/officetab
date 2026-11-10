import { describe, expect, it } from 'vitest';
import { PageSizeCss } from '../../src/app/print.ts';

describe('print page size', () => {
  it('names standard papers with their orientation', () => {
    expect(PageSizeCss(11906, 16838)).toBe('A4 portrait');
    expect(PageSizeCss(16838, 11906)).toBe('A4 landscape');
    expect(PageSizeCss(15840, 12240)).toBe('letter landscape');
  });
  it('gives other sizes in millimetres', () => {
    expect(PageSizeCss(7200, 7200)).toBe('127.00mm 127.00mm');
  });
});
