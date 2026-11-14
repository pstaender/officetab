// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/chunking/ChunkTaggedToken.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';
import type { ChunkTag } from './ChunkTag.ts';

/**
 * A word (actually a token) and its chunk tag.
 * @since 2.3
 */
export class ChunkTaggedToken {

  private readonly token: string;
  private readonly chunkTags: ChunkTag[];
  private readonly readings: AnalyzedTokenReadings | null;

  /**
   * @param readings may be null, caused by differences in tokenization we don't always have a 1:1 mapping
   */
  constructor(token: string, chunkTags: ChunkTag[], readings: AnalyzedTokenReadings | null) {
    this.token = Objects_requireNonNull(token);
    this.chunkTags = Objects_requireNonNull(chunkTags);
    this.readings = readings;
  }

  getToken(): string {
    return this.token;
  }

  getChunkTags(): ChunkTag[] {
    return this.chunkTags;
  }

  /**
   * @return readings or {@code null}
   */
  getReadings(): AnalyzedTokenReadings | null {
    return this.readings;
  }

  toString(): string {
    return this.token + '/' + this.chunkTags.join(',');
  }
}
