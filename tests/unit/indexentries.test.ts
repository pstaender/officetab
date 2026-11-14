import { describe, expect, it } from 'vitest';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwTOXMgr } from '../../src/lo/sw/source/uibase/index/toxmgr.ts';
import { GetTOIKeys, GetTOXMarkText, GetTextTOXMarks } from '../../src/lo/sw/source/core/doc/doctxm.ts';
import { SwTOIKeyType, TOXTypes, ToxAuthorityField } from '../../src/lo/sw/inc/toxe.ts';
import { AuthEntryFromContents, ConditionalExpandAuthIdentifier, SwAuthEntry, TOX_STYLE_DELIMITER } from '../../src/lo/sw/inc/authfld.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const first = (sh: SwWrtShell) => sh.m_pDoc.GetNodes().FirstTextNode() as SwTextNode;
const desc = (meTOXType: TOXTypes, extra: Partial<Parameters<SwTOXMgr['InsertTOXMark']>[0]> = {}) => ({ meTOXType, mnLevel: 1, mbMainEntry: false, ...extra });
const entry = (id: string, author = '', title = '') => {
  const e = new SwAuthEntry();
  e.SetAuthorField(ToxAuthorityField.AUTH_FIELD_IDENTIFIER, id);
  e.SetAuthorField(ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE, '1');
  e.SetAuthorField(ToxAuthorityField.AUTH_FIELD_AUTHOR, author);
  e.SetAuthorField(ToxAuthorityField.AUTH_FIELD_TITLE, title);
  return e;
};
/** The text of the body's first page, fields expanded. */
const shown = (sh: SwWrtShell) => sh.m_pRoot.pages[0]!.frames.filter((f) => !f.pArea).flatMap((f) => f.lines.flatMap((l) => l.portions.map((x) => (x.kind === 'field' ? x.aExpand : f.node.GetText().slice(x.nStart, x.nStart + x.nLen))))).join('');

