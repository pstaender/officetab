// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractAdvancedSynthesizerFilter.java faithful
// String.replace(CharSequence, CharSequence) is replaceAll with a function, so that "$" in a
// replacement stays literal as in Java.
import { AnalyzedToken } from '../AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { StringTools } from '../tools/StringTools.ts';
import { parseJavaInt, RuleFilter } from './patterns/RuleFilter.ts';
import { RuleMatch } from './RuleMatch.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

const replace = (s: string, target: string, replacement: string): string => s.replaceAll(target, () => replacement);

/*
 * Synthesize suggestions using the lemma from one token (lemma_from) 
 * and the POS tag from another one (postag_from).
 * 
 * The lemma_select and postag_select attributes are required 
 * to choose one among several possible readings.
 */
export abstract class AbstractAdvancedSynthesizerFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, arguments_: Map<string, string>, _patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {

//    if (match.getSentence().getText().contains("Jo pensem")) {
//      int ii=0;
//      ii++;
//    }

    const postagSelect = this.getRequired('postagSelect', arguments_);
    const lemmaSelect = this.getRequired('lemmaSelect', arguments_);
    const postagFromStr = this.getRequired('postagFrom', arguments_);
    const lemmaFromStr = this.getRequired('lemmaFrom', arguments_);
    const newLemma = this.getOptional('newLemma', arguments_, '')!;

    let postagFrom = 0;
    if (postagFromStr.startsWith('marker')) {
      while (postagFrom < patternTokens.length && patternTokens[postagFrom]!.getStartPos() < match.getFromPos()) {
        postagFrom++;
      }
      postagFrom++;
      if (postagFromStr.length > 6) {
        postagFrom += parseJavaInt(replace(postagFromStr, 'marker', ''));
      }
    } else {
      postagFrom = parseJavaInt(postagFromStr);
    }
    if (postagFrom < 1 || postagFrom > patternTokens.length) {
      throw new Error('IllegalArgumentException: AdvancedSynthesizerFilter: Index out of bounds in '
          + match.getRule().getFullId() + ', value: ' + postagFromStr);
    }
    let lemmaFrom = 0;
    if (lemmaFromStr.startsWith('marker')) {
      while (lemmaFrom < patternTokens.length && patternTokens[lemmaFrom]!.getStartPos() < match.getFromPos()) {
        lemmaFrom++;
      }
      lemmaFrom++;
      if (lemmaFromStr.length > 6) {
        lemmaFrom += parseJavaInt(replace(lemmaFromStr, 'marker', ''));
      }
    } else {
      lemmaFrom = parseJavaInt(lemmaFromStr);
    }
    if (lemmaFrom < 1 || lemmaFrom > patternTokens.length) {
      throw new Error('IllegalArgumentException: AdvancedSynthesizerFilter: Index out of bounds in '
          + match.getRule().getFullId() + ', value: ' + lemmaFromStr);
    }

    const postagReplace = this.getOptional('postagReplace', arguments_);

    let desiredLemma = this.getAnalyzedToken(patternTokens[lemmaFrom - 1]!, lemmaSelect).getLemma();
    const originalPostag = this.getAnalyzedToken(patternTokens[lemmaFrom - 1]!, lemmaSelect).getPOSTag();
    let desiredPostag = this.getAnalyzedToken(patternTokens[postagFrom - 1]!, postagSelect).getPOSTag();
    if (newLemma.length !== 0) {
      if (newLemma.startsWith('_')) {
        desiredLemma = this.getNewLemma(desiredLemma, newLemma);
      } else {
        desiredLemma = newLemma;
      }
    }
    if (desiredLemma == null) {
      return null;
    }

    if (desiredPostag == null) {
      throw new Error('IllegalArgumentException: AdvancedSynthesizerFilter: undefined POS tag for rule ' +
        match.getRule().getFullId() + " with POS regex '" + postagSelect + "' for token: " + String(patternTokens[postagFrom - 1]));
    }

    if (postagReplace != null) {
      desiredPostag = this.getCompositePostag(lemmaSelect, postagSelect, originalPostag!, desiredPostag, postagReplace);
    }

