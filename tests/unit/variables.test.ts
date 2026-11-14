import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { InsertField, GetSubTypes, SwFieldTypesEnum } from '../../src/lo/sw/source/uibase/fldui/fldmgr.ts';
import { SwGetSetExpType, SwInputFieldSubType } from '../../src/lo/sw/source/core/fields/expfld.ts';
import { SwUserType } from '../../src/lo/sw/source/core/fields/usrfld.ts';
import { SwCalc } from '../../src/lo/sw/source/core/bastyp/calc.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** The text of every frame of a page area, fields expanded. */
const texts = (sh: SwWrtShell, area?: string) => sh.m_pRoot.pages.map((p) => p.frames.filter((f) => f.pArea === area).flatMap((f) => f.lines.flatMap((l) => l.portions.map((x) => (x.kind === 'field' ? x.aExpand : f.node.GetText().slice(x.nStart, x.nStart + x.nLen))))).join('|'));
const ins = (sh: SwWrtShell, d: Partial<Parameters<typeof InsertField>[1]> & { m_nTypeId: SwFieldTypesEnum }) => InsertField(sh, { m_nSubType: 0, m_sPar1: '', m_sPar2: '', ...d });

describe('SwCalc variables', () => {
  it('assigns with name=expression and looks names up without case', () => {
    const c = new SwCalc();
    expect(c.Calculate('a=2*3')).toBe(6);
    expect(c.Calculate('A+1')).toBe(7);
    c.m_fnVarLook = (n) => (n.toLowerCase() === 'price' ? 10 : undefined);
    expect(c.Calculate('price*a')).toBe(60);
    expect(SwCalc.IsValidVarName(' net total')).toEqual({ bRet: false, sValidName: 'net' });
    expect(SwCalc.IsValidVarName('net_1').bRet).toBe(true);
  });
});

describe('variables', () => {
  it('sets and shows numeric and text variables in document order', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Set, m_nSubType: SwGetSetExpType.Expr, m_sPar1: 'n', m_sPar2: '4' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Get, m_sPar1: 'n' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Set, m_nSubType: SwGetSetExpType.Expr | SwGetSetExpType.Invisible, m_sPar1: 'n', m_sPar2: 'n*2.5', m_sNumFormat: '0.00' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Get, m_sPar1: 'n', m_sNumFormat: '0.00' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Set, m_nSubType: SwGetSetExpType.String, m_sPar1: 'who', m_sPar2: 'Ada' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Get, m_sPar1: 'who' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Formel, m_sPar2: 'n+1' });
    sh.Insert(' ');
    // Show command: Formel with the Name format.
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Formel, m_nSubType: SwGetSetExpType.Formula | SwGetSetExpType.Command, m_sPar2: 'n+1' });
    expect(texts(sh)[0]).toBe('4| |4| || |10.00| |Ada| |Ada| |11| |n+1');
    expect(GetSubTypes(sh, SwFieldTypesEnum.Get)).toEqual(['n', 'who']);
    // No variable to show: nothing is inserted.
    expect(ins(sh, { m_nTypeId: SwFieldTypesEnum.Get, m_sPar1: 'nope' })).toBeNull();
  });

  it('shows user fields, calculated from other user fields, and follows their changes', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    ins(sh, { m_nTypeId: SwFieldTypesEnum.User, m_nSubType: SwUserType.Expr, m_sPar1: 'net', m_sPar2: '100' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.User, m_nSubType: SwUserType.Expr, m_sPar1: 'gross', m_sPar2: 'net*1.19', m_sNumFormat: '#,##0.00' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.User, m_nSubType: SwUserType.Expr | SwUserType.ShowCommand, m_sPar1: 'gross', m_sPar2: 'net*1.19' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Formel, m_sPar2: 'gross-net', m_nSubType: SwGetSetExpType.Formula });
    expect(texts(sh)[0]).toBe('100| |119.00| |net*1.19| |19');
    sh.m_pDoc.m_aUserFieldTypes.get('net')!.SetContent('200');
    sh.m_pDoc.UpdateFields();
    sh.m_pRoot.Layout();
    expect(texts(sh)[0]).toBe('200| |238.00| |net*1.19| |38');
    expect(sh.m_pDoc.IsUsed('User', 'net')).toBe(true);
  });

  it('inserts input fields of variables and user fields', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    ins(sh, { m_nTypeId: SwFieldTypesEnum.User, m_sPar1: 'client', m_sPar2: 'ACME', m_nSubType: SwUserType.String });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Set, m_nSubType: SwGetSetExpType.String, m_sPar1: 'v', m_sPar2: 'x' });
    sh.Insert(' ');
    const fUser = ins(sh, { m_nTypeId: SwFieldTypesEnum.Input, m_nSubType: SwInputFieldSubType.User, m_sPar1: 'client', m_sPar2: 'Client?' });
    sh.Insert(' ');
    const fVar = ins(sh, { m_nTypeId: SwFieldTypesEnum.Input, m_nSubType: SwInputFieldSubType.Var, m_sPar1: 'v', m_sPar2: 'Value?' });
    expect(fUser).toMatchObject({ type: 'Input', content: 'client', prompt: 'Client?' });
    expect(fVar).toMatchObject({ type: 'SetExp', name: 'v', input: true, prompt: 'Value?' });
    expect(texts(sh)[0]).toBe('ACME| |x| |ACME| |');
  });

  it('numbers number ranges by their formulas', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Sequence, m_sPar1: 'Step', m_sPar2: 'Step+1' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Sequence, m_sPar1: 'Step', m_sPar2: 'Step+10' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Sequence, m_sPar1: 'Step', m_sPar2: '' });
    expect(texts(sh)[0]).toBe('1| |11| |12');
  });

  it('shows page variables: the pages since the setting field plus its offset', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('a');
    sh.SplitNode();
    ins(sh, { m_nTypeId: SwFieldTypesEnum.SetRefPage, m_nSubType: 1, m_sPar2: '2' });
    for (let i = 0; i < 120; i++) { sh.SplitNode(); sh.Insert(`line ${i}`); }
    sh.SplitNode();
    ins(sh, { m_nTypeId: SwFieldTypesEnum.GetRefPage });
    const pages = sh.m_pRoot.pages.length;
    expect(pages).toBeGreaterThan(2);
    const last = texts(sh)[pages - 1]!.split('|');
    expect(last[last.length - 1]).toBe(String(2 + pages));
  });
});

