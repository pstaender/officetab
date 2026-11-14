// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RuleFilter.java faithful
// The two getOptional overloads are one with an optional default value. FakeRule is created on
// first use (it extends Rule, whose module may still be loading when this one is).
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import type { Language } from '../../Language.ts';
import { Rule } from '../Rule.ts';
import { RuleMatch } from '../RuleMatch.ts';
import type { Synthesizer } from '../../synthesis/Synthesizer.ts';
import type { Tagger } from '../../tagging/Tagger.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { AbstractPatternRule } from './AbstractPatternRule.ts';

let FakeRuleClass: (new () => Rule) | null = null;

function FakeRule(): Rule {
  FakeRuleClass ??= class FakeRule extends Rule {
    override getId(): string { return 'FAKE-RULE-FOR-FILTER'; }
    override getDescription(): string { return '<none>'; }
    override match(_sentence: AnalyzedSentence): RuleMatch[] { return RuleMatch.EMPTY_ARRAY as RuleMatch[]; }
  };
  return new FakeRuleClass();
}

/**
 * Filter rule matches after a PatternRule has matched already.
 * Can be used from the XML using the {@code filter} element.
 * @since 2.7 (changed from interface to abstract class in 3.2)
 */
export abstract class RuleFilter {

  /**
   * Returns the original rule match or a modified one, or {@code null}
   * if the rule match is filtered out.
   *
   * @param arguments      the resolved argument from the {@code args} attribute in the XML. Resolved
   *                       means that e.g. {@code \1} has been resolved to the actual string at that match position.
   * @param patternTokens  those tokens of the text that correspond the matched pattern
   * @return {@code null} if this rule match should be removed, or any other RuleMatch (e.g. the one from
   * the arguments) that properly describes the detected error
   */
  abstract acceptRuleMatch(match: RuleMatch, args: Map<string, string>, patternTokenPos: number, patternTokens: AnalyzedTokenReadings[], tokenPositions: number[]): RuleMatch | null;

  /** @since 3.2 */
  matches(args: Map<string, string>, patternTokens: AnalyzedTokenReadings[], firstMatchToken: number, tokenPositions: number[]): boolean {
    const fakeMatch = new RuleMatch(FakeRule(), null, 0, 1, '(internal rule)');
    return this.acceptRuleMatch(fakeMatch, args, firstMatchToken, patternTokens, tokenPositions) != null;
  }

  protected getRequired(key: string, map: Map<string, string>): string {
    const result = map.get(key);
    if (result == null) {
      throw new Error("IllegalArgumentException: Missing key '" + key + "'");
    }
    return result;
  }

  protected getOptional(key: string, map: Map<string, string>, defaultValue?: string): string | null {
    const value = map.get(key);
    if (value == null) {
      return defaultValue ?? null;
    }
    return value;
  }

  protected getPosition(fromStr: string, patternTokens: AnalyzedTokenReadings[], match: RuleMatch): number {
    let i: number;
    if (fromStr.startsWith('marker')) {
      i = 0;
      while (i < patternTokens.length && patternTokens[i]!.getStartPos() < match.getFromPos()
        || patternTokens[i]!.isSentenceStart()) {
        i++;
      }
      i++;
      if (fromStr.length > 6) {
        i += parseJavaInt(fromStr.replaceAll('marker', ''));
      }
    } else {
      i = parseJavaInt(fromStr);
    }
    if (i < 1 || i > patternTokens.length) {
      throw new Error('IllegalArgumentException: RuleFilter: Index out of bounds in '
        + match.getRule().getFullId() + ', value: ' + fromStr);
    }
    return i - 1;
  }

  protected isMatchAtSentenceStart(tokens: AnalyzedTokenReadings[], match: RuleMatch): boolean {
    let i = 0;
    while (i < tokens.length && tokens[i]!.getStartPos() < match.getFromPos()) {
      i++;
    }
    while (i > 0 && StringTools.isPunctuationMark(tokens[i]!.getToken())) {
      i--;
    }
    return i === 0;
  }

  // when there's a 'skip', we need to adapt the reference number
  protected getSkipCorrectedReference(tokenPositions: number[], refNumber: number): number {
    if (refNumber < 0) {
      return refNumber;
    }
    let correctedRef = 0;
    let i = 0;
    for (const tokenPosition of tokenPositions) {
      if (i++ >= refNumber) {
        break;
      }
      correctedRef += tokenPosition;
    }
    return correctedRef - 1;
  }

  getLanguageFromRuleMatch(match: RuleMatch): Language {
    const rule = match.getRule();
    if (this.language != null) {
      return this.language;
    }
    let lang: Language;
    if (rule instanceof AbstractPatternRule) {
      lang = rule.getLanguage();
    } else {
      throw new Error('RuntimeException: AbstractAdvancedSynthesizerFilter only works with pattern rules. ' + rule.getFullId() + ' is not a pattern rule');
    }
    return lang;
  }

  getSynthesizerFromRuleMatch(match: RuleMatch): Synthesizer | null {
    return this.getLanguageFromRuleMatch(match).getSynthesizer();
  }

  getTaggerFromRuleMatch(match: RuleMatch): Tagger {
    return this.getLanguageFromRuleMatch(match).getTagger();
  }

  private language: Language | null = null;

  getLanguage(): Language | null {
    return this.language;
  }

  setLanguage(language: Language | null): void {
    this.language = language;
  }
}

/** Integer.parseInt: a decimal integer, else NumberFormatException. */
export function parseJavaInt(s: string): number {
  if (!/^[+-]?\d+$/.test(s)) throw new Error('NumberFormatException: For input string: "' + s + '"');
  return parseInt(s, 10);
}
