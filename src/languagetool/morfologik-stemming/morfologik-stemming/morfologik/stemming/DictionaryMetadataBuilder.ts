// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/DictionaryMetadataBuilder.java faithful
// Overloads are one method with optional parameters (frequencyIncluded(v = true), encoding of a
// Charset or a name, locale as a name). The EnumMap is a Map kept in the enum's order by toMap().
import type { Charset } from '../../../../jdk/java/nio/charset/Charset.ts';
import { DictionaryAttribute } from './DictionaryAttribute.ts';
import { DictionaryMetadata } from './DictionaryMetadata.ts';
import type { EncoderType } from './EncoderType.ts';

/**
 * Helper class to build {@link DictionaryMetadata} instances.
 */
export class DictionaryMetadataBuilder {
  private readonly attrs = new Map<DictionaryAttribute, string>();

  separator(c: string): DictionaryMetadataBuilder {
    this.attrs.set(DictionaryAttribute.SEPARATOR, c);
    return this;
  }

  encoding(charset: Charset | string): DictionaryMetadataBuilder {
    if (typeof charset !== 'string') {
      return this.encoding(charset.name());
    }
    this.attrs.set(DictionaryAttribute.ENCODING, charset);
    return this;
  }

  frequencyIncluded(v = true): DictionaryMetadataBuilder  { this.attrs.set(DictionaryAttribute.FREQUENCY_INCLUDED, String(v)); return this; }

  ignorePunctuation(v = true): DictionaryMetadataBuilder  { this.attrs.set(DictionaryAttribute.IGNORE_PUNCTUATION, String(v)); return this; }

  ignoreNumbers(v = true): DictionaryMetadataBuilder      { this.attrs.set(DictionaryAttribute.IGNORE_NUMBERS, String(v)); return this; }

  ignoreCamelCase(v = true): DictionaryMetadataBuilder    { this.attrs.set(DictionaryAttribute.IGNORE_CAMEL_CASE, String(v)); return this; }

  ignoreAllUppercase(v = true): DictionaryMetadataBuilder { this.attrs.set(DictionaryAttribute.IGNORE_ALL_UPPERCASE, String(v)); return this; }

  ignoreDiacritics(v = true): DictionaryMetadataBuilder   { this.attrs.set(DictionaryAttribute.IGNORE_DIACRITICS, String(v)); return this; }

  convertCase(v = true): DictionaryMetadataBuilder        { this.attrs.set(DictionaryAttribute.CONVERT_CASE, String(v)); return this; }

  supportRunOnWords(v = true): DictionaryMetadataBuilder  { this.attrs.set(DictionaryAttribute.RUN_ON_WORDS, String(v)); return this; }

  encoder(type: EncoderType): DictionaryMetadataBuilder {
    this.attrs.set(DictionaryAttribute.ENCODER, type.name());
    return this;
  }

  locale(localeName: string): DictionaryMetadataBuilder {
    this.attrs.set(DictionaryAttribute.LOCALE, localeName);
    return this;
  }

  withReplacementPairs(replacementPairs: Map<string, string[]>): DictionaryMetadataBuilder {
    let builder = '';
    for (const [k, vs] of replacementPairs) {
      for (const v of vs) {
        if (builder.length > 0) builder += ", ";
        builder += k + " " + v;
      }
    }
    this.attrs.set(DictionaryAttribute.REPLACEMENT_PAIRS, builder);
    return this;
  }

  withEquivalentChars(equivalentChars: Map<string, string[]>): DictionaryMetadataBuilder {
    let builder = '';
    for (const [k, vs] of equivalentChars) {
      for (const v of vs) {
        if (builder.length > 0) builder += ", ";
        builder += k + " " + v;
      }
    }
    this.attrs.set(DictionaryAttribute.EQUIVALENT_CHARS, builder);
    return this;
  }

  withInputConversionPairs(conversionPairs: Map<string, string>): DictionaryMetadataBuilder {
    let builder = '';
    for (const k of conversionPairs.keys()) {
      if (builder.length > 0) builder += ", ";
      builder += k + " " + conversionPairs.get(k);
    }
    this.attrs.set(DictionaryAttribute.INPUT_CONVERSION, builder);
    return this;
  }

  withOutputConversionPairs(conversionPairs: Map<string, string>): DictionaryMetadataBuilder {
    let builder = '';
    for (const k of conversionPairs.keys()) {
      if (builder.length > 0) builder += ", ";
      builder += k + " " + conversionPairs.get(k);
    }
    this.attrs.set(DictionaryAttribute.OUTPUT_CONVERSION, builder);
    return this;
  }


  author(author: string): DictionaryMetadataBuilder {
    this.attrs.set(DictionaryAttribute.AUTHOR, author);
    return this;
  }

  creationDate(creationDate: string): DictionaryMetadataBuilder {
    this.attrs.set(DictionaryAttribute.CREATION_DATE, creationDate);
    return this;
  }

  license(license: string): DictionaryMetadataBuilder {
    this.attrs.set(DictionaryAttribute.LICENSE, license);
    return this;
  }

  build(): DictionaryMetadata {
    return new DictionaryMetadata(this.attrs);
  }

  toMap(): Map<DictionaryAttribute, string> {
    return new Map(DictionaryAttribute.values().filter((a) => this.attrs.has(a)).map((a) => [a, this.attrs.get(a)!]));
  }
}
