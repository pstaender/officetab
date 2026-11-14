// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/multitoken/MultitokenSpellerFilter.java faithful
// Language.getMultitokenSpeller() and getDefaultSpellingRule() are typed as object and Rule (see
// Language.ts): they are a MultitokenSpeller and a SpellingCheckRule.
import type { AnalyzedTokenReadings } from '../../../AnalyzedTokenReadings.ts';
import type { Language } from '../../../Language.ts';
import type { RuleMatch } from '../../RuleMatch.ts';
import type { PatternRule } from '../../patterns/PatternRule.ts';
import { FilterRegistry } from '../../patterns/registry.ts';
import { RuleFilter } from '../../patterns/RuleFilter.ts';
import type { SpellingCheckRule } from '../SpellingCheckRule.ts';
import { StringTools } from '../../../tools/StringTools.ts';
import type { MultitokenSpeller } from './MultitokenSpeller.ts';

export class MultitokenSpellerFilter extends RuleFilter {

   /* Provide suggestions for misspelled multitoken expressions, usually proper nouns*/
  override acceptRuleMatch(match: RuleMatch, _arguments: Map<string, string>, patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    if (patternTokens.every((x) => x.isIgnoredBySpeller())) {
      return null;
    }
    const underlinedError = match.getOriginalErrorStr();
    let lang: Language = (match.getRule() as PatternRule).getLanguage();
    // check the spelling for some languages in a different way
    let areTokensAcceptedBySpeller = false;
    if (lang.getShortCode() === 'en' || lang.getShortCode() === 'de' || lang.getShortCode() === 'pt'
      || lang.getShortCode() === 'nl') {
      if (lang.getShortCodeWithCountryAndVariant().length === 2) {
        // needed in testing
        lang = lang.getDefaultLanguageVariant();
      }
      areTokensAcceptedBySpeller = !this.isMisspelled(underlinedError, lang) ;
    }
    let replacements = (lang.getMultitokenSpeller() as MultitokenSpeller).getSuggestions(underlinedError, areTokensAcceptedBySpeller);
    if (replacements.length === 0) {
      return null;
    }
    // all upper-case suggestions
    if (underlinedError.length > 4 && StringTools.isAllUppercase(underlinedError)) {
      const allupercaseReplacements: string[] = [];
      for (const replacement of replacements) {
        const newReplacement = replacement.toUpperCase();
        if (!allupercaseReplacements.includes(newReplacement) && !(underlinedError === newReplacement)) {
          allupercaseReplacements.push(newReplacement);
        }
      }
      replacements = allupercaseReplacements;
    } else {
      // capitalize suggestion at sentence start
      let wordsStartPos = 1;
      // ignore punctuation marks at the sentence start to do the capitalization
      const tokens = match.getSentence()!.getTokensWithoutWhitespace();
      while (wordsStartPos < tokens.length && (StringTools.isPunctuationMark(tokens[wordsStartPos]!.getToken())
        || StringTools.isNotWordString((tokens[wordsStartPos]!.getToken())))) {
        wordsStartPos++;
      }
      if (patternTokenPos === wordsStartPos) {
        const capitalizedReplacements: string[] = [];
        for (const replacement of replacements) {
          let newReplacement = replacement;
          if (replacement === replacement.toLowerCase()) {
            //do not capitalize iPad
            newReplacement = StringTools.uppercaseFirstChar(replacement)!;
          }
          if (!capitalizedReplacements.includes(newReplacement) && !(underlinedError === newReplacement)) {
            capitalizedReplacements.push(newReplacement);
          }
        }
        replacements = capitalizedReplacements;
      }
    }
    if (replacements.length === 0) {
      return null;
    }
    match.setSuggestedReplacements(replacements);
    return match;
  }

  isMisspelled(s: string, language: Language): boolean {
    const spellerRule = language.getDefaultSpellingRule() as SpellingCheckRule | null;
    if (spellerRule == null) {
      return false;
    }
    const tokens = language.getWordTokenizer().tokenize(s);
    for (const token of tokens) {
      if (spellerRule.isMisspelled(token)) {
        return true;
      }
    }
    return false;
  }
}

FilterRegistry.register('org.languagetool.rules.spelling.multitoken.MultitokenSpellerFilter', () => new MultitokenSpellerFilter());
