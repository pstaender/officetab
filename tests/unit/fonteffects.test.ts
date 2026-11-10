// Format > Text: font effects (overline, shadow, outline, small capitals) and Change Case.
import { describe, expect, it } from 'vitest';
import { SwDoc, SwPosition } from '../../src/lo/sw/inc/doc.ts';
import { SwPaM } from '../../src/lo/sw/inc/pam.ts';
import { transliterate, TransliterationFlags as T } from '../../src/lo/i18npool/source/transliteration/transliteration_body.ts';
import { RotateTransliteration } from '../../src/lo/unotools/source/i18n/caserotate.ts';
import { CapitalBlocks, GetTextSize, displayText, fontAt } from '../../src/lo/sw/source/core/text/itrform2.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwCharAttrSet } from '../../src/lo/sw/inc/hintids.ts';

function setup(text: string) {
  const doc = new SwDoc();
  const node = doc.GetNodes().FirstTextNode();
  const pam = new SwPaM(new SwPosition(node, 0));
  doc.InsertString(pam, text);
  return { doc, pam, node };
}
const select = (pam: SwPaM, a: number, b: number) => { const n = pam.GetPoint().GetNode(); pam.GetMark().Assign(n, a); pam.GetPoint().Assign(n, b); };
const caret = (pam: SwPaM, a: number) => { const n = pam.GetPoint().GetNode(); pam.GetPoint().Assign(n, a); pam.DeleteMark(); };

describe('transliterations', () => {
  it('maps case as Writer does', () => {
    expect(transliterate(T.LOWERCASE_UPPERCASE, 'straße', 'de-DE')).toBe('STRASSE');
    expect(transliterate(T.TITLE_CASE, 'hELLO', 'en')).toBe('Hello');
    expect(transliterate(T.TOGGLE_CASE, 'Hello World', 'en')).toBe('hELLO wORLD');
    expect(transliterate(T.UPPERCASE_LOWERCASE, 'İ', 'tr')).toBe('i');
  });

  it('folds widths and converts kana', () => {
    expect(transliterate(T.HALFWIDTH_FULLWIDTH, 'AB 1', 'ja')).toBe('ＡＢ　１');
    expect(transliterate(T.FULLWIDTH_HALFWIDTH, 'ＡＢ　１', 'ja')).toBe('AB 1');
    expect(transliterate(T.FULLWIDTH_HALFWIDTH, 'ガギ', 'ja')).toBe('ｶﾞｷﾞ');
    expect(transliterate(T.HALFWIDTH_FULLWIDTH, 'ｶﾞｷﾞ', 'ja')).toBe('ガギ');
    expect(transliterate(T.HIRAGANA_KATAKANA, 'ひらがな', 'ja')).toBe('ヒラガナ');
    expect(transliterate(T.KATAKANA_HIRAGANA, 'カタカナ', 'ja')).toBe('かたかな');
  });

  it('cycles title case, sentence case, upper and lower case (RotateTransliteration)', () => {
    const r = new RotateTransliteration();
    expect([1, 2, 3, 4, 5].map(() => r.getNextMode())).toEqual([T.TITLE_CASE, T.SENTENCE_CASE, T.LOWERCASE_UPPERCASE, T.UPPERCASE_LOWERCASE, T.TITLE_CASE]);
  });
});

