// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/MatchState.java faithful
// The two setToken overloads are one method: (token) or (tokens, index, next). TreeSet<String> is
// a sorted array without duplicates (Java's natural String order is JavaScript's default sort).
import { AnalyzedToken } from '../../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../JLanguageTool.ts';
import type { Language } from '../../Language.ts';
import type { Synthesizer } from '../../synthesis/Synthesizer.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { CaseConversionHelper } from './CaseConversionHelper.ts';
import { IncludeRange, type Match } from './Match.ts';
import { PatternRuleMatcher } from './PatternRuleMatcher.ts';

/** TreeSet<String>.toArray(): sorted, without duplicates. */
function treeSet(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * The state of a matching process. This state is <strong>NOT</strong> thread-safe.
 *
 * @author Stefan Lotties
 * @since 2.3
 */
export class MatchState {

  private readonly match: Match;
  private readonly synthesizer: Synthesizer | null;

  private formattedToken: AnalyzedTokenReadings | null = null;
  private matchedToken: AnalyzedTokenReadings | null = null;
  private skippedTokens: string | null = null;

  constructor(match: Match, synthesizer: Synthesizer | null) {
    this.match = match;
    this.synthesizer = synthesizer;
    const lemma = match.getLemma();
    if (!StringTools.isEmpty(lemma)) {
      this.formattedToken = new AnalyzedTokenReadings(new AnalyzedToken(lemma!, match.getPosTag(), lemma), 0);
    }
  }

  /**
   * Sets the token to be formatted etc. and includes the support for
   * including the skipped tokens.
   *
   * @param tokens the token, or an array of tokens
   * @param index Index of the token to be formatted
   * @param next Position of the next token (the skipped tokens are the ones between the tokens[index] and tokens[next]
   */
  setToken(tokens: AnalyzedTokenReadings | AnalyzedTokenReadings[], index?: number, next?: number): void {
    if (!Array.isArray(tokens)) {
      const token = tokens;
      if (this.match.isStaticLemma()) {
        this.matchedToken = token;
      } else {
        this.formattedToken = token;
      }
      return;
    }
    let idx = index!;
    if (index! >= tokens.length) {
      // TODO: hacky workaround, find a proper solution. See EnglishPatternRuleTest.testBug()
      idx = tokens.length - 1;
    }
    this.setToken(tokens[idx]!);
    const includeSkipped = this.match.getIncludeSkipped();
    if (includeSkipped === IncludeRange.FOLLOWING) {
      this.formattedToken = null;
    }
    if (next! > 1 && includeSkipped !== IncludeRange.NONE) {
      let sb = '';
      for (let k = index! + 1; k < index! + next!; k++) {
        if (tokens[k]!.isWhitespaceBefore()
            && !(k === index! + 1 && includeSkipped === IncludeRange.FOLLOWING)) {
          sb += ' ';
        }
        sb += tokens[k]!.getToken();
      }
      this.skippedTokens = sb;
    } else {
      this.skippedTokens = '';
    }
  }

  filterReadings(): AnalyzedTokenReadings | null {
    const l: AnalyzedToken[] = [];
    if (this.formattedToken != null) {
      if (this.match.isStaticLemma()) {
        // Note: we want the token without ignored characters so we can't use matchedToken.getToken()
        this.matchedToken!.leaveReading(new AnalyzedToken(this.matchedToken!.getReadings()[0]!.getToken(),
                this.match.getPosTag(), this.formattedToken.getToken()));
        this.formattedToken = this.matchedToken!;
      }
      // Note: we want the token without ignored characters so we can't use formattedToken.getToken()
      let token = this.formattedToken.getAnalyzedToken(0).getToken();
      const regexMatch = this.match.getRegexMatch();
      const regexReplace = this.match.getRegexReplace();
      if (regexMatch != null && regexReplace != null) {
        /* only replace if it is something to replace */
        token = regexMatch.matcher(token).replaceAll(regexReplace);
      }
      token = this.convertCase(token, token, null);

      const posTag = this.match.getPosTag();
      if (posTag != null) {
        const numRead = this.formattedToken.getReadingsLength();
        if (this.match.isPostagRegexp()) {
          const pPosRegexMatch = this.match.getPosRegexMatch()!;
          const posTagReplace = this.match.getPosTagReplace();
          let targetPosTag: string;
          for (let i = 0; i < numRead; i++) {
            const testTag = this.formattedToken.getAnalyzedToken(i).getPOSTag();
            if (testTag != null && pPosRegexMatch.matcher(testTag).matches()) {
              targetPosTag = testTag;
              if (posTagReplace != null) {
                targetPosTag = pPosRegexMatch.matcher(targetPosTag).replaceAll(posTagReplace);
              }
              l.push(new AnalyzedToken(token, targetPosTag,
                  this.formattedToken.getAnalyzedToken(i).getLemma()));
              l[l.length - 1]!.setWhitespaceBefore(this.formattedToken.isWhitespaceBefore());
            }
          }
          if (l.length === 0) {
            l.push(...this.getNewToken(numRead, token));
          }
        } else {
          l.push(...this.getNewToken(numRead, token));
        }
        const lemma = this.formattedToken.getAnalyzedToken(0).getLemma();
        if (this.formattedToken.isSentenceEnd()) {
          l.push(new AnalyzedToken(this.formattedToken.getToken(), JLanguageTool.SENTENCE_END_TAGNAME, lemma));
        }
        if (this.formattedToken.isParagraphEnd()) {
          l.push(new AnalyzedToken(this.formattedToken.getToken(), JLanguageTool.PARAGRAPH_END_TAGNAME, lemma));
        }

      }
    }
    if (l.length === 0) {
      return this.formattedToken;
    }
    const formattedToken = this.formattedToken!;
    const anTkRead = new AnalyzedTokenReadings(
        l,
        formattedToken.getStartPos());
    // TODO: in case original had ignored characters we want to restore readings.token
    // but there's no setToken() available :(
//    anTkRead.setToken(formattedToken.getToken());

    anTkRead.setWhitespaceBefore(formattedToken.getWhitespaceBefore());
    if (formattedToken.getChunkTags().length !== 0) {
      anTkRead.setChunkTags(formattedToken.getChunkTags());
    }
    if (formattedToken.isImmunized()) {
      anTkRead.immunize(formattedToken.getImmunizationSourceLine());
    }
    return anTkRead;
  }

  /**
   * Converts case of the string token according to match element attributes.
   * @param s Token to be converted.
   * @param sample the sample string used to determine how the original string looks like (used only on case preservation)
   * @return Converted string.
   */
  convertCase(s: string, sample: string, lang: Language | null): string {
    return CaseConversionHelper.convertCase(this.match.getCaseConversionType(), s, sample, lang);
  }

  private getNewToken(numRead: number, token: string): AnalyzedToken[] {
    const posTag = this.match.getPosTag();
    const formattedToken = this.formattedToken!;
    const list: AnalyzedToken[] = [];
    let lemma: string | null = '';
    for (let j = 0; j < numRead; j++) {
      const tempPosTag = formattedToken.getAnalyzedToken(j).getPOSTag();
      if (tempPosTag != null) {
        if (tempPosTag === posTag && formattedToken.getAnalyzedToken(j).getLemma() != null) {
          lemma = formattedToken.getAnalyzedToken(j).getLemma();
        }
        if (StringTools.isEmpty(lemma)) {
          lemma = formattedToken.getAnalyzedToken(0).getLemma();
        }
        list.push(new AnalyzedToken(token, posTag, lemma));
        list[list.length - 1]!.setWhitespaceBefore(
            formattedToken.isWhitespaceBefore());
      }
    }
    return list;
  }

  /**
   * Gets all strings formatted using the match element.
   */
  toFinalString(lang: Language | null): string[] {
    let formattedString: (string | null)[] = [null];
    const formattedToken = this.formattedToken;
    if (formattedToken != null) {
      const readingCount = formattedToken.getReadingsLength();
      formattedString[0] = formattedToken.getToken();

      const pRegexMatch = this.match.getRegexMatch();
      const regexReplace = this.match.getRegexReplace();
      if (pRegexMatch != null) {
        if (lang != null && lang.getShortCode() === 'ar') {
           formattedString[0] = StringTools.removeTashkeel(formattedString[0]!);
        }
        formattedString[0] = pRegexMatch.matcher(formattedString[0]!).replaceAll(regexReplace!);
      }

      const posTag = this.match.getPosTag();
      if (posTag != null) {
        if (this.synthesizer == null) {
          formattedString[0] = formattedToken.getToken();
        } else if (this.match.isPostagRegexp()) {
          const wordForms: string[] = [];
          let oneForm = false;
          for (let k = 0; k < readingCount; k++) {
            if (formattedToken.getAnalyzedToken(k).getLemma() == null) {
              const posUnique = formattedToken.getAnalyzedToken(k).getPOSTag();
              if (posUnique == null) {
                wordForms.push(formattedToken.getToken());
                oneForm = true;
              } else {
                if (JLanguageTool.SENTENCE_START_TAGNAME === posUnique
                    || JLanguageTool.SENTENCE_END_TAGNAME === posUnique
                    || JLanguageTool.PARAGRAPH_END_TAGNAME === posUnique) {
                  if (!oneForm) {
                    wordForms.push(formattedToken.getToken());
                  }
                  oneForm = true;
                } else {
                  oneForm = false;
                }
              }
            }
          }
          const targetPosTag = this.getTargetPosTag();
          if (!oneForm) {
            for (let i = 0; i < readingCount; i++) {
              const possibleWordForms = this.synthesizer.synthesize(
                  formattedToken.getAnalyzedToken(i), targetPosTag, true);
              if (possibleWordForms != null && possibleWordForms.length > 0) {
                wordForms.push(...possibleWordForms);
              }
            }
          }
          if (wordForms.length === 0) {
            formattedString[0] = '(' + formattedToken.getToken() + ')';
          } else {
            formattedString = treeSet(wordForms);
          }
        } else {
          const wordForms: string[] = [];
          for (let i = 0; i < readingCount; i++) {
            const possibleWordForms = this.synthesizer.synthesize(formattedToken.getAnalyzedToken(i), posTag);
            if (possibleWordForms != null) {
              wordForms.push(...possibleWordForms);
            }
          }
          formattedString = treeSet(wordForms);
        }
      }
    }
    let original: string;
    if (this.match.isStaticLemma()) {
      original = this.matchedToken != null ? this.matchedToken.getToken() : '';
    } else {
      original = this.formattedToken != null ? this.formattedToken.getToken() : '';
    }
    for (let i = 0; i < formattedString.length; i++) {
      formattedString[i] = this.convertCase((formattedString[i] != null ? formattedString[i]! : ''), original, lang);
    }
    // TODO should case conversion happen before or after including skipped tokens?
    const includeSkipped = this.match.getIncludeSkipped();
    if (includeSkipped !== IncludeRange.NONE && this.skippedTokens != null
        && this.skippedTokens !== '') {
      const helper: string[] = new Array<string>(formattedString.length);
      for (let i = 0; i < formattedString.length; i++) {
        if (formattedString[i] == null) {
          formattedString[i] = '';
        }
        helper[i] = formattedString[i] + this.skippedTokens;
      }
      formattedString = helper;
    }
    if (this.match.checksSpelling() && lang != null) {
      const formattedStringElements = formattedString as string[];
      // tagger-based speller
      const analyzed = lang.getTagger().tag(
          formattedStringElements);
      for (let i = 0; i < formattedString.length; i++) {
        const analyzedToken = analyzed[i]!.getAnalyzedToken(0);
        if (analyzedToken.getLemma() == null && analyzedToken.hasNoTag()) {
          formattedString[i] = PatternRuleMatcher.MISTAKE;
        }
      }
    }
    return formattedString as string[];
  }

  /**
   * Format POS tag using parameters already defined in the class.
   *
   * @return Formatted POS tag as String.
   */
  // FIXME: gets only the first POS tag that matches, this can be wrong
  // on the other hand, many POS tags = too many suggestions?
  // POS tags can be chosen by the synthesizer of each language: synthesizer.getTargetPosTag()
  getTargetPosTag(): string {
    let targetPosTag = this.match.getPosTag();
    const posTags: string[] = [];
    const pPosRegexMatch = this.match.getPosRegexMatch();
    const posTagReplace = this.match.getPosTagReplace();
    if (this.match.isStaticLemma()) {
      for (const analyzedToken of this.matchedToken!) {
        const tst = analyzedToken.getPOSTag();
        if (tst != null && pPosRegexMatch!.matcher(tst).matches()) {
          posTags.push(tst);
        }
      }
      targetPosTag = this.synthesizer!.getTargetPosTag(posTags, targetPosTag!);
      if (pPosRegexMatch != null && posTagReplace != null && posTags.length !== 0) {
        targetPosTag = pPosRegexMatch.matcher(targetPosTag!).replaceAll(posTagReplace);
      }
    } else {
      for (const analyzedToken of this.formattedToken!) {
        const tst = analyzedToken.getPOSTag();
        if (tst != null && pPosRegexMatch!.matcher(tst).matches()) {
          posTags.push(tst);
        }
      }
      targetPosTag = this.synthesizer!.getTargetPosTag(posTags, targetPosTag!);
      if (pPosRegexMatch != null && posTagReplace != null) {
        if (posTags.length === 0) {
          posTags.push(targetPosTag!);
        }
        let sb = '';
        const posTagLen = posTags.length;
        let l = 0;
        for (let lPosTag of posTags) {
          l++;
          lPosTag = pPosRegexMatch.matcher(lPosTag).replaceAll(posTagReplace);
          if (this.match.setsPos()) {
            lPosTag = this.synthesizer!.getPosTagCorrection(lPosTag);
          }
          sb += lPosTag;
          if (l < posTagLen) {
            sb += '|';
          }
        }
        targetPosTag = sb;
      }
    }
    return targetPosTag!;
  }

  /**
   * Method for getting the formatted match as a single string. In case of
   * multiple matches, it joins them using a regular expression operator "|".
   * @return Formatted string of the matched token.
   */
  toTokenString(): string {
    const stringToFormat = this.toFinalString(null);
    return stringToFormat.join('|');
  }

  getMatch(): Match {
    return this.match;
  }
}
