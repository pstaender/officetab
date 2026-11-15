// Criteria functions: COUNTIF, SUMIF, AVERAGEIF, COUNTIFS, SUMIFS, AVERAGEIFS, MINIFS, MAXIFS and
// COUNTBLANK, with the query machinery (ScQueryParam, ScQueryEvaluator, ScQueryCellIterator).
// Expected values from upstream's sc/qa/unit/ucalc_formula.cxx, ucalc_formula2.cxx and the
// function test documents sc/qa/unit/data/functions/*/fods/*.fods (run as upstream's
// functions_test.cxx does: every "Correct" cell must be TRUE after recalculation).
import { describe, expect, it } from 'vitest';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { fodsFailures } from './calcfods.ts';
import { calc, calcValue, newDoc, put, putAll, str, val } from './calchelper.ts';

function matrix(doc: ScDocument, nCol1: number, nRow1: number, nCol2: number, nRow2: number, f: string): void {
  const mark = new ScMarkData(doc.GetSheetLimits());
  mark.SelectOneTable(0);
  doc.InsertMatrixFormula(nCol1, nRow1, nCol2, nRow2, mark, f);
}

describe('COUNTIF', () => {
  it('numbers, operators and strings (testFuncCOUNTIF)', () => {
    const doc = newDoc();
    ['1999', '2000', '0', '0', '0', '2002', '2001', 'X', '2002'].forEach((v, i) => put(doc, `A${i + 1}`, v));
    const aChecks: [string, number][] = [
      ['=COUNTIF(A1:A12;1999)', 1], ['=COUNTIF(A1:A12;2002)', 2], ['=COUNTIF(A1:A12;1998)', 0], ['=COUNTIF(A1:A12;">=1999")', 5],
      ['=COUNTIF(A1:A12;">1999")', 4], ['=COUNTIF(A1:A12;"<2001")', 5], ['=COUNTIF(A1:A12;">0")', 5], ['=COUNTIF(A1:A12;">=0")', 8],
      ['=COUNTIF(A1:A12;0)', 3], ['=COUNTIF(A1:A12;"X")', 1], ['=COUNTIF(A1:A12;)', 3],
    ];
    aChecks.forEach(([f], i) => put(doc, `A${21 + i}`, f));
    aChecks.forEach(([f, r], i) => expect(val(doc, `A${21 + i}`), f).toBe(r));
  });

  it('empty strings (testFuncCOUNTIF, fdo#77039)', () => {
    const doc = newDoc();
    // Don't count empty strings when searching for a number.
    putAll(doc, { A1: '=""', A2: '=COUNTIF(A1;1)' });
    expect(val(doc, 'A2')).toBe(0);

    const doc2 = newDoc();
    for (let i = 1; i <= 4; i++) put(doc2, `A${i}`, '=""');
    put(doc2, 'A5', '=COUNTIF(A1:A4;"")');
    expect(val(doc2, 'A5')).toBe(4);
  });

  it('empty array elements match 0, not empty cells (tdf#99291)', () => {
    const doc = newDoc();
    matrix(doc, 0, 0, 0, 1, '=COUNTIF(B1:B5;C1:C2)');
    expect(doc.GetFormula(new ScAddress(0, 0, 0))).toBe('{=COUNTIF(B1:B5,C1:C2)}');
    expect(val(doc, 'A1')).toBe(0);
    expect(val(doc, 'A2')).toBe(0);
  });

  it('counts empty cells when asked to (testFuncCOUNTIFEmpty)', () => {
    const doc = newDoc();
    ['', 'a', 'b', 'c', 'd', 'a', '', 'b', 'c'].forEach((v, i) => v && put(doc, `A${i + 1}`, v));
    put(doc, 'K1', '=COUNTIFS($A1:$A21; "")');
    expect(val(doc, 'K1')).toBe(21 - 7);
    expect(calcValue(doc, '=COUNTIF(A1:A21;"")')).toBe(14);
    expect(calcValue(doc, '=COUNTIF(A1:A21;"=")')).toBe(14);
    expect(calcValue(doc, '=COUNTIF(A1:A21;"<>")')).toBe(7);
    // Whole columns, also beyond the allocated ones.
    expect(calcValue(doc, '=COUNTIF(A:A;"<>")')).toBe(7);
    expect(calcValue(doc, '=COUNTIF(X1:Y10;"")')).toBe(20);
  });

  it('wildcards, regular expressions, case and whole cell options', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'apple', A2: 'Apple pie', A3: 'banana', A4: 'APPLE', A5: 'a*b', A6: 10, A7: "'10", A8: 5 });
    expect(calcValue(doc, '=COUNTIF(A1:A8;"apple")')).toBe(2);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"app*")')).toBe(3);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"?pple")')).toBe(2);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"a~*b")')).toBe(1);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"<>apple")')).toBe(6);
    expect(calcValue(doc, '=COUNTIF(A1:A8;10)')).toBe(1); // a number does not match the text "10"
    expect(calcValue(doc, '=COUNTIF(A1:A8;"10")')).toBe(2); // a numeric criterion string matches both
    expect(calcValue(doc, '=COUNTIF(A1:A8;">5")')).toBe(1);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"<c")')).toBe(6); // the texts before "c", including "10"
    expect(calcValue(doc, '=COUNTIF(A1:A8;A3)')).toBe(1);

    const aOpt = doc.GetDocOptions().clone();
    aOpt.SetFormulaRegexEnabled(true);
    doc.SetDocOptions(aOpt);
    doc.CalcAll();
    expect(calcValue(doc, '=COUNTIF(A1:A8;"app.*")')).toBe(3);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"(?-i)app.*")')).toBe(1);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"a*b")')).toBe(0); // a regular expression now: "", "a", "aa"... followed by b
    expect(calcValue(doc, '=COUNTIF(A1:A8;"[ab].*")')).toBe(5);

    aOpt.SetMatchWholeCell(false);
    doc.SetDocOptions(aOpt);
    doc.CalcAll();
    expect(calcValue(doc, '=COUNTIF(A1:A8;"pie")')).toBe(1);
    expect(calcValue(doc, '=COUNTIF(A1:A8;"an")')).toBe(1);
  });

  it('inline arrays and errors', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=COUNTIF({1,2,3,2};2)')).toBe(2);
    expect(calcValue(doc, '=COUNTIF({1,2,3,2};">1")')).toBe(3);
    expect(calcValue(doc, '=COUNTIF({"a","b","ab"};"a*")')).toBe(2);
    putAll(doc, { A1: '=1/0', A2: '=NA()', A3: 1 });
    expect(calcValue(doc, '=COUNTIF(A1:A3;"#DIV/0!")')).toBe(1);
    expect(calcValue(doc, '=COUNTIF(A1:A3;">0")')).toBe(1);
    expect(calc(doc, '=COUNTIF(A1:A3)')).toBe('Err:511');
  });

  it('reference lists', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3, B1: 2, B2: 2 });
    expect(calcValue(doc, '=COUNTIF((A1:A3;B1:B2);2)')).toBe(3); // outside of array context the counts add up
  });
});

