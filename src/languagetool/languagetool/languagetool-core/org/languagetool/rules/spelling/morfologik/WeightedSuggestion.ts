// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/morfologik/WeightedSuggestion.java faithful
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';

export class WeightedSuggestion {

  private readonly word: string;
  private readonly weight: number;

  constructor(word: string, weight: number) {
    this.word = Objects_requireNonNull(word);
    this.weight = weight;
  }

  getWord(): string {
    return this.word;
  }

  getWeight(): number {
    return this.weight;
  }

  compareTo(o: WeightedSuggestion): number {
    return this.weight < o.getWeight() ? -1 : this.weight === o.getWeight() ? 0 : 1;
  }

  toString(): string {
    return this.word + '/' + this.weight;
  }
}
