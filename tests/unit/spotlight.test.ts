// View > Spotlight: character direct formatting, paragraph styles and character styles.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ColorHash, hashCode_WithLength } from '../../src/lo/sfx2/source/dialog/StyleList.ts';
import { ApplyTintOrShade, HSBtoRGB } from '../../src/lo/tools/source/generic/color.ts';
import { CSDFHighlight, ParaStyleHighlight } from '../../src/lo/sw/source/core/text/inftxt.ts';
import { PSCSDFPropsQuickHelp } from '../../src/lo/sw/source/uibase/docvw/edtwin2.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

describe('ColorHash', () => {
  it('gives the colours LibreOffice gives', () => {
    // Computed with upstream's ColorHash, Color::HSBtoRGB and Color::ApplyTintOrShade in C++.
    expect(['Standard', 'Heading 1', 'Heading 2', 'Text Body', 'Emphasis', 'Strong Emphasis'].map(ColorHash))
      .toEqual(['#d9ffdd', '#3cffb1', '#f7b1b8', '#b76b4b', '#dbf9be', '#54eedf']);
  });

  it('hashes as rtl::OUString::hashCode and converts colours as tools::Color', () => {
    expect(hashCode_WithLength('')).toBe(0);
    expect(hashCode_WithLength('ab')).toBe((2 * 37 + 97) * 37 + 98);
    expect(HSBtoRGB(0, 100, 100)).toBe('#ff0000');
    expect(HSBtoRGB(120, 0, 50)).toBe('#7f7f7f');
    expect(ApplyTintOrShade('#ff0000', -5000)).toBe('#800000');
    expect(ApplyTintOrShade('#000000', 5000)).toBe('#808080');
  });
});

function setup() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('plain bold styled');
  const n = sh.m_pCursor.GetPoint().GetNode();
  n.SetAttr(6, 10, { RES_CHRATR_WEIGHT: true });
  n.SetAttr(11, 17, { RES_TXTATR_CHARFMT: sh.m_pDoc.FindCharFormatByName('Emphasis')! });
  return { sh, n };
}

describe('styles spotlight', () => {
  it('marks character styles by number and colour, direct formatting as "df"', () => {
    const { sh, n } = setup();
    const all = { charDF: true, paraStyles: false, charStyles: true };
    expect(CSDFHighlight(sh.m_pDoc, n, 0, all)).toBeNull();
    expect(CSDFHighlight(sh.m_pDoc, n, 7, all)).toEqual({ label: 'df', color: '#c0c0c0', charStyle: null });
    const pos = [...sh.m_pDoc.m_aCharFormats.keys()].indexOf('Emphasis');
    expect(CSDFHighlight(sh.m_pDoc, n, 12, all)).toEqual({ label: String(pos), color: ColorHash('Emphasis'), charStyle: 'Emphasis' });
    // Each spotlight on its own: direct formatting does not mark styled text, and the other way round.
    expect(CSDFHighlight(sh.m_pDoc, n, 12, { ...all, charStyles: false })).toBeNull();
    expect(CSDFHighlight(sh.m_pDoc, n, 7, { ...all, charDF: false })).toBeNull();
  });

  it('numbers paragraph styles and knows direct paragraph formatting', () => {
    const { sh, n } = setup();
    expect(ParaStyleHighlight(sh.m_pDoc, n)).toEqual({ label: String([...sh.m_pDoc.m_aTextFormatColls.keys()].indexOf('Standard')), color: ColorHash('Standard') });
    expect(SwDoc.HasParagraphDirectFormatting(n)).toBe(false);
    n.m_aSet.RES_PARATR_LIST_LEVEL = 2;
    expect(SwDoc.HasParagraphDirectFormatting(n)).toBe(false);
    n.m_aSet.RES_PARATR_ADJUST = 'center';
    expect(SwDoc.HasParagraphDirectFormatting(n)).toBe(true);
  });

  it('explains the marks in the quick help', () => {
    const { sh, n } = setup();
    const f = sh.m_pRoot.pages[0]!.frames.find((fr) => fr.node === n)!;
    const y = f.nTop + 100;
    expect(PSCSDFPropsQuickHelp(sh, new Point(f.nLeft + 750, y))).toBeNull();
    sh.m_aSpotlight = { charDF: true, paraStyles: true, charStyles: true };
    // Monospaced at 100 twips a character: "bold" from 600, "styled" from 1100.
    expect(PSCSDFPropsQuickHelp(sh, new Point(f.nLeft + 750, y))).toEqual({ kind: 'charDF' });
    expect(PSCSDFPropsQuickHelp(sh, new Point(f.nLeft + 1250, y))).toEqual({ kind: 'charStyle', name: 'Emphasis' });
    expect(PSCSDFPropsQuickHelp(sh, new Point(f.nLeft + 50, y))).toBeNull();
    expect(PSCSDFPropsQuickHelp(sh, new Point(f.nLeft - 200, y))).toEqual({ kind: 'paraStyle', name: 'Standard', df: false });
  });
});
