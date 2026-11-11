// Bookmarks (MarkManager): positions that follow edits, undo, links into the document
// (SwView::JumpToSwMark), ODT and DOCX, and the index's links to its headings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { MarkType } from '../../src/lo/sw/source/core/doc/docbm.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

function twoParas(): SwWrtShell {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('First paragraph');
  sh.SplitNode();
  sh.Insert('Second one');
  return sh;
}
const where = (sh: SwWrtShell, name: string) => {
  const m = sh.getIDocumentMarkAccess().findMark(name)!;
  return [m.GetMarkStart().GetNode().GetText(), m.GetMarkStart().GetContentIndex(), m.GetMarkEnd().GetContentIndex()];
};

describe('Bookmarks', () => {
  it('follow the text they are in, and undo and redo', () => {
    const sh = twoParas();
    sh.SttDoc();
    for (let i = 0; i < 6; i++) sh.Right(true); // "First "
    sh.SetBookmark('start');
    expect(where(sh, 'start')).toEqual(['First paragraph', 0, 6]);
    sh.SttDoc();
    sh.Insert('The ');
    expect(where(sh, 'start')).toEqual(['The First paragraph', 4, 10]);
    sh.Undo(); sh.Undo();
    expect(sh.getIDocumentMarkAccess().findMark('start')).toBeUndefined();
    sh.Redo();
    expect(where(sh, 'start')).toEqual(['First paragraph', 0, 6]);
    // A name in use gets " Copy N" (STR_MARK_COPY).
    expect(sh.SetBookmark('start').GetName()).toBe('start Copy 1');
  });

  it('are where a "#name" link jumps, and rename and delete with undo', () => {
    const sh = twoParas();
    sh.SetBookmark('end');
    sh.SttDoc();
    expect(sh.JumpToSwMark('end')).toBe(true);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('Second one');
    expect(sh.JumpToSwMark('nowhere')).toBe(false);
    expect(sh.RenameBookmark('end', 'finish')).toBe(true);
    expect(sh.DeleteBookmark('finish')).toBe(true);
    expect(sh.getIDocumentMarkAccess().getBookmarksCount()).toBe(0);
    sh.Undo();
    expect(sh.getIDocumentMarkAccess().findMark('finish')).toBeDefined();
    sh.Undo();
    expect(sh.getIDocumentMarkAccess().findMark('end')).toBeDefined();
    // "name|outline" jumps to a heading.
    sh.SttDoc();
    sh.SetTextFormatColl('Heading 1');
    sh.EndDoc();
    expect(sh.JumpToSwMark('First paragraph|outline')).toBe(true);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('First paragraph');
  });

  it('round-trip through ODT and DOCX', async () => {
    const sh = twoParas();
    sh.SttDoc();
    for (let i = 0; i < 5; i++) sh.Right(true);
    sh.SetBookmark('range one');
    sh.EndDoc();
    sh.SetBookmark('point');
    const odt = await ImportODT(await ExportODT(sh.m_pDoc));
    const o = new SwWrtShell(odt.doc, mono);
    expect(where(o, 'range one')).toEqual(['First paragraph', 0, 5]);
    expect(o.getIDocumentMarkAccess().findMark('point')!.IsExpanded()).toBe(false);
    const docx = await ImportDOCX(await ExportDOCX(sh.m_pDoc));
    const d = new SwWrtShell(docx.doc, mono);
    // Word's bookmark names have no spaces (MSWordExportBase::BookmarkToWord).
    expect(where(d, 'range_one')).toEqual(['First paragraph', 0, 5]);
    expect(d.getIDocumentMarkAccess().findMark('point')).toBeDefined();
  });
});

describe('Index links', () => {
  it('link each entry of a new index to its heading, in the Index Link style', () => {
    const sh = twoParas();
    sh.SetTextFormatColl('Heading 1');
    sh.SttDoc();
    const id = sh.InsertTableOf('Contents', 1);
    const entry = sh.m_pDoc.GetTocParas(id)[1]!;
    const link = entry.m_aHints.find((h) => h.aAttrs.RES_TXTATR_INETFMT)!.aAttrs;
    expect(link.RES_TXTATR_INETFMT_CHARFMT?.GetName()).toBe('Index Link');
    const mark = sh.getIDocumentMarkAccess().findMark(link.RES_TXTATR_INETFMT!.slice(1))!;
    expect(mark.m_eType).toBe(MarkType.CROSSREF_HEADING_BOOKMARK);
    expect(mark.GetName()).toMatch(/^__RefHeading___Toc\d+_\d+$/);
    expect(sh.JumpToSwMark(link.RES_TXTATR_INETFMT!.slice(1))).toBe(true);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('Second one');
  });

  it('read a Word index as an index whose links jump to the headings', async () => {
    const { doc } = await ImportDOCX(readFileSync('specs/writer/math.docx'));
    const sh = new SwWrtShell(doc, mono);
    const [id] = [...doc.m_aTocSettings.keys()];
    const toc = doc.GetTocParas(id!);
    expect(toc[0]!.GetText()).toBe('Purpose of this resource\t3');
    expect(doc.m_aTocSettings.get(id!)!.levels).toBe(3);
    // Word's Hyperlink character style does not apply in an index (DomainMapper, rStyle).
    const h = toc[0]!.m_aHints.find((x) => x.aAttrs.RES_TXTATR_INETFMT)!;
    expect(h.aAttrs.RES_TXTATR_INETFMT).toBe('#_Toc409704176');
    expect(h.aAttrs.RES_TXTATR_INETFMT_CHARFMT?.GetName()).toBe('Index Link');
    expect(h.aAttrs.RES_CHRATR_COLOR).toBeUndefined();
    expect(sh.JumpToSwMark('_Toc409704176')).toBe(true);
    const heading = sh.m_pCursor.GetPoint().GetNode();
    expect(heading.GetText()).toBe('Purpose of this resource');
    // The page break of the paragraph before moves to the heading, without its upper spacing.
    expect(heading.GetAttr('RES_BREAK')).toBe('page-before');
    expect(heading.GetAttr('RES_UL_SPACE').upper).toBe(0);
  });
});
