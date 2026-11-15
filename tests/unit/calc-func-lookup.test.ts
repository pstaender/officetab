// Lookup and reference functions: VLOOKUP, HLOOKUP, LOOKUP, MATCH, XLOOKUP, XMATCH, INDEX, OFFSET,
// INDIRECT, ADDRESS, ROW(S), COLUMN(S), AREAS, SHEET(S). Expected values from upstream's
// sc/qa/unit/ucalc_formula.cxx, ucalc_formula2.cxx and sc/qa/unit/data/functions/*/fods/*.fods.
import { afterEach, describe, expect, it } from 'vitest';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { SetGlobalConfig } from '../../src/lo/sc/source/core/tool/interpr1.ts';
import { ScRangeData } from '../../src/lo/sc/source/core/tool/rangenam.ts';
import { fodsFailures } from './calcfods.ts';
import { calc, calcValue, newDoc, put, putAll, str, val } from './calchelper.ts';

function matrix(doc: ScDocument, nCol1: number, nRow1: number, nCol2: number, nRow2: number, f: string): void {
  const mark = new ScMarkData(doc.GetSheetLimits());
  mark.SelectOneTable(0);
  doc.InsertMatrixFormula(nCol1, nRow1, nCol2, nRow2, mark, f);
}

/** Column letters for 0-based column indices. */
const col = (i: number): string => String.fromCharCode(65 + i);

describe('VLOOKUP', () => {
  it('sorted lookup in mixed numbers and strings (testFuncVLOOKUP)', () => {
    const doc = newDoc();
    const aData: [string, string][] = [
      ['Key', 'Val'], ['10', '3'], ['20', '4'], ['30', '5'], ['40', '6'], ['50', '7'], ['60', '8'], ['70', '9'],
      ['B', '10'], ['B', '11'], ['C', '12'], ['D', '13'], ['E', '14'], ['F', '15'],
    ];
    aData.forEach(([a, b], i) => putAll(doc, { [`A${i + 1}`]: a, [`B${i + 1}`]: b }));
    const aChecks: [string, string][] = [
      ['12', '3'], ['29', '4'], ['31', '5'], ['45', '6'], ['56', '7'], ['65', '8'], ['78', '9'], ['Andy', '#N/A'], ['Bruce', '11'],
      ['Charlie', '12'], ['David', '13'], ['Edward', '14'], ['Frank', '15'], ['Henry', '15'], ['100', '9'], ['1000', '9'], ['Zena', '15'],
    ];
    aChecks.forEach(([v], i) => putAll(doc, { [`D${i + 2}`]: v, [`E${i + 2}`]: `=VLOOKUP(D${i + 2};A2:B14;2;1)` }));
    aChecks.forEach(([v, r], i) => expect(str(doc, `E${i + 2}`), `lookup ${v}`).toBe(r));
  });

  it('sorted data interspersed with empty cells', () => {
    const doc = newDoc();
    putAll(doc, { A3: 1, A5: 2, A8: 4, B3: 'One', B5: 'Two', B8: 'Four', D1: 1, D2: 2, D3: 3, D4: 4, D5: 5 });
    for (let i = 1; i <= 5; i++) put(doc, `E${i}`, `=VLOOKUP(D${i};$A$1:$B$8;2)`);
    expect(['E1', 'E2', 'E3', 'E4', 'E5'].map((a) => str(doc, a))).toEqual(['One', 'Two', 'Two', 'Four', 'Four']);
  });

  it('string lookup, implicit intersection and exact match', () => {
    const doc = newDoc();
    'ABCDEFG'.split('').forEach((c, i) => put(doc, `A${i + 1}`, c));
    expect(calc(doc, '=VLOOKUP("C";A1:A16;1)')).toBe('C');

    const doc2 = newDoc();
    const aData2 = [['1', 'one', '3', 'three'], ['2', 'two', '1', 'one'], ['3', 'three', '4', 'four'], ['4', 'four', '2', 'two']];
    aData2.forEach((r, i) => putAll(doc2, { [`A${21 + i}`]: r[0]!, [`B${21 + i}`]: r[1]!, [`C${21 + i}`]: r[2]!, [`D${21 + i}`]: '=VLOOKUP(C21:C24;A21:B24;2;0)' }));
    aData2.forEach((r, i) => expect(str(doc2, `D${21 + i}`)).toBe(r[3]));
  });

  it('unsorted, case-insensitive, wildcards, errors', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'apple', A2: 'Banana', A3: 'cherry', A4: 3, B1: 1, B2: 2, B3: 3, B4: 4 });
    expect(calc(doc, '=VLOOKUP("banana";A1:B4;2;0)')).toBe('2');
    expect(calc(doc, '=VLOOKUP("ch*";A1:B4;2;0)')).toBe('3');
    expect(calc(doc, '=VLOOKUP("?anana";A1:B4;2;0)')).toBe('2');
    expect(calc(doc, '=VLOOKUP(3;A1:B4;2;0)')).toBe('4');
    expect(calc(doc, '=VLOOKUP("pear";A1:B4;2;0)')).toBe('#N/A');
    expect(calc(doc, '=VLOOKUP("apple";A1:B4;3;0)')).toBe('Err:502');
    expect(calc(doc, '=VLOOKUP("apple";A1:B4;0;0)')).toBe('Err:502');
    // An empty result cell gives an empty string.
    expect(calc(doc, '=VLOOKUP("apple";A1:C4;3;0)')).toBe('');
  });

  it('on inline arrays', () => {
    const doc = newDoc();
    expect(calc(doc, '=VLOOKUP(2;{1,"a";2,"b";3,"c"};2;0)')).toBe('b');
    expect(calc(doc, '=VLOOKUP(2.5;{1,"a";2,"b";3,"c"};2)')).toBe('b');
    expect(calc(doc, '=VLOOKUP("B";{"a",1;"b",2};2;0)')).toBe('2');
    expect(calc(doc, '=VLOOKUP(5;{1,"a";2,"b"};2;0)')).toBe('#N/A');
  });
});

