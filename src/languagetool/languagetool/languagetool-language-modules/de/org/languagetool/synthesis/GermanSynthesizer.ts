// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/synthesis/GermanSynthesizer.java faithful
// INSTANCE is created on first use (Java creates it when the class is loaded), as the dictionaries
// must have been preloaded into the data broker first; Java passes it the de-DE language, which
// the deprecated constructor ignores, so it is not looked up here. The constructors are one (the
// private one and the deprecated one taking a Language). The two synthesize overloads are one
// method with an optional posTagRegExp (undefined: the two-argument one), as in BaseSynthesizer.
import { AnalyzedToken } from '../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { BaseSynthesizer } from '../../../../../languagetool-core/org/languagetool/synthesis/BaseSynthesizer.ts';
import { StringTools } from '../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { GermanCompoundTokenizer } from '../tokenizers/de/GermanCompoundTokenizer.ts';

let instance: GermanSynthesizer | null = null;

const REMOVE = new Set<string>(['unsren', 'unsrem', 'unsres', 'unsre', 'unsern', 'unserm', 'unsrer',
    // old spellings still in the synthesizer dict:
    'angepaßt', 'beschloß', 'biß', 'entschloß', 'ergoß', 'faßt', 'genoß', 'paßt', 'paßte', 'preßt', 'preßte', 'riß',
    'schloß', 'streßtest', 'vergißt', 'verlaß', 'verläßt', 'vermiß', 'vermißt',
    'wißt', 'wußtest', 'wüßtest']);

/**
 * German word form synthesizer. Also supports compounds.
 *
 * @since 2.4
 */
export class GermanSynthesizer extends BaseSynthesizer {

  static get INSTANCE(): GermanSynthesizer {
    return (instance ??= new GermanSynthesizer());
  }

  /** @deprecated use {@link #INSTANCE} (the lang parameter is ignored) */
  constructor(_lang?: Language | null) {
    super('de/de.sor', '/de/german_synth.dict', '/de/german_tags.txt', 'de');
  }

  protected override lookup(lemma: string, posTag: string): string[] {
    const lookup = super.lookup(lemma, posTag);
    const results: string[] = [];
    for (const s of lookup) {
      // don't inflect a lowercase lemma to an uppercase word and vice versa
      // https://github.com/languagetool-org/languagetool/issues/4712
      const lcLemma = StringTools.startsWithLowercase(lemma);
      const lcLookup = StringTools.startsWithLowercase(s);
      if (lcLemma === lcLookup || lemma === 'mein' || lemma === 'ich' && !REMOVE.has(s)) {  // mein/ich wegen Ihr/Sie
        results.push(s);
      }
    }
    return results;
  }

  override synthesize(token: AnalyzedToken, posTag: string, posTagRegExp?: boolean): string[] {
    if (posTagRegExp === undefined) {
      const result = super.synthesize(token, posTag);
      if (result.length === 0) {
        return this.getCompoundForms(token, posTag, false);
      }
      return result.filter((k) => !REMOVE.has(k));
    }
    const result = super.synthesize(token, posTag, posTagRegExp);
    if (result.length === 0) {
      return this.getCompoundForms(token, posTag, posTagRegExp);
    }
    const array = result.filter((k) => !REMOVE.has(k));
    /*
    // log cases where 'ß' is in a word and it's probably old spelling:
    String other = null;
    for (String s : array) {
      if (s.contains("ß")) {
        other = s.replaceAll("ß", "ss");
      }
    }
    if (other != null && Arrays.asList(array).contains(other)) {
      System.out.println(">>"+ Arrays.toString(array));
    }*/
    return array;
  }

  private getCompoundForms(token: AnalyzedToken, posTag: string, posTagRegExp: boolean): string[] {
    let parts = GermanCompoundTokenizer.getStrictInstance().tokenize(token.getLemma()!);
    if (parts.length === 0) {
      return [...parts];
    }
    let maybeHyphen = '';
    if (parts.length === 1 && token.getLemma() != null) {
      parts = token.getLemma()!.split('-');  // String.split("-"): a literal, trailing empty strings removed
      while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
      if (parts.length > 1) {
        maybeHyphen = '-';
      }
    }
    const firstPart = parts.slice(0, parts.length - 1).join(maybeHyphen);
    const lastPart = StringTools.uppercaseFirstChar(parts[parts.length - 1]!)!;
    const uppercaseLastPart = !(maybeHyphen === '') && StringTools.startsWithUppercase(parts[parts.length - 1]!);
    const lastPartToken = new AnalyzedToken(lastPart, posTag, lastPart);
    let lastPartForms: string[];
    if (posTagRegExp) {
      lastPartForms = super.synthesize(lastPartToken, posTag, true);
    } else {
      lastPartForms = super.synthesize(lastPartToken, posTag);
    }
    const results = new Set<string>();  // avoid dupes
    for (const part of lastPartForms) {
      if (uppercaseLastPart) {
        results.add(firstPart + maybeHyphen + part);
      } else {
        results.add(firstPart + maybeHyphen + StringTools.lowercaseFirstChar(part));
      }
    }
    return [...results];
  }

}