describe('index entries', () => {
  it('marks the selection, does not grow when typing at its edges, and grows inside', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('the cold winter');
    const n = first(sh);
    sh.SelectRange(n, 4, 8);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_INDEX, { maPrimKey: 'weather' }));
    let [m] = GetTextTOXMarks(n);
    expect(m && [m.nStart, m.nEnd, GetTOXMarkText(sh.m_pDoc, m.pMark), m.pMark.GetPrimaryKey()]).toEqual([4, 8, 'cold', 'weather']);
    sh.SelectRange(n, 8, 8);
    sh.Insert('!');
    sh.SelectRange(n, 4, 4);
    sh.Insert('>');
    sh.SelectRange(n, 7, 7);
    sh.Insert('o');
    [m] = GetTextTOXMarks(n);
    expect(n.GetText()).toBe('the >coold! winter');
    expect(GetTOXMarkText(sh.m_pDoc, m!.pMark)).toBe('coold');
    expect(GetTOIKeys(sh.m_pDoc, SwTOIKeyType.TOI_PRIMARY)).toEqual(['weather']);
    // The marks at a position: the mark's start and inside it, not its end.
    sh.SelectRange(n, 5, 5);
    expect(sh.GetCurTOXMarks()).toHaveLength(1);
    sh.SelectRange(n, 10, 10);
    expect(sh.GetCurTOXMarks()).toHaveLength(0);
  });

  it('puts a mark with an alternative text on a placeholder that takes no space', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Heading text');
    sh.SelectRange(first(sh), 7, 7);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_CONTENT, { maAltStr: 'Other', mnLevel: 2 }));
    const n = first(sh);
    expect(n.GetText()).toBe('Heading\u0001 text');
    expect(shown(sh)).toBe('Heading text');
    sh.SelectRange(n, 7, 7);
    const mgr = new SwTOXMgr(sh);
    expect(mgr.GetCurTOXMark()?.GetAlternativeText()).toBe('Other');
    expect(mgr.GetCurTOXMark()?.GetLevel()).toBe(2);
    mgr.DeleteTOXMark();
    expect(n.GetText()).toBe('Heading text');
    sh.Undo();
    expect(first(sh).GetText()).toBe('Heading\u0001 text');
  });

  it('updates a mark by replacing it, and an alternative text turns a range into a point', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('alpha beta');
    const n = first(sh);
    sh.SelectRange(n, 0, 5);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_USER, { maTOUName: 'Names', mnLevel: 1 }));
    sh.SelectRange(n, 0, 0);
    let mgr = new SwTOXMgr(sh);
    const old = mgr.GetCurTOXMark()!;
    expect(old.GetTOXType().GetTypeName()).toBe('Names');
    mgr.UpdateTOXMark(desc(TOXTypes.TOX_USER, { mnLevel: 3 }));
    expect(GetTextTOXMarks(n)[0]!.pMark.GetLevel()).toBe(3);
    expect(old.GetLevel()).toBe(1);
    sh.Undo();
    expect(GetTextTOXMarks(first(sh))[0]!.pMark).toBe(old);
    sh.SelectRange(first(sh), 0, 0);
    mgr = new SwTOXMgr(sh);
    mgr.UpdateTOXMark(desc(TOXTypes.TOX_USER, { mnLevel: 1, maAltStr: 'A' }));
    expect(first(sh).GetText()).toBe('\u0001alpha beta');
    expect(GetTextTOXMarks(first(sh)).map((m) => [m.nStart, m.nEnd, m.pMark.GetAlternativeText()])).toEqual([[0, 1, 'A']]);
  });

  it('applies to all occurrences and travels between them', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Cat cat category cat');
    const n = first(sh);
    sh.SelectRange(n, 4, 7);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_INDEX), sh.FindSameStrings('cat', true, true));
    expect(GetTextTOXMarks(n).map((m) => m.nStart)).toEqual([4, 17]);
    sh.SelectRange(n, 4, 4);
    const mgr = new SwTOXMgr(sh);
    mgr.NextTOXMark();
    expect(sh.m_pCursor.Start().GetContentIndex()).toBe(17);
    mgr.NextTOXMark();
    expect(sh.m_pCursor.Start().GetContentIndex()).toBe(17);
    mgr.PrevTOXMark(true);
    expect(sh.m_pCursor.Start().GetContentIndex()).toBe(4);
    expect(sh.FindSameStrings('cat', false, false)).toHaveLength(4);
  });

  it('keeps marks through ODT', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('one two three');
    const n = first(sh);
    sh.SelectRange(n, 4, 7);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_INDEX, { maPrimKey: 'numbers', maSecKey: 'small', mbMainEntry: true }));
    sh.SelectRange(n, 0, 3);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_CONTENT, { mnLevel: 2 }));
    sh.SelectRange(n, 13, 13);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_USER, { maTOUName: 'Mine', maAltStr: 'End' }));
    const bytes = await ExportODT(sh.m_pDoc);
    const content = new TextDecoder().decode((await readZip(bytes)).get('content.xml')!);
    expect(content).toContain('<text:alphabetical-index-mark-start text:id="IMark');
    expect(content).toContain('text:key1="numbers" text:key2="small" text:main-entry="true"');
    expect(content).toContain('<text:user-index-mark text:string-value="End" text:index-name="Mine" text:outline-level="1"/>');
    const r = await ImportODT(bytes);
    const m = GetTextTOXMarks(r.doc.GetNodes().FirstTextNode());
    expect(m.map((x) => [x.nStart, x.nEnd, x.pMark.GetTOXType().GetType(), GetTOXMarkText(r.doc, x.pMark)])).toEqual([
      [0, 3, TOXTypes.TOX_CONTENT, 'one'], [4, 7, TOXTypes.TOX_INDEX, 'two'], [13, 14, TOXTypes.TOX_USER, 'End']]);
    expect(m[1]!.pMark.IsMainEntry()).toBe(true);
    expect(m[0]!.pMark.GetLevel()).toBe(2);
    expect(m[2]!.pMark.GetTOXType().GetTypeName()).toBe('Mine');
    expect(r.lost).toEqual([]);
  });
});