describe('HLOOKUP', () => {
  it('sorted and exact', () => {
    const doc = newDoc();
    putAll(doc, { A1: 10, B1: 20, C1: 30, A2: 'x', B2: 'y', C2: 'z' });
    expect(calc(doc, '=HLOOKUP(25;A1:C2;2)')).toBe('y');
    expect(calc(doc, '=HLOOKUP(30;A1:C2;2;0)')).toBe('z');
    expect(calc(doc, '=HLOOKUP(5;A1:C2;2)')).toBe('#N/A');
    expect(calc(doc, '=HLOOKUP(25;A1:C2;2;0)')).toBe('#N/A');
    expect(calc(doc, '=HLOOKUP(20;{10,20,30;"a","b","c"};2;0)')).toBe('b');
  });
});

describe('LOOKUP', () => {
  it('formula string results (testFuncLOOKUP)', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=CONCATENATE("A")', A2: '=CONCATENATE("B")', A3: '=CONCATENATE("C")', B1: 1, B2: 2, B3: 3 });
    putAll(doc, { A5: 'A', A6: 'B', A7: 'C', B5: '=LOOKUP(A5;$A$1:$A$3;$B$1:$B$3)', B6: '=LOOKUP(A6;$A$1:$A$3;$B$1:$B$3)', B7: '=LOOKUP(A7;$A$1:$A$3;$B$1:$B$3)' });
    expect([val(doc, 'B5'), val(doc, 'B6'), val(doc, 'B7')]).toEqual([1, 2, 3]);
  });

  it('array with errors (testFuncLOOKUParrayWithError)', () => {
    const doc = newDoc();
    putAll(doc, { C2: 'x', D2: 'y', E2: 'z', C3: 'a', D3: 'b', E3: 'c' });
    put(doc, 'A1', '=LOOKUP(2;1/(C2:E2<>"");C3:E3)');
    expect(str(doc, 'A1')).toBe('c');
    put(doc, 'E2', '');
    expect(str(doc, 'A1')).toBe('b');
    // Upstream uses NOT(ISBLANK(G2:G9)), which needs the jump matrix (not ported) to iterate
    // ISBLANK over the array; the comparison creates the same interim array
    // {1,#DIV/0!,#DIV/0!,#DIV/0!,1,#DIV/0!,#DIV/0!,#DIV/0!}.
    putAll(doc, { G2: 'one', G6: 'two' });
    put(doc, 'H9', '=LOOKUP(2;1/(G2:G9<>"");G2:G9)');
    expect(str(doc, 'H9')).toBe('two');
    put(doc, 'J9', '=LOOKUP(2;1/(I2:I9<>"");I2:I9)');
    expect(str(doc, 'J9')).toBe('#N/A');
  });

  it('tdf#141146', () => {
    const doc = newDoc();
    putAll(doc, { A2: 'k1', B2: 'value1', A3: 'k2', B3: 'value2', A4: 'k3', B4: 'value3', E1: 'k2' });
    putAll(doc, { E2: '=LOOKUP(1;1/(A$2:A$4=E$1);1)', E3: '=LOOKUP(E1;A$2:A$4;B2:B4)', E4: '=LOOKUP(1;1/(A$2:A$4=E$1);B2:B4)' });
    expect(str(doc, 'E2')).toBe('#N/A');
    expect(str(doc, 'E3')).toBe('value2');
    expect(str(doc, 'E4')).toBe('value2');
  });

  it('vector and array forms', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3, B1: 'a', B2: 'b', B3: 'c' });
    expect(calc(doc, '=LOOKUP(2.5;A1:A3;B1:B3)')).toBe('b');
    expect(calc(doc, '=LOOKUP(2.5;A1:B3)')).toBe('b');
    expect(calc(doc, '=LOOKUP(0;A1:A3;B1:B3)')).toBe('#N/A');
    expect(calc(doc, '=LOOKUP(9;A1:A3)')).toBe('3');
    expect(calc(doc, '=LOOKUP(3;{1;2;3};{"x";"y";"z"})')).toBe('z');
    expect(calc(doc, '=LOOKUP(0;A1)')).toBe('#N/A');
  });
});

