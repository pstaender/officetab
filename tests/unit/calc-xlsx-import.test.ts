// XLSX import: upstream's test documents (sc/qa/unit/data/xlsx, xlsm) and assertions translated from
// subsequent_filters_test*.cxx.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, test } from 'vitest';
import { ImportXLSX } from '../../src/lo/sc/source/filter/oox/xlsx.ts';
import { BrokenPackageError } from '../../src/lo/package/source/zipapi/zip.ts';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { SfxStyleFamily } from '../../src/lo/sc/inc/stlsheet.ts';
import { ScSplitMode } from '../../src/lo/sc/source/filter/xml/ods.ts';
import { checkContent } from './calccsvcontent.ts';

const DATA = new URL('../../upstream/core/sc/qa/unit/data/', import.meta.url);
const load = async (name: string, bRepair = false) => ImportXLSX(new Uint8Array(readFileSync(new URL(name, DATA))), bRepair);
const A = (c: number, r: number, t = 0) => new ScAddress(c, r, t);

describe('XLSX import of upstream test documents', () => {
  // The CVE documents in the pass folders are not packages; they must fail cleanly.
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(new URL(d, DATA), { withFileTypes: true })) {
      if (f.isDirectory()) walk(`${d}${f.name}/`);
      else if (/\.xls[xmt]$/i.test(f.name)) files.push(d + f.name);
    }
  };
  walk('xlsx/');
  walk('xlsm/');

  it('imports every document or refuses it with a broken package error', async () => {
    const thrown: string[] = [];
    for (const f of files) {
      try {
        await load(f, /tdf131575|tdf76115/.test(f));
      } catch (e) {
        expect(e, f).toBeInstanceOf(BrokenPackageError);
        thrown.push(f.replace(/^.*\//, ''));
      }
    }
    // forcepoint107 is a broken package (upstream needs RepairPackage); the CVE files are no zips.
    expect(thrown.sort()).toEqual(['CVE-2016-0122-1.xlsm', 'CVE-2017-0199-1.xlsx', 'CVE-2017-0199-2.xlsx', 'forcepoint107.xlsx']);
  }, 300000);

  it('needs repairing for part names with backslashes (testTdf131575, testTdf76115)', async () => {
    await expect(load('xlsx/tdf131575.xlsx')).rejects.toBeInstanceOf(BrokenPackageError);
    const { doc } = await load('xlsx/tdf131575.xlsx', true);
    expect(doc.GetDocument().GetTableCount()).toBeGreaterThan(0);
    await expect(load('xlsx/tdf76115.xlsx')).rejects.toBeInstanceOf(BrokenPackageError);
    await load('xlsx/tdf76115.xlsx', true);
  });
});

