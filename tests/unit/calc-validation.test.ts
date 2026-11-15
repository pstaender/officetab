// Validity (validat.cxx, conditio.cxx): the data modes, the selection list, references that
// follow inserted columns (ucalc_formula.cxx testFormulaRefUpdateValidity).
import { describe, expect, test } from 'vitest';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { InsCellCmd } from '../../src/lo/sc/inc/global.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import { ScTypedStrData } from '../../src/lo/sc/inc/filterentries.ts';
import { ScConditionMode } from '../../src/lo/sc/source/core/data/conditio.ts';
import { ScValidationData, ScValidationMode, ScValidErrorStyle } from '../../src/lo/sc/source/core/data/validat.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { newDoc, putAll } from './calchelper.ts';

const values = (l: ScTypedStrData[]) => l.map((e) => e.GetValue()).sort((a, b) => a - b);

describe('ScValidationData', () => {
  test('testFormulaRefUpdateValidity', () => {
    const sh = new ScDocShell();
    const doc = sh.GetDocument();
    doc.SetValue(new ScAddress(2, 1, 0), 1);
    doc.SetValue(new ScAddress(2, 2, 0), 2);
    doc.SetValue(new ScAddress(2, 3, 0), 3);
    const aData = new ScValidationData(ScValidationMode.SC_VALID_LIST, ScConditionMode.Equal, 'C2:C4', '', doc, new ScAddress(0, 1, 0));
    const nIndex = doc.AddValidationEntry(aData);
    doc.ApplyAttr(0, 1, 0, { ATTR_VALIDDATA: nIndex });
    const pData = doc.GetValidationEntry(nIndex)!;
    let aList: ScTypedStrData[] = [];
    pData.FillSelectionList(aList, new ScAddress(0, 1, 0));
    expect(values(aList)).toEqual([1, 2, 3]);

    const aMark = new ScMarkData(doc.GetSheetLimits());
    aMark.SelectOneTable(0);
    expect(sh.GetDocFunc().InsertCells(new ScRange(1, 0, 0, 1, doc.MaxRow(), 0), aMark, InsCellCmd.INS_INSCOLS_BEFORE, true, true)).toBe(true);
    expect(doc.GetValue(new ScAddress(3, 1, 0))).toBe(1);
    aList = [];
    pData.FillSelectionList(aList, new ScAddress(0, 1, 0));
    expect(values(aList)).toEqual([1, 2, 3]);

    sh.GetUndoManager().Undo();
    expect(doc.GetValue(new ScAddress(2, 1, 0))).toBe(1);
    aList = [];
    pData.FillSelectionList(aList, new ScAddress(0, 1, 0));
    expect(values(aList)).toEqual([1, 2, 3]);
  });

  test('whole numbers between, decimals, text length, lists of strings, custom formulas, blanks', () => {
    const doc = newDoc();
    const pos = new ScAddress(0, 0, 0);
    const pat = doc.GetPattern(0, 0, 0);
    const whole = new ScValidationData(ScValidationMode.SC_VALID_WHOLE, ScConditionMode.Between, '1', '10', doc, pos);
    expect(whole.IsDataValid('5', pat, pos)).toBe(true);
    expect(whole.IsDataValid('5.5', pat, pos)).toBe(false);
    expect(whole.IsDataValid('11', pat, pos)).toBe(false);
    expect(whole.IsDataValid('abc', pat, pos)).toBe(false);
    expect(whole.IsDataValid('', pat, pos)).toBe(true); // blanks allowed by default
    whole.SetIgnoreBlank(false);
    expect(whole.IsDataValid('', pat, pos)).toBe(false);
    const dec = new ScValidationData(ScValidationMode.SC_VALID_DECIMAL, ScConditionMode.Greater, '0.5', '', doc, pos);
    expect(dec.IsDataValid('0.75', pat, pos)).toBe(true);
    expect(dec.IsDataValid('0.25', pat, pos)).toBe(false);
    const len = new ScValidationData(ScValidationMode.SC_VALID_TEXTLEN, ScConditionMode.EqLess, '3', '', doc, pos);
    expect(len.IsDataValid('abc', pat, pos)).toBe(true);
    expect(len.IsDataValid('abcd', pat, pos)).toBe(false);
    const list = new ScValidationData(ScValidationMode.SC_VALID_LIST, ScConditionMode.Equal, '"red";"green";"blue"', '', doc, pos);
    expect(list.IsDataValid('green', pat, pos)).toBe(true);
    expect(list.IsDataValid('GREEN', pat, pos)).toBe(true);
    expect(list.IsDataValid('pink', pat, pos)).toBe(false);
    const entries: ScTypedStrData[] = [];
    expect(list.FillSelectionList(entries, pos)).toBe(true);
    expect(entries.map((e) => e.GetString())).toEqual(['red', 'green', 'blue']);
    putAll(doc, { C1: 10 });
    const custom = new ScValidationData(ScValidationMode.SC_VALID_CUSTOM, ScConditionMode.Direct, 'A1<C1', '', doc, pos);
    expect(custom.IsDataValid('5', pat, pos)).toBe(true);
    expect(custom.IsDataValid('15', pat, pos)).toBe(false);
    expect(doc.GetCellType(pos)).toBe(0); // the cell is back as it was
    const date = new ScValidationData(ScValidationMode.SC_VALID_DATE, ScConditionMode.EqGreater, 'DATE(2024;1;1)', '', doc, pos);
    expect(date.IsDataValid('2024-03-01', pat, pos)).toBe(true);
    expect(date.IsDataValid('2023-03-01', pat, pos)).toBe(false);
    whole.SetError('Too big', 'Enter 1 to 10', ScValidErrorStyle.SC_VALERR_WARNING);
    expect(whole.DoError()).toEqual({ aTitle: 'Too big', aMessage: 'Enter 1 to 10', eStyle: ScValidErrorStyle.SC_VALERR_WARNING });
  });

  test('equal validations share a key', () => {
    const doc = newDoc();
    const a = new ScValidationData(ScValidationMode.SC_VALID_WHOLE, ScConditionMode.Greater, '0', '', doc, new ScAddress(0, 0, 0));
    const b = new ScValidationData(ScValidationMode.SC_VALID_WHOLE, ScConditionMode.Greater, '0', '', doc, new ScAddress(0, 0, 0));
    const n = doc.AddValidationEntry(a);
    expect(n).toBe(1);
    expect(doc.AddValidationEntry(b)).toBe(1);
    expect(doc.AddValidationEntry(new ScValidationData(ScValidationMode.SC_VALID_ANY, ScConditionMode.Equal, '', '', doc, new ScAddress()))).toBe(0);
  });
});

