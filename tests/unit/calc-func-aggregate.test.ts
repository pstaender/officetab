// MIN/MAX/MINA/MAXA, SUBTOTAL, AGGREGATE, IFS, SWITCH, MUNIT, MDETERM, MINVERSE and FREQUENCY.
// Expected values from upstream's sc/qa/unit/data/functions/*/fods/*.fods and ucalc_formula2.cxx.
// The SUBTOTAL/AGGREGATE cases with STDEV/VAR/MEDIAN/MODE/LARGE/SMALL/PERCENTILE/QUARTILE depend on
// the statistics functions, FREQUENCY on GetSortArray.
import { describe, expect, it } from 'vitest';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { addr, calc, calcValue, newDoc, put, putAll, str, val } from './calchelper.ts';

function matrix(doc: ScDocument, nCol1: number, nRow1: number, nCol2: number, nRow2: number, f: string): void {
  const mark = new ScMarkData(doc.GetSheetLimits());
  mark.SelectOneTable(0);
  doc.InsertMatrixFormula(nCol1, nRow1, nCol2, nRow2, mark, f);
}

describe('MIN, MAX, MINA, MAXA', () => {
  // min.fods / max.fods / mina.fods / maxa.fods, Sheet2
  const setup = () => {
    const doc = newDoc();
    putAll(doc, { I2: 4, I3: 3.5, I4: 1.2, I6: 'a', I12: 'a', I13: 'b', I14: 'c' });
    return doc;
  };

  it('MIN', () => {
    const doc = setup();
    expect(calcValue(doc, '=MIN(I2;I3;I4)')).toBe(1.2);
    expect(calcValue(doc, '=MIN(I2:I4)')).toBe(1.2);
    expect(calcValue(doc, '=MIN(I2;I3;I4;100;101)')).toBe(1.2);
    expect(calc(doc, '=MIN(H1:H3)')).toBe('0');
    expect(calcValue(doc, '=MIN((I2-I3);0)')).toBe(0);
    expect(calcValue(doc, '=MIN({1,2,3,4})')).toBe(1);
    expect(calcValue(doc, '=MIN({1,2,3,4};7)')).toBe(1);
    expect(calcValue(doc, '=MIN(I2:I6)')).toBe(1.2);
    expect(calcValue(doc, '=MIN(I12:I14)')).toBe(0);
    expect(calcValue(doc, '=MIN(-3;5)')).toBe(-3);
    expect(calc(doc, '=MIN("a";1)')).toBe('Err:504');
  });

  it('MAX', () => {
    const doc = setup();
    expect(calcValue(doc, '=MAX(I2;I3;I4)')).toBe(4);
    expect(calcValue(doc, '=MAX(I2:I4)')).toBe(4);
    expect(calcValue(doc, '=MAX(I2;I3;I4;100;101)')).toBe(101);
    expect(calcValue(doc, '=MAX(H1:H3)')).toBe(0);
    expect(calcValue(doc, '=MAX((I2-I3);0)')).toBe(0.5);
    expect(calcValue(doc, '=MAX({1,2,3,4})')).toBe(4);
    expect(calcValue(doc, '=MAX({1,2,3,4};7)')).toBe(7);
    expect(calcValue(doc, '=MAX(I12:I14)')).toBe(0);
    expect(calcValue(doc, '=MAX(-3;-5)')).toBe(-3);
  });

  it('MINA and MAXA count text as zero', () => {
    const doc = setup();
    expect(calcValue(doc, '=MINA(I2;I3;I4)')).toBe(1.2);
    expect(calcValue(doc, '=MINA(I2:I6)')).toBe(0);
    expect(calcValue(doc, '=MINA(I12:I14)')).toBe(0);
    expect(calcValue(doc, '=MINA({1,2,3,4};7)')).toBe(1);
    expect(calcValue(doc, '=MAXA(I2:I6)')).toBe(4);
    put(doc, 'I15', -1);
    expect(calcValue(doc, '=MAXA(I12:I15)')).toBe(0);
    expect(calcValue(doc, '=MAX(I12:I15)')).toBe(-1);
    expect(calcValue(doc, '=MAXA(-1;"x")')).toBe(0);
    expect(calcValue(doc, '=MINA(1;"x")')).toBe(0);
  });

  it('propagates errors of the range', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: '=1/0', A3: 3 });
    expect(calc(doc, '=MAX(A1:A3)')).toBe('#DIV/0!');
    expect(calc(doc, '=MIN(A1:A3)')).toBe('#DIV/0!');
  });

  it('keeps the number format of the values', () => {
    const doc = newDoc();
    putAll(doc, { A1: '2009-05-23', A2: '2009-04-12' });
    expect(calc(doc, '=MAX(A1:A2)')).toBe(str(doc, 'A1'));
  });

  it('MAX of an array expression as array formula', () => {
    // max.fods A9 uses {=MAX(IF(MONTH(J14:J23)=5;K14:K23;0))}; IF jump matrices (and MONTH over an
    // array) are not ported, so multiply by May's serial date range.
    const doc = newDoc();
    const dates = ['2009-04-12', '2009-04-27', '2009-04-27', '2009-04-30', '2009-04-12', '2009-05-23', '2009-05-13', '2009-05-13', '2009-05-20', '2009-06-01'];
    const vals = [1, 28, 46, 74, 6, 28, 51, 43, 49, 100];
    dates.forEach((d, i) => putAll(doc, { [`J${14 + i}`]: d, [`K${14 + i}`]: vals[i]! }));
    matrix(doc, 0, 8, 0, 8, '=MAX((J14:J23>=39934)*(J14:J23<39965)*K14:K23)');
    expect(val(doc, 'A9')).toBe(51);
    matrix(doc, 0, 9, 0, 9, '=MIN((J14:J23>=39934)*(J14:J23<39965)*K14:K23)');
    expect(val(doc, 'A10')).toBe(0);
  });
});

