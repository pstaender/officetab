import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { HoriOrientation, RndStdIds, WrapTextMode } from '../../src/lo/sw/inc/frmfmt.ts';
import { SwRect } from '../../src/lo/sw/inc/swrect.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i % 10}`).join(' ');

function withImage(wrap: WrapTextMode, hori: number = HoriOrientation.LEFT) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert(words(200));
  sh.SttDoc();
  sh.InsertGraphic(PNG, 'image/png', { width: 3000, height: 1000 });
  sh.SetFlyFrameAttr({ m_aSurround: { m_eSurround: wrap }, m_aHoriOrient: { m_eOrient: hori, m_eRelation: 0, m_nPos: 0 } });
  return sh;
}

describe('anchored graphics', () => {
  it('are anchored to the character by default and placed at the paragraph, not in the line', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('abc');
    const name = sh.InsertGraphic(PNG, 'image/png', { width: 2000, height: 1000 });
    expect(sh.GetAnchorId()).toBe(RndStdIds.FLY_AT_CHAR);
    const node = sh.m_pCursor.GetPoint().GetNode();
    expect(node.GetText()).toBe('abc');
    expect(node.m_aAnchoredFlys.map((f) => [f.fmt.m_aName, f.nContent])).toEqual([[name, 3]]);
    const page = sh.m_pRoot.pages[0]!;
    const fly = page.flys[0]!;
    // Centred on the paragraph area, at its top.
    expect(fly.aFrame.Left()).toBe(page.aPrt.Left() + (page.aPrt.Width() - 2000) / 2);
    expect(fly.aFrame.Top()).toBe(page.aPrt.Top());
  });

  it('let text run beside them, or below with no wrap', () => {
    const par = withImage(WrapTextMode.PARALLEL);
    const f = par.m_pRoot.pages[0]!.frames[0]!;
    const fly = par.m_pRoot.pages[0]!.flys[0]!;
    // Lines beside the image start right of it.
    expect(f.lines[0]!.nX).toBeGreaterThanOrEqual(fly.aFrame.Width());
    const below = f.lines.findIndex((l, i) => i > 0 && l.nX === 0);
    expect(below).toBeGreaterThan(1);

    const none = withImage(WrapTextMode.NONE);
    const nf = none.m_pRoot.pages[0]!.frames[0]!;
    expect(nf.lines[0]!.nLen).toBe(0); // an empty line down to the image's bottom
    expect(nf.lines[0]!.nRealHeight).toBeGreaterThanOrEqual(1000);
    expect(nf.lines[1]!.nX).toBe(0);
  });

  it('split lines on both sides with parallel wrap of a centred image', () => {
    const sh = withImage(WrapTextMode.PARALLEL, HoriOrientation.CENTER);
    const line = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!;
    const gap = line.portions.find((p) => p.kind === 'fly' && !p.pFly);
    expect(gap).toBeDefined();
    expect(gap!.nWidth).toBeGreaterThanOrEqual(3000);
  });

  it('follow the paragraph when moved, re-anchor and undo as one step', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('first');
    sh.SplitNode();
    sh.Insert('second');
    sh.SttDoc();
    const name = sh.InsertGraphic(PNG, 'image/png', { width: 1000, height: 500 });
    const r = sh.GetFlyRect()!;
    const page = sh.m_pRoot.pages[0]!;
    // Move it down by 4 cm: it now belongs to the second paragraph's area.
    expect(sh.MoveFly(r.Left() + 567, r.Top() + 2268)).toBe(true);
    const moved = sh.GetFlyRect()!;
    expect(moved.Left()).toBe(r.Left() + 567);
    expect(moved.Top()).toBe(r.Top() + 2268);
    expect(sh.GetFlyFrameFormat()!.m_aHoriOrient.m_eOrient).toBe(HoriOrientation.NONE);
    sh.ChgAnchor(RndStdIds.FLY_AT_PAGE);
    expect(sh.m_pDoc.m_aPageFlys.map((f) => f.m_aName)).toEqual([name]);
    expect(sh.GetFlyRect()!.Top()).toBe(moved.Top());
    expect(sh.GetFlyFrameFormat()!.m_aAnchor.m_nPageNumber).toBe(page.nIndex + 1);
    sh.ChgAnchor(RndStdIds.FLY_AS_CHAR);
    expect(sh.m_pDoc.m_aPageFlys).toEqual([]);
    expect([...sh.m_pDoc.GetNodes().FirstTextNode().GetText()].filter((c) => c === '\u0001').length + [...sh.m_pDoc.GetNodes().LastTextNode().GetText()].filter((c) => c === '\u0001').length).toBe(1);
    sh.Undo(); sh.Undo();
    expect(sh.GetFlyRect()!.Top()).toBe(moved.Top());
    sh.SetFlyRect(new SwRect(moved.Left() - 100, moved.Top(), 1100, 600));
    expect(sh.GetFlyRect()!.Width()).toBe(1100);
    expect(sh.GetFlyRect()!.Left()).toBe(moved.Left() - 100);
    sh.Undo();
    expect(sh.GetFlyRect()!.Width()).toBe(1000);
    expect(sh.DelSelectedFly()).toBe(true);
    expect(sh.m_pDoc.GetFlyFormats()).toEqual([]);
    sh.Undo();
    expect(sh.m_pDoc.GetFlyFormats().map((f) => f.name)).toEqual([name]);
  });

  it('go with the text that is deleted around their character anchor', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('abcdef');
    sh.Left(); sh.Left(); sh.Left();
    sh.InsertGraphic(PNG, 'image/png', { width: 1000, height: 500 });
    sh.SelectFly(null);
    let node = sh.m_pCursor.GetPoint().GetNode();
    sh.SttDoc(); sh.Insert('X');
    expect(node.m_aAnchoredFlys[0]!.nContent).toBe(4);
    sh.SplitNode();
    expect(node.m_aAnchoredFlys).toEqual([]);
    expect(sh.m_pCursor.GetPoint().GetNode().m_aAnchoredFlys[0]!.nContent).toBe(3);
    sh.Undo();
    node = sh.m_pDoc.GetNodes().FirstTextNode();
    expect(node.m_aAnchoredFlys[0]!.nContent).toBe(4);
    sh.SelectRange(node, 2, 6);
    sh.DelSelection();
    expect(sh.m_pDoc.GetFlyFormats()).toEqual([]);
    sh.Undo();
    expect(sh.m_pDoc.GetFlyFormats().length).toBe(1);
  });
});

