// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/PotentialCompoundFilter.java faithful
// GermanyGerman.getInstance() is Languages.getLanguageForShortCode('de-DE') (what it does): a value
// import of GermanyGerman would make the import cycle language module → registerFilters →
// GermanyGerman → German → rules.
import { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { RuleFilter } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/RuleFilter.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import type { German } from '../../language/German.ts';

const GermanyGerman_getInstance = (): German => Languages.getLanguageForShortCode('de-DE') as German;

/*
 * This filter creates a compound word from two tokens. 
 * If the joined word is a valid word and its length is less than 20 characters, 
 * the rule provides the joined word as a suggestion. 
 * Otherwise, it provides the hyphenated word.
 */
export class PotentialCompoundFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, arguments_: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const part1 = arguments_.get('part1')!;
    const part2 = arguments_.get('part2')!;
    let part1capitalized = part1;
    let part2capitalized = part2;
    let part2lowercase = part2;
    if (!StringTools.isMixedCase(part2) && !StringTools.isAllUppercase(part2)) {
      part2lowercase = part2.toLowerCase();
      part2capitalized = StringTools.uppercaseFirstChar(part2.toLowerCase())!;
    }
    if (!StringTools.isMixedCase(part1) && !StringTools.isAllUppercase(part1)) {
      part1capitalized = StringTools.uppercaseFirstChar(part1.toLowerCase())!;
    }
    const joinedWord = part1capitalized + part2lowercase;
    const hyphenatedWord = part1capitalized + '-' + part2capitalized;
    const replacements: string[] = [];
    // create an AnalyzedSentence without instantiating a new JLanguageTool
    const tokens = [joinedWord];
    const tokensList = GermanyGerman_getInstance().getTagger().tag(tokens);
    const tokensArray: AnalyzedTokenReadings[] = new Array<AnalyzedTokenReadings>(2);
    const sentenceStartToken = new AnalyzedToken('', 'SENT_START', null);
    const startTokenArray: AnalyzedToken[] = new Array<AnalyzedToken>(1);
    startTokenArray[0] = sentenceStartToken;
    tokensArray[0] = new AnalyzedTokenReadings(startTokenArray, 0);
    tokensArray[1] = tokensList[0]!;
    const analyzedSentence = new AnalyzedSentence(tokensArray);
    // check with the spelling rule
    const matches = GermanyGerman_getInstance().getDefaultSpellingRule().match(analyzedSentence);
    if (matches.length === 0) {
      if (joinedWord.length > 20) {
        replacements.push(hyphenatedWord);
      }
      replacements.push(joinedWord);
    } else {
      replacements.push(hyphenatedWord);
    }
    if (replacements.length !== 0) {
      const message = match.getMessage();
      const ruleMatch = new RuleMatch(match.getRule(), match.getSentence(), match.getFromPos(), match.getToPos(),
          message, match.getShortMessage());
      ruleMatch.setType(match.getType());
      ruleMatch.setSuggestedReplacements(replacements);
      return ruleMatch;
    }
    return null;
  }
}

FilterRegistry.register('org.languagetool.rules.de.PotentialCompoundFilter', () => new PotentialCompoundFilter());