/** subtotal.fods Sheet3: B2:B9 with rows 4-7 filtered, A16:A26 with rows 16-20 hidden. */
function subtotalSheet(): ScDocument {
  const doc = newDoc();
  for (let r = 2; r <= 9; r++) put(doc, `B${r}`, r);
  for (let r = 16; r <= 26; r++) put(doc, `A${r}`, r - 15);
  doc.SetRowHidden(3, 6, 0, true);
  doc.SetRowFiltered(3, 6, 0, true);
  doc.SetRowHidden(15, 19, 0, true);
  return doc;
}

describe('SUBTOTAL', () => {
  it('functions 1 to 11 and 101 to 111', () => {
    // subtotal.fods Sheet2
    const doc = newDoc(); // subtotal.fods Sheet2 J2:J11, no hidden rows
    for (let r = 1; r <= 10; r++) put(doc, `J${r + 1}`, r);
    const r = (n: number) => calcValue(doc, `=SUBTOTAL(${n};$J$2:$J$11)`);
    for (const off of [0, 100]) {
      expect(r(off + 1)).toBe(5.5);
      expect(r(off + 2)).toBe(10);
      expect(r(off + 3)).toBe(10);
      expect(r(off + 4)).toBe(10);
      expect(r(off + 5)).toBe(1);
      expect(r(off + 6)).toBe(3628800);
      expect(r(off + 9)).toBe(55);
    }
  });

  it('STDEV, STDEVP, VAR, VARP (statistics functions)', () => {
    const doc = newDoc();
    for (let r = 1; r <= 10; r++) put(doc, `J${r + 1}`, r);
    const r = (n: number) => calcValue(doc, `=SUBTOTAL(${n};$J$2:$J$11)`);
    expect(r(7)).toBeCloseTo(3.02765035409749, 11);
    expect(r(8)).toBeCloseTo(2.87228132326901, 11);
    expect(r(10)).toBeCloseTo(9.16666666666667, 11);
    expect(r(11)).toBeCloseTo(8.25, 11);
    expect(r(107)).toBeCloseTo(3.02765035409749, 11);
  });

  it('ignores filtered rows always and hidden rows for 101 to 111', () => {
    const doc = subtotalSheet();
    expect(calcValue(doc, '=SUBTOTAL(9;$B$2:$B$18)')).toBe(22);
    expect(calcValue(doc, '=SUBTOTAL(109;$B$2:$B$18)')).toBe(22);
    expect(calcValue(doc, '=SUBTOTAL(109;$A$16:$A$26)')).toBe(51);
    expect(calcValue(doc, '=SUBTOTAL(9;$A$16:$A$26)')).toBe(66);
    expect(calcValue(doc, '=SUBTOTAL(102;$A$16:$A$26)')).toBe(6);
    expect(calcValue(doc, '=SUBTOTAL(103;$A$16:$A$26)')).toBe(6);
    expect(calcValue(doc, '=SUBTOTAL(105;$A$16:$A$26)')).toBe(6);
    expect(calcValue(doc, '=SUBTOTAL(5;$A$16:$A$26)')).toBe(1);
  });

  it('follows hiding rows (testFuncRowsHidden)', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 4, A4: 8, A5: 16, A6: 32 });
    put(doc, 'A7', '=SUBTOTAL(109; A1:A6)');
    expect(val(doc, 'A7')).toBe(63);
    doc.SetRowHidden(0, 0, 0, true);
    doc.CalcAll();
    expect(val(doc, 'A7')).toBe(62);
    doc.SetRowHidden(0, 0, 0, false);
    doc.SetRowHidden(1, 2, 0, true);
    doc.CalcAll();
    expect(val(doc, 'A7')).toBe(57);
    doc.SetRowHidden(1, 2, 0, false);
    doc.CalcAll();
    expect(val(doc, 'A7')).toBe(63);

    put(doc, 'A7', '=AGGREGATE(9; 5; A1:A6)');
    expect(val(doc, 'A7')).toBe(63);
    doc.SetRowHidden(0, 0, 0, true);
    doc.CalcAll();
    expect(val(doc, 'A7')).toBe(62);
    doc.SetRowHidden(0, 0, 0, false);
    doc.SetRowHidden(2, 4, 0, true);
    doc.CalcAll();
    expect(val(doc, 'A7')).toBe(35);
  });

  it('ignores nested SUBTOTAL and AGGREGATE results', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: '=SUBTOTAL(9;A1:A2)', A4: 4, A5: '=AGGREGATE(9;4;A4)', A6: '=SUM(A1:A2)' });
    expect(val(doc, 'A3')).toBe(3);
    expect(calcValue(doc, '=SUBTOTAL(9;A1:A6)')).toBe(10);
    expect(calcValue(doc, '=SUM(A1:A6)')).toBe(17);
    expect(doc.GetFormulaCell(addr(doc, 'A3'))!.IsSubTotal()).toBe(true);
    expect(doc.GetFormulaCell(addr(doc, 'A6'))!.IsSubTotal()).toBe(false);
  });

  it('several ranges and errors', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, B1: 10 });
    expect(calcValue(doc, '=SUBTOTAL(9;A1:A2;B1)')).toBe(13);
    expect(calc(doc, '=SUBTOTAL(12;A1:A2)')).toBe('Err:502');
    expect(calc(doc, '=SUBTOTAL(0;A1:A2)')).toBe('Err:502');
    expect(calc(doc, '=SUBTOTAL(9)')).toBe('Err:511');
    put(doc, 'A3', '=1/0');
    expect(calc(doc, '=SUBTOTAL(9;A1:A3)')).toBe('#DIV/0!');
  });
});

