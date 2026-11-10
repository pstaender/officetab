// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/txtnode/txtedt.cxx reduced
// @upstream sw/source/core/text/wrong.cxx reduced
// SwTextNode::Spell and SwTextFrame::AutoSpell_, reduced: a paragraph's words are checked in one
// go, each in the language of its first character, and the misspelled ones are kept as an
// SwWrongList. Word boundaries come from Intl.Segmenter in place of i18npool's break iterator
// (SwScanner with WordType::DICTIONARY_WORD).
import { CH_TXTATR_BREAKWORD } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SpellChecker } from '../../../../lingucomponent/source/spellcheck/spell/sspellimp.ts';

/** One misspelled word of a paragraph (SwWrongArea). */
export interface SwWrongArea { nStart: number; nEnd: number; word: string; lang: string }

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** SwScanner: the words of a paragraph with their offsets and languages. */
export function* SwScanner(node: SwTextNode): Generator<{ word: string; start: number; end: number; lang: string }> {
  const text = node.GetText();
  for (const s of words.segment(text)) {
    if (!s.isWordLike) continue;
    let word = s.segment, start = s.index;
    // Placeholder characters (fields, notes, images) are not part of words.
    if (word.includes(CH_TXTATR_BREAKWORD)) continue;
    // Apostrophes at the ends are punctuation.
    while (word.length && /['’]/.test(word[0]!)) { word = word.slice(1); start++; }
    while (word.length && /['’]/.test(word[word.length - 1]!)) word = word.slice(0, -1);
    // Only words with letters are checked (underscores and other marks are word-like too).
    if (!word || !/\p{L}/u.test(word)) continue;
    // Deleted text (tracked) is not proofread.
    if (node.GetCharAttrAt('RES_TXTATR_REDLINE', start)?.type === 'Delete') continue;
    yield { word, start, end: start + word.length, lang: node.GetCharAttrAt('RES_CHRATR_LANGUAGE', start) };
  }
}

/** SwTextNode::Spell over the whole paragraph: the misspelled words. */
export function SpellParagraph(node: SwTextNode, checker: SpellChecker): SwWrongArea[] {
  const out: SwWrongArea[] = [];
  for (const w of SwScanner(node)) if (checker.isValid(w.word, w.lang) === false) out.push({ nStart: w.start, nEnd: w.end, word: w.word, lang: w.lang });
  return out;
}