describe('MATCH', () => {
  function runTestMATCH(aData: string[], aChecks: [string, string][], nType: number): void {
    const doc = newDoc();
    aData.forEach((v, i) => put(doc, `A${i + 1}`, v));
    aChecks.forEach(([v], i) => putAll(doc, { [`B${i + 1}`]: v, [`C${i + 1}`]: `=MATCH(B${i + 1};A1:A${aData.length};${nType})` }));
    aChecks.forEach(([v, r], i) => expect(str(doc, `C${i + 1}`), `criterion ${v}`).toBe(r));
  }
  function runTestHorizontalMATCH(aData: string[], aChecks: [string, string][], nType: number): void {
    const doc = newDoc();
    aData.forEach((v, i) => put(doc, `${col(i)}1`, v));
    aChecks.forEach(([v], i) => putAll(doc, { [`${col(i)}2`]: v, [`${col(i)}3`]: `=MATCH(${col(i)}2;A1:${col(aData.length)}1;${nType})` }));
    aChecks.forEach(([v, r], i) => expect(str(doc, `${col(i)}3`), `criterion ${v}`).toBe(r));
  }

  it('ascending in-exact match (testFuncMATCH)', () => {
    const aData = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'B', 'B', 'C'];
    const aChecks: [string, string][] = [
      ['0.8', '#N/A'], ['1.2', '1'], ['2.3', '2'], ['3.9', '3'], ['4.1', '4'], ['5.99', '5'], ['6.1', '6'], ['7.2', '7'], ['8.569', '8'], ['9.59', '9'],
      ['10', '9'], ['100', '9'], ['Andy', '#N/A'], ['Bruce', '11'], ['Charlie', '12'],
    ];
    runTestMATCH(aData, aChecks, 1);
    runTestHorizontalMATCH(aData, aChecks, 1);
  });

  it('descending in-exact match', () => {
    const aData = ['D', 'C', 'B', '9', '8', '7', '6', '5', '4', '3', '2', '1'];
    const aChecks: [string, string][] = [
      ['10', '#N/A'], ['8.9', '4'], ['7.8', '5'], ['6.7', '6'], ['5.5', '7'], ['4.6', '8'], ['3.3', '9'], ['2.2', '10'], ['1.1', '11'], ['0.8', '12'],
      ['0', '12'], ['-2', '12'], ['Andy', '3'], ['Bruce', '2'], ['Charlie', '1'], ['David', '#N/A'],
    ];
    runTestMATCH(aData, aChecks, -1);
    runTestHorizontalMATCH(aData, aChecks, -1);
  });

  it('leading and trailing empty cells, ReferenceOrForceArray', () => {
    const doc = newDoc();
    putAll(doc, { A5: 1, A6: 2, A7: 3, A8: 4 });
    expect(calc(doc, '=MATCH(2;A1:A20)', 'B1')).toBe('6');

    const doc2 = newDoc();
    putAll(doc2, { B1: 1, B2: 2, B3: 3, B4: 4, B5: 5 });
    expect(calcValue(doc2, '=MATCH("33";B1:B5&B1:B5)', 'A6')).toBe(3);
  });

  it('exact match with wildcards, arrays and errors', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'apple', A2: 'banana', A3: 'cherry', A4: 'banana' });
    expect(calc(doc, '=MATCH("BANANA";A1:A4;0)')).toBe('2');
    expect(calc(doc, '=MATCH("c*";A1:A4;0)')).toBe('3');
    expect(calc(doc, '=MATCH("x*";A1:A4;0)')).toBe('#N/A');
    expect(calc(doc, '=MATCH("b";{"a";"b";"c"};0)')).toBe('2');
    expect(calc(doc, '=MATCH(2;{1;2;3})')).toBe('2');
    expect(calc(doc, '=MATCH(2.5;{1;2;3};1)')).toBe('2');
    expect(calc(doc, '=MATCH(2.5;{3;2;1};-1)')).toBe('1');
    expect(calc(doc, '=MATCH(1;A1:B4;0)')).toBe('Err:504');
    expect(calc(doc, '=MATCH(1;A1:A4;2)')).toBe('Err:504');
  });

  it('MATCH(INDIRECT(ADDRESS())) with a named range (testFunc_MATCH_INDIRECT)', () => {
    const doc = newDoc();
    doc.RenameTab(0, 'foo');
    doc.GetRangeName()!.insert(new ScRangeData(doc, 'RoleAssignment', '$D$4:$D$13'));
    put(doc, 'D6', 'Test1');
    put(doc, 'F15', '=MATCH("Test1";INDIRECT(ADDRESS(ROW(RoleAssignment)+1;COLUMN(RoleAssignment))&":"&ADDRESS(ROW(RoleAssignment)+ROWS(RoleAssignment)-1;COLUMN(RoleAssignment)));0)');
    expect(val(doc, 'F15')).toBe(2);
  });
});

