// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/chunking/ChunkTag.java faithful

/**
 * The name of a chunk. Just a wrapper around a string.
 * @since 2.3
 */
export class ChunkTag {
  private readonly chunkTag: string;
  private readonly _isRegexp: boolean;

  constructor(chunkTag: string, isRegexp = false) {
    if (chunkTag == null || chunkTag.trim() === '') {
      throw new Error(`IllegalArgumentException: chunkTag cannot be null or empty: '${chunkTag}'`);
    }
    this.chunkTag = chunkTag;
    this._isRegexp = isRegexp;
  }

  getChunkTag(): string { return this.chunkTag; }

  /** @since 3.5 */
  isRegexp(): boolean { return this._isRegexp; }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (!(o instanceof ChunkTag)) return false;
    return this.chunkTag === o.chunkTag;
  }

  toString(): string { return this.chunkTag + (this._isRegexp ? '[regex]' : ''); }
}
