// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/synthesis/en/EnglishSynthesizer.java faithful
// INSTANCE and the AvsAnRule are created on first use (Java creates them when the class is
// loaded), as the dictionaries must have been preloaded into the data broker first and the rule
// needs the English language registered. The synthesize overloads are one method (see
// BaseSynthesizer); so are the lookup overloads (results undefined: BaseSynthesizer's).
import type { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { BaseSynthesizer } from '../../../../../../languagetool-core/org/languagetool/synthesis/BaseSynthesizer.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import { AvsAnRule } from '../../rules/en/AvsAnRule.ts';

const RESOURCE_FILENAME = '/en/english_synth.dict';
const TAGS_FILE_NAME = '/en/english_tags.txt';
const SOR_FILE_NAME = '/en/en.sor';

const exceptions = ["ne'er", "e'er", "o'er", "ol'", "ma'am", "n't", 'informations'];

// A special tag to add determiners.
const ADD_DETERMINER = '+DT';

// A special tag to add only indefinite articles.
const ADD_IND_DETERMINER = '+INDT';

let instance: EnglishSynthesizer | null = null;

/**
 * English word form synthesizer.
 * Based on part-of-speech lists in Public Domain. See readme.txt for details,
 * the POS tagset is described in tagset.txt.
 *
 * There are to special additions:
 * <ol>
 *    <li>+DT - tag that adds "a" or "an" (according to the way the word is
 *    pronounced) and "the"</li>
 *    <li>+INDT - a tag that adds only "a" or "an"</li>
 * </ol>
 *
 * @author Marcin Miłkowski
 */
export class EnglishSynthesizer extends BaseSynthesizer {

  private _aVsAnRule: AvsAnRule | null = null;
  private get aVsAnRule(): AvsAnRule {
    return (this._aVsAnRule ??= new AvsAnRule(JLanguageTool.getMessageBundle(Languages.getLanguageForShortCode('en'))));
  }

  static get INSTANCE(): EnglishSynthesizer {
    return (instance ??= new EnglishSynthesizer());
  }

  /** @deprecated use {@link #INSTANCE} (the lang parameter is ignored) */
  constructor(_lang?: Language) {
    super(SOR_FILE_NAME, RESOURCE_FILENAME, TAGS_FILE_NAME, 'en');
  }

  /**
   * Get a form of a given AnalyzedToken, where the form is defined by a
   * part-of-speech tag.
   *
   * With posTagRegExp: special English regexp based synthesizer that allows adding articles
   * when the regexp-based tag ends with a special signature {@code \\+INDT} or {@code \\+DT}.
   *
   * @param token AnalyzedToken to be inflected.
   * @param posTag A desired part-of-speech tag.
   * @return String value - inflected word.
   * @since 2.5
   */
  override synthesize(token: AnalyzedToken, posTag: string, posTagRegExp?: boolean): string[] {
    if (posTagRegExp === undefined) {
      if (posTag.startsWith(this.SPELLNUMBER_TAG)) {
        return super.synthesize(token, posTag);
      }
      const aOrAn = this.aVsAnRule.suggestAorAn(token.getToken());
      if (ADD_DETERMINER === posTag) {
        return [aOrAn, 'the ' + StringTools.lowercaseFirstCharIfCapitalized(token.getToken())];
      } else if (ADD_IND_DETERMINER === posTag) {
        return [aOrAn];
      }
      return this.removeExceptions(super.synthesize(token, posTag));
    }
    if (posTag.startsWith(this.SPELLNUMBER_TAG)) {
      return this.synthesize(token, posTag);
    }
    if (posTagRegExp) {
      let myPosTag = posTag;
      let det = '';
      if (posTag.endsWith(ADD_IND_DETERMINER)) {
        myPosTag = myPosTag.substring(0, myPosTag.indexOf(ADD_IND_DETERMINER) - '\\'.length);
        det = this.aVsAnRule.suggestAorAn(token.getLemma()!);
        det = det.substring(0, det.indexOf(' ') + ' '.length);
      } else if (posTag.endsWith(ADD_DETERMINER)) {
        myPosTag = myPosTag.substring(0, myPosTag.indexOf(ADD_DETERMINER) - '\\'.length);
        det = 'the ';
      }

      this.initPossibleTags();
      const p = Pattern.compile(myPosTag);
      const results: string[] = [];

      for (const tag of this.possibleTags!) {
        const m = p.matcher(tag);
        if (m.matches() && token.getLemma() != null) {
          this.lookup(token.getLemma()!, tag, results, det);
        }
      }
      return this.removeExceptions(results);
    }
    return this.removeExceptions(this.synthesize(token, posTag));
  }

  /** BaseSynthesizer.lookup(lemma, posTag), or with results: the private lookup adding the determiner. */
  protected override lookup(lemma: string, posTag: string, results?: string[], determiner?: string): string[] {
    if (results === undefined) {
      return super.lookup(lemma, posTag);
    }
    const lookup = super.lookup(lemma, posTag);
    for (const result of lookup) {
      //results.add(determiner + StringTools.lowercaseFirstCharIfCapitalized(result)); //why lowercase?
      results.push(determiner + result);
    }
    return results;
  }

  protected override isException(w: string): boolean {
    // remove: 've, 's, 're...
    return w.startsWith("'") || exceptions.includes(w);
  }



}
