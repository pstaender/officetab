// Table numbers: SwCalc, number formats (reduced SvNumberFormatter), box values and formulas,
// number recognition, and their ODT form.
import { describe, expect, it } from 'vitest';
import { SwDoc, SW_CALC_ERROR } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwCalc } from '../../src/lo/sw/source/core/bastyp/calc.ts';
import { GenerateFormat, GetOutputString, GetStandardFormat, IsNumberFormat, SvNumFormatType } from '../../src/lo/svl/source/numbers/zforlist.ts';
import { ExportNumberStyle, ImportNumberStyles } from '../../src/lo/xmloff/source/style/xmlnumfe.ts';
import { sw_GetTableBoxColStr } from '../../src/lo/sw/source/core/fields/cellfml.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { parseXml } from '../../src/lo/xmloff/source/core/xmlparse.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

describe('SwCalc', () => {
  it('calculates as Writer does', () => {
    const c = new SwCalc();
    const r = (e: string) => c.Calculate(e);
    expect([r('1+2*3'), r('2*3^2'), r('(1+2)^2'), r('sum 1|2|3'), r('mean 2|4|6'), r('max 3|9|2'), r('min 3|9|2'), r('2.345 round 2'), r('50%'), r('sqrt 16')]).toEqual([7, 18, 9, 6, 4, 9, 2, 2.35, 0.5, 4]);
    expect([r('3 > 2'), r('2 eq 3'), r('not 0'), r('1 or 0'), r('count 4|5'), r('product 2|3|4'), r('abs -5'), r('mod 7|3')]).toEqual([1, 0, 1, 1, 2, 24, 5, 1]);
    expect(r('date 2024;1;2')).toBe(45293);
    expect(Number.isNaN(r('1/0'))).toBe(true);
    expect(Number.isNaN(r('foo(1)'))).toBe(true);
    expect(new SwCalc(',').Calculate('1,5*2')).toBe(3);
  });
});

describe('Number formats', () => {
  const out = (v: number, code: string, lang = 'en-US') => GetOutputString(v, code, lang).text;
  it('formats numbers, currencies, percentages, dates and times in the language', () => {
    expect([out(1234.567, 'General'), out(1234.567, '#,##0.00'), out(0.256, '0.00%'), out(12345, '0.00E+00'), out(1, '0.##'), out(-5, '#,##0_);(#,##0)')]).toEqual(['1234.567', '1,234.57', '25.60%', '1.23E+04', '1.', '(5)']);
    expect(GetOutputString(-1234.5, GetStandardFormat(SvNumFormatType.CURRENCY, 'en-US'), 'en-US')).toEqual({ text: '-$1,234.50', color: '#ff0000' });
    expect(out(-1234.5, GetStandardFormat(SvNumFormatType.CURRENCY, 'de-DE'), 'de-DE')).toBe('-1.234,50 €');
    expect([out(45605, GetStandardFormat(SvNumFormatType.DATE, 'en-US')), out(45605, GetStandardFormat(SvNumFormatType.DATE, 'de-DE'), 'de-DE'), out(45605.75, 'NNNNMMMM D, YYYY')]).toEqual(['11/9/24', '09.11.24', 'Saturday, November 9, 2024']);
    expect([out(0.6, 'HH:MM:SS AM/PM'), out(1.25, '[HH]:MM'), out(1, 'BOOLEAN')]).toEqual(['02:24:00 PM', '30:00', 'TRUE']);
    expect(GenerateFormat('0', 'en-US', true, true, 2, 1)).toBe('#,##0.00;[RED]-#,##0.00');
    expect(GenerateFormat('0%', 'en-US', false, false, 1, 1)).toBe('0.0%');
  });
  it('reads numbers as the language writes them', () => {
    expect(IsNumberFormat('1,234.5', 'en-US')).toEqual({ value: 1234.5, code: '#,##0.00' });
    expect(IsNumberFormat('1.234,5', 'de-DE')?.value).toBe(1234.5);
    expect(IsNumberFormat('12%', 'en-US')).toEqual({ value: 0.12, code: '0%' });
    expect(IsNumberFormat('$1,200.00', 'en-US')?.value).toBe(1200);
    expect(IsNumberFormat('3/15/2024', 'en-US')?.value).toBe(45366);
    expect(IsNumberFormat('15.3.24', 'de-DE')?.value).toBe(45366);
    expect(IsNumberFormat('13:45', 'en-US')?.value).toBeCloseTo(13.75 / 24, 9);
    expect(IsNumberFormat('5', 'en-US', '0%')?.value).toBe(0.05);
    expect(IsNumberFormat('abc', 'en-US')).toBeNull();
  });
  it('keeps format codes through ODF data styles', () => {
    const codes = ['#,##0.00', '0.00%', '0.00E+00', '[$€]#,##0.00;[RED]-[$€]#,##0.00', 'YYYY-MM-DD', 'NNNNMMMM D, YYYY', 'HH:MM:SS', '[HH]:MM', 'BOOLEAN', 'MM/DD/YY'];
    for (const code of codes) {
      const xml = ExportNumberStyle('N1', code, 'en-US');
      const root = parseXml(`<office:automatic-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">${xml}</office:automatic-styles>`);
      const back = ImportNumberStyles([root.children.find((c) => typeof c !== 'string') as never]).get('N1')!;
      expect(GetOutputString(-1234.5678, back, 'en-US').text, code).toBe(GetOutputString(-1234.5678, code, 'en-US').text);
      expect(GetOutputString(45605.6, back, 'en-US').text, code).toBe(GetOutputString(45605.6, code, 'en-US').text);
    }
  });
});

