// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/chunking/EnglishChunkFilter.java faithful
// IllegalStateException is an Error with Java's message.
import { ChunkTag } from '../../../../../languagetool-core/org/languagetool/chunking/ChunkTag.ts';
import { ChunkTaggedToken } from '../../../../../languagetool-core/org/languagetool/chunking/ChunkTaggedToken.ts';
import { List_contains } from '../../../../../../jdk/java/util/Objects.ts';

const BEGIN_NOUN_PHRASE_TAG = new ChunkTag('B-NP');
const IN_NOUN_PHRASE_TAG = new ChunkTag('I-NP');

export const ChunkType = { SINGULAR: 'SINGULAR', PLURAL: 'PLURAL' } as const;
export type ChunkType = typeof ChunkType[keyof typeof ChunkType];

/**
 * Update the chunk tags from OpenNLP for English to distinguish between singular and plural noun phrases.
 * Adds these chunk tags: B-NP-singular, I-NP-singular, E-NP-singular,
 * B-NP-plural, I-NP-plural, E-NP-plural (B = begin, I = in, E = end).
 * @since 2.3
 */
export class EnglishChunkFilter {

  filter(tokens: ChunkTaggedToken[]): ChunkTaggedToken[] {
    const result: ChunkTaggedToken[] = [];
    let newChunkTag: string | null = null;
    let i = 0;
    for (const taggedToken of tokens) {
      const chunkTags: ChunkTag[] = [];
      if (this.isBeginningOfNounPhrase(taggedToken)) {
        const chunkType = this.getChunkType(tokens, i);
        if (chunkType == ChunkType.SINGULAR || this.endOfNounPhraseIsSingular(tokens, i)) {
          chunkTags.push(new ChunkTag('B-NP-singular'));
          newChunkTag = 'NP-singular';
        } else if (chunkType == ChunkType.PLURAL) {
          chunkTags.push(new ChunkTag('B-NP-plural'));
          newChunkTag = 'NP-plural';
        } else {
          throw new Error('IllegalStateException: Unknown chunk type: ' + chunkType);
        }
      }
      if (newChunkTag != null && this.isEndOfNounPhrase(tokens, i)) {
        chunkTags.push(new ChunkTag('E-' + newChunkTag));
        newChunkTag = null;
      }
      if (newChunkTag != null && this.isContinuationOfNounPhrase(taggedToken)) {
        chunkTags.push(new ChunkTag('I-' + newChunkTag));
      }
      if (chunkTags.length > 0) {
        result.push(new ChunkTaggedToken(taggedToken.getToken(), chunkTags, taggedToken.getReadings()));
      } else {
        result.push(taggedToken);
      }
      i++;
    }
    return result;
  }

  private endOfNounPhraseIsSingular(tokens: ChunkTaggedToken[], i: number): boolean {
    for (let j = i; j < tokens.length; j++) {
      if (this.isEndOfNounPhrase(tokens, j)) {
        return this.getChunkType(tokens, j) == ChunkType.SINGULAR;
      }
    }
    return false;
  }

  private isBeginningOfNounPhrase(taggedToken: ChunkTaggedToken): boolean {
    return List_contains(taggedToken.getChunkTags(), BEGIN_NOUN_PHRASE_TAG);
  }

  private isEndOfNounPhrase(tokens: ChunkTaggedToken[], i: number): boolean {
    if (i > tokens.length - 2) {
      return true;
    }
    if (!this.isContinuationOfNounPhrase(tokens[i + 1]!)) {
      return true;
    }
    return false;
  }

  private isContinuationOfNounPhrase(taggedToken: ChunkTaggedToken): boolean {
    return List_contains(taggedToken.getChunkTags(), IN_NOUN_PHRASE_TAG);
  }

  /**
   * Get the type of the chunk that starts at the given position.
   */
  private getChunkType(tokens: ChunkTaggedToken[], chunkStartPos: number): ChunkType {
    let isPlural = false;
    for (let i = chunkStartPos; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!this.isBeginningOfNounPhrase(token) && !this.isContinuationOfNounPhrase(token)) {
        break;
      }
      if (false && 'and' === token.getToken()) {   // e.g. "Tarzan and Jane" is a plural noun phrase
        // TODO: "Additionally, there are over 500 college and university chapter."
        isPlural = true;
      } else if (this.hasNounWithPluralReading(token)) {   // e.g. "ten books" is a plural noun phrase
        isPlural = true;
      }
    }
    return isPlural ? ChunkType.PLURAL : ChunkType.SINGULAR;
  }

  private hasNounWithPluralReading(token: ChunkTaggedToken): boolean {
    if (token.getReadings() != null) {
      for (const analyzedToken of token.getReadings()!.getReadings()) {
        if ('NNS' === analyzedToken.getPOSTag()) {
          return true;
        }
      }
    }
    return false;
  }

}