describe('XLOOKUP and XMATCH', () => {
  const setup = () => {
    const doc = newDoc();
    putAll(doc, { A1: 10, A2: 20, A3: 30, A4: 40, B1: 'a', B2: 'b', B3: 'c', B4: 'd', C1: 'x', C2: 'y', C3: 'z', C4: 'w' });
    return doc;
  };

  it('exact, not found, next smaller and larger', () => {
    const doc = setup();
    expect(calc(doc, '=XLOOKUP(20;A1:A4;B1:B4)')).toBe('b');
    expect(calc(doc, '=XLOOKUP(25;A1:A4;B1:B4)')).toBe('#N/A');
    expect(calc(doc, '=XLOOKUP(25;A1:A4;B1:B4;"none")')).toBe('none');
    expect(calc(doc, '=XLOOKUP(25;A1:A4;B1:B4;;-1)')).toBe('b');
    expect(calc(doc, '=XLOOKUP(25;A1:A4;B1:B4;;1)')).toBe('c');
    expect(calc(doc, '=XLOOKUP(45;A1:A4;B1:B4;;1)')).toBe('#N/A');
    expect(calc(doc, '=XLOOKUP(5;A1:A4;B1:B4;;-1)')).toBe('#N/A');
  });

  it('returns rows, reverse search, wildcards, regular expressions', () => {
    const doc = setup();
    put(doc, 'A5', 20);
    put(doc, 'B5', 'e');
    expect(calc(doc, '=XLOOKUP(20;A1:A5;B1:B5)')).toBe('b');
    expect(calc(doc, '=XLOOKUP(20;A1:A5;B1:B5;;0;-1)')).toBe('e');
    expect(calc(doc, '=XLOOKUP("c*";B1:B5;A1:A5;;2)')).toBe('30');
    expect(calc(doc, '=XLOOKUP("c*";B1:B5;A1:A5;;0)')).toBe('#N/A');
    expect(calc(doc, '=XLOOKUP("[cd]";B1:B5;A1:A5;;3)')).toBe('30');
    expect(calcValue(doc, '=SUM(XLOOKUP(30;A1:A4;B1:C4))')).toBe(0);
    expect(calc(doc, '=COUNTA(XLOOKUP(30;A1:A4;B1:C4))')).toBe('2');
    expect(calc(doc, '=XLOOKUP(2;{1;2;3};{"p";"q";"r"})')).toBe('q');
    expect(calc(doc, '=XLOOKUP(20;A1:A4;B1:B3)')).toBe('Err:504');
  });

  it('horizontal search', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, B1: 2, C1: 3, A2: 'one', B2: 'two', C2: 'three' });
    expect(calc(doc, '=XLOOKUP(2;A1:C1;A2:C2)')).toBe('two');
    expect(calc(doc, '=XLOOKUP(2.5;A1:C1;A2:C2;;-1)')).toBe('two');
    expect(calc(doc, '=XLOOKUP(2.5;A1:C1;A2:C2;;1)')).toBe('three');
  });

  it('XMATCH', () => {
    const doc = setup();
    expect(calc(doc, '=XMATCH(30;A1:A4)')).toBe('3');
    expect(calc(doc, '=XMATCH(35;A1:A4)')).toBe('#N/A');
    expect(calc(doc, '=XMATCH(35;A1:A4;-1)')).toBe('3');
    expect(calc(doc, '=XMATCH(35;A1:A4;1)')).toBe('4');
    expect(calc(doc, '=XMATCH("?";B1:B4;2)')).toBe('1');
    expect(calc(doc, '=XMATCH(30;A1:A4;0;2)')).toBe('3');
    expect(calc(doc, '=XMATCH(3;{1;2;3;4})')).toBe('3');
    expect(calc(doc, '=XMATCH(2.5;{1;2;3;4};1)')).toBe('3');
    expect(calc(doc, '=XMATCH(2.5;{1;2;3;4};-1)')).toBe('2');
    expect(calc(doc, '=XMATCH(1;A1:A4;5)')).toBe('Err:504');
  });
});