describe('SUMIF, AVERAGEIF', () => {
  const setup = () => {
    const doc = newDoc();
    putAll(doc, { A1: 'a', A2: 'b', A3: 'a', A4: 'c', A5: 'a', B1: 1, B2: 2, B3: 4, B4: 8, B5: 'x', C1: 10, C2: 20, C3: 30, C4: 40, C5: 50 });
    return doc;
  };

  it('SUMIF', () => {
    const doc = setup();
    expect(calcValue(doc, '=SUMIF(A1:A5;"a";B1:B5)')).toBe(5);
    expect(calcValue(doc, '=SUMIF(A1:A5;"a";C1)')).toBe(90); // the sum range takes the criteria range's size
    expect(calcValue(doc, '=SUMIF(B1:B5;">1")')).toBe(14);
    expect(calcValue(doc, '=SUMIF(A1:A5;"<>a";C1:C5)')).toBe(60);
    expect(calcValue(doc, '=SUMIF(A1:A5;"?";C1:C5)')).toBe(150);
    expect(calcValue(doc, '=SUMIF(A1:A5;"z";C1:C5)')).toBe(0);
    expect(calcValue(doc, '=SUMIF({1,2,3};">1")')).toBe(5);
    expect(calcValue(doc, '=SUMIF({1,2,3};">1";{10,20,30})')).toBe(50);
    expect(calc(doc, '=SUMIF(A1:A5)')).toBe('Err:511');
  });

  it('AVERAGEIF', () => {
    const doc = setup();
    expect(calcValue(doc, '=AVERAGEIF(A1:A5;"a";C1:C5)')).toBe(30);
    expect(calcValue(doc, '=AVERAGEIF(A1:A5;"a";B1:B5)')).toBe(2.5); // "x" is not counted
    expect(calcValue(doc, '=AVERAGEIF(B1:B5;">1")')).toBe(14 / 3);
    expect(calc(doc, '=AVERAGEIF(A1:A5;"z";C1:C5)')).toBe('#DIV/0!');
  });
});

