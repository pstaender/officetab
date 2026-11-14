// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SuggestedReplacement.java faithful
// The constructors are one (a string with optional description and suffix, or a
// SuggestedReplacement to copy). SpellingCheckRule.HIGH_CONFIDENCE (0.99f) is repeated in topMatch:
// importing the spelling rule here would be an import cycle. SortedMap features are a Map kept in
// key order by setFeatures. hashCode is left out.
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/**
 * classify the type of the suggestion
 * so that downstream tasks (e.g. resorting, as in {@link BERTSuggestionRanking})
 * can treat them accordingly
 * Default - default, no special treatment
 * Translation - offers to translate words from native language into text language;
 *   suggestion ranking extends size of list of candidates
 * Curated - a manually curated suggestion / special case / ...; don't resort
 */
export const SuggestionType = {
  Default: 'Default', Translation: 'Translation', Curated: 'Curated',
} as const;
export type SuggestionType = typeof SuggestionType[keyof typeof SuggestionType];

/** SpellingCheckRule.HIGH_CONFIDENCE */
const HIGH_CONFIDENCE = Math.fround(0.99);

/**
 * @since 4.5
 */
export class SuggestedReplacement {

  static readonly SuggestionType = SuggestionType;

  private replacement: string;
  private shortDescription: string | null;
  private suffix: string | null;
  private features: ReadonlyMap<string, number> = new Map();
  private confidence: number | null = null;
  private type: SuggestionType = SuggestionType.Default;

  constructor(replacement: string | SuggestedReplacement, shortDescription: string | null = null, suffix: string | null = null) {
    if (replacement instanceof SuggestedReplacement) {
      const repl = replacement;
      this.replacement = repl.replacement;
      this.suffix = repl.suffix;
      this.shortDescription = null;
      this.setShortDescription(repl.getShortDescription());
      this.setConfidence(repl.getConfidence());
      this.setFeatures(repl.getFeatures());
      this.setType(repl.getType());
      return;
    }
    this.replacement = Objects_requireNonNull(replacement);
    this.shortDescription = shortDescription;
    this.suffix = suffix;
  }

  getReplacement(): string {
    return this.replacement;
  }

  setReplacement(replacement: string): void {
    this.replacement = Objects_requireNonNull(replacement);
  }

  getShortDescription(): string | null {
    return this.shortDescription;
  }

  setShortDescription(desc: string | null): void {
    this.shortDescription = desc;
  }

  /** @since 4.9 */
  setType(type: SuggestionType): void {
    this.type = Objects_requireNonNull(type);
  }

  /** @since 4.9 */
  getType(): SuggestionType {
    return this.type;
  }

  /**
   * Value shown in the UI after the replacement (but not part of it).
   */
  getSuffix(): string | null {
    return this.suffix;
  }

  setSuffix(val: string | null): void {
    this.suffix = val;
  }

  toString(): string {
    return this.replacement + '(' + this.shortDescription + ')';
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof SuggestedReplacement) || o.constructor !== this.constructor) return false;
    const that = o;
    return this.replacement === that.replacement &&
            this.shortDescription === that.shortDescription;
  }

  getConfidence(): number | null {
    return this.confidence;
  }

  setConfidence(confidence: number | null): void {
    this.confidence = confidence;
  }

  getFeatures(): ReadonlyMap<string, number> {
    return this.features;
  }

  setFeatures(features: ReadonlyMap<string, number>): void {
    this.features = new Map([...features].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  static convert(suggestions: readonly string[]): SuggestedReplacement[] {
    return suggestions.map((s) => new SuggestedReplacement(s));
  }

  static topMatch(word: string, shortDesc: string | null = null): SuggestedReplacement[] {
    const sugg = new SuggestedReplacement(word, shortDesc);
    sugg.setConfidence(HIGH_CONFIDENCE);
    return [sugg];
  }

}
