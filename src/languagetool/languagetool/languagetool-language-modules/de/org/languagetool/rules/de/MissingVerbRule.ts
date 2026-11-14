// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/MissingVerbRule.java faithful
// StringUtils.equalsAny is a local function.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternRule } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import type { German } from '../../language/German.ts';

/** StringUtils.equalsAny(cs, searchCharSequences...) */
function StringUtils_equalsAny(cs: string | null, ...searchCharSequences: string[]): boolean {
  return searchCharSequences.some((s) => s === cs);
}

/**
 * Checks that a sentence contains at least one verb. Ignores very short sentences.
 * Note that this is off by default, as there are quite some "sentences"
 * without a verb, e.g. "Nix für ungut!", "Bis nächste Woche.", "Nicht schon wieder!",
 * "Und deine Schwester?", "Wie dumm von mir!", and book references like "Andreas Fecker: Fluglotsen."
 * @since 2.7
 */
export class MissingVerbRule extends Rule {

  private static readonly MIN_TOKENS_FOR_ERROR = 5;

  private readonly rule1: PatternRule;
  private readonly rule2: PatternRule;
  private readonly language: Language;

  constructor(messages: ResourceBundle, language: German) {
    super();
    this.language = language;
    this.rule1 = new PatternRule("internal", language, [
            new PatternToken("Vielen", true, false, false),
            new PatternToken("Dank", true, false, false)], "", "", "");
    this.rule2 = new PatternRule("internal", language, [
            new PatternToken("Herzlichen", true, false, false),
            new PatternToken("Glückwunsch", true, false, false)], "", "", "");
    super.setCategory(Categories.GRAMMAR.getCategory(messages));
    this.setDefaultOff();
    this.addExamplePair(Example.wrong("<marker>In diesem Satz kein Wort.</marker>"),
                   Example.fixed("In diesem Satz <marker>fehlt</marker> kein Wort."));
  }

  override getId(): string {
    return "MISSING_VERB";
  }

  override getDescription(): string {
    return "Satz ohne Verb";
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    if (!this.isRealSentence(sentence) || this.isSpecialCase(sentence)) {
      return RuleMatch.EMPTY_ARRAY as RuleMatch[];
    }
    let verbFound = false;
    let lastToken: AnalyzedTokenReadings | null = null;
    let i = 0;
    for (const readings of sentence.getTokensWithoutWhitespace()) {
      if (readings.hasPosTagStartingWith("VER")
          || (!readings.isTagged() && !StringTools.isCapitalizedWord(readings.getToken()) // ignore unknown words to avoid false alarms
          || (i === 1 && this.verbAtSentenceStart(readings)))) {
        verbFound = true;
        break;
      }
      lastToken = readings;
      i++;
    }
    if (!verbFound && lastToken != null && sentence.getTokensWithoutWhitespace().length >= MissingVerbRule.MIN_TOKENS_FOR_ERROR) {
      const match = new RuleMatch(this, sentence, 0, lastToken.getStartPos() + lastToken.getToken().length, "Dieser Satz scheint kein Verb zu enthalten");
      return [match];
    }
    return RuleMatch.EMPTY_ARRAY as RuleMatch[];
  }

  // we want to ignore headlines, and these usually don't end with [.?!]
  private isRealSentence(sentence: AnalyzedSentence): boolean {
    const tokens = sentence.getTokensWithoutWhitespace();
    if (tokens.length > 0) {
      const lastToken = tokens[tokens.length - 1]!;
      return lastToken.hasPosTag("PKT") && StringUtils_equalsAny(lastToken.getToken(), ".", "?", "!");
    }
    return false;
  }

  private isSpecialCase(sentence: AnalyzedSentence): boolean {
    return this.rule1.match(sentence).length > 0 || this.rule2.match(sentence).length > 0;
  }

  private verbAtSentenceStart(readings: AnalyzedTokenReadings): boolean {
    // start of sentence is mis-tagged because of the uppercase first character, work around that:
    const lowercased = StringTools.lowercaseFirstChar(readings.getToken());
    const lcReadings = this.language.getTagger().tag([lowercased]);
    return lcReadings.length > 0 && lcReadings[0]!.hasPosTagStartingWith("VER");
  }

}