describe('SUMIFS, COUNTIFS, AVERAGEIFS, MINIFS, MAXIFS', () => {
  const setup = () => {
    const doc = newDoc();
    const aData: [string, number, number][] = [['a', 1, 10], ['b', 2, 20], ['c', 4, 30], ['d', 8, 40], ['a', 16, 50], ['b', 32, 60], ['c', 64, 70]];
    aData.forEach(([a, b, c], i) => putAll(doc, { [`A${i + 1}`]: a, [`B${i + 1}`]: b, [`C${i + 1}`]: c }));
    return doc;
  };

  it('several criteria', () => {
    const doc = setup();
    expect(calcValue(doc, '=SUMIFS(B1:B7;A1:A7;"a")')).toBe(17);
    expect(calcValue(doc, '=SUMIFS(B1:B7;A1:A7;"b";C1:C7;">30")')).toBe(32);
    expect(calcValue(doc, '=COUNTIFS(A1:A7;"<c";C1:C7;"<=50")')).toBe(3);
    expect(calcValue(doc, '=COUNTIFS(A1:A7;"a")')).toBe(2);
    expect(calcValue(doc, '=AVERAGEIFS(C1:C7;A1:A7;"c")')).toBe(50);
    expect(calc(doc, '=AVERAGEIFS(C1:C7;A1:A7;"z")')).toBe('#DIV/0!');
    expect(calcValue(doc, '=MINIFS(B1:B7;A1:A7;"b")')).toBe(2);
    expect(calcValue(doc, '=MAXIFS(B1:B7;A1:A7;"b";C1:C7;"<60")')).toBe(2);
    expect(calcValue(doc, '=MAXIFS(B1:B7;A1:A7;"z")')).toBe(0);
    expect(calcValue(doc, '=SUMIFS(B:B;A:A;"a";C:C;">10")')).toBe(16);
  });

  it('errors', () => {
    const doc = setup();
    expect(calc(doc, '=SUMIFS(B1:B7;A1:A6;"a")')).toBe('Err:502'); // ranges of different size
    expect(calc(doc, '=SUMIFS(B1:B7;A1:A7)')).toBe('Err:511');
    expect(calc(doc, '=COUNTIFS(A1:A7)')).toBe('Err:511');
    expect(calc(doc, '=COUNTIFS(A1:A7;"a";B1:B7)')).toBe('Err:511');
  });

  it('inline arrays', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=SUMIFS({1,2,3,4};{"a","b","a","b"};"a")')).toBe(4);
    expect(calcValue(doc, '=COUNTIFS({1,2,3,4};">1";{1,1,0,1};1)')).toBe(2);
    expect(calcValue(doc, '=MAXIFS({1,2,3,4};{"a","b","a","b"};"a")')).toBe(3);
  });

  it('range reduction is undone for empty cell queries (testFuncCOUNTIFSRangeReduce)', () => {
    const doc = newDoc();
    const aData = [[''], ['a', '1', '1'], ['b', '2', '2'], ['c', '4', '3'], ['d', '8', '4'], ['a', '16', '5'], [''], ['b', '', '6'], ['c', '64', '7']];
    aData.forEach((r, i) => r.forEach((v, c) => v && put(doc, `${'ABC'[c]}${i + 1}`, v)));
    put(doc, 'K1', '=COUNTIFS($A1:$A21; ""; $B1:$B21; ""; $C1:$C21; "")');
    // It should find out that it can't range reduce and must count all the empty rows.
    expect(val(doc, 'K1')).toBe(21 - 7);
    // The middle criterion matches empty cells through a cell with an empty string.
    put(doc, 'K2', '=""');
    put(doc, 'K1', '=COUNTIFS($A1:$A21; A8; $B1:$B21; K2; $C1:$C21; C8)');
    expect(val(doc, 'K1')).toBe(1);
  });

  it('criteria from a range (testFuncSUMIFS)', () => {
    const doc = newDoc();
    const aData = [['a', '1'], ['b', '2'], ['c', '4'], ['d', '8'], ['a', '16'], ['b', '32'], ['c', '64'], [''], ['a'], ['b'], ['c']];
    aData.forEach((r, i) => r.forEach((v, c) => v && put(doc, `${'AB'[c]}${i + 1}`, v)));
    // Upstream enters these as array formulas over C9:E11, which needs the jump matrix (not
    // ported); as plain formulas the criterion is the implicit intersection with each row.
    for (let r = 9; r <= 11; r++) {
      putAll(doc, { [`C${r}`]: '=SUMIFS(B1:B7;A1:A7;A9:A11)', [`D${r}`]: '=COUNTIFS(A1:A7;A9:A11)', [`E${r}`]: '=AVERAGEIFS(B1:B7;A1:A7;A9:A11)' });
    }
    expect(['C9', 'D9', 'E9', 'C10', 'D10', 'E10', 'C11', 'D11', 'E11'].map((a) => str(doc, a))).toEqual(['17', '2', '8.5', '34', '2', '17', '68', '2', '34']);
    // In an array formula the criterion range meets the formula at its origin row.
    matrix(doc, 6, 8, 6, 10, '=SUMIFS(B1:B7;A1:A7;A9)');
    expect(['G9', 'G10', 'G11'].map((a) => str(doc, a))).toEqual(['17', '17', '17']);
  });
});

