// Jump matrices (sc/source/core/tool/jumpmatrix.cxx, ScInterpreter::JumpMatrix): IF, CHOOSE,
// IFERROR over arrays and scalar functions given arrays in array context, translated from
// ucalc_formula2.cxx (testFuncJumpMatrixArrayIF, testFuncJumpMatrixArrayOFFSET).
import { describe, expect, test } from 'vitest';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { newDoc, putAll, str, val } from './calchelper.ts';

function matrix(doc: ReturnType<typeof newDoc>, c1: number, r1: number, c2: number, r2: number, f: string): void {
  const aMark = new ScMarkData(doc.GetSheetLimits());
  aMark.SelectOneTable(0);
  doc.InsertMatrixFormula(c1, r1, c2, r2, aMark, f);
}

describe('jump matrices', () => {
  test('testFuncJumpMatrixArrayIF', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'a', A7: 'a', B7: 1, A8: 'b', B8: 2, A9: 'a', B9: 4 });
    // Matrix in C10, summing B7,B9
    matrix(doc, 2, 9, 2, 9, '=SUM(IF(EXACT(A7:A9;A$1);B7:B9;0))');
    expect(doc.GetValue(new ScAddress(2, 9, 0))).toBe(5);
    // Matrix in C11, summing B7,B9
    matrix(doc, 2, 10, 2, 10, '=SUM(IF(EXACT(OFFSET(A7;0;0):OFFSET(A7;2;0);A$1);OFFSET(A7;0;1):OFFSET(A7;2;1);0))');
    expect(doc.GetValue(new ScAddress(2, 10, 0))).toBe(5);
  });

  test('testFuncJumpMatrixArrayOFFSET', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'abc', A2: 'bcd', A3: 'cde' });
    // Matrix in C5:C7, COLUMN()-3 here offsets by 0 but the entire expression
    // is in array/matrix context.
    matrix(doc, 2, 4, 2, 6, '=FIND("c";OFFSET(A1:A3;0;COLUMN()-3))');
    expect(doc.GetValue(new ScAddress(2, 4, 0))).toBe(3);
    expect(doc.GetValue(new ScAddress(2, 5, 0))).toBe(2);
    expect(doc.GetValue(new ScAddress(2, 6, 0))).toBe(1);
  });

  test('scalar functions over arrays, IFERROR and CHOOSE per element', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'x', A2: 'yy', A3: 'zzz', B1: 1, B2: 0, B3: 4 });
    matrix(doc, 3, 0, 3, 2, '=UPPER(A1:A3)');
    expect([str(doc, 'D1'), str(doc, 'D2'), str(doc, 'D3')]).toEqual(['X', 'YY', 'ZZZ']);
    matrix(doc, 4, 0, 4, 0, '=SUM(LEN(A1:A3))');
    expect(val(doc, 'E1')).toBe(6);
    matrix(doc, 5, 0, 5, 2, '=IFERROR(1/B1:B3;"none")');
    expect([str(doc, 'F1'), str(doc, 'F2'), str(doc, 'F3')]).toEqual(['1', 'none', '0.25']);
    matrix(doc, 6, 0, 6, 1, '=CHOOSE({1;2};"one";"two")');
    expect([str(doc, 'G1'), str(doc, 'G2')]).toEqual(['one', 'two']);
    matrix(doc, 7, 0, 7, 0, '=MAX(IF(B1:B3<4;B1:B3))');
    expect(val(doc, 'H1')).toBe(1);
  });

  test('an error in the upper left element of a matrix result is the cell error', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=WORKDAY.INTL(DATE(2014;11;1);-8;{0;1})' });
    expect(str(doc, 'A1')).toBe('#VALUE!');
  });
});
