import { describe, expect, it } from 'vitest';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { ScCompiler } from '../../src/lo/sc/source/core/tool/compiler.ts';
import { addr, newDoc, put } from './calchelper.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';

const { GRAM_NATIVE, GRAM_ODFF, GRAM_OOXML, GRAM_NATIVE_XL_A1, GRAM_NATIVE_XL_R1C1, GRAM_ENGLISH } = FormulaGrammar;

/** Compile a formula in one grammar and write it in another. */
function convert(doc: ScDocument, f: string, from: number, to: number, at = 'C3'): string {
  const pos = addr(doc, at);
  const aComp = new ScCompiler(doc, pos, null, from);
  const pArr = aComp.CompileString(f);
  aComp.CompileTokenArray(); // RPN: turns significant spaces into intersections
  const aOut = new ScCompiler(doc, pos, pArr, to);
  return aOut.CreateStringFromTokenArray();
}

describe('Calc formula compiler', () => {
  it('writes the UI grammar', () => {
    const doc = newDoc(2);
    for (const f of ['SUM(A1:B2)', 'IF(A1>0,"yes","no")', '$Sheet2.$A$1+Sheet2.B2', 'SUM(A:A)', 'A1*-2', '10%', 'A1&" x"', '{1,2;3,4}', '-A1^2', 'ROUND(1.25,1)', 'SUM((A1:A2~B1))', 'A1:B2!B1:C3'])
      expect(convert(doc, '=' + f, GRAM_NATIVE, GRAM_NATIVE), f).toBe(f);
    // ';' is a parameter separator in the UI grammar as well.
    expect(convert(doc, '=SUM(1;2)', GRAM_NATIVE, GRAM_NATIVE)).toBe('SUM(1,2)');
    // A separator in nested parentheses is the union operator, written '~'.
    expect(convert(doc, '=SUM((A1:A2,B1))', GRAM_NATIVE, GRAM_NATIVE)).toBe('SUM((A1:A2~B1))');
  });

  it('converts to and from ODFF', () => {
    const doc = newDoc(2);
    expect(convert(doc, '=SUM(A1:B2;$Sheet2.C3)', GRAM_NATIVE, GRAM_ODFF)).toBe('SUM([.A1:.B2];[$Sheet2.C3])');
    expect(convert(doc, 'of:=SUM([.A1:.B2];[$Sheet2.C3])'.replace('of:', ''), GRAM_ODFF, GRAM_NATIVE)).toBe('SUM(A1:B2,$Sheet2.C3)');
    expect(convert(doc, '=IF([.A1]>0;"a";"b")', GRAM_ODFF, GRAM_ODFF)).toBe('IF([.A1]>0;"a";"b")');
    expect(convert(doc, '=ROUND(1.5;0)', GRAM_ODFF, GRAM_ODFF)).toBe('ROUND(1.5;0)');
    expect(convert(doc, '={1;2|3;4}', GRAM_ODFF, GRAM_NATIVE)).toBe('{1,2;3,4}');
  });

  it('converts to and from OOXML', () => {
    const doc = newDoc(2);
    expect(convert(doc, '=SUM(A1:B2;$Sheet2.$C$3)', GRAM_NATIVE, GRAM_OOXML)).toBe('SUM(A1:B2,Sheet2!$C$3)');
    expect(convert(doc, '=SUM(A1:B2,Sheet2!$C$3)', GRAM_OOXML, GRAM_NATIVE)).toBe('SUM(A1:B2,$Sheet2.$C$3)');
    expect(convert(doc, '=_xlfn.IFS(A1>1,1,TRUE,2)', GRAM_OOXML, GRAM_NATIVE)).toBe('IFS(A1>1,1,TRUE(),2)');
    expect(convert(doc, '=IFS(A1>1;1;1;2)', GRAM_NATIVE, GRAM_OOXML)).toBe('_xlfn.IFS(A1>1,1,1,2)');
    expect(convert(doc, '=A1:B2 B1:C3', GRAM_OOXML, GRAM_NATIVE)).toBe('A1:B2!B1:C3');
  });

  it('converts Excel A1 and R1C1 references', () => {
    const doc = newDoc(2);
    expect(convert(doc, '=Sheet2!A1+B$2', GRAM_NATIVE_XL_A1, GRAM_NATIVE)).toBe('$Sheet2.A1+B$2');
    expect(convert(doc, '=A1+$B$2', GRAM_NATIVE, GRAM_NATIVE_XL_R1C1, 'C3')).toBe('R[-2]C[-2]+R2C2');
    expect(convert(doc, '=R[-2]C[-2]+R2C2', GRAM_NATIVE_XL_R1C1, GRAM_NATIVE, 'C3')).toBe('A1+$B$2');
  });

  it('keeps the English function names', () => {
    const doc = newDoc();
    expect(convert(doc, '=sum(a1)', GRAM_NATIVE, GRAM_ENGLISH)).toBe('SUM(A1)');
    expect(convert(doc, '=ERROR.TYPE(#N/A)', GRAM_NATIVE, GRAM_NATIVE)).toBe('ERROR.TYPE(#N/A)');
  });

  it('marks unknown names and bad references', () => {
    const doc = newDoc();
    put(doc, 'A1', '=nonexisting(1)');
    expect(doc.GetFormula(addr(doc, 'A1'))).toBe('=nonexisting(1)');
    expect(doc.GetString(addr(doc, 'A1'))).toBe('#NAME?');
    put(doc, 'A2', '=Sheet9.A1');
    expect(doc.GetString(addr(doc, 'A2'))).toBe('#NAME?');
  });

  it('uses named expressions', () => {
    const doc = newDoc();
    put(doc, 'A1', 5);
    const names = doc.GetRangeName()!;
    names.insert(new (requireRangeData())(doc, 'Five', '$Sheet1.$A$1', addr(doc, 'A1')));
    put(doc, 'B1', '=Five*2');
    expect(doc.GetString(addr(doc, 'B1'))).toBe('10');
    expect(doc.GetFormula(addr(doc, 'B1'))).toBe('=Five*2');
    put(doc, 'A1', 6);
    expect(doc.GetString(addr(doc, 'B1'))).toBe('12');
  });
});

import { ScRangeData } from '../../src/lo/sc/source/core/tool/rangenam.ts';
function requireRangeData() { return ScRangeData; }
