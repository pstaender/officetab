// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/CompoundCoherencyRule.java faithful
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TextLevelRule } from '../../../../../../languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import { StringUtils_isNumeric } from '../../../../../../../jdk/java/lang/Exceptions.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * Check consistent spelling for German compounds. It's a style issue
 * if a compound is written once with and once without hyphen in the same text.
 * E.g. "Zahnärzteverband" and "Zahnärzte-Verband"
 * @author Daniel Naber
 */
export class CompoundCoherencyRule extends TextLevelRule {

  constructor(messages: ResourceBundle) {
    super();
    super.setCategory(Categories.STYLE.getCategory(messages));
    this.addExamplePair(Example.wrong('Ein Helpdesk gliedert sich in verschiedene Level. Die Qualität des <marker>Help-Desks</marker> ist wichtig.'),
                   Example.fixed('Ein Helpdesk gliedert sich in verschiedene Level. Die Qualität des <marker>Helpdesks</marker> ist wichtig.'));
  }

  override getId(): string {
    return 'DE_COMPOUND_COHERENCY';
  }

  override getDescription(): string {
    return 'Einheitliche Schreibweise bei Komposita (mit oder ohne Bindestrich)';
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const normToTextOccurrences = new Map<string, string[]>();
    let pos = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (const atr of tokens) {
        const lemmaOrNull = this.getLemma(atr);
        const token = atr.getToken();
        if (token.length === 0) {
          continue;
        }
        // The whole implementation could be simpler, but this way we also catch cases where
        // the word (and thus its lemma) isn't known.
        const lemma = lemmaOrNull != null ? lemmaOrNull : token;
        const normToken = lemma.replaceAll('-', '').toLowerCase();
        if (StringUtils_isNumeric(normToken)) {
          // avoid messages about "2-3" and "23" both being used
          break;
        }
        const textOcc = normToTextOccurrences.get(normToken);
        if (textOcc != null) {
          if (!textOcc.some((f) => StringEqualsIgnoreCase(f, lemma))) {
            const other = textOcc[0]!;
            if (this.containsHyphenInside(other) || this.containsHyphenInside(token)) {
              const msg = "Uneinheitliche Verwendung von Bindestrichen. Der Text enthält sowohl '" + token + "' als auch '" + other + "'.";
              const ruleMatch = new RuleMatch(this, sentence, pos + atr.getStartPos(), pos + atr.getEndPos(), msg);
              if (StringEqualsIgnoreCase(token.replaceAll('-', ''), other.replaceAll('-', ''))) {
                // might be different inflected forms, so only suggest if really just the hyphen is different:
                ruleMatch.setSuggestedReplacement(other);
              }
              ruleMatches.push(ruleMatch);
            }
          }
        } else {
          const l: string[] = [];
          l.push(lemma);
          if (!normToTextOccurrences.has(normToken)) normToTextOccurrences.set(normToken, l);
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private containsHyphenInside(token: string): boolean {
    return token.includes('-') && !token.startsWith('-') && !token.endsWith('-');
  }

  private getLemma(atr: AnalyzedTokenReadings): string | null {
    const lemmaOrNull = atr.hasSameLemmas() && atr.getReadingsLength() > 0 ? atr.getReadings()[0]!.getLemma() : null;
    if (lemmaOrNull != null) {
      // our analysis gets lemma "Jugendfoto" for "Jugend-Fotos", we 'fix' that here
      const token = atr.getToken();
      if (!lemmaOrNull.includes('-') && token.includes('-')) {
        let lemmaBuilder = '';
        for (let lemmaPos = 0, tokenPos = 0; lemmaPos < lemmaOrNull.length; lemmaPos++, tokenPos++) {
          if (tokenPos >= token.length) {
            break;
          }
          const lemmaChar = lemmaOrNull.charAt(lemmaPos);
          const tokenChar = token.charAt(tokenPos);
          if (lemmaChar === tokenChar) {
            lemmaBuilder += lemmaChar;
          } else if (token.charAt(tokenPos) === '-') {
            tokenPos++;  // skip hyphen
            lemmaBuilder += '-';
            if (lemmaPos + 1 < token.length && Character.isUpperCase(token.charAt(tokenPos))) {
              lemmaBuilder += Character.toUpperCase(lemmaChar);
            } else {
              lemmaBuilder += lemmaChar;
            }
          }
        }
        return lemmaBuilder;
      }
      return lemmaOrNull;
    } else {
      return null;
    }
  }

  override minToCheckParagraph(): number {
    return -1;
  }
}
