// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RuleSet.java faithful
// java.util.BitSet is a small local class over a Uint8Array.
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { Rule } from '../Rule.ts';
import { AbstractTokenBasedRule, type TokenHint } from './AbstractTokenBasedRule.ts';

/** The part of java.util.BitSet used here. */
class BitSet {
  private bits = new Uint8Array(0);
  set(i: number): void {
    if (i >= this.bits.length) {
      const grown = new Uint8Array(Math.max(i + 1, this.bits.length * 2));
      grown.set(this.bits);
      this.bits = grown;
    }
    this.bits[i] = 1;
  }
  or(other: BitSet): void {
    if (other.bits.length > this.bits.length) {
      const grown = new Uint8Array(other.bits.length);
      grown.set(this.bits);
      this.bits = grown;
    }
    for (let i = 0; i < other.bits.length; i++) this.bits[i]! |= other.bits[i]!;
  }
  nextSetBit(from: number): number {
    for (let i = from; i < this.bits.length; i++) if (this.bits[i]) return i;
    return -1;
  }
}

/**
 * An object holding a set of rules with an optional possibility to fetch only the ones applicable for a given sentence
 * (via {@link #rulesForSentence}), to avoid even invoking the definitely inapplicable ones.
 * The filtering is based on cues provided by the rules, e.g. possible token strings or lemmas in pattern rules.
 *
 * @since 5.2
 */
export abstract class RuleSet {

  private ruleIds: ReadonlySet<string> | null = null;

  /**
   * @return all rules in this set, not filtered
   */
  abstract allRules(): readonly Rule[];

  /**
   * @return all rules from {@link #allRules} that might be applicable to the given sentence.
   */
  abstract rulesForSentence(sentence: AnalyzedSentence): readonly Rule[];

  /**
   * @return the ids of {@link #allRules()}
   * @since 5.6
   */
  allRuleIds(): ReadonlySet<string> {
    let result = this.ruleIds;
    if (result == null) {
      this.ruleIds = result = new Set(this.allRules().map((r) => r.getId()));
    }
    return result;
  }

  /**
   * @return a simple RuleSet that returns all the rules from {@link #rulesForSentence}
   */
  static plain(rules: readonly Rule[]): RuleSet {
    const allRules = rules;
    return new class extends RuleSet {
      allRules(): readonly Rule[] {
        return allRules;
      }

      rulesForSentence(_sentence: AnalyzedSentence): readonly Rule[] {
        return allRules;
      }
    }();
  }

  /**
   * @return a RuleSet whose {@link #rulesForSentence} excludes rules requiring token texts or lemmas
   * that don't occur in the given sentence
   */
  static textLemmaHinted(rules: readonly Rule[]): RuleSet {
    return RuleSet.hinted(rules, true);
  }

  /**
   * @return a RuleSet whose {@link #rulesForSentence} excludes rules requiring token texts
   * that don't occur in the given sentence.
   */
  static textHinted(rules: readonly Rule[]): RuleSet {
    return RuleSet.hinted(rules, false);
  }

  private static hinted(rules: readonly Rule[], withLemmaHints: boolean): RuleSet {
    const allRules = rules;
    const byToken = new Map<string, BitSet>();
    const byLemma = new Map<string, BitSet>();
    const unclassified = new BitSet();
    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i]!;
      let classified = false;
      if (rule instanceof AbstractTokenBasedRule) {
        const tokenHints = rule.tokenHints;
        const firstHint: TokenHint | null =
          tokenHints == null ? null :
          withLemmaHints ? tokenHints[0]! :
          tokenHints.find((th) => !th.inflected) ?? null;
        if (firstHint != null) {
          classified = true;
          const map = firstHint.inflected ? byLemma : byToken;
          for (const hint of firstHint.lowerCaseValues) {
            let set = map.get(hint);
            if (set === undefined) map.set(hint, set = new BitSet());
            set.set(i);
          }
        }
      }
      if (!classified) {
        unclassified.set(i);
      }
    }

    return new class extends RuleSet {
      allRules(): readonly Rule[] {
        return allRules;
      }

      rulesForSentence(sentence: AnalyzedSentence): readonly Rule[] {
        const included = new BitSet();
        included.or(unclassified);
        if (byLemma.size !== 0) {
          for (const lemma of sentence.getLemmaSet()) {
            const set = byLemma.get(lemma);
            if (set != null) {
              included.or(set);
            }
          }
        }
        for (const token of sentence.getTokenSet()) {
          const set = byToken.get(token);
          if (set != null) {
            included.or(set);
          }
        }
        return RuleSet.filterList(included, allRules);
      }
    }();
  }

  static filterList<T>(includedIndices: BitSet, list: readonly T[]): T[] {
    const result: T[] = [];
    let i = -1;
    while (true) {
      i = includedIndices.nextSetBit(i + 1);
      if (i < 0) break;
      result.push(list[i]!);
    }
    return result;
  }
}
