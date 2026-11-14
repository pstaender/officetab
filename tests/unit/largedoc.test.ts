// What keeps long documents fast: the font mapping asked once per family, word counts kept per
// paragraph, and the filters finding each paragraph's bookmarks without searching them all.
import { describe, expect, it } from 'vitest';
import { FontService } from '../../src/shell/fonts.ts';
import { cssFont, GetFontStacksGeneration, InvalidateFontStacks, SetFontFamilies, SetFontResolver } from '../../src/lo/vcl/source/outdev/text.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const font = (family: string): FontDesc => ({ family, size: 240, bold: false, italic: false });

describe('the font mapping', () => {
  it('is asked once per family until it changes', () => {
    let asked = 0;
    SetFontResolver({ stack: (f) => { asked++; return `"${f}", serif`; } });
    expect(cssFont(font('A'))).toBe('240px "A", serif');
    cssFont(font('A'));
    cssFont({ ...font('A'), bold: true });
    expect(asked).toBe(1);
    const gen = GetFontStacksGeneration();
    InvalidateFontStacks();
    expect(GetFontStacksGeneration()).toBe(gen + 1);
    cssFont(font('A'));
    expect(asked).toBe(2);
    // Another document's font families change the fallbacks: asked again.
    SetFontFamilies(new Map([['A', 'roman']]));
    cssFont(font('A'));
    expect(asked).toBe(3);
    SetFontResolver(null);
  });

  it('follows a change of the font profile', () => {
    const fs = new FontService();
    fs.install();
    fs.setActive('google');
    expect(cssFont(font('Calibri'))).toContain('"Carlito"');
    fs.setAlwaysReplace(true);
    expect(cssFont(font('Calibri'))).toMatch(/^240px "Carlito", "Calibri"/);
    fs.setAlwaysReplace(false);
    SetFontResolver(null);
  });
});

describe('a long document', () => {
  it('counts words per paragraph, again only where the text changed', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('one two three');
    sh.SplitNode();
    sh.Insert('four');
    expect(sh.GetWordCount()).toEqual({ words: 4, chars: 17 });
    sh.Insert(' five');
    expect(sh.GetWordCount()).toEqual({ words: 5, chars: 22 });
    sh.Undo();
    expect(sh.GetWordCount()).toEqual({ words: 4, chars: 17 });
  });

  it("writes each paragraph's bookmarks, found once for the whole document", async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    for (let i = 0; i < 50; i++) {
      sh.Insert(`para ${i}`);
      if (i % 5 === 0) sh.SetBookmark(`mark${i}`);
      sh.SplitNode();
    }
    const access = sh.getIDocumentMarkAccess();
    const byNode = access.getMarksByNode();
    for (const n of sh.m_pDoc.allText()) expect(byNode.get(n) ?? []).toEqual(access.getMarksIn(n));
    const again = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(again.doc.getIDocumentMarkAccess().getBookmarks().map((m) => m.GetName())).toEqual(access.getBookmarks().map((m) => m.GetName()));
  });
});
