// The UNO add-in mechanism (sc/source/core/tool/addincol.cxx, ScInterpreter::ScExternal and the
// compiler's add-in names) with a test component.
import { describe, expect, test } from 'vitest';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { IllegalArgumentException, ScAddInArgumentType as T, type ScAddInArgumentType, type ScAddInComponent, type UnoAny, type XPropertySet } from '../../src/lo/sc/inc/addincol.ts';
import { GetAddInCollection, RegisterAddInComponent } from '../../src/lo/sc/source/core/tool/addincol.ts';
import { newDoc, putAll, str, val } from './calchelper.ts';

const methods: Record<string, { params: [string, number][]; f: (...a: any[]) => UnoAny; display: string; excel?: string }> = {
  getTwice: { params: [['xOptions', T.SC_ADDINARG_CALLER], ['fVal', T.SC_ADDINARG_DOUBLE]], f: (_o: XPropertySet, v: number) => v * 2, display: 'TWICE', excel: 'TWICEXL' },
  getNullYear: { params: [['xOptions', T.SC_ADDINARG_CALLER]], f: (o: XPropertySet) => (o.getPropertyValue('NullDate') as { Year: number }).Year, display: 'NULLYEAR' },
  getSumAll: {
    params: [['xOptions', T.SC_ADDINARG_CALLER], ['aVals', T.SC_ADDINARG_DOUBLE_ARRAY], ['aMore', T.SC_ADDINARG_VARARGS]],
    f: (_o: unknown, a: number[][], more: UnoAny[]) => {
      let s = a.flat().reduce((x, y) => x + y, 0);
      for (const m of more) {
        if (typeof m === 'number') s += m;
        else if (Array.isArray(m)) for (const r of m as UnoAny[][]) for (const v of r) if (typeof v === 'number') s += v;
      }
      return s;
    },
    display: 'SUMALL',
  },
  getOpt: { params: [['fVal', T.SC_ADDINARG_DOUBLE], ['aOpt', T.SC_ADDINARG_VALUE_OR_ARRAY]], f: (v: number, o: UnoAny) => (o === undefined ? `${v} none` : `${v} ${String(o)}`), display: 'OPT' },
  getFail: { params: [['fVal', T.SC_ADDINARG_DOUBLE]], f: () => { throw new IllegalArgumentException(); }, display: 'FAIL' },
  getRow: { params: [['nN', T.SC_ADDINARG_INTEGER]], f: (n: number) => [Array.from({ length: n }, (_, i) => i + 1)], display: 'ROWOF' },
};

const component: ScAddInComponent = {
  getServiceName: () => 'com.sun.star.sheet.addin.Test',
  getMethods: () => Object.entries(methods).map(([name, m]) => ({ getName: () => name, getParameterInfos: () => m.params.map(([aName, eType]) => ({ aName, eType: eType as ScAddInArgumentType })), invoke: (a: unknown[]) => m.f(...a) })),
  setLocale: () => {},
  getProgrammaticCategoryName: () => 'Add-In',
  getDisplayFunctionName: (n) => methods[n]!.display,
  getFunctionDescription: () => '',
  getDisplayArgumentName: () => 'x',
  getArgumentDescription: () => '',
  getCompatibilityNames: (n) => (methods[n]!.excel ? [{ Locale: { Language: 'en', Country: 'US' }, Name: methods[n]!.excel! }] : []),
};
RegisterAddInComponent(() => component);

describe('add-in functions', () => {
  test('the collection finds functions by programmatic, English and local name', () => {
    const c = GetAddInCollection();
    expect(c.FindFunction('COM.SUN.STAR.SHEET.ADDIN.TEST.GETTWICE', false)).toBe('com.sun.star.sheet.addin.Test.getTwice');
    expect(c.FindFunction('TWICE', true)).toBe('com.sun.star.sheet.addin.Test.getTwice');
    expect(c.FindFunction('TWICE', false)).toBe('com.sun.star.sheet.addin.Test.getTwice');
    expect(c.GetExcelName('com.sun.star.sheet.addin.Test.getTwice')).toBe('TWICEXL');
    expect(c.GetCalcName('twicexl')).toBe('com.sun.star.sheet.addin.Test.getTwice');
  });

  test('formulas call them, with the caller, arrays, varargs and optional arguments', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3, B1: '=TWICE(A1+A2)', B2: '=nullyear()', B3: '=SUMALL(A1:A3;10;A1:A2)', B4: '=OPT(1)', B5: '=OPT(1;"x")', B6: '=FAIL(1)', B7: '=SUM(ROWOF(3))' });
    expect(val(doc, 'B1')).toBe(6);
    expect(val(doc, 'B2')).toBe(1899);
    expect(val(doc, 'B3')).toBe(19);
    expect(str(doc, 'B4')).toBe('1 none');
    expect(str(doc, 'B5')).toBe('1 x');
    expect(str(doc, 'B6')).toBe('Err:502');
    expect(val(doc, 'B7')).toBe(6);
    expect(doc.GetFormula(new ScAddress(1, 0, 0))).toBe('=TWICE(A1+A2)');
  });

  test('file formats keep the stored name: programmatic in ODFF, the compatibility name in OOXML', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=TWICE(2)' });
    const fc = doc.GetFormulaCell(new ScAddress(0, 0, 0))!;
    expect(fc.GetFormula(FormulaGrammar.GRAM_ODFF)).toBe('=COM.SUN.STAR.SHEET.ADDIN.TEST.GETTWICE(2)');
    expect(fc.GetFormula(FormulaGrammar.GRAM_OOXML)).toBe('=TWICEXL(2)');
    putAll(doc, { A2: 'x' });
    doc.SetFormula(new ScAddress(0, 1, 0), '=COM.SUN.STAR.SHEET.ADDIN.TEST.GETTWICE(21)', FormulaGrammar.GRAM_ODFF);
    expect(val(doc, 'A2')).toBe(42);
    expect(doc.GetFormula(new ScAddress(0, 1, 0))).toBe('=TWICE(21)');
  });
});