describe('INDEX', () => {
  it('references and arrays', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, B1: 2, C1: 3, A2: 4, B2: 5, C2: 6, A3: 7, B3: 8, C3: 9 });
    expect(calc(doc, '=INDEX(A1:C3;2;3)')).toBe('6');
    expect(calc(doc, '=INDEX(A1:C3;3)')).toBe('#VALUE!'); // a row reference, no intersection in Z1000
    expect(calcValue(doc, '=SUM(INDEX(A1:C3;0;2))')).toBe(15);
    expect(calcValue(doc, '=SUM(INDEX(A1:C3;2;0))')).toBe(15);
    expect(calcValue(doc, '=SUM(INDEX(A1:C3;0;0))')).toBe(45);
    expect(calc(doc, '=INDEX(A1:C1;2)')).toBe('2');
    expect(calc(doc, '=INDEX(A1:C3;4;1)')).toBe('#REF!');
    expect(calc(doc, '=INDEX(A1:C3;-1;1)')).toBe('Err:502');
    expect(calc(doc, '=INDEX((A1:A3;C1:C3);2;1;2)')).toBe('6');
    expect(calc(doc, '=INDEX((A1:A3;C1:C3);2;1;3)')).toBe('#REF!');
    expect(calc(doc, '=INDEX({1,2,3;4,5,6};2;3)')).toBe('6');
    expect(calc(doc, '=INDEX({1,2,3};2)')).toBe('2');
    expect(calc(doc, '=INDEX({1;2;3};2)')).toBe('2');
    expect(calcValue(doc, '=SUM(INDEX({1,2,3;4,5,6};0;2))')).toBe(7);
    expect(calcValue(doc, '=SUM(INDEX({1,2,3;4,5,6};2;0))')).toBe(15);
    expect(calc(doc, '=INDEX(B2;1;1)')).toBe('5');
  });
});

