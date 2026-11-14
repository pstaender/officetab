// The incremental layout (SwRootFrame's checkpoints): after each change the pages must be exactly
// those a layout of the whole document makes, and a change should lay out only a few pages.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwRootFrame, type SwPageFrame } from '../../src/lo/sw/source/core/layout/pagechg.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (f: FontDesc, t: string) => (t.length * f.size) / 2, GetFontMetric: (f) => ({ ascent: f.size * 0.8, descent: f.size * 0.2 }) };

/** Everything laid out on the pages, comparable between two layouts of the same document. */
function pagesOf(pages: SwPageFrame[]): unknown[] {
  return pages.map((p) => ({
    i: p.nIndex, virt: p.nVirtNum, desc: p.pDesc.m_aName, frame: [p.aFrame.Left(), p.aFrame.Top(), p.aFrame.Width(), p.aFrame.Height()],
    ftn: p.aFootnote ? [p.aFootnote.Top(), p.aFootnote.Height()] : null,
    frames: p.frames.map((f) => [f.node.GetIndex(), f.pArea ?? '', f.nLeft, f.nTop, f.nHeight, f.bMaster, f.bHasFollow, f.lines.map((l) => `${l.nStart}+${l.nLen}`).join(' ')]),
    tabs: p.tabs.length, flys: p.flys.map((f) => f.fmt.m_aName),
  }));
}
const fullLayout = (sh: SwWrtShell) => { const r = new SwRootFrame(sh.m_pDoc, mono); r.Layout(); return pagesOf(r.pages); };

/** A deterministic random number source. */
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }

/** A document of many pages: headings (kept with the next paragraph), lists, footnotes, a table, a page break. */
function longDoc(): SwWrtShell {
  const sh = new SwWrtShell(new SwDoc(), mono);
  const words = 'the quick brown fox jumps over the lazy dog and runs far away into the woods'.split(' ');
  for (let i = 0; i < 260; i++) {
    if (i % 25 === 0) { sh.Insert(`Chapter ${i / 25}`); sh.SetTextFormatColl('Heading 1'); sh.SplitNode(); }
    sh.Insert(Array.from({ length: 10 + (i * 7) % 40 }, (_, k) => words[(i + k) % words.length]).join(' '));
    if (i % 31 === 5) { sh.InsertFootnote(); sh.Insert(`note ${i}`); sh.GotoFootnoteOrAnchor(); }
    if (i % 40 === 12) sh.NumOrBulletOn(true);
    if (i % 40 === 16) sh.NumOrBulletOff();
    if (i === 100) sh.InsertField('PageNumber');
    sh.SplitNode();
    if (i === 150) { sh.InsertTable(3, 2); sh.EndDoc(); }
    if (i === 200) sh.InsertPageBreak(null);
  }
  return sh;
}

const paras = (sh: SwWrtShell): SwTextNode[] => [...sh.m_pDoc.allText()].filter((n) => n.GetIndex() >= sh.m_pDoc.GetNodes().BodyStart() && !n.FindTableNode());

describe('incremental layout', () => {
  it.each([7, 11, 23, 42, 99])('lays out the same pages as the whole document after each change (seed %i)', (seed) => {
    const sh = longDoc();
    expect(sh.GetPageCnt()).toBeGreaterThan(10);
    const random = rng(seed);
    let resumed = 0, converged = 0;
    for (let step = 0; step < 100; step++) {
      const ps = paras(sh);
      const n = ps[Math.floor(random() * ps.length)]!;
      sh.GotoTextPos(n, Math.floor(random() * (n.Len() + 1)));
      const op = Math.floor(random() * 12);
      if (op === 0) sh.Insert('some more words to make the line wrap differently ');
      else if (op === 1) sh.SplitNode();
      else if (op === 2) { for (let k = 0; k < 30; k++) sh.DelLeft(); }
      else if (op === 3) sh.DelRight();
      else if (op === 4) { sh.InsertFootnote(); sh.Insert('a footnote with some text in it'); sh.GotoFootnoteOrAnchor(); }
      else if (op === 5) sh.NumOrBulletOn(random() < 0.5);
      else if (op === 6) sh.SetParaAttr({ RES_KEEP: random() < 0.5 });
      else if (op === 7) { sh.GotoTextPos(n, 0); sh.DelLeft(); }
      else if (op === 8) { if (random() < 0.3) sh.InsertPageBreak(null); else sh.SetTextFormatColl(random() < 0.5 ? 'Heading 2' : 'Text Body'); }
      else if (op === 9) { sh.InsertTable(2, 2); sh.Insert('cell text that is long enough to wrap in its narrow cell'); }
      else if (op === 10) { if (random() < 0.5) sh.Undo(); else sh.Redo(); }
      else sh.Insert('x');
      const last = sh.m_pRoot.m_aLastPass;
      if (last.resumedAt > 0) resumed++;
      if (last.convergedAt >= 0) converged++;
      expect(pagesOf(sh.m_pRoot.pages), `step ${step}, op ${op}`).toEqual(fullLayout(sh));
    }
    // Most changes were laid out from a page near them, and stopped soon after.
    expect(resumed).toBeGreaterThan(30);
    expect(converged).toBeGreaterThan(30);
  });

  it('typing near the end lays out only the last pages', () => {
    const sh = longDoc();
    const pages = sh.GetPageCnt();
    sh.EndDoc();
    sh.Insert('a');
    expect(sh.m_pRoot.m_aLastPass.resumedAt).toBeGreaterThan(pages - 4);
    sh.SttDoc();
    sh.Insert('b');
    // At the start: a page or two, then the pages as before.
    expect(sh.m_pRoot.m_aLastPass.convergedAt).toBeGreaterThanOrEqual(0);
    expect(sh.m_pRoot.m_aLastPass.convergedAt).toBeLessThan(4);
    expect(pagesOf(sh.m_pRoot.pages)).toEqual(fullLayout(sh));
  });

  it('undo, styles and settings lay out the whole document', () => {
    const sh = longDoc();
    sh.EndDoc();
    sh.Insert('a');
    sh.Undo();
    expect(sh.m_pRoot.m_aLastPass.resumedAt).toBe(0);
    expect(pagesOf(sh.m_pRoot.pages)).toEqual(fullLayout(sh));
    sh.m_pRoot.Layout();
    expect(sh.m_pRoot.m_aLastPass.resumedAt).toBe(0);
  });
});
