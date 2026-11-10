import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SpellChecker } from '../../src/lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const words = (list: string[]) => {
  const set = new Set(list);
  return { spell: (w: string) => set.has(w), suggest: (w: string) => list.filter((x) => x[0] === w[0]) };
};

function shell() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  const sp = new SpellChecker();
  sp.SetDictionary('en-US', words(['the', 'quick', 'brown', 'fox', 'jumps', "don't"]));
  sp.SetDictionary('de-DE', words(['der', 'schnelle', 'Fuchs']));
  sh.m_pSpell = sp;
  return { sh, sp };
}
const node = (sh: SwWrtShell) => sh.m_pCursor.GetPoint().GetNode();

describe('spelling', () => {
  it('finds misspelled words in the language of their text', () => {
    const { sh, sp } = shell();
    sh.Insert('The quikc brown fox, don’t jumpz 42times.');
    expect(sh.GetWrongList(node(sh)).map((w) => w.word)).toEqual(['quikc', 'jumpz']);
    // A capitalised word is also tried in lower case; words with digits are not checked.
    sh.SttDoc();
    sh.SelectRange(node(sh), 0, 9);
    sh.SetLanguage('de-DE', 'selection');
    expect(sh.GetWrongList(node(sh)).map((w) => [w.word, w.lang])).toEqual([['The', 'de-DE'], ['quikc', 'de-DE'], ['jumpz', 'en-US']]);
    // Ignore All and the user dictionary accept a word.
    sp.IgnoreAll('quikc');
    sp.AddWord('jumpz');
    expect(sh.GetWrongList(node(sh)).map((w) => w.word)).toEqual(['The']);
    // Without a dictionary for the language, nothing is marked.
    sh.SetLanguage('fr-FR', 'all');
    expect(sh.GetWrongList(node(sh))).toEqual([]);
  });

  it('walks from one misspelling to the next and corrects them in one undo step each', () => {
    const { sh, sp } = shell();
    sh.Insert('the quikc fox');
    sh.SplitNode();
    sh.Insert('brwn jumps');
    sh.SttDoc();
    const first = sh.SpellContinue()!;
    expect(first.word).toBe('quikc');
    expect(sp.getSuggestions(first.word, 'en-US')).toEqual(['quick']);
    sh.ReplaceWord(sh.m_pCursor.Start().GetNode(), first.nStart, first.nEnd, 'quick');
    expect(sh.m_pDoc.GetNodes().FirstTextNode().GetText()).toBe('the quick fox');
    expect(sh.SpellContinue()!.word).toBe('brwn');
    sh.Undo();
    expect(sh.m_pDoc.GetNodes().FirstTextNode().GetText()).toBe('the quikc fox');
  });

  it('keeps text languages in ODT', async () => {
    const { sh } = shell();
    sh.Insert('Hallo');
    sh.SetLanguage('de-DE', 'all');
    sh.SplitNode();
    sh.Insert('none');
    sh.SelectRange(node(sh), 0, 4);
    sh.SetLanguage('zxx', 'selection');
    const { doc } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(doc.GetNodes().FirstTextNode().GetAttr('RES_CHRATR_LANGUAGE')).toBe('de-DE');
    expect(doc.GetNodes().LastTextNode().GetCharAttrAt('RES_CHRATR_LANGUAGE', 1)).toBe('zxx');
  });
});
