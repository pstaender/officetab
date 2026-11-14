// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/txtnode/txtedt.cxx reduced
// @upstream sw/source/core/text/wrong.cxx reduced
// SwTextNode::Spell and SwTextFrame::AutoSpell_, reduced: a paragraph's words are checked in one
// go, each in the language of its first character, and the misspelled ones are kept as an
// SwWrongList. Word boundaries come from Intl.Segmenter in place of i18npool's break iterator
// (SwScanner with WordType::DICTIONARY_WORD).
// With a grammar checker (SwTextFrame's grammar check through the GrammarCheckingIterator, and
// SwGrammarMarkUp), a paragraph is proofread as a whole in the language of its first word; its
// errors, spelling ones included, replace the spell checker's for the words of that language.
// While the paragraph waits for its check, the previous errors are kept, moved with the edit
// (SwWrongList::Move); errors over placeholders or deleted (tracked) text are not shown.
import { CH_TXTATR_BREAKWORD } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwAutoCompleteWord } from '../doc/acmplwrd.ts';
import { LANGUAGE_NONE, type SpellChecker } from '../../../../lingucomponent/source/spellcheck/spell/sspellimp.ts';
import { IsSpellingError, type SingleProofreadingError } from '../../../../lingucomponent/source/spellcheck/languagetool/languagetoolimp.ts';
import type { GrammarCheckingIterator } from '../../../../linguistic/source/gciterator.ts';

/**
 * One misspelled word of a paragraph (SwWrongArea), or one error of the grammar checker, which
 * brings its own comment, suggestions and line colour (SwWrongArea's mColor).
 */
export interface SwWrongArea { nStart: number; nEnd: number; word: string; lang: string; pError?: SingleProofreadingError }

/** Whether an area is a grammar (or style) error rather than a spelling one. */
export const IsGrammarArea = (w: SwWrongArea): boolean => !!w.pError && !IsSpellingError(w.pError);

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

/** The text sent to the grammar checker: placeholders become U+FFFC (OBJECT REPLACEMENT CHARACTER). */
export const ProofreadingText = (node: SwTextNode): string => node.GetText().replaceAll(CH_TXTATR_BREAKWORD, '\uFFFC');

/** A paragraph's areas and whether its grammar check is still to come. */
export interface SwProofreadResult { list: SwWrongArea[]; text: string; pending: boolean }

/**
 * SwWrongList::Move, reduced: the grammar checker's areas of the paragraph's previous text, kept
 * where the text before or after them did not change.
 */
export function MoveWrongAreas(prev: SwProofreadResult, text: string): SwWrongArea[] {
  const old = prev.text;
  let p = 0;
  while (p < old.length && p < text.length && old[p] === text[p]) p++;
  let q = 0;
  while (q < old.length - p && q < text.length - p && old[old.length - 1 - q] === text[text.length - 1 - q]) q++;
  const delta = text.length - old.length;
  const out: SwWrongArea[] = [];
  for (const w of prev.list) {
    if (!w.pError) continue;
    if (w.nEnd <= p) out.push(w);
    else if (w.nStart >= old.length - q) out.push({ ...w, nStart: w.nStart + delta, nEnd: w.nEnd + delta });
  }
  return out;
}

/**
 * SwTextNode::Spell and the paragraph's grammar check: the spell checker's misspelled words, and
 * for the paragraph's language the grammar checker's errors instead, once they are known.
 */
export function ProofreadParagraph(node: SwTextNode, checker: SpellChecker, gc: GrammarCheckingIterator | null, prev?: SwProofreadResult): SwProofreadResult {
  const text = node.GetText();
  const scan = [...SwScanner(node)];
  const lang = scan[0]?.lang ?? node.GetAttr('RES_CHRATR_LANGUAGE');
  const useGC = !!gc && !!lang && lang !== LANGUAGE_NONE && gc.hasLocale(lang);
  const list: SwWrongArea[] = [];
  for (const w of scan) {
    if (useGC && w.lang === lang) continue;
    if (checker.isValid(w.word, w.lang) === false) list.push({ nStart: w.start, nEnd: w.end, word: w.word, lang: w.lang });
  }
  let pending = false;
  if (useGC) {
    const errors = gc.GetErrors(node, ProofreadingText(node), lang);
    if (!errors) {
      pending = true;
      if (prev) list.push(...MoveWrongAreas(prev, text));
    } else {
      for (const e of errors) {
        const nStart = e.nErrorStart, nEnd = e.nErrorStart + e.nErrorLength;
        if (nEnd > text.length || nEnd <= nStart) continue;
        const word = text.slice(nStart, nEnd);
        if (word.includes(CH_TXTATR_BREAKWORD)) continue;
        // Text in another language was checked by the spell checker; deleted text is not proofread.
        if (node.GetCharAttrAt('RES_CHRATR_LANGUAGE', nStart) !== lang) continue;
        if (node.GetCharAttrAt('RES_TXTATR_REDLINE', nStart)?.type === 'Delete') continue;
        // The ignore list and the user dictionary accept words the grammar checker does not know.
        if (IsSpellingError(e) && checker.IsAccepted(word)) continue;
        list.push({ nStart, nEnd, word, lang, pError: e });
      }
    }
  }
  list.sort((a, b) => a.nStart - b.nStart);
  return { list, text, pending };
}

/**
 * SwTextFrame::CollectAutoCmplWrds: the paragraph's words for word completion, except the word at
 * nActPos (the one being typed).
 */
export function CollectAutoCmplWrds(rNode: SwTextNode, rACW: SwAutoCompleteWord, rDoc: string, nActPos = -1): void {
  for (const w of SwScanner(rNode)) {
    const nBegin = w.start, nLen = w.end - w.start;
    if (rACW.GetMinWordLen() <= nLen) {
      if (nActPos < 0 || nActPos < nBegin || (nBegin + nLen) < nActPos)
        rACW.InsertWord(w.word, rDoc);
    }
  }
}
