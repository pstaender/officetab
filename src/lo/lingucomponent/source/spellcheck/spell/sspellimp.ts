// SPDX-License-Identifier: MPL-2.0
// @upstream lingucomponent/source/spellcheck/spell/sspellimp.cxx reduced
// @upstream linguistic/source/spelldsp.cxx reduced
// @upstream linguistic/source/misc.cxx partial
// The Hunspell engine is supplied per locale by the caller (the web shell loads the
// dictionaries); this class picks the dictionary for a word's language and applies the
// dispatcher's rules: words with digits are not checked (IsSpellWithDigits off), the ignore list
// and the user dictionary accept words, and a word is also tried in lower case when it starts a
// sentence or is capitalised (SpellChecker::GetSpellFailure's case handling).

/** What a Hunspell instance offers (Hunspell::spell and Hunspell::suggest). */
export interface Hunspell { spell(word: string): boolean; suggest(word: string): string[] }

/** linguistic::HasDigits */
export const HasDigits = (s: string): boolean => /\p{Nd}/u.test(s);

/** No language (LANGUAGE_NONE / zxx): the text is not proofread. */
export const LANGUAGE_NONE = 'zxx';

export class SpellChecker {
  /** Loaded dictionaries by BCP 47 locale. */
  private m_aDicts = new Map<string, Hunspell>();
  /** The IgnoreAllList of the session. */
  private m_aIgnoreAll = new Set<string>();
  /** The standard user dictionary (standard.dic): words added by the user. */
  m_aUserWords = new Set<string>();
  /** Bumped when dictionaries or lists change, so that checked paragraphs are checked again. */
  m_nVersion = 0;

  SetDictionary(locale: string, h: Hunspell | null): void {
    if (h) this.m_aDicts.set(locale, h); else this.m_aDicts.delete(locale);
    this.m_nVersion++;
  }

  GetLocales(): string[] { return [...this.m_aDicts.keys()]; }

  /** The dictionary for a language: the exact locale, else one of the same language. */
  private dictFor(lang: string): Hunspell | null {
    if (!lang || lang === LANGUAGE_NONE) return null;
    const exact = this.m_aDicts.get(lang);
    if (exact) return exact;
    const primary = lang.split('-')[0]!.toLowerCase();
    for (const [loc, h] of this.m_aDicts) if (loc.split('-')[0]!.toLowerCase() === primary) return h;
    return null;
  }

  hasLanguage(lang: string): boolean { return !!this.dictFor(lang); }

  /** SpellCheckerDispatcher::isValid: null when there is no dictionary for the language. */
  isValid(word: string, lang: string): boolean | null {
    const h = this.dictFor(lang);
    if (!h) return null;
    if (!word || HasDigits(word)) return true;
    if (this.m_aIgnoreAll.has(word) || this.m_aUserWords.has(word)) return true;
    // Typographic apostrophes are checked as plain ones.
    const w = word.replace(/’/g, "'");
    if (h.spell(w)) return true;
    // A capitalised word may be a lower case one at a sentence start.
    if (w[0] !== w[0]!.toLowerCase() && w.slice(1) === w.slice(1).toLowerCase() && h.spell(w[0]!.toLowerCase() + w.slice(1))) return true;
    return false;
  }

  /** SpellChecker::GetProposals */
  getSuggestions(word: string, lang: string): string[] {
    const h = this.dictFor(lang);
    return h ? h.suggest(word.replace(/’/g, "'")).slice(0, 10) : [];
  }

  /** IgnoreAll: the word is accepted for the rest of the session. */
  IgnoreAll(word: string): void { this.m_aIgnoreAll.add(word); this.m_nVersion++; }

  /** Adds a word to the user dictionary. */
  AddWord(word: string): void { this.m_aUserWords.add(word); this.m_nVersion++; }
}
