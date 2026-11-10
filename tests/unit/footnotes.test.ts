import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const ftnTexts = (sh: SwWrtShell, page = 0) => sh.m_pRoot.pages[page]!.frames.filter((f) => f.pArea === 'footnote').map((f) => f.node.GetText());

describe('footnotes', () => {
  it('inserts an anchor and a footnote, numbers them in document order, and undoes as one step', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Second claim');
    sh.InsertFootnote();
    sh.Insert('Note B');
    sh.GotoFootnoteOrAnchor();
    sh.SttDoc();
    sh.Insert('First claim. ');
    sh.InsertFootnote();
    sh.Insert('Note A');
    expect(ftnTexts(sh)).toEqual(['Note A', 'Note B']);
    const body = sh.m_pDoc.GetNodes().FirstTextNode();
    const anchors = sh.m_pRoot.pages[0]!.frames.find((f) => f.node === body)!.lines[0]!.portions.filter((p) => p.kind === 'field');
    expect(anchors.map((p) => p.aExpand)).toEqual(['1', '2']);
    // The footnote's first paragraph starts with its number, text at the 6 mm indent.
    const note = sh.m_pRoot.pages[0]!.frames.find((f) => f.pArea === 'footnote')!;
    expect(note.lines[0]!.portions[0]).toMatchObject({ kind: 'number', aExpand: '1' });
    expect(note.lines[0]!.portions[1]!.nX).toBe(340);
    sh.Undo(); sh.Undo();
    expect(ftnTexts(sh)).toEqual(['Note B']);
    expect(body.GetText()).toBe('First claim. Second claim\u0001');
  });

  it('puts the footnote area above the footer with a separator, and clicks there enter the footnote', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    sh.InsertFootnote();
    sh.Insert('the note');
    const page = sh.m_pRoot.pages[0]!;
    expect(page.aFootnote!.Top() + page.aFootnote!.Height()).toBe(page.aPrt.Top() + page.aPrt.Height());
    expect(page.aFootnoteSep!.Width()).toBe(Math.round(page.aPrt.Width() / 4));
    sh.SetCursor(new Point(page.aPrt.Left() + 10, page.aPrt.Top() + 10));
    expect(sh.IsInHeaderFooter()).toBe(false);
    sh.SetCursor(new Point(page.aPrt.Left() + 600, page.aFootnote!.Top() + page.aFootnote!.Height() - 20));
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('the note');
  });

  it('moves a line to the next page when its footnote does not fit', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    for (let i = 0; i < 61; i++) { if (i) sh.SplitNode(); sh.Insert(`line ${i}`); }
    const lastOnFirst = () => sh.m_pRoot.pages[0]!.frames.filter((f) => !f.pArea).at(-1)!.node.GetText();
    const before = lastOnFirst();
    // Anchor a tall footnote in the last line of page 1.
    const n = sh.m_pRoot.pages[0]!.frames.filter((f) => !f.pArea).at(-1)!.node;
    sh.SelectRange(n, n.Len(), n.Len());
    sh.InsertFootnote();
    for (let i = 0; i < 5; i++) { if (i) sh.SplitNode(); sh.Insert('note line'); }
    expect(lastOnFirst()).not.toBe(before);
    const p2 = sh.m_pRoot.pages[1]!;
    expect(p2.frames.filter((f) => f.pArea === 'footnote')).toHaveLength(5);
  });

  it('round-trips through ODT as text:note', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Body');
    sh.InsertFootnote();
    sh.Insert('Footnote text');
    sh.SplitNode();
    sh.Insert('second paragraph');
    const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(lost).toEqual([]);
    const sh2 = new SwWrtShell(doc, mono);
    expect(ftnTexts(sh2)).toEqual(['Footnote text', 'second paragraph']);
    expect(doc.GetNodes().FirstTextNode().GetText()).toBe('Body\u0001');
  });
});