    // take capitalization from the lemma (?)
    const isWordCapitalized = StringTools.isCapitalizedWord(patternTokens[lemmaFrom - 1]!.getToken());
    const isWordAllupper = StringTools.isAllUppercase(patternTokens[lemmaFrom - 1]!.getToken());
    const token = new AnalyzedToken('', desiredPostag, desiredLemma);
    const language = this.getLanguageFromRuleMatch(match);
    const synth = language.getSynthesizer()!;
    const replacements = synth.synthesize(token, desiredPostag, true);
    if (replacements.length > 0) {
      const newMatch = new RuleMatch(match.getRule(), match.getSentence(), match.getFromPos(), match.getToPos(),
          match.getMessage(), match.getShortMessage());
      newMatch.setType(match.getType());
      const replacementsList: string[] = [];

      let suggestionUsed = false;
      for (const r of match.getSuggestedReplacements()) {
        for (let nr of replacements) {
          if (this.isSuggestionException(nr, desiredPostag)) {
            continue;
          }
          if (r.includes('{suggestion}') || r.includes('{Suggestion}') || r.includes('{SUGGESTION}')) {
            suggestionUsed = true;
          }
          if (isWordCapitalized) {
            nr = StringTools.uppercaseFirstChar(nr)!;
          }
          if (isWordAllupper) {
            nr = nr.toUpperCase();
          }
          let completeSuggestion = replace(r, '{suggestion}', nr);
          completeSuggestion = replace(completeSuggestion, '{Suggestion}', StringTools.uppercaseFirstChar(nr)!);
          completeSuggestion = replace(completeSuggestion, '{SUGGESTION}', nr.toUpperCase());
          if (!replacementsList.includes(completeSuggestion)) {
            replacementsList.push(completeSuggestion);
          }
        }
      }
      if (!suggestionUsed) {
        replacementsList.push(...replacements);
      }
      const adjustedReplacementsList: string[] = [];
      for (const replacement of replacementsList) {
        adjustedReplacementsList.push(language.adaptSuggestion(replacement, ''));
      }
      newMatch.setSuggestedReplacements(adjustedReplacementsList);
      return newMatch;
    }
    return match;
  }

  getCompositePostag(lemmaSelect: string, postagSelect: string, originalPostag: string,
      desiredPostag: string, postagReplace: string): string {
    const aPattern = Pattern.compile(lemmaSelect, Pattern.UNICODE_CASE);
    const bPattern = Pattern.compile(postagSelect, Pattern.UNICODE_CASE);
    const aMatcher = aPattern.matcher(originalPostag);
    const bMatcher = bPattern.matcher(desiredPostag);
    let result = postagReplace;
    if (aMatcher.matches() && bMatcher.matches()) {
      for (let i = 1; i <= aMatcher.groupCount(); i++) {
        const groupStr = aMatcher.group(i);
        if (groupStr != null) {
          const toReplace = '\\a' + i;
          result = replace(result, toReplace, groupStr);
        }
      }
      for (let i = 1; i <= bMatcher.groupCount(); i++) {
        const groupStr = bMatcher.group(i);
        if (groupStr != null) {
          const toReplace = '\\b' + i;
          result = replace(result, toReplace, groupStr);
        }
      }
    }
    return result;
  }

  protected isSuggestionException(_token: string, _desiredPostag: string): boolean {
    return false;
  }

  private getAnalyzedToken(aToken: AnalyzedTokenReadings, regexp: string): AnalyzedToken {
    const pattern = Pattern.compile(regexp);
    for (const analyzedToken of aToken) {
      let posTag = analyzedToken.getPOSTag();
      if (posTag == null) {
        posTag = 'UNKNOWN';
      }
      const m = pattern.matcher(posTag);
      if (m.matches()) {
        return analyzedToken;
      }
    }
    // Return the first one. Something is wrong, anyway
    return aToken.getAnalyzedToken(0);
  }

  protected getNewLemma(_word: string | null, _newLemma: string): string | null {
    return null;
  }

}
