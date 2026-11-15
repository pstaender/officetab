import { describe, expect, it } from 'vitest';
import { CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE } from '../../src/lo/sc/inc/cellvalue.ts';
import { addr, newDoc, put, str, val } from './calchelper.ts';

describe('Calc cell input', () => {
  it('recognises numbers, percent, currency, dates, times and booleans', () => {
    const doc = newDoc();
    const cases: [string, number, string, string][] = [
      // input, value, display, input line
      ['12', 12, '12', '12'],
      ['-1.5', -1.5, '-1.5', '-1.5'],
      // A thousands separator gives #,##0.00 (ImpSvNumberInputScan).
      ['1,234.5', 1234.5, '1,234.50', '1234.5'],
      ['1e3', 1000, '1.00E+03', '1000'],
      ['12%', 0.12, '12%', '12%'],
      ['$5.25', 5.25, '$5.25', '5.25'],
      ['12/31/2024', 45657, '12/31/24', '12/31/2024'],
      ['2024-01-15', 45306, '2024-01-15', '2024-01-15'],
      ['13:45', 13.75 / 24, '13:45', '13:45:00'],
      ['TRUE', 1, 'TRUE', 'TRUE'],
    ];
    let r = 1;
    for (const [input, value, display, inputLine] of cases) {
      const ref = `A${r++}`;
      put(doc, ref, input);
      expect(doc.GetCellType(addr(doc, ref)), input).toBe(CELLTYPE_VALUE);
      expect(val(doc, ref), input).toBeCloseTo(value, 10);
      expect(str(doc, ref), input).toBe(display);
      expect(doc.GetInputString(addr(doc, ref)), input).toBe(inputLine);
    }
  });

  it('keeps text as text, apostrophe forces text', () => {
    const doc = newDoc();
    put(doc, 'A1', 'hello');
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_STRING);
    put(doc, 'A2', "'0123");
    expect(doc.GetCellType(addr(doc, 'A2'))).toBe(CELLTYPE_STRING);
    expect(str(doc, 'A2')).toBe('0123');
    expect(doc.GetInputString(addr(doc, 'A2'))).toBe("'0123");
    put(doc, 'A3', '12 apples');
    expect(doc.GetCellType(addr(doc, 'A3'))).toBe(CELLTYPE_STRING);
  });

  it('makes formulas from = input', () => {
    const doc = newDoc();
    put(doc, 'A1', '=1+1');
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_FORMULA);
    expect(val(doc, 'A1')).toBe(2);
    expect(doc.GetInputString(addr(doc, 'A1'))).toBe('=1+1');
  });

  it('formats results of date arithmetic as dates', () => {
    const doc = newDoc();
    put(doc, 'A1', '12/31/2024');
    put(doc, 'A2', '=A1+1');
    // en-US standard short date is M/D/YY (DateFormatskey1).
    expect(str(doc, 'A2')).toBe('1/1/25');
    put(doc, 'A3', '=A2-A1');
    expect(str(doc, 'A3')).toBe('1');
    put(doc, 'B1', '$3');
    put(doc, 'B2', '=B1*2');
    expect(str(doc, 'B2')).toBe('$6.00');
  });
});
