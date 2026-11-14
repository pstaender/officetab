import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { RndStdIds } from '../../src/lo/sw/inc/frmfmt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
const names = (sh: SwWrtShell) => sh.m_pDoc.GetFlyFormats().map((f) => f.name);

describe('copying a selected object (SwFEShell::Copy and Paste)', () => {
  it('copies an anchored image with a new name at the selected one\'s anchor, and selects it', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('abc');
    const name = sh.InsertGraphic(PNG, 'image/png', { width: 2000, height: 1000 });
    sh.SetFlyFrameAttr({ alt: 'A picture' });
    const clip = sh.CopyFly()!;
    expect(clip.graphic?.data).toEqual(PNG);
    const copy = sh.PasteFly(clip)!;
    expect(copy).not.toBe(name);
    expect(names(sh)).toEqual([name, copy]);
    expect(sh.GetFlyFrameFormat()?.m_aName).toBe(copy);
    expect(sh.GetFlyFrameFormat()?.alt).toBe('A picture');
    expect(sh.GetAnchorId()).toBe(RndStdIds.FLY_AT_CHAR);
    sh.Undo();
    expect(names(sh)).toEqual([name]);
  });

  it('cuts and pastes a formula anchored as character', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    const name = sh.InsertObjectStarMath('a over b');
    sh.Insert('y');
    sh.SelectFly(name);
    const clip = sh.CopyFly()!;
    sh.DelSelectedFly();
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('xy');
    sh.EndDoc();
    const copy = sh.PasteFly(clip)!;
    expect(sh.GetFlyFrameFormat(copy)?.m_pMath?.m_sText).toBe('a over b');
    expect(sh.m_pDoc.FindFlyByName(copy)?.nContent).toBe(2);
  });

  it('pastes a formula after the selected one, twice with distinct names', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const name = sh.InsertObjectStarMath('x^2');
    const clip = sh.CopyFly()!;
    sh.SelectFly(name);
    const a = sh.PasteFly(clip)!;
    const b = sh.PasteFly(clip)!;
    expect(new Set([name, a, b]).size).toBe(3);
    expect(sh.m_pDoc.FindFlyByName(a)?.nContent).toBe(1);
    expect(sh.m_pDoc.FindFlyByName(b)?.nContent).toBe(2);
  });

  it('copies a text frame with its text, which then is its own', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('body');
    const name = sh.InsertTextFrame();
    sh.Insert('one');
    sh.SplitNode();
    sh.Insert('two');
    sh.SelectFly(name);
    const clip = sh.CopyFly()!;
    expect(clip.text?.map((p) => p.text)).toEqual(['one', 'two']);
    const copy = sh.PasteFly(clip)!;
    const nodes = sh.m_pDoc.GetNodes();
    const text = (id: string) => {
      const sec = nodes.FindFlySection(id)!, out: string[] = [];
      for (let i = sec.GetIndex() + 1; i < sec.EndOfSectionNode().GetIndex(); i++) { const n = nodes.node(i); if (n.IsTextNode()) out.push(n.GetText()); }
      return out;
    };
    expect(sh.GetFlyFrameFormat(copy)?.m_sContentId).toBe(copy);
    expect(text(copy)).toEqual(['one', 'two']);
    expect(text(name)).toEqual(['one', 'two']);
    // One undo step removes the copy and its text.
    sh.Undo();
    expect(names(sh)).toEqual([name]);
    expect(nodes.FindFlySection(copy)).toBeNull();
  });

  it('copies nothing without a selected object', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('abc');
    expect(sh.CopyFly()).toBeNull();
  });
});
