// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SimilarNameRule.java faithful
// StringUtils.getLevenshteinDistance is a local function. namesSoFar (a HashSet in Java) iterates
// in insertion order here, so with several similar names the first one used is suggested.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TextLevelRule } from '../../../../../../languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/** StringUtils.getLevenshteinDistance */
function getLevenshteinDistance(s: string, t: string): number {
  let p = Array.from({ length: s.length + 1 }, (_, i) => i);
  for (let j = 1; j <= t.length; j++) {
    const d = [j];
    for (let i = 1; i <= s.length; i++) {
      const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i] = Math.min(d[i - 1]! + 1, p[i]! + 1, p[i - 1]! + cost);
    }
    p = d;
  }
  return p[s.length]!;
}

const MIN_LENGTH = 4;
const MAX_DIFF = 1;

/**
 * Search for names similar to ones used before in the same text, as these
 * might be typos. Note: this rule if off by default, as it only works on known
 * names and the internal dictionary doesn't know that many names.
 * 
 * @author Daniel Naber
 * @since 3.0
 */
export class SimilarNameRule extends TextLevelRule {
  
  constructor(messages: ResourceBundle) {
    super(messages);
    super.setCategory(Categories.TYPOS.getCategory(messages));
    this.addExamplePair(Example.wrong('Angela Müller ist CEO. <marker>Miller</marker> wurde in Hamburg geboren.'),
                   Example.fixed('Angela Müller ist CEO. <marker>Müller</marker> wurde in Hamburg geboren.'));
    this.setDefaultOff();
  }

  override getId(): string {
    return 'DE_SIMILAR_NAMES';
  }

  override getDescription(): string {
    return 'Mögliche Tippfehler in Namen finden';
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const namesSoFar = new Set<string>();
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (const token of tokens) {
        const word = token.getToken();
        // not tagged = too many correct words are not known so we cannot use that:
        //boolean isName = word.length() > MIN_LENGTH && (token.hasPartialPosTag("EIG:") || !token.isTagged());
        const isMaybeName = word.length >= MIN_LENGTH 
                && ((token.hasPartialPosTag('EIG:') && !token.hasPartialPosTag(':COU')) || token.isPosTagUnknown())
                && word !== 'Dein' && word !== 'Deine' && word !== 'Deinen' && word !== 'Deiner' && word !== 'Deines' && word !== 'Deinem'
                && word !== 'Ihr' && word !== 'Ihre' && word !== 'Ihren' && word !== 'Ihrer' && word !== 'Ihres' && word !== 'Ihrem';
        if (isMaybeName && StringTools.startsWithUppercase(word)) {
          const similarName = this.similarName(word, namesSoFar);
          if (similarName != null) {
            const msg = "'" + word + "' ähnelt dem vorher benutzten '" + similarName + "', handelt es sich evtl. um einen Tippfehler?";
            const ruleMatch = new RuleMatch(this, sentence, pos+token.getStartPos(), pos+token.getEndPos(), msg);
            ruleMatch.setSuggestedReplacement(similarName);
            ruleMatches.push(ruleMatch);
          }
          namesSoFar.add(word);
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private similarName(nameHere: string, namesSoFar: Set<string>): string | null {
    for (const name of namesSoFar) {
      if (name === nameHere) {
        continue;
      }
      const lenDiff = Math.abs(name.length - nameHere.length);
      const nameEndsWithS = name.endsWith('s') && !nameHere.endsWith('s');
      const otherNameEndsWithS = !name.endsWith('s') && nameHere.endsWith('s');
      const nameEndsWithN = name.endsWith('n') && !nameHere.endsWith('n');   // probably a dative
      const otherNameEndsWithN = !name.endsWith('n') && nameHere.endsWith('n');
      if (nameEndsWithS || otherNameEndsWithS || nameEndsWithN || otherNameEndsWithN) {
        // we assume this is a genitive, e.g. "Angela Merkels Ehemann"
        continue;
      }
      if (lenDiff <= MAX_DIFF && getLevenshteinDistance(name, nameHere) <= MAX_DIFF) {
        return name;
      }
    }
    return null;
  }

  override minToCheckParagraph(): number {
    return -1;
  }
  
}
