import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const paras = (sh: SwWrtShell): SwTextNode[] => {
  const out: SwTextNode[] = [];
  const ns = sh.m_pDoc.GetNodes();
  for (let n: SwTextNode | null = ns.FirstTextNode(); n; n = ns.GoNext(n.GetIndex())) out.push(n);
  return out;
};

function report() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('Intro');
  sh.SetTextFormatColl('Heading 1');
  sh.SplitNode();
  for (let i = 0; i < 70; i++) { sh.Insert(`text ${i}`); sh.SplitNode(); }
  sh.Insert('Details');
  sh.SetTextFormatColl('Heading 2');
  sh.SttDoc();
  return sh;
}

describe('table of contents', () => {
  it('lists headings with page numbers after the index is in place, as one undo step', () => {
    const sh = report();
    const id = sh.InsertTableOf();
    const toc = sh.m_pDoc.GetTocParas(id);
    expect(toc.map((n) => n.GetText())).toEqual(['Table of Contents', 'Intro\t1', 'Details\t2']);
    expect(toc.map((n) => n.GetTextColl().GetName())).toEqual(['Contents Heading', 'Contents 1', 'Contents 2']);
    // The entry's dot leader runs to the right margin.
    expect(toc[1]!.GetAttr('RES_PARATR_TABSTOP')[0]).toMatchObject({ adjust: 'right', fill: '.' });
    sh.Undo();
    expect(sh.m_pDoc.GetTocParas(id)).toEqual([]);
    expect(paras(sh)[0]!.GetText()).toBe('Intro');
  });

  it('updates after edits and round-trips through ODT', async () => {
    const sh = report();
    const id = sh.InsertTableOf('Contents', 1);
    expect(sh.m_pDoc.GetTocParas(id).map((n) => n.GetText())).toEqual(['Contents', 'Intro\t1']);
    const intro = paras(sh).find((n) => n.GetText() === 'Intro')!;
    intro.InsertText('The ', 0);
    sh.m_pDoc.Changed();
    sh.UpdateTableOf(id);
    // Update keeps the levels the index was made with: Details is a level 2 heading.
    expect(sh.m_pDoc.GetTocParas(id).map((n) => n.GetText())).toEqual(['Contents', 'The Intro\t1']);
    const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(lost).toEqual([]);
    expect(doc.GetTocParas(id).map((n) => n.GetText())).toEqual(['Contents', 'The Intro\t1']);
    expect(doc.m_aTocSettings.get(id)).toEqual({ title: 'Contents', levels: 1 });
  });
});
