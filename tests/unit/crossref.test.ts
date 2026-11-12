// Insert > Cross-reference (SwGetRefField, reference marks, SwFieldRefPage).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { GetFootnotes, GetNumItems, GetOutlineNodes, GetSeqFields, MakeRefNumString, RefFieldFormat, ReferencesSubtype, aGetRefField_RefItemNotFound } from '../../src/lo/sw/source/core/fields/reffld.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import { SwNumRule } from '../../src/lo/sw/inc/numrule.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** The reference fields' texts as the layout shows them, in document order. */
const refs = (sh: SwWrtShell) => sh.m_pRoot.pages.flatMap((p) => p.frames).flatMap((f) => f.lines.flatMap((l) => l.portions))
  .filter((p) => p.kind === 'field').map((p) => p.aExpand);
const sel = (sh: SwWrtShell, node: SwTextNode, a: number, b: number) => sh.SelectRange(node, a, b);
const at = (sh: SwWrtShell) => sh.m_pCursor.GetPoint().GetNode();
const end = (sh: SwWrtShell) => { const n = at(sh); sh.SelectRange(n, n.Len(), n.Len()); };

describe('Cross-references', () => {
  it('refers to a bookmark by its text, page and direction, and follows changes', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('See ');
    const first = at(sh);
    sh.SplitNode();
    sh.InsertPageBreak(null);
    sh.Insert('Target text');
    sel(sh, at(sh), 0, 6);
    sh.SetBookmark('bm');
    const target = at(sh);
    sh.SelectRange(first, 4, 4);
    for (const format of [RefFieldFormat.Content, RefFieldFormat.Page, RefFieldFormat.UpDown]) sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format, name: 'bm' });
    expect(refs(sh)).toEqual(['Target', '2', 'below']);
    // The bookmark's text changes: the reference follows.
    sh.SelectRange(target, 3, 3);
    sh.Insert('X');
    expect(refs(sh)[0]).toBe('TarXget');
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Content, name: 'missing' });
    expect(refs(sh)).toContain(aGetRefField_RefItemNotFound);
  });

  it('sets a reference mark and refers to it', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Alpha beta gamma');
    sel(sh, at(sh), 6, 10);
    expect(sh.SetRefMark('ref1')).toBe(true);
    expect(sh.SetRefMark('ref1')).toBe(false);
    end(sh);
    sh.Insert(' ');
    sh.InsertRefField({ subType: ReferencesSubtype.SetRefAttr, format: RefFieldFormat.Content, name: 'ref1' });
    sh.InsertRefField({ subType: ReferencesSubtype.SetRefAttr, format: RefFieldFormat.UpDown, name: 'ref1' });
    expect(refs(sh)).toEqual(['beta', 'above']);
    expect(sh.m_pDoc.getIDocumentMarkAccess().getBookmarks()).toEqual([]);
  });

  it('refers to captions by category and number, caption text and numbering', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Intro');
    sh.SplitNode();
    sh.InsertTable(1, 1, { heading: false, repeatHeading: false, borders: true });
    sh.InsertLabel('Table', 'Prices', ': ', false);
    const [seq] = GetSeqFields(sh.m_pDoc, 'Table');
    expect(seq!.f.seqNo).toBe(0);
    sh.SelectRange(sh.m_pDoc.GetNodes().FirstTextNode(), 5, 5);
    for (const format of [RefFieldFormat.CategoryAndNumber, RefFieldFormat.CaptionText, RefFieldFormat.Numbering, RefFieldFormat.Content])
      sh.InsertRefField({ subType: ReferencesSubtype.SequenceField, format, name: 'Table', seqNo: 0 });
    expect(refs(sh).slice(0, 4)).toEqual(['Table 1', 'Prices', '1', 'Table 1: Prices']);
  });

  it('refers to footnotes, headings and numbered paragraphs', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Note');
    sh.InsertFootnote();
    sh.Insert('Footnote text');
    sh.GotoFootnoteOrAnchor();
    const body = sh.m_pDoc.GetNodes().FirstTextNode();
    sh.SelectRange(body, body.Len(), body.Len());
    sh.SplitNode();
    sh.SetTextFormatColl('Heading 1');
    sh.Insert('Chapter One');
    sh.SplitNode();
    sh.SetTextFormatColl('Standard');
    sh.NumOrBulletOn(true);
    sh.Insert('First item');
    sh.SplitNode();
    sh.Insert('Second item');
    sh.SplitNode();
    sh.NumOrBulletOff();
    const [ftn] = GetFootnotes(sh.m_pDoc, false);
    const [heading] = GetOutlineNodes(sh.m_pDoc);
    const items = GetNumItems(sh.m_pDoc, sh.m_pRoot.m_aNums);
    expect(heading!.GetText()).toBe('Chapter One');
    expect(items.map((n) => n.GetText())).toEqual(['First item', 'Second item']);
    sh.InsertRefField({ subType: ReferencesSubtype.Footnote, format: RefFieldFormat.Content, name: ftn });
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Content }, { node: heading!, bHeading: true });
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Number }, { node: items[1]!, bHeading: false });
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Content }, { node: items[1]!, bHeading: false });
    expect(refs(sh).slice(-4)).toEqual(['1', 'Chapter One', '2', 'Second item']);
    // The cross-reference bookmarks are made once and are not listed as bookmarks.
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Content }, { node: heading!, bHeading: true });
    const access = sh.m_pDoc.getIDocumentMarkAccess();
    expect(access.getBookmarks()).toEqual([]);
    expect(access.getAllMarksCount()).toBe(2);
    // One undo step removes the field and the bookmark made with it.
    sh.Undo();
    expect(access.getAllMarksCount()).toBe(2);
  });

  it('makes reference number strings with and without superior levels', () => {
    const rule = new SwNumRule('Test');
    for (let l = 0; l < 2; l++) { const f = rule.Get(l).Clone(); f.SetNumberingType(4); f.SetListFormat('', '.', l); rule.Set(l, f); }
    expect(MakeRefNumString(rule, [2, 3], false, 0)).toBe('3');
    expect(MakeRefNumString(rule, [2, 3], true, 0)).toBe('2.3');
    expect(MakeRefNumString(rule, [2, 3], true, 1)).toBe('3');
  });

  it('keeps references through ODT', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Alpha');
    sel(sh, at(sh), 0, 5);
    sh.SetRefMark('mark');
    sh.SetBookmark('bm');
    end(sh);
    sh.SplitNode();
    sh.InsertTable(1, 1, { heading: false, repeatHeading: false, borders: true });
    sh.InsertLabel('Figure', 'Cat', ': ', false);
    const tbl = (() => { const ns = sh.m_pDoc.GetNodes(); for (let i = 0; i < ns.Count(); i++) if (ns.node(i).IsTableNode()) return ns.node(i) as SwTableNode; return null; })()!;
    const after = sh.m_pDoc.GetNodes().node(tbl.EndOfSectionNode().GetIndex() + 2) as SwTextNode;
    sh.SelectRange(after, after.Len(), after.Len());
    sh.SplitNode();
    sh.Insert('Note');
    sh.InsertFootnote();
    sh.Insert('x');
    sh.GotoFootnoteOrAnchor();
    end(sh);
    sh.InsertRefField({ subType: ReferencesSubtype.SetRefAttr, format: RefFieldFormat.Content, name: 'mark' });
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Page, name: 'bm' });
    sh.InsertRefField({ subType: ReferencesSubtype.SequenceField, format: RefFieldFormat.CategoryAndNumber, name: 'Figure', seqNo: 0 });
    sh.InsertRefField({ subType: ReferencesSubtype.Footnote, format: RefFieldFormat.Content, name: GetFootnotes(sh.m_pDoc, false)[0] });
    const before = refs(sh);
    expect(before.slice(-4)).toEqual(['Alpha', '1', 'Figure 1', '1']);
    const back = new SwWrtShell((await ImportODT(await ExportODT(sh.m_pDoc))).doc, mono);
    expect(refs(back)).toEqual(before);
    expect(back.m_pDoc.getIDocumentMarkAccess().getRefMarks().map((m) => m.GetName())).toEqual(['mark']);
  });

  it('writes and reads REF and PAGEREF in DOCX', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Alpha');
    sel(sh, at(sh), 0, 5);
    sh.SetBookmark('bm');
    end(sh);
    sh.Insert(' ');
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Content, name: 'bm' });
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Page, name: 'bm' });
    const before = refs(sh);
    expect(before[1]).toBe('1');
    const r = await ImportDOCX(await ExportDOCX(sh.m_pDoc));
    expect(r.lost).toEqual([]);
    expect(refs(new SwWrtShell(r.doc, mono))).toEqual(before);
  });
});