describe('SwDoc::TransliterateText', () => {
  it('capitalizes every word of the selection and keeps the attributes', () => {
    const { doc, pam, node } = setup('the quick brown fox');
    node.SetAttr(4, 9, { RES_CHRATR_WEIGHT: true });
    select(pam, 0, node.Len());
    doc.TransliterateText(pam, T.TITLE_CASE);
    expect(node.GetText()).toBe('The Quick Brown Fox');
    expect(node.GetCharAttrAt('RES_CHRATR_WEIGHT', 4)).toBe(true);
    expect(node.GetCharAttrAt('RES_CHRATR_WEIGHT', 9)).toBe(false);
    // The selection still covers the text, and undo brings the old text back.
    expect(pam.End().GetContentIndex()).toBe(node.Len());
    doc.Undo(pam);
    expect(doc.GetNodes().FirstTextNode().GetText()).toBe('the quick brown fox');
  });

  it('changes the sentences of the selection to sentence case', () => {
    const { doc, pam, node } = setup('hello WORLD. This IS fine.');
    select(pam, 0, node.Len());
    doc.TransliterateText(pam, T.SENTENCE_CASE);
    expect(node.GetText()).toBe('Hello world. This is fine.');
  });

  it('takes the word at the cursor without a selection, and nothing between words', () => {
    const { doc, pam, node } = setup('one two three');
    caret(pam, 5);
    doc.TransliterateText(pam, T.LOWERCASE_UPPERCASE);
    expect(node.GetText()).toBe('one TWO three');
    caret(pam, 3);
    doc.TransliterateText(pam, T.LOWERCASE_UPPERCASE);
    expect(node.GetText()).toBe('one TWO three');
  });

  it('records the change as a deletion and an insertion when changes are tracked', () => {
    const { doc, pam, node } = setup('abc');
    doc.m_pDocumentRedlineManager.m_bRecord = true;
    select(pam, 0, 3);
    doc.TransliterateText(pam, T.LOWERCASE_UPPERCASE);
    expect(node.GetText()).toBe('abcABC');
    expect(node.GetCharAttrAt('RES_TXTATR_REDLINE', 0)?.type).toBe('Delete');
    expect(node.GetCharAttrAt('RES_TXTATR_REDLINE', 3)?.type).toBe('Insert');
  });

  it('keeps the attributes when the text grows (ß to SS)', () => {
    const { doc, pam, node } = setup('maß x');
    node.SetAttr(0, 3, { RES_CHRATR_POSTURE: true });
    select(pam, 0, 3);
    doc.TransliterateText(pam, T.LOWERCASE_UPPERCASE);
    expect(node.GetText()).toBe('MASS x');
    expect([0, 1, 2, 3].map((i) => node.GetCharAttrAt('RES_CHRATR_POSTURE', i))).toEqual([true, true, true, true]);
    expect(node.GetCharAttrAt('RES_CHRATR_POSTURE', 4)).toBe(false);
  });
});

describe('font effects', () => {
  const measurer: TextMeasurer = { GetTextWidth: (f, t) => [...t].length * f.size * 0.5, GetFontMetric: (f) => ({ ascent: f.size * 0.8, descent: f.size * 0.2 }) };

  it('lays out small capitals as upper case, lower case letters at 80 %', () => {
    const { node } = setup('Hello');
    node.SetAttr(0, 5, { RES_CHRATR_CASEMAP: 'smallcaps' });
    const f = fontAt(node, 0);
    expect(f.smallCaps).toBe(true);
    expect(CapitalBlocks('Hello', f).map((b) => [b.text, b.font.size])).toEqual([['H', 240], ['ELLO', 192]]);
    expect(GetTextSize(measurer, f, 'Hello')).toBe(120 + 4 * 96);
  });

  it('capitalizes the first letter of each word for Capitalize', () => {
    const { node } = setup('one two');
    node.SetAttr(0, 7, { RES_CHRATR_CASEMAP: 'capitalize' });
    expect(displayText('one two', fontAt(node, 0))).toBe('One Two');
  });

  const effects: SwCharAttrSet = { RES_CHRATR_OVERLINE: 'double', RES_CHRATR_SHADOWED: true, RES_CHRATR_CONTOUR: true, RES_CHRATR_CASEMAP: 'smallcaps' };
  const attrsOf = (d: SwDoc) => {
    const n = d.GetNodes().FirstTextNode();
    return { ov: n.GetCharAttrAt('RES_CHRATR_OVERLINE', 1), sh: n.GetCharAttrAt('RES_CHRATR_SHADOWED', 1), co: n.GetCharAttrAt('RES_CHRATR_CONTOUR', 1), cm: n.GetCharAttrAt('RES_CHRATR_CASEMAP', 1) };
  };

  it('keeps overline, shadow, outline and small capitals through ODT', async () => {
    const { doc, node } = setup('text');
    node.SetAttr(0, 4, effects);
    expect(attrsOf((await ImportODT(await ExportODT(doc))).doc)).toEqual({ ov: 'double', sh: true, co: true, cm: 'smallcaps' });
  });

  it('keeps shadow, outline and small capitals through DOCX (which has no overline)', async () => {
    const { doc, node } = setup('text');
    node.SetAttr(0, 4, effects);
    const r = await ImportDOCX(await ExportDOCX(doc));
    expect(r.lost).toEqual([]);
    expect(attrsOf(r.doc)).toEqual({ ov: 'none', sh: true, co: true, cm: 'smallcaps' });
  });
});
