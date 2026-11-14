import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (f: FontDesc, t: string) => (t.length * f.size) / 2.4, GetFontMetric: (f) => ({ ascent: f.size * 0.8, descent: f.size * 0.2 }) };

describe('paragraph styles', () => {
  it('changes a style, relays out its paragraphs, and undoes', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('text');
    const coll = sh.m_pDoc.FindTextFormatCollByName('Standard')!;
    const before = sh.m_pRoot.pages[0]!.frames[0]!.nHeight;
    sh.m_pDoc.ChgFormatColl(sh.m_pCursor, coll, { set: { ...coll.m_aSet, RES_CHRATR_FONTSIZE: 480 } });
    expect(sh.m_pRoot.pages[0]!.frames[0]!.nHeight).toBe(before * 2);
    sh.Undo();
    expect(coll.GetFormatAttr('RES_CHRATR_FONTSIZE')).toBe(240);
    expect(sh.m_pRoot.pages[0]!.frames[0]!.nHeight).toBe(before);
    sh.Redo();
    expect(sh.m_pRoot.pages[0]!.frames[0]!.nHeight).toBe(before * 2);
  });

  it('renames, re-parents and sets the next style, refusing cycles', () => {
    const doc = new SwDoc();
    const sh = new SwWrtShell(doc, mono);
    const body = doc.FindTextFormatCollByName('Text Body')!;
    const heading = doc.FindTextFormatCollByName('Heading')!;
    doc.ChgFormatColl(sh.m_pCursor, body, { name: 'Body', parent: heading, next: heading });
    expect(doc.FindTextFormatCollByName('Body')).toBe(body);
    expect(doc.FindTextFormatCollByName('Text Body')).toBeUndefined();
    expect(body.DerivedFrom()).toBe(heading);
    expect(body.GetNextTextFormatColl()).toBe(heading);
    // Heading cannot derive from Heading 1, which derives from Heading.
    doc.ChgFormatColl(sh.m_pCursor, heading, { parent: doc.FindTextFormatCollByName('Heading 1')! });
    expect(heading.DerivedFrom()!.GetName()).toBe('Standard');
    sh.Undo(); sh.Undo();
    expect(doc.FindTextFormatCollByName('Text Body')).toBe(body);
    expect(body.DerivedFrom()!.GetName()).toBe('Standard');
  });

  it('makes a style from the selection and updates a style from a paragraph', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Callout');
    sh.SetParaAttr({ RES_PARATR_ADJUST: 'center' });
    sh.SelPara();
    sh.SetCharAttr({ RES_CHRATR_WEIGHT: true });
    const made = sh.m_pDoc.MakeCollByExample(sh.m_pCursor, 'Callout', sh.CopyFormat().chars)!;
    const n = sh.m_pCursor.GetPoint().GetNode();
    expect(n.GetTextColl()).toBe(made);
    expect(n.m_aSet).toEqual({});
    expect(made.GetFormatAttr('RES_PARATR_ADJUST')).toBe('center');
    expect(made.GetFormatAttr('RES_CHRATR_WEIGHT')).toBe(true);
    sh.SetParaAttr({ RES_PARATR_ADJUST: 'right' });
    sh.m_pDoc.UpdateCollByExample(sh.m_pCursor, {});
    expect(made.GetFormatAttr('RES_PARATR_ADJUST')).toBe('right');
    expect(n.m_aSet).toEqual({});
    const { doc } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(doc.FindTextFormatCollByName('Callout')!.GetFormatAttr('RES_PARATR_ADJUST')).toBe('right');
  });
});

describe('character styles', () => {
  it('applies to the word at the cursor, survives Clear Direct Formatting and round-trips', async () => {
    const { fontAt } = await import('../../src/lo/sw/source/core/text/itrform2.ts');
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('an important word');
    const n = sh.m_pCursor.GetPoint().GetNode();
    sh.SelectRange(n, 5, 5);
    sh.SetCharFormat('Strong Emphasis');
    expect(sh.GetCharFormatName()).toBe('Strong Emphasis');
    expect(fontAt(n, 4).bold).toBe(true);
    expect(fontAt(n, 2).bold).toBe(false);
    // Direct formatting on top, then cleared: the style stays.
    sh.SelectRange(n, 3, 12);
    sh.SetCharAttr({ RES_CHRATR_COLOR: '#ff0000' });
    sh.ResetAttrs();
    expect(fontAt(n, 4)).toMatchObject({ bold: true, color: null });
    const { doc } = await ImportODT(await ExportODT(sh.m_pDoc));
    const n2 = doc.GetNodes().FirstTextNode();
    expect(n2.GetCharAttrAt('RES_TXTATR_CHARFMT', 4)?.GetName()).toBe('Strong Emphasis');
    expect(n2.GetCharAttrAt('RES_CHRATR_WEIGHT', 4)).toBe(true);
    expect(n2.GetCharAttrAt('RES_TXTATR_CHARFMT', 1)).toBeNull();
  });
});

describe('Format > Clear Direct Formatting', () => {
  const setup = () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('one two three');
    const n = sh.m_pDoc.GetNodes().FirstTextNode()!;
    sh.SelectRange(n, 0, n.Len());
    sh.SetCharAttr({ RES_CHRATR_WEIGHT: true, RES_CHRATR_LANGUAGE: 'de-DE' });
    sh.m_pDoc.SetParaAttr(sh.m_pCursor, { RES_PARATR_ADJUST: 'center', RES_FRAMEDIR: 'rl-tb' });
    return { sh, n };
  };

  it('without a selection clears the word at the cursor and the paragraph, keeping languages and direction', () => {
    const { sh, n } = setup();
    sh.SelectRange(n, 5, 5);
    sh.ResetAttrs();
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 5)).toBe(false);
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 1)).toBe(true);
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 9)).toBe(true);
    expect(n.GetCharAttrAt('RES_CHRATR_LANGUAGE', 5)).toBe('de-DE');
    expect(n.m_aSet.RES_PARATR_ADJUST).toBeUndefined();
    expect(n.m_aSet.RES_FRAMEDIR).toBe('rl-tb');
    expect(sh.HasSelection()).toBe(false);
    // One undo step brings both back.
    sh.Undo();
    const m = sh.m_pDoc.GetNodes().FirstTextNode()!;
    expect(m.GetCharAttrAt('RES_CHRATR_WEIGHT', 5)).toBe(true);
    expect(m.m_aSet.RES_PARATR_ADJUST).toBe('center');
  });

  it('between words clears only the paragraph', () => {
    const { sh, n } = setup();
    sh.SelectRange(n, 3, 3);
    sh.ResetAttrs();
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 1)).toBe(true);
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 5)).toBe(true);
    expect(n.m_aSet.RES_PARATR_ADJUST).toBeUndefined();
  });

  it('with a selection clears whole paragraphs, but not one selected in part', () => {
    const { sh, n } = setup();
    sh.SelectRange(n, 4, 7);
    sh.ResetAttrs();
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 5)).toBe(false);
    expect(n.m_aSet.RES_PARATR_ADJUST).toBe('center');
    sh.SelectRange(n, 0, n.Len());
    sh.ResetAttrs();
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 1)).toBe(false);
    expect(n.m_aSet.RES_PARATR_ADJUST).toBeUndefined();
  });
});
