// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/WiederVsWiderRule.java faithful
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * Check incorrect use of "spiegelt ... wider", namely using "wieder" instead
 * of "wider", e.g. in "Das spiegelt die Situation wieder" (incorrect).
 *   
 * @author Daniel Naber
 */
export class WiederVsWiderRule extends Rule {

  constructor(messages: ResourceBundle) {
    super();
    super.setCategory(Categories.TYPOS.getCategory(messages));
    this.addExamplePair(Example.wrong('Das spiegelt die Situation in Deutschland <marker>wieder</marker>.'),
                   Example.fixed('Das spiegelt die Situation in Deutschland <marker>wider</marker>.'));
  }
  
  override getId(): string {
    return 'DE_WIEDER_VS_WIDER';
  }

  override getDescription(): string {
    return "Möglicher Tippfehler 'spiegeln ... wieder (wider)'";
  }

  override estimateContextForSureMatch(): number {
    return 0;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    let foundSpiegelt = false;
    let foundWieder = false;
    let foundWider = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!.getToken();
      if (tokens[i]!.hasLemma('spiegeln')) {
        foundSpiegelt = true;
      } else if (StringEqualsIgnoreCase(token, 'wieder') && foundSpiegelt) {
        foundWieder = true;
      } else if (StringEqualsIgnoreCase(token, 'wider') && foundSpiegelt) {
        foundWider = true;
      }
      if (foundSpiegelt && foundWieder && !foundWider &&
          !(tokens.length > i + 2 && (tokens[i + 1]!.getToken() === 'wider' || tokens[i + 2]!.getToken() === 'wider') )
         ) {
        const msg = "'wider' in 'widerspiegeln' wird mit 'i' statt mit 'ie' " +
                "geschrieben, z.B. 'Das spiegelt die Situation gut wider.'";
        const shortMsg = "'wider' in 'widerspiegeln' wird mit 'i' geschrieben";
        const pos = tokens[i]!.getStartPos();
        const ruleMatch = new RuleMatch(this, sentence, pos, pos + token.length, msg, shortMsg);
        ruleMatch.setSuggestedReplacement('wider');
        ruleMatches.push(ruleMatch);
        foundSpiegelt = false;
        foundWieder = false;
        foundWider = false;
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }
}