describe('validity in ODS', () => {
  const DATA = new URL('../../upstream/core/sc/qa/unit/data/', import.meta.url);

  test('testDataValidityODS', async () => {
    const { readFileSync } = await import('node:fs');
    const { ImportODS } = await import('../../src/lo/sc/source/filter/xml/ods.ts');
    const { FormulaGrammar } = await import('../../src/lo/include/formula/grammar.ts');
    const { doc: sh, lost } = await ImportODS(new Uint8Array(readFileSync(new URL('ods/dataValidity.ods', DATA))));
    expect(lost).toEqual([]);
    const doc = sh.GetDocument();
    const check = (eMode: ScValidationMode, eOp: number, s1: string, s2: string, aPos: ScAddress, title: string, msg: string, eStyle: ScValidErrorStyle, nIndex: number) => {
      const aValData = new ScValidationData(eMode, eOp as never, s1, s2, doc, aPos, FormulaGrammar.GRAM_ODFF, FormulaGrammar.GRAM_ODFF);
      aValData.SetIgnoreBlank(true);
      aValData.SetListType(1);
      aValData.ResetInput();
      aValData.SetError(title, msg, eStyle);
      const pTest = doc.GetValidationEntry(nIndex);
      expect(pTest).not.toBeNull();
      expect(aValData.EqualEntries(pTest!)).toBe(true);
    };
    const a1 = new ScAddress(2, 6, 0), a2 = new ScAddress(2, 3, 1), a3 = new ScAddress(2, 2, 2);
    check(ScValidationMode.SC_VALID_DECIMAL, ScConditionMode.Greater, '3.14', '', a1, 'Too small', 'The number you are trying to enter is not greater than 3.14! Are you sure you want to enter it anyway?', ScValidErrorStyle.SC_VALERR_WARNING, 1);
    check(ScValidationMode.SC_VALID_WHOLE, ScConditionMode.Between, '1', '10', a2, 'Error sheet 2', 'Must be a whole number between 1 and 10.', ScValidErrorStyle.SC_VALERR_STOP, 2);
    check(ScValidationMode.SC_VALID_CUSTOM, ScConditionMode.Direct, 'ISTEXT([.C3])', '', a3, 'Error sheet 3', 'Must not be a numerical value.', ScValidErrorStyle.SC_VALERR_STOP, 3);
    const cells = (aBase: ScAddress, r: ScRange) => {
      const nKey = doc.GetAttr(aBase.Col(), aBase.Row(), aBase.Tab(), 'ATTR_VALIDDATA');
      expect(nKey).toBeGreaterThan(0);
      for (let i = r.aStart.Col(); i <= r.aEnd.Col(); i++) for (let j = r.aStart.Row(); j <= r.aEnd.Row(); j++) expect(doc.GetAttr(i, j, aBase.Tab(), 'ATTR_VALIDDATA')).toBe(nKey);
    };
    cells(a1, new ScRange(2, 2, 0, 2, 6, 0));
    cells(a2, new ScRange(2, 3, 1, 6, 7, 1));
    cells(a3, new ScRange(2, 2, 2, 2, 6, 2));

    // and a round trip keeps them
    const { ExportFODS, ImportFODS } = await import('../../src/lo/sc/source/filter/xml/ods.ts');
    const { doc: sh2, lost: lost2 } = ImportFODS(ExportFODS(sh));
    expect(lost2).toEqual([]);
    const d2 = sh2.GetDocument();
    for (let n = 1; n <= 3; n++) expect(d2.GetValidationEntry(n)!.EqualEntries(doc.GetValidationEntry(n)!)).toBe(true);
    expect(d2.GetAttr(4, 5, 1, 'ATTR_VALIDDATA')).toBe(2);
  });

  test('a list validation with input help survives a round trip', async () => {
    const { ExportFODS, ImportFODS } = await import('../../src/lo/sc/source/filter/xml/ods.ts');
    const sh = new ScDocShell();
    const doc = sh.GetDocument();
    const aData = new ScValidationData(ScValidationMode.SC_VALID_LIST, ScConditionMode.Equal, '"one","two"', '', doc, new ScAddress(0, 0, 0));
    aData.SetInput('Pick', 'One of two');
    aData.SetListType(2);
    doc.ApplyAttr(0, 0, 0, { ATTR_VALIDDATA: doc.AddValidationEntry(aData) });
    const xml = ExportFODS(sh);
    expect(xml).toContain('cell-content-is-in-list(&quot;one&quot;;&quot;two&quot;)');
    const d2 = ImportFODS(xml).doc.GetDocument();
    const p = d2.GetValidationEntry(d2.GetAttr(0, 0, 0, 'ATTR_VALIDDATA'))!;
    expect(p.GetInput()).toEqual({ bShow: true, aTitle: 'Pick', aMsg: 'One of two' });
    const l: ScTypedStrData[] = [];
    p.FillSelectionList(l, new ScAddress(0, 0, 0));
    expect(l.map((e) => e.GetString())).toEqual(['one', 'two']);
  });
});