describe('COUNTBLANK', () => {
  it('ranges and single references (testFuncCOUNTBLANK)', () => {
    const doc = newDoc();
    const aData = [['1', '', '=B1', '=""'], ['2', '', '=B2', '=""'], ['A', '', '=B3', '=""'], ['B', '', '=B4', '=D3'], ['', '', '=B5', '=D4']];
    aData.forEach((r, i) => r.forEach((v, c) => v && put(doc, `${'ABCD'[c]}${i + 1}`, v)));
    putAll(doc, { A6: '=COUNTBLANK(A1:A5)', B6: '=COUNTBLANK(B1:B5)', C6: '=COUNTBLANK(C1:C5)', D6: '=COUNTBLANK(D1:D5)' });
    expect([val(doc, 'A6'), val(doc, 'B6'), val(doc, 'C6'), val(doc, 'D6')]).toEqual([1, 5, 0, 5]);

    const doc2 = newDoc();
    putAll(doc2, { A1: '1', A2: 'A', A4: '=""', A5: '=A4' });
    for (let i = 1; i <= 5; i++) put(doc2, `B${i}`, `=COUNTBLANK(A${i})`);
    expect([1, 2, 3, 4, 5].map((i) => val(doc2, `B${i}`))).toEqual([0, 0, 1, 1, 1]);
  });

  it('arrays and whole columns', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A3: 'x' });
    expect(calcValue(doc, '=COUNTBLANK(A1:B3)')).toBe(4);
    expect(calcValue(doc, '=COUNTBLANK(A:A)')).toBe(doc.MaxRow() + 1 - 2);
    expect(calcValue(doc, '=COUNTBLANK({1,"",3})')).toBe(1);
  });
});

describe('upstream function test documents', () => {
  // Remaining failures: the array formula cases need the jump matrix (a function evaluated per
  // array element, not ported); an array formula of empty inline array elements ({=;;}) yields
  // formula results the core does not treat as empty and 0 at once.
  const cases: [string, string[]][] = [
    ['mathematical/fods/sumif.fods', []],
    ['mathematical/fods/sumif_wildcards.fods', []],
    ['statistical/fods/averageif.fods', []],
    ['statistical/fods/averageif_wildcards.fods', []],
    ['statistical/fods/averageifs.fods', []],
    ['statistical/fods/countblank.fods', []],
    ['statistical/fods/countif.fods', ['Sheet2.A10', 'Sheet2.A11', 'Sheet2.A17']],
    ['statistical/fods/countif2.fods', []],
    ['statistical/fods/countifs.fods', ['Sheet2.A10', 'Sheet2.A11', 'Sheet2.A17', 'Sheet2.A18', 'Sheet2.A19', 'Sheet2.A20', 'Sheet2.A21']],
    ['statistical/fods/maxifs.fods', []],
    ['statistical/fods/minifs.fods', []],
  ];
  for (const [file, known] of cases) {
    it(file, () => {
      // Every failure must be a known one (others may get fixed by later ports).
      const aUnexpected = fodsFailures(file).filter((s) => !known.includes(s.split(' ')[0]!));
      expect(aUnexpected).toEqual([]);
    });
  }
});
