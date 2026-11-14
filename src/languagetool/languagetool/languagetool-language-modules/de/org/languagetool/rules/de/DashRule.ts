// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/DashRule.java faithful
// StringUtils.equalsAny and countMatches are local functions.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/** StringUtils.countMatches */
function countMatches(str: string, sub: string): number {
  return str.split(sub).length - 1;
}

/**
 * Prüft, dass in Bindestrich-Komposita kein Leerzeichen eingefügt wird (wie z.B. in 'Diäten- Erhöhung').
 *   
 * @author Daniel Naber
 */
export class DashRule extends Rule {

  constructor(messages: ResourceBundle) {
    super();
    super.setCategory(Categories.COMPOUNDING.getCategory(messages));
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/de/beitrag/grammatik-leerzeichen/#fehler-1-leerzeichen-vor-und-nach-satzzeichen'));
    this.addExamplePair(Example.wrong('Bundestag beschließt <marker>Diäten- Erhöhung</marker>'),
                   Example.fixed('Bundestag beschließt <marker>Diäten-Erhöhung</marker>'));
  }

  override getId(): string {
    return 'DE_DASH';
  }

  override getDescription(): string {
    return "Keine Leerzeichen in Bindestrich-Komposita (wie z.B. in 'Diäten- Erhöhung')";
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    let prevToken: string | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!.getToken();
      if (prevToken != null &&
          prevToken.endsWith('-') &&
          prevToken !== '-' &&
          !prevToken.includes('--') &&
          !prevToken.includes('–-')    // first char is some special kind of dash, found in Wikipedia
          ) {
        const firstChar = token.charAt(0);
        if (Character.isUpperCase(firstChar)) {
          if (!['UND', 'ODER', 'BZW'].includes(token) ) {  // ignore "NORD- UND SÜDKOREA"
            const msg = "Möglicherweise fehlt ein 'und' oder ein Komma, oder es wurde nach dem Wort " +
                    'ein überflüssiges Leerzeichen eingefügt. Eventuell haben Sie auch versehentlich einen Bindestrich statt eines Punktes eingefügt.';
            const shortMsg = "Fehlendes 'und' oder Komma oder überflüssiges Leerzeichen?";
            const fromPos = tokens[i - 1]!.getStartPos();
            const ruleMatch = new RuleMatch(this, sentence, fromPos,
                    tokens[i]!.getEndPos(), msg, shortMsg);
            ruleMatch.addSuggestedReplacement(tokens[i-1]!.getToken() + tokens[i]!.getToken());
            if (countMatches(tokens[i-1]!.getToken(), '-') + countMatches(tokens[i]!.getToken(), '-') <= 1) {
              ruleMatch.addSuggestedReplacement(tokens[i-1]!.getToken() + ', ' + tokens[i]!.getToken());
            }
            ruleMatches.push(ruleMatch);
          }
        }
      }      
      prevToken = token;
    }
    return this.toRuleMatchArray(ruleMatches);
  }
}