describe('AGGREGATE', () => {
  // aggregate.fods Sheet2
  const setup = () => {
    const doc = newDoc();
    const J = [72, 30, '#NUM!', 31, 96, 32, 81, 33, 53, 34];
    J.forEach((v, i) => put(doc, `J${i + 2}`, v));
    put(doc, 'J4', '=1/0'); // a real error instead of the text "#NUM!"
    const O = [34, 10, '#DIV/0! (text)', 20, 0, '#VALUE! (text)', 5, 14]; // the fods has text here
    const R = [34, 10, '=1/0', 20, 0, '=1+"a"', 5, 14]; // real errors
    const P = [11, 56, 5, 8, 8, 20, 7, 0];
    const Q = [12, 35, 3, 1, 9, 21, 8, 5];
    for (let i = 0; i < 8; i++) {
      put(doc, `O${i + 2}`, O[i]!);
      put(doc, `R${i + 2}`, R[i]!);
      put(doc, `P${i + 2}`, P[i]!);
      put(doc, `Q${i + 2}`, Q[i]!);
    }
    putAll(doc, { M38: 13, N38: '=M38/0', O38: 5 });
    return doc;
  };

  it('functions 1 to 6 and 9 with options', () => {
    const doc = setup();
    expect(calcValue(doc, '=AGGREGATE(4;6;J2:J12)')).toBe(96);
    expect(calc(doc, '=AGGREGATE(4;0;J2:J12)')).toBe('#DIV/0!');
    expect(calcValue(doc, '=AGGREGATE(4;1;O2:O9)')).toBe(34);
    expect(calcValue(doc, '=AGGREGATE(9;5;O5:Q5)')).toBe(29);
    expect(calcValue(doc, '=AGGREGATE(9;5;P2:P9)')).toBe(115);
    expect(calcValue(doc, '=AGGREGATE(1;5;P2:P9)')).toBe(14.375);
    expect(calcValue(doc, '=AGGREGATE(2;5;P2:P9)')).toBe(8);
    expect(calcValue(doc, '=AGGREGATE(3;5;P2:P9)')).toBe(8);
    expect(calcValue(doc, '=AGGREGATE(4;5;P2:P9)')).toBe(56);
    expect(calcValue(doc, '=AGGREGATE(5;5;P2:P9)')).toBe(0);
    expect(calcValue(doc, '=AGGREGATE(6;5;P2:P9)')).toBe(0);
    expect(calcValue(doc, '=AGGREGATE(4;5;O2:O9)')).toBe(34);
    for (const o of [0, 1, 2, 3, 4, 5, 6, 7]) expect(calcValue(doc, `=AGGREGATE(2;${o};O2:O9)`)).toBe(6);
    expect(calc(doc, '=AGGREGATE(2;8;O2:O9)')).toBe('Err:502');
    expect(calc(doc, '=AGGREGATE(20;0;O2:O9)')).toBe('Err:502');
    expect(calc(doc, '=AGGREGATE(O2:O9)')).toBe('Err:511');
    expect(calcValue(doc, '=AGGREGATE(9;6;M38;N38;O38)')).toBe(18);
    expect(calc(doc, '=AGGREGATE(9;4;M38;N38;O38)')).toBe('#DIV/0!');
    expect(calcValue(doc, '=AGGREGATE(1;2;3;OR())')).toBe(3);
  });

  it('error values in ranges depend on the option', () => {
    const doc = setup();
    expect(calc(doc, '=AGGREGATE(9;4;R2:R9)')).toBe('#DIV/0!');
    expect(calc(doc, '=AGGREGATE(9;5;R2:R9)')).toBe('#DIV/0!');
    expect(calcValue(doc, '=AGGREGATE(9;6;R2:R9)')).toBe(83);
    expect(calcValue(doc, '=AGGREGATE(9;7;R2:R9)')).toBe(83);
    expect(calcValue(doc, '=AGGREGATE(3;6;R2:R9)')).toBe(6);
    expect(calcValue(doc, '=AGGREGATE(3;4;R2:R9)')).toBe(8);
  });

  it('statistics functions 7 to 19', () => {
    const doc = setup();
    expect(calcValue(doc, '=AGGREGATE(7;5;P2:P9)')).toBeCloseTo(17.7517604760767, 11);
    expect(calcValue(doc, '=AGGREGATE(8;5;P2:P9)')).toBeCloseTo(16.6052514283886, 11);
    expect(calcValue(doc, '=AGGREGATE(10;5;P2:P9)')).toBeCloseTo(315.125, 11);
    expect(calcValue(doc, '=AGGREGATE(11;5;P2:P9)')).toBeCloseTo(275.734375, 11);
    expect(calcValue(doc, '=AGGREGATE(12;5;P2:P9)')).toBe(8);
    expect(calcValue(doc, '=AGGREGATE(13;5;P2:P9)')).toBe(8);
    expect(calcValue(doc, '=AGGREGATE(14;6;J2:J12;3)')).toBe(72);
    // LARGE, SMALL, PERCENTILE and QUARTILE need their k argument.
    for (const f of [14, 15, 16, 17, 18, 19]) expect(calc(doc, `=AGGREGATE(${f};5;P2:P9)`)).toBe('Err:511');
    expect(calc(doc, '=AGGREGATE(15;6;J2:J12)')).toBe('Err:511');
    expect(calcValue(doc, '=AGGREGATE(15;6;J2:J12;2)')).toBe(31);
    expect(calcValue(doc, '=AGGREGATE(16;4;P2:P9;0.5)')).toBe(8);
    expect(calcValue(doc, '=AGGREGATE(17;4;P2:P9;2)')).toBe(8);
  });
});