describe('variables in ODF', () => {
  it('keeps variables, formulas, user fields, input and page variable fields through ODT', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    ins(sh, { m_nTypeId: SwFieldTypesEnum.User, m_nSubType: SwUserType.Expr, m_sPar1: 'net', m_sPar2: '100' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Set, m_nSubType: SwGetSetExpType.Expr, m_sPar1: 'n', m_sPar2: 'net/4', m_sNumFormat: '0.00' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Set, m_nSubType: SwGetSetExpType.String | SwGetSetExpType.Invisible, m_sPar1: 'who', m_sPar2: 'Ada' });
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Get, m_sPar1: 'who' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Formel, m_nSubType: SwGetSetExpType.Formula, m_sPar2: 'n*2' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Input, m_nSubType: SwInputFieldSubType.User, m_sPar1: 'net', m_sPar2: 'Net?' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.SetRefPage, m_nSubType: 1, m_sPar2: '5' });
    ins(sh, { m_nTypeId: SwFieldTypesEnum.GetRefPage });
    const before = texts(sh)[0];
    expect(before).toBe('100| |25.00| ||Ada| |50| |100| ||6');
    const bytes = await ExportODT(sh.m_pDoc);
    const r = await ImportODT(bytes);
    expect(r.lost).toEqual([]);
    const sh2 = new SwWrtShell(r.doc, mono);
    expect(texts(sh2)[0]).toBe(before);
    expect(r.doc.m_aSetExpFieldTypes.get('who')!.GetType()).toBe(SwGetSetExpType.String);
    expect(r.doc.m_aUserFieldTypes.get('net')!.GetContent()).toBe('100');
  });

  const dir = 'upstream/core/sw/qa/extras/';
  it.skipIf(!existsSync(`${dir}uiwriter/data/tdf125154.odt`))('reads numbers with group separators in German formulas (tdf#125154)', async () => {
    const r = await ImportODT(new Uint8Array(readFileSync(`${dir}uiwriter/data/tdf125154.odt`)));
    const sh = new SwWrtShell(r.doc, mono);
    const shown = new Map<string, string>();
    for (const n of r.doc.allText()) for (const h of n.m_aHints) { const f = h.aAttrs.RES_TXTATR_FIELD; if (f?.formula) shown.set(f.formula, sh.m_pRoot.m_aExpFields!.m_aTexts.get(f)!); }
    // testFormulaNumberWithGroupSeparator
    expect(shown.get('1000')).toBe('1.000');
    expect(shown.get('test')).toBe('1.000');
    expect(shown.get('1000*10%')).toBe('100');
    expect(shown.get('5.000*10%')).toBe('500');
  });

  it.skipIf(!existsSync(`${dir}odfimport/data/tdf103025.odt`))('shows in headers the variables set before each page (tdf#103025)', async () => {
    const r = await ImportODT(new Uint8Array(readFileSync(`${dir}odfimport/data/tdf103025.odt`)));
    const sh = new SwWrtShell(r.doc, mono);
    const headers = sh.m_pRoot.pages.map((p) => p.frames.filter((f) => f.pArea === 'header').flatMap((f) => f.lines.flatMap((l) => l.portions.filter((x) => x.kind === 'field').map((x) => x.aExpand))).filter((s) => /^\d{4}-\d\d$/.test(s!)));
    expect(headers.slice(0, 5)).toEqual([['2014-01'], ['2014-01'], ['2014-02'], ['2014-03'], ['2014-03']]);
  });
});

