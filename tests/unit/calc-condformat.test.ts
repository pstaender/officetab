// Conditional formatting (ScConditionalFormat, ScDocFunc::ReplaceConditionalFormat,
// ScUndoConditionalFormat) and its painting through FillInfo.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { ScAddress, ScColToAlpha, ScRange } from '../../src/lo/sc/inc/address.ts';
import { ScCellFormat } from '../../src/lo/sc/source/core/tool/cellform.ts';
import { ExportODS, ImportODS } from '../../src/lo/sc/source/filter/xml/ods.ts';
import { ScRangeList } from '../../src/lo/sc/inc/rangelst.ts';
import { ScTableInfo } from '../../src/lo/sc/inc/fillinfo.ts';
import { FillInfo } from '../../src/lo/sc/source/core/data/fillinfo.ts';
import { ScCondFormatEntry, ScConditionMode, ScConditionalFormat } from '../../src/lo/sc/source/core/data/conditio.ts';
import { ScDocFunc } from '../../src/lo/sc/source/ui/docshell/docfunc.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';

function setup() {
  const sh = new ScDocShell();
  const doc = sh.GetDocument();
  for (let r = 0; r < 4; r++) doc.SetValue(new ScAddress(0, r, 0), r * 10);
  const pFormat = new ScConditionalFormat(0, doc);
  pFormat.AddEntry(new ScCondFormatEntry(ScConditionMode.Greater, '15', '', doc, new ScAddress(0, 0, 0), 'Bad'));
  pFormat.AddEntry(new ScCondFormatEntry(ScConditionMode.Direct, 'A1=0', '', doc, new ScAddress(0, 0, 0), 'Good'));
  new ScDocFunc(sh).ReplaceConditionalFormat(0, pFormat, 0, new ScRangeList(new ScRange(0, 0, 0, 0, 3, 0)));
  return { sh, doc };
}

describe('conditional formatting', () => {
  test('the first condition that holds gives the style; it follows edits', () => {
    const { doc } = setup();
    expect([0, 1, 2, 3].map((r) => doc.GetCondResult(0, r, 0))).toEqual(['Good', '', 'Bad', 'Bad']);
    doc.SetValue(new ScAddress(0, 1, 0), 100);
    expect(doc.GetCondResult(0, 1, 0)).toBe('Bad');
    expect(doc.GetCondResult(1, 1, 0)).toBe('');
  });

  test('FillInfo lays the style over the pattern', () => {
    const { doc } = setup();
    const bad = doc.GetStyleSheetPool().Find('Bad')!.GetItem('ATTR_BACKGROUND');
    const info = new ScTableInfo(0, 5);
    FillInfo(doc, info, 0, 0, 2, 4, 0, 1 / 15, 1 / 15, false, false);
    expect(info.mpRowInfo[3]!.cellInfo(0).maBackground).toBe(bad);
    expect(info.mpRowInfo[2]!.cellInfo(0).maBackground).not.toBe(bad);
  });

  test('undo and redo restore the formats and the cells\' keys', () => {
    const { sh, doc } = setup();
    const nKey = doc.GetCondFormList(0)!.GetFormatsAt(new ScAddress(0, 2, 0))[0]!.GetKey();
    new ScDocFunc(sh).ReplaceConditionalFormat(nKey, null, 0, new ScRangeList());
    expect(doc.GetCondResult(0, 2, 0)).toBe('');
    sh.GetUndoManager().Undo();
    expect(doc.GetCondResult(0, 2, 0)).toBe('Bad');
    sh.GetUndoManager().Undo();
    expect(doc.GetCondFormList(0)!.size()).toBe(0);
    expect(doc.GetCondResult(0, 2, 0)).toBe('');
    sh.GetUndoManager().Redo();
    expect(doc.GetCondResult(0, 2, 0)).toBe('Bad');
  });
});

// testNewCondFormatODS, testConditionalFormatExportODS (sc/qa/unit/cond_format.cxx): the shown
// text of each cell with the number format of its condition's style (getConditionalFormatString)
// against the CSV.
describe('conditional formats in ODS', () => {
  const UP = 'upstream/core/sc/qa/unit/data';
  const parseCsv = (s: string) => s.split('\n').filter((l) => l.length).map((l) => {
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
  const shown = (doc: ScDocument, c: number, r: number): string => {
    const aCell = doc.GetRefCellValue(new ScAddress(c, r, 0));
    if (aCell.isEmpty()) return '';
    const aStyle = doc.GetCondResult(c, r, 0);
    const pStyle = aStyle ? doc.GetStyleSheetPool().Find(aStyle) : null;
    const nFormat = pStyle && pStyle.GetItemSet().ATTR_VALUE_FORMAT !== undefined ? pStyle.GetItem('ATTR_VALUE_FORMAT') : doc.GetPattern(c, r, 0).GetItem('ATTR_VALUE_FORMAT');
    return ScCellFormat.GetString(aCell, nFormat).aString;
  };
  const check = (doc: ScDocument, csv: string) => {
    const rows = parseCsv(readFileSync(`${UP}/contentCSV/${csv}`, 'utf8'));
    const diffs: string[] = [];
    rows.forEach((row, r) => row.forEach((v, c) => { const s = shown(doc, c, r); if (s !== v) diffs.push(`${ScColToAlpha(c)}${r + 1}: ${s} != ${v}`); }));
    return diffs;
  };

  test.each([['new_cond_format_test.ods', 'new_cond_format_test.csv'], ['new_cond_format_test_export.ods', 'new_cond_format_test_export.csv']])('%s', async (ods, csv) => {
    const res = await ImportODS(new Uint8Array(readFileSync(`${UP}/ods/${ods}`)));
    const sh = res.doc;
    expect(res.lost.filter((l) => /onditional/.test(l))).toEqual([]);
    const doc = sh.GetDocument();
    expect(doc.GetCondFormList(0)!.size()).toBeGreaterThan(0);
    expect(check(doc, csv)).toEqual([]);
    // saved and loaded again (saveAndReload)
    const again = await ImportODS(await ExportODS(sh));
    expect(check(again.doc.GetDocument(), csv)).toEqual([]);
  });
});