describe('IFS', () => {
  // ifs.fods Sheet2
  it('returns the value of the first true condition', () => {
    const doc = newDoc();
    const grade = '=IFS(G1>89;"A";G1>79;"B";G1>69;"C";G1>59;"D";1;"F")';
    const expectGrade = (n: number, g: string) => {
      put(doc, 'G1', n);
      expect(calc(doc, grade)).toBe(g);
    };
    expectGrade(93, 'A');
    expectGrade(89, 'B');
    expectGrade(71, 'C');
    expectGrade(60, 'D');
    expectGrade(58, 'F');
    putAll(doc, { L2: 'Apple', L3: 'Potato', L4: 'Steak', L5: 'Coffee' });
    const f = (r: number) => `=IFS(L${r}="Apple";"Fruit";L${r}="Potato";"Veg";L${r}="Steak";"Meat")`;
    expect(calc(doc, f(2))).toBe('Fruit');
    expect(calc(doc, f(3))).toBe('Veg');
    expect(calc(doc, f(4))).toBe('Meat');
    expect(calc(doc, f(5))).toBe('#N/A');
  });

  it('returns references and ignores errors outside the active path', () => {
    const doc = newDoc();
    putAll(doc, { I2: 'Sunday', I3: 'Monday', I4: 'Tuesday', J2: 3 });
    expect(calc(doc, '=IFS(J2=1;I2;J2=2;I3;J2=3;I4)')).toBe('Tuesday');
    expect(calc(doc, '=IFS(0;1/0;1;TRUE())')).toBe('TRUE');
    expect(calc(doc, '=IFS(1/0;1;1;2)')).toBe('#DIV/0!');
    expect(calc(doc, '=IFS("x";1;1;2)')).toBe('#VALUE!');
    expect(calc(doc, '=IFS(1)')).toBe('Err:511');
    expect(calc(doc, '=IFS(1;2;3)')).toBe('2');
  });
});

