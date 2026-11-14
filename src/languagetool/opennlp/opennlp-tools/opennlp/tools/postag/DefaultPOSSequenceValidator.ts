// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/DefaultPOSSequenceValidator.java faithful
import type { SequenceValidator } from '../util/SequenceValidator.ts';
import type { TagDictionary } from './TagDictionary.ts';

export class DefaultPOSSequenceValidator implements SequenceValidator<string> {
  private tagDictionary: TagDictionary | null;

  constructor(tagDictionary: TagDictionary | null) {
    this.tagDictionary = tagDictionary;
  }

  validSequence(i: number, inputSequence: string[],
      outcomesSequence: string[], outcome: string): boolean {
    if (this.tagDictionary == null) {
      return true;
    } else {
      const tags = this.tagDictionary.getTags(inputSequence[i]);
      return tags == null || tags.includes(outcome);
    }
  }
}
