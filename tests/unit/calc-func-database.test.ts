// Database functions: DSUM, DCOUNT, DCOUNTA, DGET, DAVERAGE, DMAX, DMIN, DPRODUCT, DSTDEV,
// DSTDEVP, DVAR, DVARP with their query machinery (ScDBInternalRange, ScDBExternalRange,
// ScDBQueryParamInternal/Matrix, ScDBQueryDataIterator) and ScTable::CreateQueryParam.
// Upstream has no unit assertions for these functions beyond its function test documents
// (sc/qa/unit/data/functions/database/fods/*.fods, run as functions_test.cxx does) and the
// database ranges of database.ods (subsequent_filters_test.cxx testDatabaseRangesODS).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { ScQueryConnect, ScQueryOp } from '../../src/lo/sc/inc/global.ts';
import { ScQueryEntry } from '../../src/lo/sc/inc/queryentry.ts';
import { ScQueryParam } from '../../src/lo/sc/inc/queryparam.ts';
import { SetGlobalConfig } from '../../src/lo/sc/source/core/tool/interpr1.ts';
import { ImportFODS } from '../../src/lo/sc/source/filter/xml/ods.ts';
import { calc, calcValue, newDoc, putAll } from './calchelper.ts';

const DIR = new URL('../../upstream/core/sc/qa/unit/data/functions/database/fods/', import.meta.url);

describe('function test documents (functions_test.cxx)', () => {
  for (const f of ['daverage', 'dcount', 'dcounta', 'dget', 'dmax', 'dmin', 'dproduct', 'dstdev', 'dstdevp', 'dsum', 'dvar', 'dvarp']) {
    it(f, () => {
      SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_A1_XL_A1 });
      try {
        const { doc } = ImportFODS(readFileSync(new URL(`${f}.fods`, DIR), 'utf8'));
        const d = doc.GetDocument();
        d.CalcAll();
        expect(d.GetValue(1, 2, 0)).toBe(1);
      } finally {
        SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_UNSPECIFIED });
      }
    });
  }
});

function treeDoc() {
  const doc = newDoc();
  putAll(doc, {
    A1: 'Tree', B1: 'Height', C1: 'Age', D1: 'Yield',
    A2: 'Apple', B2: 18, C2: 20, D2: 14,
    A3: 'Pear', B3: 12, C3: 12, D3: 10,
    A4: 'Cherry', B4: 13, C4: 14, D4: 9,
    A5: 'Apple', B5: 14, C5: 15, D5: 10,
    A6: 'Pear', B6: 9, C6: 8, D6: 8,
    A7: 'Apple', B7: 8, C7: 9, D7: 6,
    // Excel style criteria: Tree = Apple and Height > 10
    F1: 'Tree', G1: 'Height', F2: 'Apple', G2: '>10',
    // Two rows: Apple or Pear
    I1: 'Tree', I2: 'Apple', I3: 'Pear',
    // Star query: field, operator, value in columns 2 to 4, AND/OR in column 1
    K1: '', L1: 'Tree', M1: "'=", N1: 'Pear',
    K2: 'OR', L2: 'Tree', M2: "'=", N2: 'Cherry',
  });
  return doc;
}

