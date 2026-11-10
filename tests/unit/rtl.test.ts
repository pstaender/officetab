import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const visual = (sh: SwWrtShell) => {
  const n = sh.m_pCursor.GetPoint().GetNode();
  const line = sh.m_pRoot.pages[0]!.frames.find((f) => f.node === n)!.lines[0]!;
  return { line, order: line.portions.map((p) => n.GetText().slice(p.nStart, p.nStart + p.nLen)) };
};

describe('right-to-left text', () => {
  it('puts mixed runs in visual order and the caret on the right side of right-to-left text', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('abc אבג 123');
    const { line, order } = visual(sh);
    expect(order).toEqual(['abc ', 'אבג', ' 123']);
    expect(line.portions[1]!.nLevel).toBe(1);
    // The first Hebrew letter is at the right end of its run.
    sh.SttDoc(); sh.Right(); sh.Right(); sh.Right(); sh.Right();
    const at4 = sh.GetCharRect()!.Left(), at6 = (sh.Right(), sh.Right(), sh.GetCharRect()!.Left());
    expect(at4 - at6).toBe(200);
  });

  it('formats right-to-left paragraphs from the right and turns the alignment with them', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('שלום world');
    sh.SetParaDirection(true);
    const n = sh.m_pCursor.GetPoint().GetNode();
    expect(n.GetAttr('RES_PARATR_ADJUST')).toBe('right');
    const { line, order } = visual(sh);
    // The space between them takes the paragraph's direction and joins the Hebrew run.
    expect(order).toEqual(['world', 'שלום ']);
    const frame = sh.m_pRoot.pages[0]!.frames[0]!;
    // Right aligned: the line ends at the right edge of the text area.
    const total = line.portions.reduce((w, p) => w + p.nWidth, 0);
    expect(line.nX + total).toBe(frame.nWidth);
    // The Left key moves forwards (visually left) in right-to-left text.
    sh.SttDoc();
    sh.VisualLeft();
    expect(sh.m_pCursor.GetPoint().GetContentIndex()).toBe(1);
  });

  it('keeps the direction in ODT and DOCX', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('שלום');
    sh.SetParaDirection(true);
    for (const back of [await ImportODT(await ExportODT(sh.m_pDoc)), await ImportDOCX(await ExportDOCX(sh.m_pDoc))]) {
      const n = back.doc.GetNodes().FirstTextNode();
      expect([n.GetAttr('RES_FRAMEDIR'), n.GetAttr('RES_PARATR_ADJUST')]).toEqual(['rl-tb', 'right']);
    }
  });
});
