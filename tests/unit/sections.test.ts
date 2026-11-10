import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { DEF_GUTTER_WIDTH } from '../../src/lo/sw/inc/fmtclds.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const cols = (n: number, balanced = true, line = false) => ({ m_nCount: n, m_nGutterWidth: DEF_GUTTER_WIDTH, m_bLine: line, m_bBalanced: balanced });

function paras(sh: SwWrtShell, n: number) {
  for (let i = 0; i < n; i++) { if (i) sh.SplitNode(); sh.Insert(`Paragraph ${i + 1}`); }
}

describe('columns', () => {
  it('flow the page text through page columns before the next page', () => {
    const doc = new SwDoc();
    doc.m_aPageDesc.m_aCol = cols(2, true, true);
    const sh = new SwWrtShell(doc, mono);
    paras(sh, 120);
    const page = sh.m_pRoot.pages[0]!;
    const lefts = [...new Set(page.frames.map((f) => f.nLeft))];
    expect(lefts.length).toBe(2);
    const w = Math.floor((doc.m_aPageDesc.PrintWidth() - DEF_GUTTER_WIDTH) / 2);
    expect(lefts[1]! - lefts[0]!).toBe(w + DEF_GUTTER_WIDTH);
    expect(page.frames.every((f) => f.nWidth === w)).toBe(true);
    // 2 columns hold about twice the lines of one before the next page starts.
    const perCol = page.frames.filter((f) => f.nLeft === lefts[0]).length;
    expect(page.frames.length).toBe(perCol * 2);
    expect(sh.m_pRoot.pages.length).toBe(Math.ceil(120 / (perCol * 2)));
    expect(page.colLines.length).toBe(1);
  });

  it('balance a section with columns and continue below it', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    paras(sh, 2);
    sh.SplitNode();
    paras(sh, 9);
    sh.SplitNode(); sh.Insert('After');
    // Paragraphs 1 to 9 of the second run go into a 3-column section.
    const nodes = sh.m_pDoc.GetNodes();
    const all: ReturnType<typeof nodes.FirstTextNode>[] = [];
    for (let n: ReturnType<typeof nodes.GoNext> = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) all.push(n);
    sh.SelectRange(all[2]!, 0, 0); sh.m_pCursor.GetPoint().Assign(all[10]!, 3);
    const sec = sh.m_pDoc.InsertSwSection(sh.m_pCursor, { m_sSectionName: 'S', m_bHidden: false, m_bProtectFlag: false, m_aCol: cols(3) })!;
    expect(sec).not.toBeNull();
    expect(all[2]!.FindSectionNode()).toBe(sec);
    expect(all[11]!.FindSectionNode()).toBeNull();
    const page = sh.m_pRoot.pages[0]!;
    const inSec = page.frames.filter((f) => f.node.FindSectionNode() === sec);
    const byCol = new Map<number, number>();
    for (const f of inSec) byCol.set(f.nLeft, (byCol.get(f.nLeft) ?? 0) + 1);
    expect([...byCol.values()]).toEqual([3, 3, 3]);
    const after = page.frames.find((f) => f.node.GetText() === 'After')!;
    const secBottom = Math.max(...inSec.map((f) => f.nTop + f.nHeight));
    expect(after.nTop).toBeGreaterThanOrEqual(secBottom);
    expect(after.nTop - secBottom).toBeLessThan(500);
    // Hidden sections take no space; undo and removal keep the text.
    sh.m_pDoc.UpdateSection(sh.m_pCursor, sec, { ...sec.m_pSection, m_bHidden: true });
    expect(sh.m_pRoot.pages[0]!.frames.some((f) => f.node.FindSectionNode() === sec)).toBe(false);
    sh.Undo();
    expect(sh.m_pDoc.GetSections()[0]!.m_pSection.m_bHidden).toBe(false);
    const s2 = sh.m_pDoc.GetSections()[0]!;
    sh.m_pDoc.DelSectionFormat(sh.m_pCursor, s2);
    expect(sh.m_pDoc.GetSections()).toEqual([]);
    expect(nodes.FirstTextNode().GetText()).toBe('Paragraph 1');
    sh.Undo();
    expect(sh.m_pDoc.GetSections().length).toBe(1);
  });

  it('insert a section with an empty paragraph at the cursor and break columns', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('abcdef');
    sh.Left(); sh.Left(); sh.Left();
    const sec = sh.m_pDoc.InsertSwSection(sh.m_pCursor, { m_sSectionName: 'S', m_bHidden: false, m_bProtectFlag: false, m_aCol: cols(2, false) })!;
    const nodes = sh.m_pDoc.GetNodes();
    expect(sh.m_pCursor.GetPoint().GetNode().FindSectionNode()).toBe(sec);
    expect(nodes.FirstTextNode().GetText()).toBe('abc');
    expect(nodes.LastTextNode().GetText()).toBe('def');
    sh.Insert('one');
    sh.SplitNode();
    sh.Insert('two');
    sh.SetParaAttr({ RES_BREAK: 'column-before' });
    const page = sh.m_pRoot.pages[0]!;
    const one = page.frames.find((f) => f.node.GetText() === 'one')!, two = page.frames.find((f) => f.node.GetText() === 'two')!;
    expect(two.nLeft).toBeGreaterThan(one.nLeft);
    expect(two.nTop).toBe(one.nTop);
  });
});

import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';

describe('sections and columns in ODT', () => {
  it('round-trip', async () => {
    const doc = new SwDoc();
    doc.m_aPageDesc.m_aCol = cols(3, true, true);
    const sh = new SwWrtShell(doc, mono);
    sh.Insert('before');
    sh.SplitNode();
    sh.m_pDoc.InsertSwSection(sh.m_pCursor, { m_sSectionName: 'Box', m_bHidden: true, m_bProtectFlag: true, m_aCol: cols(2, false), m_aBackground: '#eeeeee' });
    sh.Insert('inside');
    const back = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(back.lost).toEqual([]);
    expect(back.doc.m_aPageDesc.m_aCol).toEqual(cols(3, true, true));
    const secs = back.doc.GetSections();
    expect(secs.map((x) => x.m_pSection)).toEqual([{ m_sSectionName: 'Box', m_bHidden: true, m_bProtectFlag: true, m_aCol: cols(2, false), m_aBackground: '#eeeeee' }]);
    expect(back.doc.GetNodes().GoNext(secs[0]!.GetIndex())!.GetText()).toBe('inside');
  });
});