function grid(texts: string[][]) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.InsertTable(texts.length, texts[0]!.length, { heading: false, repeatHeading: false, borders: true });
  texts.flat().forEach((t, i) => { if (i) sh.GoNextCell(false); sh.Insert(t); });
  return sh;
}
const table = (doc: SwDoc): SwTableNode => { const ns = doc.GetNodes(); for (let i = 0; i < ns.Count(); i++) { const n = ns.node(i); if (n.IsTableNode()) return n as SwTableNode; } throw new Error(); };
const text = (sh: SwWrtShell) => table(sh.m_pDoc).m_pTable.m_aLines.map((l) => l.m_aBoxes.map((b) => sh.m_pDoc.GetNodes().GoNext(b.m_pStartNode!.GetIndex())!.GetText()));
const goto = (sh: SwWrtShell, r: number, c: number) => {
  const b = table(sh.m_pDoc).m_pTable.m_aLines[r]!.m_aBoxes[c]!;
  const n = sh.m_pDoc.GetNodes().GoNext(b.m_pStartNode!.GetIndex()) as SwTextNode;
  sh.m_pCursor.GetPoint().Assign(n, n.Len());
  sh.m_pCursor.DeleteMark();
};

describe('Table formulas', () => {
  it('names columns as Writer does', () => {
    expect([0, 25, 26, 51, 52, 53].map(sw_GetTableBoxColStr)).toEqual(['A', 'Z', 'a', 'z', 'AA', 'AB']);
  });

  it('calculates formulas with references, ranges and other tables, and updates them', () => {
    const sh = grid([['1', '2', ''], ['3', '4', '']]);
    goto(sh, 0, 2);
    sh.SetTableBoxFormulaAttrs({ formula: '<A1>+<B1>' });
    goto(sh, 1, 2);
    sh.SetTableBoxFormulaAttrs({ formula: 'sum <A1:B2>' });
    expect(text(sh)).toEqual([['1', '2', '3'], ['3', '4', '10']]);
    // Editing a number: once the cursor leaves the box, the formulas follow.
    goto(sh, 0, 0);
    sh.DelLeft(); sh.Insert('5');
    goto(sh, 1, 1);
    expect(sh.CheckTableBoxContent()).toBe(true);
    expect(text(sh)).toEqual([['5', '2', '7'], ['3', '4', '14']]);
    // A formula about its own box is an error.
    goto(sh, 0, 2);
    sh.SetTableBoxFormulaAttrs({ formula: '<C1>*2' });
    expect(text(sh)[0]![2]).toBe(SW_CALC_ERROR);
    expect(sh.GetTableBoxFormula()).toBe('=<C1>*2');
  });

  it('proposes AutoSum over the numbers above, or else on the left', () => {
    const sh = grid([['Item', 'Price'], ['a', '10'], ['b', '5.5'], ['Sum', '']]);
    goto(sh, 3, 1);
    expect(sh.GetAutoSum()).toBe('sum(<B2>|<B3>)');
    sh.SetTableBoxFormulaAttrs({ formula: sh.GetAutoSum() });
    expect(text(sh)[3]![1]).toBe('15.5');
    const row = grid([['2', '3', '']]);
    goto(row, 0, 2);
    expect(row.GetAutoSum()).toBe('sum(<A1>|<B1>)');
  });
});

describe('Number formats in tables', () => {
  it('formats a box value with the standard formats and recognises typed numbers', () => {
    const sh = grid([['1234.5', 'x']]);
    goto(sh, 0, 0);
    sh.SetTableBoxFormulaAttrs({ numFormat: GetStandardFormat(SvNumFormatType.CURRENCY, 'en-US') });
    expect(text(sh)[0]![0]).toBe('$1,234.50');
    // Right aligned like a number.
    expect(sh.m_pDoc.GetNodes().GoNext(table(sh.m_pDoc).m_pTable.m_aLines[0]!.m_aBoxes[0]!.m_pStartNode!.GetIndex())!.GetAttr('RES_PARATR_ADJUST')).toBe('right');
    // With number recognition, typed numbers get their format.
    sh.m_bInsTableFormatNum = true;
    goto(sh, 0, 1);
    sh.DelLeft(); sh.Insert('25%');
    goto(sh, 0, 0);
    sh.CheckTableBoxContent();
    const b = table(sh.m_pDoc).m_pTable.m_aLines[0]!.m_aBoxes[1]!;
    expect([b.m_aAttrs.value, b.m_aAttrs.numFormat]).toEqual([0.25, '0%']);
    expect(text(sh)[0]![1]).toBe('25%');
  });

  it('keeps values, formats and formulas through ODT', async () => {
    const sh = grid([['10', '2024-01-02', '']]);
    goto(sh, 0, 0);
    sh.SetTableBoxFormulaAttrs({ numFormat: '#,##0.00' });
    goto(sh, 0, 1);
    sh.SetTableBoxFormulaAttrs({ numFormat: 'NNNNMMMM D, YYYY' });
    goto(sh, 0, 2);
    sh.SetTableBoxFormulaAttrs({ formula: '<A1>*3', numFormat: '0.0' });
    expect(text(sh)).toEqual([['10.00', 'Tuesday, January 2, 2024', '30.0']]);
    const back = (await ImportODT(await ExportODT(sh.m_pDoc))).doc;
    const boxes = table(back).m_pTable.m_aLines[0]!.m_aBoxes;
    expect(boxes.map((b) => [b.m_aAttrs.value, b.m_aAttrs.numFormat, b.m_aAttrs.formula])).toEqual([[10, '#,##0.00', undefined], [45293, 'NNNNMMMM D, YYYY', undefined], [30, '0.0', '<A1>*3']]);
  });
});