describe('variables in DOCX', () => {
  it('writes user fields as DOCVARIABLE, string variables as SET and REF, input fields as FILLIN, and reads them back', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    ins(sh, { m_nTypeId: SwFieldTypesEnum.User, m_nSubType: SwUserType.String, m_sPar1: 'client', m_sPar2: 'ACME' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Set, m_nSubType: SwGetSetExpType.String, m_sPar1: 'who', m_sPar2: 'Ada' });
    sh.Insert(' ');
    sh.InsertFormatField({ type: 'Input', subType: SwInputFieldSubType.Text, prompt: 'Name?', content: 'Bob' });
    sh.Insert(' ');
    ins(sh, { m_nTypeId: SwFieldTypesEnum.Formel, m_nSubType: SwGetSetExpType.Formula, m_sPar2: '6*7' });
    expect(texts(sh)[0]).toBe('ACME| |Ada| |Bob| |42');
    const bytes = await ExportDOCX(sh.m_pDoc);
    const r = await ImportDOCX(bytes);
    const sh2 = new SwWrtShell(r.doc, mono);
    // Word hides SET (its REF shows the variable); the formula is written as its text (WriteExpand).
    expect(texts(sh2)[0]).toBe('ACME| ||Ada| |Bob| 42');
    expect(r.lost).toEqual([]);
    expect(r.doc.m_aUserFieldTypes.get('client')!.GetContent()).toBe('ACME');
    expect(r.doc.m_aSetExpFieldTypes.get('who')!.GetType()).toBe(SwGetSetExpType.String);
  });
});

describe('variables from Word', () => {
  const doc = 'upstream/core/sw/qa/extras/ooxmlimport/data/n751017.docx';
  it.skipIf(!existsSync(doc))('reads ASK as an input field of a string variable that REF shows (n751017)', async () => {
    const r = await ImportDOCX(new Uint8Array(readFileSync(doc)));
    const sh = new SwWrtShell(r.doc, mono);
    expect(r.doc.m_aSetExpFieldTypes.get('foo')?.GetType()).toBe(SwGetSetExpType.String);
    const fields = [...r.doc.allText()].flatMap((n) => n.m_aHints.map((h) => h.aAttrs.RES_TXTATR_FIELD)).filter((f) => f?.type === 'SetExp' || f?.type === 'GetExp');
    expect(fields.map((f) => [f!.type, f!.formula])).toEqual([['SetExp', 'bar'], ['GetExp', 'foo']]);
    expect(sh.m_pRoot.m_aExpFields!.m_aTexts.get(fields[1]!)).toBe('bar');
  });
});