describe('citations', () => {
  it('shows the identifier in brackets, or numbers in the order of the document', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: entry('Knuth84', 'Knuth', 'TeX') });
    sh.Insert(' and ');
    sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: entry('Lamport86') });
    sh.Insert(' and ');
    sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: entry('Knuth84', 'Knuth', 'TeX') });
    sh.m_pRoot.Layout();
    expect(shown(sh)).toBe('[Knuth84] and [Lamport86] and [Knuth84]');
    const pType = sh.m_pDoc.m_pAuthorityFieldType;
    const ids: string[] = [];
    pType.GetAllEntryIdentifiers(ids);
    expect(ids).toEqual(['Knuth84', 'Lamport86']);
    pType.SetSequence(true);
    sh.m_pDoc.Changed(null);
    sh.m_pRoot.Layout();
    expect(shown(sh)).toBe('[1] and [2] and [1]');
    pType.SetSortByDocument(false);
    pType.SetSortKeys([{ eField: ToxAuthorityField.AUTH_FIELD_IDENTIFIER, bSortAscending: false }]);
    const f = first(sh).m_aHints.find((h) => h.aAttrs.RES_TXTATR_FIELD)!.aAttrs.RES_TXTATR_FIELD!;
    expect(ConditionalExpandAuthIdentifier(f, pType)).toBe('[2]');
  });

  it('changes every citation of an entry, undoably', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: entry('A1', 'Old') });
    sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: entry('A1', 'Old') });
    sh.ChangeAuthorityData(entry('A1', 'New'));
    expect(sh.m_pDoc.m_pAuthorityFieldType.GetEntryByIdentifier('A1')?.GetAuthorField(ToxAuthorityField.AUTH_FIELD_AUTHOR)).toBe('New');
    expect(sh.m_pDoc.m_pAuthorityFieldType.GetEntries()).toHaveLength(1);
    sh.Undo();
    expect(sh.m_pDoc.m_pAuthorityFieldType.GetEntryByIdentifier('A1')?.GetAuthorField(ToxAuthorityField.AUTH_FIELD_AUTHOR)).toBe('Old');
    expect(AuthEntryFromContents(['X', '3', 'Addr'].join(TOX_STYLE_DELIMITER)).GetAuthorField(ToxAuthorityField.AUTH_FIELD_ADDRESS)).toBe('Addr');
  });

  it('keeps citations and the bibliography settings through ODT', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const e = entry('Knuth84', 'Donald E. Knuth', 'The TeXbook');
    e.SetAuthorField(ToxAuthorityField.AUTH_FIELD_TARGET_TYPE, '3');
    sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: e });
    sh.m_pDoc.m_pAuthorityFieldType.SetPreSuffix('(', ')');
    sh.m_pDoc.m_pAuthorityFieldType.SetSequence(true);
    const bytes = await ExportODT(sh.m_pDoc);
    const files = await readZip(bytes);
    const content = new TextDecoder().decode(files.get('content.xml')!);
    const styles = new TextDecoder().decode(files.get('styles.xml')!);
    expect(content).toContain('<text:bibliography-mark text:identifier="Knuth84" text:bibliography-type="book" text:author="Donald E. Knuth" text:title="The TeXbook" loext:target-type="3">(1)</text:bibliography-mark>');
    expect(styles).toContain('<text:bibliography-configuration text:prefix="(" text:suffix=")" text:numbered-entries="true">');
    const r = await ImportODT(bytes);
    expect(r.lost).toEqual([]);
    const f = r.doc.GetNodes().FirstTextNode().m_aHints[0]!.aAttrs.RES_TXTATR_FIELD!;
    expect(f.m_xAuthEntry!.equals(e)).toBe(true);
    expect(ConditionalExpandAuthIdentifier(f, r.doc.m_pAuthorityFieldType)).toBe('(1)');
  });
});

describe('index entries and citations in DOCX', () => {
  it('writes XE and TC fields and CITATION, and reads them as upstream does', async () => {
    const { ExportDOCX } = await import('../../src/lo/sw/source/filter/ww8/docxexport.ts');
    const { ImportDOCX } = await import('../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts');
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Cold and warm');
    const n = first(sh);
    sh.SelectRange(n, 0, 4);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_INDEX, { maPrimKey: 'weather' }));
    sh.SelectRange(n, 9, 13);
    new SwTOXMgr(sh).InsertTOXMark(desc(TOXTypes.TOX_CONTENT, { mnLevel: 2 }));
    sh.SelectRange(n, n.Len(), n.Len());
    sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: entry('Knuth84', 'Knuth', 'TeX') });
    const bytes = await ExportDOCX(sh.m_pDoc);
    const xml = new TextDecoder().decode((await readZip(bytes)).get('word/document.xml')!);
    expect(xml).toContain('<w:instrText xml:space="preserve"> XE &quot;weather:Cold&quot; </w:instrText>');
    expect(xml).toContain('<w:instrText xml:space="preserve"> TC &quot;warm&quot; \\l 2 </w:instrText>');
    expect(xml).toContain('<w:instrText xml:space="preserve"> CITATION &quot;Knuth84&quot;</w:instrText>');
    // writerfilter: XE's text is the primary key of a mark of " ", TC's level is \l + 1, a
    // CITATION's instruction its identifier and its result its title.
    const r = await ImportDOCX(bytes);
    const m = r.doc.GetNodes().FirstTextNode();
    const marks = GetTextTOXMarks(m);
    expect(m.GetText()).toBe('\u0001Cold and \u0001warm\u0001');
    expect(marks.map((x) => [x.nStart, x.pMark.GetTOXType().GetType(), x.pMark.GetAlternativeText(), x.pMark.GetPrimaryKey(), x.pMark.GetLevel()])).toEqual([
      [0, TOXTypes.TOX_INDEX, ' ', 'weather:Cold', 0], [10, TOXTypes.TOX_CONTENT, 'warm', '', 3]]);
    const f = m.m_aHints.find((h) => h.aAttrs.RES_TXTATR_FIELD)!.aAttrs.RES_TXTATR_FIELD!;
    expect(f.m_xAuthEntry!.GetAuthorField(ToxAuthorityField.AUTH_FIELD_IDENTIFIER)).toBe('CITATION "Knuth84"');
    expect(ConditionalExpandAuthIdentifier(f, r.doc.m_pAuthorityFieldType)).toBe('[Knuth84]');
    expect(r.lost).toEqual([]);
  });
});
