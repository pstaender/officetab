// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/AbstractTokenBasedRule.java faithful
// The HashSet<TokenHint> is a list without equal elements (TokenHint.equals).
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { Language } from '../../Language.ts';
import { Arrays_equals } from '../../../../../../jdk/java/util/Objects.ts';
import { AbstractPatternRule } from './AbstractPatternRule.ts';
import type { PatternToken } from './PatternToken.ts';

const Byte_MAX_VALUE = 127;

/**
 * A base class for {@link PatternToken}-based rules.
 * It's public for implementation reasons and should not be used outside LanguageTool.
 */
export abstract class AbstractTokenBasedRule extends AbstractPatternRule {
  // Tokens used for fast checking whether a rule can ever match.
  readonly tokenHints: TokenHint[] | null;

  // Token/lemma hints together with offset of a matching token from any match start
  readonly anchorHint: TokenHint | null;

  private readonly minTokenCount: number;

  protected constructor(id: string, description: string, language: Language, patternTokens: PatternToken[], getUnified: boolean) {
    super(id, description, language, patternTokens, getUnified);

    const tokenHints: TokenHint[] = [];
    let anchorHint: TokenHint | null = null;

    let fixedOffset = true;
    let minTokenCount = patternTokens.length === 0 || AbstractTokenBasedRule.canMatchSentenceStart(patternTokens[0]!) ? 0 : 1;
    for (let i = 0; i < patternTokens.length; i++) {
      const token = patternTokens[i]!;
      if (token.getMinOccurrence() > 0) {
        minTokenCount++;
      }

      let inflected = false;
      let hints = token.calcFormHints();
      if (hints == null) {
        inflected = true;
        hints = token.calcLemmaHints();
      }
      if (hints != null) {
        const hint = new TokenHint(inflected, hints, i);
        if (!tokenHints.some((th) => th.equals(hint))) tokenHints.push(hint);
        if (fixedOffset && anchorHint == null) {
          anchorHint = hint;
        }
      }

      if (fixedOffset && (token.getMinOccurrence() !== 1 || token.getSkipNext() !== 0 || token.getMaxOccurrence() !== 1)) {
        fixedOffset = false;
      }
    }

    const minLength = (th: TokenHint) => th.lowerCaseValues.length === 0 ? 0 : Math.min(...th.lowerCaseValues.map((s) => s.length));
    this.tokenHints = tokenHints.length === 0 ? null : [...tokenHints]
      .sort((a, b) => (a.lowerCaseValues.length - b.lowerCaseValues.length) || (-minLength(a) - -minLength(b)));
    this.anchorHint = anchorHint;
    this.minTokenCount = Math.min(minTokenCount, Byte_MAX_VALUE);
  }

  private static canMatchSentenceStart(token: PatternToken): boolean {
    return token.isSentenceStart() || token.getNegation() || !token.hasStringThatMustMatch();
  }

  /**
   * A fast check whether this rule can be ignored for the given sentence
   * because it can never match. Used for performance optimization.
   */
  canBeIgnoredFor(sentence: AnalyzedSentence): boolean {
    if (sentence.getNonWhitespaceTokenCount() < this.minTokenCount) return true;
    if (this.tokenHints == null) return false;
    for (const th of this.tokenHints) {
      if (th.canBeIgnoredFor(sentence)) {
        return true;
      }
    }
    return false;
  }

}

/**
 * Represents possible values of a {@link PatternToken}'s lemma or text.
 */
export class TokenHint {
  readonly inflected: boolean;
  readonly lowerCaseValues: string[];
  readonly tokenIndex: number;

  constructor(inflected: boolean, possibleValues: Set<string>, tokenIndex: number) {
    this.inflected = inflected;
    this.tokenIndex = tokenIndex;
    this.lowerCaseValues = [...new Set([...possibleValues].map((s) => s.toLowerCase()))];
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (!(o instanceof TokenHint)) return false;
    const tokenHint = o;
    return this.inflected === tokenHint.inflected &&
           this.tokenIndex === tokenHint.tokenIndex &&
           Arrays_equals(this.lowerCaseValues, tokenHint.lowerCaseValues);
  }

  /**
   * @return all indices inside sentence's non-blank tokens where this token could possibly match
   */
  getPossibleIndices(sentence: AnalyzedSentence): readonly number[] {
    let needMerge = false;
    let result: readonly number[] | null = null;
    for (const hint of this.lowerCaseValues) {
      const hintIndices = this.getHintIndices(sentence, hint);
      if (hintIndices != null) {
        if (result == null) {
          result = hintIndices;
        } else {
          if (!needMerge) {
            result = [...result];
            needMerge = true;
          }
          (result as number[]).push(...hintIndices);
        }
      }
    }
    if (result == null) return [];
    return needMerge ? [...new Set(result)].sort((a, b) => a - b) : result;
  }

  canBeIgnoredFor(sentence: AnalyzedSentence): boolean {
    for (const hint of this.lowerCaseValues) {
      if (this.getHintIndices(sentence, hint) != null) {
        return false;
      }
    }
    return true;
  }

  private getHintIndices(sentence: AnalyzedSentence, hint: string): readonly number[] | null {
    return (this.inflected ? sentence.getLemmaOffsets(hint) : sentence.getTokenOffsets(hint)) ?? null;
  }
}