describe('OFFSET', () => {
  it('references', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, B1: 2, C1: 3, A2: 4, B2: 5, C2: 6 });
    expect(calc(doc, '=OFFSET(A1;1;2)')).toBe('6');
    expect(calcValue(doc, '=SUM(OFFSET(A1;0;0;2;2))')).toBe(12);
    expect(calcValue(doc, '=SUM(OFFSET(A1:B2;0;1))')).toBe(16);
    expect(calcValue(doc, '=SUM(OFFSET(A1:B2;0;1;;1))')).toBe(7);
    expect(calc(doc, '=OFFSET(A1;-1;0)')).toBe('Err:502');
    expect(calc(doc, '=OFFSET(A1;0;0;0;1)')).toBe('Err:502');
    expect(calc(doc, '=ROWS(OFFSET(A1;2;3;4;5))')).toBe('4');
    expect(calc(doc, '=COLUMNS(OFFSET(A1;2;3;4;5))')).toBe('5');
  });
});

describe('INDIRECT and ADDRESS', () => {
  afterEach(() => SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_UNSPECIFIED }));

  it('reference syntaxes (testFuncINDIRECT)', () => {
    const doc = newDoc();
    doc.RenameTab(0, 'foo');
    put(doc, 'A11', 'Test');
    putAll(doc, { A1: '=INDIRECT("foo.A11")', A2: '=INDIRECT("foo!A11")', A3: '=INDIRECT("foo!R11C1")', A4: '=INDIRECT("foo!R11C1";0)' });
    const results = () => ['A1', 'A2', 'A3', 'A4'].map((a) => str(doc, a));
    // Default (for new documents) is to use current formula syntax which is Calc A1
    expect(results()).toEqual(['Test', '#REF!', '#REF!', 'Test']);
    SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_OOO });
    doc.CalcAll();
    expect(results()).toEqual(['Test', '#REF!', '#REF!', 'Test']);
    SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_XL_A1 });
    doc.CalcAll();
    expect(results()).toEqual(['#REF!', 'Test', '#REF!', 'Test']);
    SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_XL_R1C1 });
    doc.CalcAll();
    expect(results()).toEqual(['#REF!', '#REF!', 'Test', 'Test']);
    SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_A1_XL_A1 });
    doc.CalcAll();
    expect(results()).toEqual(['Test', 'Test', '#REF!', 'Test']);
  });

  it('ranges across sheets (testFuncINDIRECT2)', () => {
    const doc = newDoc(3);
    doc.RenameTab(0, 'foo');
    doc.RenameTab(1, 'bar');
    doc.RenameTab(2, 'baz');
    putAll(doc, { 'foo.A1': 10, 'foo.A2': 10, 'foo.A3': 10 });
    for (let i = 1; i <= 10; i++) put(doc, `bar.A${i}`, 1);
    const f = [
      '=COUNTIF(bar.$A1:INDIRECT("$A"&foo.$A$1);1)', '=COUNTIF(bar.$A1:INDIRECT("$A"&foo.$A$2);1)', '=COUNTIF(bar.$A1:INDIRECT("$A"&foo.$A$3);1)',
      '=COUNTIF(bar.$A$1:INDIRECT("$A"&foo.$A$1);1)', '=COUNTIF(bar.$A$1:INDIRECT("$A"&foo.$A$2);1)', '=COUNTIF(bar.$A$1:INDIRECT("$A"&foo.$A$3);1)',
      '=COUNTIF($bar.$A$1:INDIRECT("$A"&foo.$A$1);1)', '=COUNTIF($bar.$A$1:INDIRECT("$A"&foo.$A$2);1)', '=COUNTIF(bar.$A$1:INDIRECT("bar.$A"&foo.$A$1);1)',
      '=COUNTIF($bar.$A$1:INDIRECT("$A"&foo.$A$3);1)',
    ];
    f.forEach((s, i) => put(doc, `baz.A${i + 1}`, s));
    // Upstream's test writes the formulas with ',' separators, which the test grammar does not
    // parse, so its checks pass on errors. Its intent ("check result = 10"): the sheet-less
    // reference from INDIRECT inherits the sheet of the range start (ScComplexRefData::Extend).
    for (let i = 1; i <= 10; i++) expect(val(doc, `baz.A${i}`)).toBe(10);
    // A reference to another sheet does not inherit it.
    expect(calc(doc, '=COUNTIF(bar.$A$1:INDIRECT("baz.$A10");1)')).toBe('Err:504');
  });

  it('named ranges and invalid strings', () => {
    const doc = newDoc(2);
    putAll(doc, { A1: 5, B2: 7, 'Sheet2.C3': 9 });
    doc.GetRangeName()!.insert(new ScRangeData(doc, 'MyName', '$Sheet1.$A$1:$B$2'));
    expect(calcValue(doc, '=SUM(INDIRECT("MyName"))')).toBe(12);
    expect(calcValue(doc, '=SUM(INDIRECT("myname"))')).toBe(12);
    expect(calc(doc, '=INDIRECT("Sheet2.C3")')).toBe('9');
    expect(calc(doc, '=INDIRECT("$Sheet2.$C$3")')).toBe('9');
    expect(calc(doc, '=INDIRECT("R2C2";0)')).toBe('7');
    expect(calc(doc, '=INDIRECT("nonsense")')).toBe('#REF!');
    expect(calc(doc, '=INDIRECT("")')).toBe('#REF!');
    expect(calcValue(doc, '=SUM(INDIRECT("A1:B2"))')).toBe(12);
  });

  it('ADDRESS', () => {
    const doc = newDoc();
    expect(calc(doc, '=ADDRESS(1;1)')).toBe('$A$1');
    expect(calc(doc, '=ADDRESS(2;3;2)')).toBe('C$2');
    expect(calc(doc, '=ADDRESS(2;3;3)')).toBe('$C2');
    expect(calc(doc, '=ADDRESS(2;3;4)')).toBe('C2');
    expect(calc(doc, '=ADDRESS(2;3;1;0)')).toBe('R2C3');
    expect(calc(doc, '=ADDRESS(2;3;4;0)')).toBe('R[2]C[3]');
    expect(calc(doc, '=ADDRESS(1;1;1;1;"Sheet2")')).toBe('Sheet2.$A$1');
    expect(calc(doc, '=ADDRESS(1;1;1;1;"My Sheet")')).toBe("'My Sheet'.$A$1");
    expect(calc(doc, '=ADDRESS(1;1;1;0;"Sheet2")')).toBe('Sheet2!R1C1');
    expect(calc(doc, '=ADDRESS(0;1)')).toBe('Err:502');
    expect(calc(doc, '=ADDRESS(1;1;9)')).toBe('#VALUE!');
  });
});

