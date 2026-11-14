// Insert > Content from Document (SID_INSERTDOC): SwView::InsertMedium and SwReader::Read in insert mode.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import { MarkType } from '../../src/lo/sw/source/core/doc/docbm.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

const shell = (...paras: string[]) => {
  const sh = new SwWrtShell(new SwDoc(), mono);
  paras.forEach((p, i) => { if (i) sh.SplitNode(); sh.Insert(p); });
  return sh;
};
const body = (sh: SwWrtShell) => [...sh.m_pDoc.allText()].filter((n) => !n.FindFootnoteStartNode() && !n.FindFlyStartNode() && !n.FindTableNode()).map((n) => n.GetText());
const pt = (sh: SwWrtShell) => sh.m_pCursor.GetPoint();
/** The document as an importer reads it (through ODT, as Insert > Content from Document does). */
const read = async (sh: SwWrtShell) => (await ImportODT(await ExportODT(sh.m_pDoc))).doc;

describe('Insert > Content from Document', () => {
  it('joins the first paragraph to the text before the cursor and the text after it to the last', async () => {
    const sh = shell('Hello World');
    sh.SttDoc();
    for (let i = 0; i < 6; i++) sh.Right();
    sh.InsertMedium(await read(shell('One', 'Two', 'Three')));
    expect(body(sh)).toEqual(['Hello One', 'Two', 'ThreeWorld']);
    // The cursor is at the end of the inserted content.
    expect(pt(sh).GetNode().GetText()).toBe('ThreeWorld');
    expect(pt(sh).GetContentIndex()).toBe(5);
    // One undo step, with the styles it brought.
    sh.Undo();
    expect(body(sh)).toEqual(['Hello World']);
    sh.Redo();
    expect(body(sh)).toEqual(['Hello One', 'Two', 'ThreeWorld']);
  });

  it('inserts a single paragraph within the paragraph, and replaces a selection', async () => {
    const sh = shell('AxB');
    sh.SttDoc();
    sh.Right();
    sh.Right(true);
    sh.InsertMedium(await read(shell('inserted')));
    expect(body(sh)).toEqual(['AinsertedB']);
    expect(pt(sh).GetContentIndex()).toBe(9);
    sh.Undo();
    expect(body(sh)).toEqual(['AxB']);
  });

  it('gives an empty paragraph the style of the first inserted one, and the rest of the paragraph that of the last', async () => {
    const src = shell('Title', 'Text');
    src.SttDoc();
    src.SetTextFormatColl('Heading 1');
    const sh = shell('', 'After');
    sh.SttDoc();
    sh.InsertMedium(await read(src));
    expect(body(sh)).toEqual(['Title', 'Text', 'After']);
    const [first, second] = [...sh.m_pDoc.allText()];
    expect(first!.GetTextColl().GetName()).toBe('Heading 1');
    expect(second!.GetTextColl().GetName()).toBe('Standard');
  });

  it('adds the styles the document lacks and keeps its own', async () => {
    const src = shell('Styled');
    src.m_pDoc.MakeColl('Fancy', src.m_pDoc.FindTextFormatCollByName('Standard')!, { RES_CHRATR_FONTSIZE: 480 });
    src.m_pDoc.FindTextFormatCollByName('Heading 1')!.m_aSet.RES_CHRATR_FONTSIZE = 999;
    src.SetTextFormatColl('Fancy');
    const sh = shell('');
    const mine = sh.m_pDoc.FindTextFormatCollByName('Heading 1')!.m_aSet.RES_CHRATR_FONTSIZE;
    sh.InsertMedium(await read(src));
    const fancy = sh.m_pDoc.FindTextFormatCollByName('Fancy');
    expect(fancy?.m_aSet.RES_CHRATR_FONTSIZE).toBe(480);
    expect(sh.m_pDoc.GetNodes().FirstTextNode().GetTextColl()).toBe(fancy);
    expect(sh.m_pDoc.FindTextFormatCollByName('Heading 1')!.m_aSet.RES_CHRATR_FONTSIZE).toBe(mine);
    sh.Undo();
    expect(sh.m_pDoc.FindTextFormatCollByName('Fancy')).toBeUndefined();
  });

  it('copies footnotes, comments and bookmarks under ids and names of their own', async () => {
    const src = shell('Note');
    src.SttDoc();
    src.Right(true);
    src.SetBookmark('Mark');
    src.EndDoc();
    src.InsertPostIt('Ann');
    src.InsertFootnote();
    src.Insert('the footnote');
    const sh = shell('Mine');
    sh.SttDoc();
    sh.SetBookmark('Mark');
    sh.InsertPostIt('Me');
    sh.EndDoc();
    sh.InsertFootnote();
    sh.Insert('my footnote');
    sh.GotoFootnoteAnchor(pt(sh).GetNode().FindFootnoteStartNode()!.m_sFootnoteId);
    sh.EndDoc();
    sh.SplitNode();
    sh.InsertMedium(await read(src));
    const doc = sh.m_pDoc;
    const ftns = [...doc.allText()].flatMap((n) => n.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_FTN).map((h) => h.aAttrs.RES_TXTATR_FTN!.id));
    expect(new Set(ftns).size).toBe(2);
    expect(ftns.map((id) => doc.GetNodes().GoNext(doc.GetNodes().FindFootnoteSection(id)!.GetIndex())!.GetText()).sort()).toEqual(['my footnote', 'the footnote']);
    const ids = doc.GetAnnotations().map((a) => a.field.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const marks = doc.getIDocumentMarkAccess().getBookmarks();
    expect(marks.map((m) => m.GetName()).sort()).toEqual(['Mark', 'Mark Copy 1']);
    expect(body(sh).map((t) => t.replaceAll('\u0001', '#'))).toEqual(['#Mine#', 'Note##']);
    const copy = marks.find((m) => m.GetName() === 'Mark Copy 1')!;
    expect(copy.GetMarkStart().GetNode().GetText().startsWith('Note')).toBe(true);
    expect(copy.m_eType).toBe(MarkType.BOOKMARK);
    sh.Undo();
    expect(doc.getIDocumentMarkAccess().getBookmarks().map((m) => m.GetName())).toEqual(['Mark']);
    expect(doc.GetAnnotations()).toHaveLength(1);
  });

  it('inserts tables under a name of their own, keeping a paragraph after a table at the end', async () => {
    const src = shell('');
    src.InsertTable(2, 2);
    src.Insert('cell');
    const sh = shell('Before');
    sh.InsertTable(1, 1);
    sh.EndDoc();
    sh.InsertMedium(await read(src));
    const tables: string[] = [];
    const nodes = sh.m_pDoc.GetNodes();
    for (let i = 0; i < nodes.Count(); i++) if (nodes.node(i).IsTableNode()) tables.push((nodes.node(i) as SwTableNode).m_pTable.m_aAttrs.name);
    expect(tables).toHaveLength(2);
    expect(new Set(tables).size).toBe(2);
    expect([...sh.m_pDoc.allText()].some((n) => n.GetText() === 'cell')).toBe(true);
    // A paragraph follows the inserted table, and the cursor is in it.
    expect(nodes.node(pt(sh).GetNodeIndex() - 1).IsEndNode()).toBe(true);
  });

  it('copies text frames with their text under a new name', async () => {
    const src = shell('Anchor');
    const srcName = src.InsertTextFrame();
    src.Insert('frame text');
    const sh = shell('Here');
    const myName = sh.InsertTextFrame();
    expect(myName).toBe(srcName);
    sh.EndDoc();
    sh.InsertMedium(await read(src));
    const flys = sh.m_pDoc.GetFlyFormats();
    expect(flys).toHaveLength(2);
    const other = flys.find((f) => f.name !== myName)!;
    const sec = sh.m_pDoc.GetNodes().FindFlySection(other.fmt!.m_sContentId!)!;
    expect((sh.m_pDoc.GetNodes().node(sec.GetIndex() + 1) as SwTextNode).GetText()).toBe('frame text');
    sh.Undo();
    expect(sh.m_pDoc.GetFlyFormats()).toHaveLength(1);
    expect(sh.m_pDoc.GetNodes().FindFlySection(other.fmt!.m_sContentId!)).toBeNull();
  });
});