import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';

describe('anchored frames in ODT', () => {
  it('keep their anchor, position, wrap and page through a round trip', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('hello world');
    const a = sh.InsertGraphic(PNG, 'image/png', { width: 2000, height: 1000 });
    sh.SetFlyFrameAttr({ m_aSurround: { m_eSurround: WrapTextMode.LEFT }, m_nLeftSpace: 113, m_aHoriOrient: { m_eOrient: HoriOrientation.RIGHT, m_eRelation: 7, m_nPos: 0 } });
    sh.SelectFly(null);
    const b = sh.InsertGraphic(PNG, 'image/png', { width: 1000, height: 1000 });
    sh.ChgAnchor(RndStdIds.FLY_AT_PAGE);
    sh.SetFlyFrameAttr({ m_aSurround: { m_eSurround: WrapTextMode.THROUGH }, m_bOpaque: false });
    const bytes = await ExportODT(sh.m_pDoc);
    const content = new TextDecoder().decode((await readZip(bytes)).get('content.xml'));
    expect(content).toContain('text:anchor-type="char"');
    expect(content).toContain('text:anchor-type="page" text:anchor-page-number="1"');
    expect(content).toContain('style:run-through="background"');
    const { doc, lost } = await ImportODT(bytes);
    expect(lost).toEqual([]);
    const flys = doc.GetFlyFormats();
    expect(flys.map((f) => f.name).sort()).toEqual([a, b].sort());
    const fa = flys.find((f) => f.name === a)!;
    expect(fa.nContent).toBe(11);
    expect(fa.fmt!.m_aSurround.m_eSurround).toBe(WrapTextMode.LEFT);
    expect(fa.fmt!.m_nLeftSpace).toBe(113);
    expect(fa.fmt!.m_aHoriOrient).toEqual({ m_eOrient: HoriOrientation.RIGHT, m_eRelation: 7, m_nPos: 0 });
    const fb = flys.find((f) => f.name === b)!;
    expect(fb.node).toBeUndefined();
    expect(fb.fmt!.m_bOpaque).toBe(false);
    expect(fb.fmt!.m_aHoriOrient.m_nPos).toBe(sh.GetFlyFrameFormat(b)!.m_aHoriOrient.m_nPos);
  });
});

