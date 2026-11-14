// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/markup/AnnotatedText.java faithful
// MetaDataKey is an enum, but a class with static instances here, so that the two
// getGlobalMetaData overloads (a MetaDataKey or a custom string key) can be told apart.
import type { MappingValue } from './MappingValue.ts';
import { TextPart } from './TextPart.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/**
 * @since 3.9
 */
export class MetaDataKey {
  static readonly DocumentTitle = new MetaDataKey('DocumentTitle');
  static readonly EmailToAddress = new MetaDataKey('EmailToAddress');
  static readonly FullName = new MetaDataKey('FullName');
  static readonly EmailNumberOfAttachments = new MetaDataKey('EmailNumberOfAttachments');

  private readonly _name: string;
  private constructor(name: string) { this._name = name; }
  name(): string { return this._name; }
  toString(): string { return this._name; }
}

/** Integer.MAX_VALUE */
const Integer_MAX_VALUE = 2147483647;

/**
 * A text with markup and with a mapping so error positions will refer to the original
 * position that includes the markup, even though only the plain text parts are checked.
 * Use {@link AnnotatedTextBuilder} to create objects of this type.
 * @since 2.3
 */
export class AnnotatedText {

  static readonly MetaDataKey = MetaDataKey;

  private readonly parts: TextPart[];
  private readonly mapping: Map<number, MappingValue>;  // plain text position to original text (with markup) position
  private readonly metaData: Map<MetaDataKey, string>;
  private readonly customMetaData: Map<string, string>;

  constructor(parts: TextPart[], mapping: Map<number, MappingValue>, metaData: Map<MetaDataKey, string>, customMetaData: Map<string, string>) {
    this.parts = Objects_requireNonNull(parts);
    this.mapping = Objects_requireNonNull(mapping);
    this.metaData = Objects_requireNonNull(metaData);
    this.customMetaData = Objects_requireNonNull(customMetaData);
  }

  /**
   * @since 5.4
   */
  getParts(): TextPart[] {
    return this.parts;
  }

  /**
   * Get the plain text, without markup and content from {@code interpretAs}.
   * @since 4.3
   */
  getOriginalText(): string {
    let sb = '';
    for (const part of this.parts) {
      if (part.getType() === TextPart.Type.TEXT) {
        sb += part.getPart();
      }
    }
    return sb;
  }

  /**
   * Get the plain text, without markup but with content from {@code interpretAs}.
   */
  getPlainText(): string {
    let sb = '';
    for (const part of this.parts) {
      if (part.getType() === TextPart.Type.TEXT || part.getType() === TextPart.Type.FAKE_CONTENT) {
        sb += part.getPart();
      }
    }
    return sb;
  }

  /**
   * @since 4.3
   */
  getTextWithMarkup(): string {
    let sb = '';
    for (const part of this.parts) {
      if (part.getType() !== TextPart.Type.FAKE_CONTENT) {
        sb += part.getPart();
      }
    }
    return sb;
  }

  /**
   * Internally used by LanguageTool to adjust error positions to point to the
   * original location with markup, even though markup was ignored during text checking.
   * @param plainTextPosition the position in the plain text (no markup) that was checked
   * @param isToPos the from/to position needed
   * @return an adjusted position of the same location in the text with markup
   */
  getOriginalTextPositionFor(plainTextPosition: number, isToPos: boolean): number {
    if (plainTextPosition < 0) {
      throw new Error('IllegalArgumentException: plainTextPosition must be >= 0: ' + plainTextPosition);
    }
    if (this.mapping.size === 0) {
      return 0;
    }
    let minDiff = Integer_MAX_VALUE;
    let bestMatch: MappingValue | null = null;
    // algorithm: find the closest lower position
    for (const [maybeClosePosition, value] of this.mapping) {
      if (plainTextPosition < maybeClosePosition) {
        const diff = maybeClosePosition - plainTextPosition;
        if (diff > 0 && diff < minDiff) {
          bestMatch = value;
          minDiff = diff;
        }
      }
    }
    if (bestMatch == null) {
      const msg = 'mappings: ' + (this.mapping.size < 5 ? '{' + [...this.mapping].map(([k, v]) => k + '=' + v).join(', ') + '}' : this.mapping.size);
      throw new Error('RuntimeException: Could not map ' + plainTextPosition + ' to original position. isToPos: ' + isToPos + ', ' + msg);
    }
    // we remove markup total length if usage of fake markup and need from position
    if (!isToPos && bestMatch.getFakeMarkupLength() > 0) {
      minDiff = bestMatch.getFakeMarkupLength();
    }
    // We assume that when we have found the closest match there's a one-to-one mapping
    // in this region, thus we can subtract 'minDiff' to get the exact position.
    // If the bestMatch is a fakeMarkup, subtract it:
    return bestMatch.getTotalPosition() - minDiff;
  }

  /**
   * By key and default value (since 3.9; a MetaDataKey or a custom key), or all of them
   * (without arguments; since 5.4).
   */
  getGlobalMetaData(): Map<MetaDataKey, string>;
  getGlobalMetaData(key: MetaDataKey | string, defaultValue: string | null): string | null;
  getGlobalMetaData(key?: MetaDataKey | string, defaultValue?: string | null): Map<MetaDataKey, string> | string | null {
    if (key === undefined) {
      return this.metaData;
    }
    if (key instanceof MetaDataKey) {
      return this.metaData.get(key) ?? defaultValue ?? null;
    }
    return this.customMetaData.get(key) ?? defaultValue ?? null;
  }

  /** @since 5.4 */
  getCustomMetaData(): Map<string, string> {
    return this.customMetaData;
  }

  toString(): string {
    return this.parts.join('');
  }

}
