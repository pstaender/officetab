// Insert > Text Box and Insert > Vertical Text (SID_DRAW_TEXT, SID_DRAW_TEXT_VERTICAL).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwRect } from '../../src/lo/sw/inc/swrect.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

function withBox(bVertical: boolean) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('Body');
  const page = sh.m_pRoot.pages[0]!.aPrt;
  const name = sh.InsertDrawText(new SwRect(page.Left() + 1000, page.Top() + 2000, 2000, 600), bVertical);
  return { sh, name };
}
const flyOf = (sh: SwWrtShell, name: string) => sh.m_pRoot.FindFly(name)!.fly;

describe('Text boxes', () => {
  it('makes a text object without fill or line whose text is edited at once and grows its height', () => {
    const { sh, name } = withBox(false);
    const fmt = sh.GetFlyFrameFormat(name)!;
    expect(fmt.m_pShape).toMatchObject({ m_sType: 'rectangle', m_aFill: null, m_aLine: null, m_eTextVertAdjust: 'top' });
    expect(fmt.m_bAutoHeight).toBe(true);
    expect(sh.GetCurrFlyName()).toBe(name);
    sh.Insert('one two three four five six seven');
    const fly = flyOf(sh, name);
    expect(fly.aFrame.Width()).toBe(2000);
    expect(fly.frames[0]!.lines.length).toBeGreaterThan(1);
    expect(fly.aFrame.Height()).toBeGreaterThan(600);
    // Creating and the text edit are one undo step.
    sh.Undo();
    sh.Undo();
    expect(sh.m_pDoc.FindFlyByName(name)).toBeUndefined();
  });

  it('lays vertical text out top to bottom and grows to the left', () => {
    const { sh, name } = withBox(true);
    const before = flyOf(sh, name).aFrame;
    sh.Insert('one two three four five six seven');
    const fly = flyOf(sh, name);
    expect(fly.aVert).toBeDefined();
    // Lines are as long as the box is high; more lines make it wider, its right edge staying.
    expect(fly.frames[0]!.lines.length).toBeGreaterThan(1);
    expect(fly.aFrame.Height()).toBe(600);
    expect(fly.aFrame.Width()).toBeGreaterThan(before.Width());
    expect(fly.aFrame.Right()).toBe(before.Right());
  });

  it('keeps text boxes through ODT, and DOCX makes them Word text boxes', async () => {
    for (const bVertical of [false, true]) {
      const { sh } = withBox(bVertical);
      sh.Insert('Text');
      const odt = (await ImportODT(await ExportODT(sh.m_pDoc))).doc;
      const fmt = odt.GetFlyFormats().map((f) => f.fmt).find((f) => f?.m_pShape)!;
      expect(fmt.m_pShape).toMatchObject({ m_aFill: null, m_aLine: null, m_eTextVertAdjust: 'top' });
      expect(!!fmt.m_pShape!.m_bVerticalWriting).toBe(bVertical);
      expect(!!(bVertical ? fmt.m_bAutoWidth : fmt.m_bAutoHeight)).toBe(true);
      // writerfilter imports a rectangle with text as a text frame (a Word text box).
      const docx = (await ImportDOCX(await ExportDOCX(sh.m_pDoc))).doc;
      const frame = docx.GetFlyFormats().map((f) => f.fmt).find((f) => f?.m_sContentId !== undefined)!;
      expect(frame.m_aBackground).toBeNull();
      expect(frame.m_aBox?.top).toBeNull();
      expect(frame.m_eFrameDir).toBe(bVertical ? 'tb-rl' : undefined);
      expect(frame.m_bAutoHeight).toBe(true);
    }
  });
});
