import { describe, expect, it } from 'vitest';
import { calc, newDoc, putAll, str } from './calchelper.ts';

describe('Calc interpreter core', () => {
  it('computes operators with precedence', () => {
    const doc = newDoc();
    expect(calc(doc, '=1+2*3')).toBe('7');
    expect(calc(doc, '=(1+2)*3')).toBe('9');
    expect(calc(doc, '=2^3^2')).toBe('64');
    expect(calc(doc, '=-2^2')).toBe('4');
    expect(calc(doc, '=10%', 'Y1')).toBe('10.00%');
    expect(calc(doc, '="a"&"b"&1')).toBe('ab1');
    expect(calc(doc, '=0.1+0.2')).toBe('0.3');
    expect(calc(doc, '=1/0')).toBe('#DIV/0!');
    expect(calc(doc, '="x"+1')).toBe('#VALUE!');
    expect(calc(doc, '="3"+1')).toBe('4');
  });
  it('compares', () => {
    const doc = newDoc();
    expect(calc(doc, '=1<2')).toBe('TRUE');
    // Case sensitive by default (Tools - Options - Calc - Calculate).
    expect(calc(doc, '="a"="A"')).toBe('FALSE');
    expect(calc(doc, '="a"="a"')).toBe('TRUE');
    expect(calc(doc, '="b">"a"')).toBe('TRUE');
    expect(calc(doc, '=1<"a"')).toBe('TRUE');
    expect(calc(doc, '=A100=0')).toBe('TRUE');
    expect(calc(doc, '=A100=""')).toBe('TRUE');
  });
  it('sums ranges and references', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 'x', A4: '=A1*10' });
    expect(calc(doc, '=SUM(A1:A4)')).toBe('13');
    expect(calc(doc, '=SUM(A1:A4;5)')).toBe('18');
    expect(calc(doc, '=COUNT(A1:A4)')).toBe('3');
    expect(calc(doc, '=COUNTA(A1:A4)')).toBe('4');
    expect(calc(doc, '=AVERAGE(A1:A2)')).toBe('1.5');
    expect(calc(doc, '=PRODUCT(A1:A2;3)')).toBe('6');
    expect(calc(doc, '=SUM(A:A)')).toBe('13');
    expect(calc(doc, '=AVERAGE(B1:B3)')).toBe('#DIV/0!');
    expect(calc(doc, '=SUM((A1:A2;A4))')).toBe('13');
    expect(calc(doc, '=SUM(A1:A4!A2:B2)')).toBe('2');
  });
  it('evaluates IF, IFERROR, CHOOSE lazily', () => {
    const doc = newDoc();
    expect(calc(doc, '=IF(1;"y";"n")')).toBe('y');
    expect(calc(doc, '=IF(0;"y")')).toBe('FALSE');
    expect(calc(doc, '=IF(0;1/0;2)')).toBe('2');
    expect(calc(doc, '=IFERROR(1/0;"e")')).toBe('e');
    expect(calc(doc, '=IFNA(1/0;"e")')).toBe('#DIV/0!');
    expect(calc(doc, '=IFNA(NA();"e")')).toBe('e');
    expect(calc(doc, '=CHOOSE(2;"a";"b";"c")')).toBe('b');
    expect(calc(doc, '=CHOOSE(4;"a";"b";"c")')).toBe('Err:502');
  });
  it('has logical and information functions', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'text', A2: 5, A3: '=1/0' });
    expect(calc(doc, '=AND(1;0)')).toBe('FALSE');
    expect(calc(doc, '=OR(1;0)')).toBe('TRUE');
    expect(calc(doc, '=XOR(1;1)')).toBe('FALSE');
    expect(calc(doc, '=NOT(0)')).toBe('TRUE');
    expect(calc(doc, '=TRUE()')).toBe('TRUE');
    expect(calc(doc, '=ISTEXT(A1)')).toBe('TRUE');
    expect(calc(doc, '=ISNUMBER(A2)')).toBe('TRUE');
    expect(calc(doc, '=ISBLANK(A9)')).toBe('TRUE');
    expect(calc(doc, '=ISERROR(A3)')).toBe('TRUE');
    expect(calc(doc, '=ISERR(NA())')).toBe('FALSE');
    expect(calc(doc, '=ISNA(NA())')).toBe('TRUE');
    expect(calc(doc, '=ISFORMULA(A3)')).toBe('TRUE');
    expect(calc(doc, '=ISEVEN(4)')).toBe('TRUE');
    expect(calc(doc, '=N(A1)')).toBe('0');
    expect(calc(doc, '=TYPE(A1)')).toBe('2');
    expect(calc(doc, '=ERROR.TYPE(A3)')).toBe('2');
    expect(calc(doc, '=foo(1)')).toBe('#NAME?');
    expect(calc(doc, '=1+')).toBe('Err:520');
  });
  it('propagates errors and recalculates', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, B1: '=A1*2', C1: '=B1+1' });
    expect(str(doc, 'C1')).toBe('3');
    putAll(doc, { A1: 5 });
    expect(str(doc, 'C1')).toBe('11');
    putAll(doc, { A1: '=1/0' });
    expect(str(doc, 'C1')).toBe('#DIV/0!');
  });
});