describe('text frames', () => {
  it('are inserted with the cursor inside, grow with their text and undo as a whole', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert(words(60));
    const name = sh.InsertTextFrame();
    expect(sh.GetCurrFlyName()).toBe(name);
    sh.Insert('inside the frame');
    const fly = sh.m_pRoot.FindFly(name)!.fly;
    expect(fly.frames[0]!.node.GetText()).toBe('inside the frame');
    const h1 = fly.aFrame.Height();
    sh.SplitNode(); sh.Insert('more'); sh.SplitNode(); sh.Insert('and more');
    expect(sh.m_pRoot.FindFly(name)!.fly.aFrame.Height()).toBeGreaterThan(h1);
    // Body text goes around it.
    const body = sh.m_pRoot.pages[0]!.frames.find((f) => !f.pArea)!;
    expect(body.lines.some((l) => l.portions.some((p) => p.kind === 'fly' && !p.pFly))).toBe(true);
    sh.SelectFly(name);
    expect(sh.DelSelectedFly()).toBe(true);
    expect(sh.m_pDoc.GetNodes().FindFlySection(name)).toBeNull();
    expect(sh.m_pCursor.GetPoint().GetNode().FindFlyStartNode()).toBeNull();
    sh.Undo();
    expect(sh.m_pDoc.GetNodes().FindFlySection(name)).not.toBeNull();
    while (sh.m_pDoc.m_aUndo.length) sh.Undo();
    expect(sh.m_pDoc.GetFlyFormats()).toEqual([]);
    expect(sh.m_pDoc.GetNodes().FindFlySection(name)).toBeNull();
  });
});

describe('Format > Wrap > Wrap First Paragraph (SwFormatSurround::IsAnchorOnly)', () => {
  it('lets only the anchor paragraph flow beside the object', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('w1 w2'); sh.SplitNode(); sh.Insert(words(60));
    sh.SttDoc();
    const name = sh.InsertGraphic(PNG, 'image/png', { width: 3000, height: 3000 });
    sh.SelectFly(name);
    sh.ChgAnchor(RndStdIds.FLY_AT_PARA);
    sh.SetFlyFrameAttr({ m_aSurround: { m_eSurround: WrapTextMode.PARALLEL }, m_aHoriOrient: { m_eOrient: HoriOrientation.LEFT, m_eRelation: 0, m_nPos: 0 } });
    // The top of the second paragraph's first line.
    const second = () => { const n = sh.m_pRoot.pages[0]!.frames[1]!.node; return sh.m_pRoot.GetCharRect(n, 0)!.Top(); };
    // Wrapping: the second paragraph starts beside the object.
    expect(second()).toBeLessThan(sh.GetFlyRect()!.Bottom());
    sh.SetFlyFrameAttr({ m_aSurround: { m_eSurround: WrapTextMode.PARALLEL, m_bAnchorOnly: true } });
    expect(second()).toBeGreaterThanOrEqual(sh.GetFlyRect()!.Bottom());
    // The first paragraph still flows beside it.
    const first = sh.m_pRoot.pages[0]!.frames[0]!;
    expect(first.nLeft + first.lines[0]!.nX).toBeGreaterThanOrEqual(sh.GetFlyRect()!.Right());
  });
});
