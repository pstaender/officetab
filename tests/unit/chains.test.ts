// Linked text frames (SwFormatChain): Chainable, Chain and Unchain, the text flowing through the
// chain, and the chains in ODT (draw:chain-next-name) and DOCX (wps:linkedTxbx).
import { describe, expect, it } from 'vitest';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { HoriOrientation, SwChainRet, TextFlyFormat, VertOrientation, type SwFlyFrameFormat } from '../../src/lo/sw/inc/frmfmt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** Two frames side by side, 2000 wide and 1000 high: four lines fit in each. */
function twoFrames(): { doc: SwDoc; sh: SwWrtShell } {
  const doc = new SwDoc();
  const sh = new SwWrtShell(doc, mono);
  for (const [name, x] of [['Frame1', 0], ['Frame2', 4000]] as const) {
    const f: SwFlyFrameFormat = { ...TextFlyFormat(name, name, 2000, 1000), m_bAutoHeight: false, m_aBox: null,
      m_aHoriOrient: { m_eOrient: HoriOrientation.NONE, m_eRelation: 0, m_nPos: x }, m_aVertOrient: { m_eOrient: VertOrientation.NONE, m_eRelation: 0, m_nPos: 0 } };
    doc.MakeTextFly(sh.m_pCursor, f);
  }
  const sec = doc.GetNodes().FindFlySection('Frame1')!;
  (doc.GetNodes().node(sec.GetIndex() + 1) as SwTextNode).InsertText('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp qqqq rrrr', 0);
  sh.SelectFly('Frame1');
  return { doc, sh };
}
const texts = (sh: SwWrtShell, name: string) => {
  sh.m_pRoot.Layout();
  const fly = sh.m_pRoot.FindFly(name)!.fly;
  return fly.frames.flatMap((f) => f.lines.map((l) => f.node.GetText().slice(l.nStart, l.nStart + l.nLen).trim()));
};

describe('Chained frames', () => {
  it('lets the text continue in an empty frame of the same area, and nowhere else', () => {
    const { doc, sh } = twoFrames();
    expect(doc.Chainable('Frame1', 'Frame2')).toBe(SwChainRet.OK);
    expect(doc.Chainable('Frame2', 'Frame1')).toBe(SwChainRet.NOT_EMPTY);
    expect(doc.Chainable('Frame1', 'Frame1')).toBe(SwChainRet.SELF);
    expect(sh.Chain('Frame2')).toBe(SwChainRet.OK);
    expect(doc.Chainable('Frame1', 'Frame2')).toBe(SwChainRet.SOURCE_CHAINED);
    expect(sh.GetFlyFrameFormat('Frame2')!.m_aChain).toEqual({ m_sPrev: 'Frame1' });
  });

  it('flows the lines that do not fit into the next frame, and back on Unchain', () => {
    const { sh } = twoFrames();
    const all = texts(sh, 'Frame1');
    expect(all.length).toBeGreaterThan(3);
    sh.Chain('Frame2');
    const first = texts(sh, 'Frame1'), second = texts(sh, 'Frame2');
    // Four lines of 240 fit in 1000.
    expect(first).toEqual(all.slice(0, 4));
    expect(second).toEqual(all.slice(4));
    // The follow's text starts at its top.
    const f2 = sh.m_pRoot.FindFly('Frame2')!.fly;
    expect(f2.frames[0]!.nTop).toBe(f2.aFrame.Top());
    sh.Undo();
    expect(texts(sh, 'Frame2')).toEqual(['']);
    sh.Redo();
    sh.SelectFly('Frame1');
    sh.Unchain();
    expect(sh.GetFlyFrameFormat('Frame1')!.m_aChain).toBeUndefined();
    expect(texts(sh, 'Frame2')).toEqual(['']);
  });

  it('keeps the chain when a frame is renamed or deleted', () => {
    const { sh } = twoFrames();
    sh.Chain('Frame2');
    sh.SelectFly('Frame2');
    sh.SetFlyFrameAttr({ m_aName: 'Next' });
    expect(sh.GetFlyFrameFormat('Frame1')!.m_aChain).toEqual({ m_sNext: 'Next' });
    sh.SelectFly('Next');
    expect(sh.DelSelectedFly()).toBe(true);
    expect(sh.GetFlyFrameFormat('Frame1')!.m_aChain).toBeUndefined();
    sh.Undo();
    expect(sh.GetFlyFrameFormat('Frame1')!.m_aChain).toEqual({ m_sNext: 'Next' });
  });

  it('keeps chains in ODT and DOCX', async () => {
    const { doc, sh } = twoFrames();
    sh.Chain('Frame2');
    const odt = await ExportODT(doc);
    expect(new TextDecoder().decode((await readZip(odt)).get('content.xml'))).toContain('draw:chain-next-name="Frame2"');
    const back = (await ImportODT(odt)).doc;
    expect(back.FindFlyByName('Frame1')!.fmt!.m_aChain).toEqual({ m_sNext: 'Frame2' });
    expect(back.FindFlyByName('Frame2')!.fmt!.m_aChain).toEqual({ m_sPrev: 'Frame1' });
    const docx = await ExportDOCX(doc);
    const xml = new TextDecoder().decode((await readZip(docx)).get('word/document.xml'));
    expect(xml).toContain('<wps:txbx id="1">');
    expect(xml).toContain('<wps:linkedTxbx id="1" seq="1"/>');
    const d = (await ImportDOCX(docx)).doc;
    expect(d.FindFlyByName('Frame1')!.fmt!.m_aChain).toEqual({ m_sNext: 'Frame2' });
  });
});