describe('XLSX import (subsequent_filters_test)', () => {
  for (const f of ['xlsx/universal-content.xlsx', 'xlsx/universal-content-strict.xlsx']) {
    it(`testContentImpl ${f}`, async () => {
      const { doc } = await load(f);
      const rDoc = doc.GetDocument();
      rDoc.CalcAll();
      expect(rDoc.GetValue(0, 0, 0)).toBe(1);
      expect(rDoc.GetValue(0, 1, 0)).toBe(2);
      expect(rDoc.GetString(1, 0, 0)).toBe('String1');
      expect(rDoc.GetString(1, 1, 0)).toBe('String2');
      expect(rDoc.GetValue(2, 0, 0)).toBe(6);
      expect(rDoc.GetValue(2, 1, 0)).toBe(5);
      expect(rDoc.GetValue(2, 2, 0)).toBe(-1);
      expect(rDoc.GetValue(2, 3, 0)).toBe(11);
      const m = rDoc.ExtendMerge(4, 1, 4, 1, 0);
      expect([m.nEndCol, m.nEndRow]).toEqual([5, 2]);
      expect(rDoc.GetNote(A(7, 2))?.maText).toBe('Test');
    });
  }

  it('testRangeNameXLSX', async () => {
    const { doc } = await load('xlsx/named-ranges-global.xlsx');
    const rDoc = doc.GetDocument();
    rDoc.CalcAll();
    expect(rDoc.GetRangeName()!.findByUpperName('GLOBAL1')).toBeTruthy();
    expect(rDoc.GetValue(1, 0, 0)).toBe(1);
    expect(rDoc.GetRangeName(0)!.findByUpperName('LOCAL1')).toBeTruthy();
    expect(rDoc.GetValue(1, 2, 0)).toBe(3);
    expect(rDoc.GetRangeName(1)!.findByUpperName('LOCAL2')).toBeTruthy();
    expect(rDoc.GetValue(1, 1, 1)).toBe(7);
    expect(rDoc.GetValue(1, 1, 0)).toBe(2);
    expect(rDoc.GetValue(1, 3, 0)).toBe(4);
    expect(rDoc.GetValue(2, 0, 0)).toBe(10);
    expect(rDoc.GetValue(1, 0, 1)).toBe(5);
    expect(rDoc.GetValue(0, 5, 1)).toBe(5);
  });

  it('testRowIndex1BasedXLSX', async () => {
    const { doc } = await load('xlsx/row-index-1-based.xlsx');
    const rDoc = doc.GetDocument();
    expect(rDoc.GetString(0, 0, 0)).toBe('Action Plan.Name');
    expect(rDoc.GetString(1, 0, 0)).toBe('Action Plan.Description');
    expect(rDoc.GetString(0, 1, 0)).toBe('Jerry');
    const pText = rDoc.GetEditText(A(1, 1))!;
    expect(pText.GetParagraphCount()).toBe(3);
    expect([pText.GetText(0), pText.GetText(1), pText.GetText(2)]).toEqual(['This is a longer Text.', 'Second line.', 'Third line.']);
  });

  it('testSharedFormulaXLSX', async () => {
    const { doc } = await load('xlsx/shared-formula/basic.xlsx');
    const rDoc = doc.GetDocument();
    rDoc.CalcAll();
    for (let i = 1; i <= 18; ++i) expect(rDoc.GetValue(1, i, 0)).toBe(i * 10);
    expect(rDoc.GetFormulaCell(A(1, 18))).toBeTruthy();
  });

  it('testSharedFormulaRefUpdateXLSX', async () => {
    const { doc } = await load('xlsx/shared-formula/refupdate.xlsx');
    const rDoc = doc.GetDocument();
    rDoc.SetAutoCalc(true);
    rDoc.DeleteRow(0, 0, rDoc.MaxCol(), 0, 4, 1);
    expect([1, 2, 3, 4].map((c) => rDoc.GetFormula(c, 0, 0))).toEqual(['=B29+1', '=C29+1', '=D29+1', '=E29+1']);
  });

  it('testHyperlinksXLSX', async () => {
    const { doc } = await load('xlsx/hyperlinks.xlsx');
    const rDoc = doc.GetDocument();
    expect([1, 2, 3].map((r) => rDoc.GetString(0, r, 0))).toEqual(['10:ABC10', '10:ABC11', '10:ABC12']);
    expect(rDoc.GetEditText(A(0, 1))?.GetParagraph(0)?.maCharAttribs[0]?.aAttribs.URL).toBeTruthy();
  });

  it('testSheetNamesXLSX', async () => {
    const { doc } = await load('xlsx/sheet-names.xlsx');
    expect(doc.GetDocument().GetAllTableNames()).toEqual(['S&P', "Sam's Club", '"The Sheet"', 'A<B', 'C>D']);
  });

  it('testTdf122336: invalid cell addresses continue the row', async () => {
    const { doc } = await load('xlsx/tdf122336.xlsx');
    expect(doc.GetDocument().GetString(0, 0, 0)).toBe('Uitvoeringsdatum');
  });

  it('testTdf155046: boolean cells written as true/false', async () => {
    const { doc } = await load('xlsx/tdf155046.xlsx');
    const rDoc = doc.GetDocument();
    rDoc.CalcAll();
    const row = [2, 6, 7, 8, 9, 10, 11].map((c) => rDoc.GetString(c, 2, 0));
    expect(row).toEqual(['TRUE', 'TRUE', 'TRUE', 'FALSE', 'FALSE', 'TRUE', 'FALSE']);
  });

  it('testHiddenSheetsXLSX', async () => {
    const { doc } = await load('xlsx/hidden_sheets.xlsx');
    const rDoc = doc.GetDocument();
    expect([rDoc.IsVisible(0), rDoc.IsVisible(1), rDoc.IsVisible(2)]).toEqual([false, true, false]);
  });

  it('testPageScalingXLSX', async () => {
    const { doc } = await load('xlsx/page_scale.xlsx');
    const rDoc = doc.GetDocument();
    const pStyle = rDoc.GetStyleSheetPool().Find(rDoc.GetPageStyle(0), SfxStyleFamily.Page)!;
    expect(rDoc.GetPageStyle(0)).toBe(`PageStyle_${rDoc.GetName(0)}`);
    expect(pStyle.GetItem('ATTR_PAGE_SCALE')).toBe(90);
  });

  it('testBooleanFormatXLSX', async () => {
    const { doc } = await load('xlsx/check-boolean.xlsx');
    const rDoc = doc.GetDocument();
    // Saved as >"TRUE";"TRUE";"FALSE"< but reading converted back to >BOOLEAN<
    for (let i = 0; i <= 1; i++) expect(rDoc.GetNumberFormat(0, i, 0)).toBe('BOOLEAN');
  });

  test.each([
    ['xlsx/cell-value.xlsx', 'cell-value.csv', 0],
  ] as [string, string, number][])('%s matches %s', async (file, csv, nTab) => {
    const { doc } = await load(file);
    expect(checkContent(doc.GetDocument(), nTab, csv).slice(0, 8)).toEqual([]);
  });

  it('reports macros of XLSM documents', async () => {
    const r = await load('xlsm/vba-user-function.xlsm');
    expect(r.lost).toContain('Macros');
    expect(r.template).toBe(false);
  });

  it('recognises templates by the main part content type', async () => {
    const { readZip, writeZip } = await import('../../src/lo/package/source/zipapi/zip.ts');
    const files = await readZip(new Uint8Array(readFileSync(new URL('xlsx/universal-content.xlsx', DATA))));
    const ct = new TextDecoder().decode(files.get('[Content_Types].xml')).replace('spreadsheetml.sheet.main+xml', 'spreadsheetml.template.main+xml');
    files.set('[Content_Types].xml', new TextEncoder().encode(ct));
    const r = await ImportXLSX(await writeZip([...files].map(([name, data]) => ({ name, data }))));
    expect(r.template).toBe(true);
    expect(r.doc.GetDocument().GetString(1, 0, 0)).toBe('String1');
  });

  it('refuses encrypted documents', async () => {
    const bytes = new Uint8Array(512);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(ImportXLSX(bytes)).rejects.toThrow(/password-protected/);
  });

  it('reports what it does not import', async () => {
    expect((await load('xlsx/dataValidity.xlsx')).lost).toContain('Data validation');
    expect((await load('xlsx/autofilter.xlsx')).lost).toContain('AutoFilter');
  });

  it('reads the view settings: active sheet, frozen panes', async () => {
    const { viewSettings, doc } = await load('xlsx/universal-content.xlsx');
    expect(viewSettings?.ActiveTable).toBe(doc.GetDocument().GetName(0));
    expect(viewSettings?.Tables[doc.GetDocument().GetName(0)!]?.HorizontalSplitMode).toBe(ScSplitMode.SC_SPLIT_NONE);
  });
});