describe('ROW, ROWS, COLUMN, COLUMNS, AREAS, SHEET, SHEETS', () => {
  it('COLUMN (testFuncCOLUMN)', () => {
    const doc = newDoc();
    put(doc, 'J11', '=COLUMN()');
    expect(val(doc, 'J11')).toBe(10);
    put(doc, 'A1', '=COLUMN(C5)');
    expect(val(doc, 'A1')).toBe(3);
    put(doc, 'A2', '=COLUMN(E1:H3)');
    expect(val(doc, 'A2')).toBe(5); // implicit first element (array in scalar context)
    // Array formula: {=COLUMN(A1:C1)} in A3:C3.
    matrix(doc, 0, 2, 2, 2, '=COLUMN(A1:C1)');
    expect([val(doc, 'A3'), val(doc, 'B3'), val(doc, 'C3')]).toEqual([1, 2, 3]);
    matrix(doc, 4, 4, 6, 4, '=COLUMN()');
    expect([val(doc, 'E5'), val(doc, 'F5'), val(doc, 'G5')]).toEqual([5, 6, 7]);
  });

  it('ROW (testFuncROW)', () => {
    const doc = newDoc();
    put(doc, 'B11', '=ROW()');
    expect(val(doc, 'B11')).toBe(11);
    put(doc, 'A1', '=ROW(C5)');
    expect(val(doc, 'A1')).toBe(5);
    matrix(doc, 1, 0, 1, 2, '=ROW(D4:D6)');
    expect([val(doc, 'B1'), val(doc, 'B2'), val(doc, 'B3')]).toEqual([4, 5, 6]);
    matrix(doc, 3, 9, 3, 11, '=ROW()');
    expect([val(doc, 'D10'), val(doc, 'D11'), val(doc, 'D12')]).toEqual([10, 11, 12]);
    expect(calcValue(doc, '=SUMPRODUCT(ROW(A1:A4))')).toBe(10);
  });

  it('ROWS, COLUMNS, AREAS', () => {
    const doc = newDoc(3);
    expect(calc(doc, '=ROWS(A1:C5)')).toBe('5');
    expect(calc(doc, '=COLUMNS(A1:C5)')).toBe('3');
    expect(calc(doc, '=ROWS(A1)')).toBe('1');
    expect(calc(doc, '=ROWS({1,2,3;4,5,6})')).toBe('2');
    expect(calc(doc, '=COLUMNS({1,2,3;4,5,6})')).toBe('3');
    expect(calc(doc, '=ROWS($Sheet1.A1:$Sheet3.B2)')).toBe('6');
    expect(calc(doc, '=COLUMNS(1)')).toBe('Err:504');
    expect(calc(doc, '=AREAS(A1:B2)')).toBe('1');
    expect(calc(doc, '=AREAS((A1:B2;C3;D4:E5))')).toBe('3');
    expect(calc(doc, '=AREAS(A1)')).toBe('1');
  });

  it('SHEET and SHEETS (testFuncSHEET)', () => {
    const doc = newDoc(2);
    doc.RenameTab(0, 'test1');
    doc.RenameTab(1, 'test2');
    put(doc, 'test1.A1', '=SHEETS()');
    expect(val(doc, 'test1.A1')).toBe(2);
    doc.InsertTab(2, 'test3');
    doc.CalcAll();
    expect(val(doc, 'test1.A1')).toBe(3);
    expect(calc(doc, '=SHEET()')).toBe('1');
    expect(calc(doc, '=SHEET("test2")')).toBe('2');
    expect(calc(doc, '=SHEET($test3.A1)')).toBe('3');
    expect(calc(doc, '=SHEET("none")')).toBe('Err:502');
    expect(calc(doc, '=SHEETS($test1.A1:$test3.B2)')).toBe('3');
    expect(calc(doc, '=SHEETS(A1)')).toBe('1');
  });
});