describe('SWITCH', () => {
  // switch.fods Sheet2
  it('matches values and strings', () => {
    const doc = newDoc();
    putAll(doc, { I2: 2, I3: 3, I4: 4 });
    const f = (x: string) => `=SWITCH(${x}; 1; "Amy"; 2; "Bob"; 3; "Ian"; "Invalid Subject Number")`;
    expect(calc(doc, f('I2'))).toBe('Bob');
    expect(calc(doc, f('I3'))).toBe('Ian');
    expect(calc(doc, f('I4'))).toBe('Invalid Subject Number');
    expect(calc(doc, f('I2>0'))).toBe('Amy');
    expect(calc(doc, f('1+1'))).toBe('Bob');
    expect(calc(doc, '=SWITCH(I4;1;"Sunday";2;"Monday";3;"Tuesday")')).toBe('#N/A');
    expect(calc(doc, '=SWITCH(1;0;1/0;1;TRUE())')).toBe('TRUE');
    expect(calc(doc, '=SWITCH("b";"A";1;"B";2)')).toBe('2');
    expect(calc(doc, '=SWITCH(1;2)')).toBe('Err:511');
    expect(calc(doc, '=SWITCH(1/0;1;2;3)')).toBe('#DIV/0!');
  });
});

describe('MUNIT, MDETERM, MINVERSE', () => {
  it('MUNIT as array formula', () => {
    // munit.fods
    const doc = newDoc();
    matrix(doc, 8, 0, 12, 4, '=MUNIT(5)');
    for (let c = 0; c < 5; c++)
      for (let r = 0; r < 5; r++) expect(doc.GetValue(8 + c, r, 0)).toBe(c === r ? 1 : 0);
    expect(calc(doc, '=MUNIT(0)')).toBe('Err:502');
    expect(calcValue(doc, '=SUM(MUNIT(3))')).toBe(3);
  });

  it('MDETERM', () => {
    // mdeterm.fods
    const doc = newDoc();
    const rows = [[1, 3, 8, 5], [1, 3, 6, 1], [1, 1, 1, 0], [7, 3, 10, 2]];
    rows.forEach((row, r) => row.forEach((v, c) => doc.SetValue(8 + c, 1 + r, 0, v)));
    putAll(doc, { N1: 0.2, O1: 1, P1: -0.9, N2: 0.35, O2: 10.8, P2: 4, N3: -3.15, O3: 5 });
    putAll(doc, { R1: 1, S1: 2, T1: 3, R2: 4, S2: 5, T2: 6, R3: 7, S3: 8, T3: 9 });
    expect(calcValue(doc, '=MDETERM(I2:L5)')).toBeCloseTo(88, 10);
    expect(calcValue(doc, '=MDETERM({3,6,1;1,1,0;3,10,2})')).toBeCloseTo(1, 12);
    expect(calcValue(doc, '=MDETERM({3,6;1,1})')).toBeCloseTo(-3, 12);
    expect(calc(doc, '=MDETERM({1,3,8,5;1,3,6,1})')).toBe('Err:502');
    expect(calcValue(doc, '=MDETERM(N1:O2)')).toBeCloseTo(1.81, 12);
    expect(calc(doc, '=MDETERM(N1:P3)')).toBe('#VALUE!');
    expect(calcValue(doc, '=MDETERM({1,2;3,4})')).toBeCloseTo(-2, 12);
    expect(calcValue(doc, '=MDETERM({1,2,1;3,4,2;1,1,2})')).toBeCloseTo(-3, 12);
    expect(calcValue(doc, '=MDETERM(R1:T3)')).toBeCloseTo(0, 12);
    expect(calcValue(doc, '=MDETERM({0,0;0,0})')).toBe(0);
  });

  it('MINVERSE', () => {
    const doc = newDoc();
    putAll(doc, { A1: 4, B1: 7, A2: 2, B2: 6 });
    matrix(doc, 3, 0, 4, 1, '=MINVERSE(A1:B2)');
    expect(val(doc, 'D1')).toBeCloseTo(0.6, 12);
    expect(val(doc, 'E1')).toBeCloseTo(-0.7, 12);
    expect(val(doc, 'D2')).toBeCloseTo(-0.2, 12);
    expect(val(doc, 'E2')).toBeCloseTo(0.4, 12);
    // A * A^-1 = I
    expect(calcValue(doc, '=SUMPRODUCT(MMULT(A1:B2;MINVERSE(A1:B2))-MUNIT(2))')).toBeCloseTo(0, 12);
    matrix(doc, 6, 0, 8, 2, '=MINVERSE({2,0,0;0,4,0;0,0,8})');
    expect(val(doc, 'I3')).toBeCloseTo(0.125, 12);
    expect(val(doc, 'H1')).toBe(0);
    expect(calc(doc, '=MINVERSE({1,2;2,4})')).toBe('Err:502');
    expect(calc(doc, '=MINVERSE({1,2,3})')).toBe('Err:502');
    expect(calc(doc, '=MINVERSE({1,"a";2,4})')).toBe('#VALUE!');
  });
});