describe('database functions on a range', () => {
  it('aggregate the matching records of a field', () => {
    const doc = treeDoc();
    expect(calcValue(doc, '=DSUM(A1:D7;"Yield";F1:G2)')).toBe(24);
    expect(calcValue(doc, '=DSUM(A1:D7;4;F1:G2)')).toBe(24);
    expect(calcValue(doc, '=DCOUNT(A1:D7;"Yield";I1:I3)')).toBe(5);
    expect(calcValue(doc, '=DAVERAGE(A1:D7;"Yield";F1:G2)')).toBe(12);
    expect(calcValue(doc, '=DMAX(A1:D7;"Height";I1:I3)')).toBe(18);
    expect(calcValue(doc, '=DMIN(A1:D7;"Height";I1:I3)')).toBe(8);
    expect(calcValue(doc, '=DPRODUCT(A1:D7;"Yield";F1:G2)')).toBe(140);
    expect(calcValue(doc, '=DVARP(A1:D7;"Yield";F1:G2)')).toBe(4);
    expect(calcValue(doc, '=DVAR(A1:D7;"Yield";F1:G2)')).toBe(8);
    expect(calcValue(doc, '=DSTDEVP(A1:D7;"Yield";F1:G2)')).toBe(2);
    expect(calcValue(doc, '=DSTDEV(A1:D7;"Yield";F1:G2)')).toBeCloseTo(Math.sqrt(8), 14);
  });

  it('DCOUNTA counts strings, DCOUNT with a missing field counts records', () => {
    const doc = treeDoc();
    expect(calcValue(doc, '=DCOUNTA(A1:D7;"Tree";I1:I3)')).toBe(5);
    expect(calcValue(doc, '=DCOUNT(A1:D7;"Tree";I1:I3)')).toBe(0);
    expect(calcValue(doc, '=DCOUNT(A1:D7;0;I1:I3)')).toBe(5);
    expect(calcValue(doc, '=DCOUNT(A1:D7;;I1:I3)')).toBe(5);
    // A range as field must be the whole database range (old SO compatibility).
    expect(calcValue(doc, '=DCOUNT(A1:D7;A1:D7;I1:I3)')).toBe(5);
    expect(calc(doc, '=DCOUNT(A1:D7;A1:D6;I1:I3)')).toBe('Err:504');
  });

  it('DGET returns the single match', () => {
    const doc = treeDoc();
    putAll(doc, { F5: 'Height', F6: 18, G5: 'Height', G6: '>100' });
    expect(calcValue(doc, '=DGET(A1:D7;"Age";F5:F6)')).toBe(20);
    expect(calc(doc, '=DGET(A1:D7;"Tree";F5:F6)')).toBe('Apple');
    expect(calc(doc, '=DGET(A1:D7;"Age";I1:I3)')).toBe('Err:502'); // more than one match
    expect(calc(doc, '=DGET(A1:D7;"Age";G5:G6)')).toBe('#VALUE!'); // no match
  });

  it('a star query (four columns, AND/OR in the first)', () => {
    const doc = treeDoc();
    // The star query reads as many rows as the database range has (lcl_createStarQuery uses
    // pDBRef->getRowSize()), so every one of them must be a valid condition.
    putAll(doc, { L3: 'Tree', K3: 'OR', M3: "'=", N3: 'Apple' });
    expect(calcValue(doc, '=DSUM(A1:D3;"Yield";K1:N3)')).toBe(24);
    expect(calc(doc, '=DSUM(A1:D4;"Yield";K1:N4)')).toBe('Err:504'); // K4:N4 is no condition; as Excel style criteria the header "" is no field
  });

  it('an unknown field or criteria header is an illegal parameter', () => {
    const doc = treeDoc();
    expect(calc(doc, '=DSUM(A1:D7;"Weight";F1:G2)')).toBe('Err:504');
    putAll(doc, { P1: 'Colour', P2: 'red' });
    expect(calc(doc, '=DSUM(A1:D7;"Yield";P1:P2)')).toBe('Err:504');
  });
});

describe('database functions on an inline array (ScDBExternalRange)', () => {
  it('query a matrix', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=DSUM({"a","b";1,2;3,4;1,8};"b";{"a";"1"})')).toBe(10);
    // A number in a query matrix is no criterion (ScMatrix::GetString), so nothing matches.
    expect(calcValue(doc, '=DSUM({"a","b";1,2;3,4;1,8};"b";{"a";1})')).toBe(0);
    expect(calcValue(doc, '=DCOUNT({"a","b";1,2;3,4;1,8};2;{"a";">1"})')).toBe(1);
    expect(calcValue(doc, '=DMAX({"a","b";1,2;3,4;1,8};"b";{"a";"<>3"})')).toBe(8);
  });
});

describe('ScTable::CreateQueryParam', () => {
  it('reads Excel style criteria', () => {
    const doc = treeDoc();
    const aParam = new ScQueryParam();
    aParam.nCol1 = 0; aParam.nRow1 = 0; aParam.nCol2 = 3; aParam.nRow2 = 6; aParam.nTab = 0;
    const pTab = doc.FetchTable(0)!;
    expect(pTab.CreateQueryParam(5, 0, 6, 1, aParam)).toBe(true);
    const e0 = aParam.GetEntry(0), e1 = aParam.GetEntry(1);
    expect([e0.bDoQuery, e0.nField, e0.eOp, e0.GetQueryItem().maString, e0.GetQueryItem().meType]).toEqual([true, 0, ScQueryOp.SC_EQUAL, 'Apple', ScQueryEntry.ByString]);
    expect([e1.bDoQuery, e1.nField, e1.eOp, e1.eConnect, e1.GetQueryItem().mfVal, e1.GetQueryItem().meType]).toEqual([true, 1, ScQueryOp.SC_GREATER, ScQueryConnect.SC_AND, 10, ScQueryEntry.ByValue]);
    expect(aParam.GetEntry(2).bDoQuery).toBe(false);
  });

  it('reads a star query', () => {
    const doc = treeDoc();
    const aParam = new ScQueryParam();
    aParam.nCol1 = 0; aParam.nRow1 = 0; aParam.nCol2 = 3; aParam.nRow2 = 6; aParam.nTab = 0;
    expect(doc.FetchTable(0)!.CreateQueryParam(10, 0, 13, 1, aParam)).toBe(true);
    const e1 = aParam.GetEntry(1);
    expect([e1.bDoQuery, e1.nField, e1.eOp, e1.eConnect, e1.GetQueryItem().maString]).toEqual([true, 0, ScQueryOp.SC_EQUAL, ScQueryConnect.SC_OR, 'Cherry']);
  });
});