describe('upstream function test documents', () => {
  // Known failures: array formulas evaluating a function per element of an array argument need
  // the jump matrix (not ported); LOGEST, CELL and external references are not ported; match.fods
  // row 150 is a stray text row the test loader reads as a check.
  const r = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `Sheet2.A${from + i}`);
  const cases: [string, string[]][] = [
    ['spreadsheet/fods/vlookup.fods', r(32, 35)],
    ['spreadsheet/fods/vlookup2.fods', []],
    ['spreadsheet/fods/hlookup.fods', []],
    ['spreadsheet/fods/lookup.fods', []],
    ['spreadsheet/fods/match.fods', [...r(30, 37), ...r(48, 62), ...r(64, 74), 'Sheet2.A150']],
    ['spreadsheet/fods/xlookup.fods', []],
    ['spreadsheet/fods/xmatch.fods', [...r(14, 22), ...r(38, 43)]],
    ['spreadsheet/fods/index.fods', r(10, 13)],
    ['spreadsheet/fods/offset.fods', []],
    ['spreadsheet/fods/indirect.fods', []],
    ['spreadsheet/fods/address.fods', []],
    ['spreadsheet/fods/row.fods', ['Sheet2.A14', ...r(18, 24)]],
    ['spreadsheet/fods/rows.fods', []],
    ['spreadsheet/fods/column.fods', r(19, 22)],
    ['spreadsheet/fods/columns.fods', []],
    ['spreadsheet/fods/areas.fods', []],
    ['spreadsheet/fods/sheet.fods', []],
    ['spreadsheet/fods/sheets.fods', []],
  ];
  for (const [file, known] of cases) {
    it(file, () => {
      // Every failure must be a known one (others may get fixed by later ports).
      const aUnexpected = fodsFailures(file).filter((s) => !known.includes(s.split(' ')[0]!));
      expect(aUnexpected).toEqual([]);
    });
  }
});