describe('FREQUENCY', () => {
  it('counts the data per bin (frequency.fods)', () => {
    const doc = newDoc();
    [12, 8, 24, 11, 5, 20, 16, 9, 7, 16, 33].forEach((v, i) => put(doc, `K${i + 1}`, v));
    [5, 10, 15, 20, 25, '>25'].forEach((v, i) => put(doc, `L${i + 1}`, v));
    matrix(doc, 0, 1, 0, 6, '=FREQUENCY(K1:K11;L1:L6)');
    expect([2, 3, 4, 5, 6, 7].map((r) => val(doc, `A${r}`))).toEqual([1, 3, 2, 3, 1, 1]);

    [79, 85, 78, 85, 50, 81, 95, 88, 97].forEach((v, i) => put(doc, `N${i + 2}`, v));
    [70, 79, 89].forEach((v, i) => put(doc, `O${i + 2}`, v));
    matrix(doc, 1, 7, 1, 10, '=FREQUENCY(N2:N10;O2:O4)');
    expect([8, 9, 10, 11].map((r) => val(doc, `B${r}`))).toEqual([1, 2, 4, 2]);
  });

  it('keeps the order of unsorted bins', () => {
    const doc = newDoc();
    matrix(doc, 0, 0, 0, 3, '=FREQUENCY({1,2,3,4,5,6};{4;2;5})');
    expect([1, 2, 3, 4].map((r) => val(doc, `A${r}`))).toEqual([2, 2, 1, 1]);
  });
});
