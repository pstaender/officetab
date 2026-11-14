// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/DictionaryMetadata.java partial
// Left out: write(Writer) and getExpectedMetadataLocation(Path) (no files here). read() takes
// the .info file's bytes (UTF-8, as upstream reads them) or its text. The locale is the locale
// name from the .info file ("" for Java's default locale). DEFAULT_ATTRIBUTES is built on first
// use (DictionaryMetadataBuilder imports this module). EnumMaps are Maps iterated in the enum's
// order.
import type { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { CharBuffer } from '../../../../jdk/java/nio/CharBuffer.ts';
import { CharacterCodingException, Charset, CodingErrorAction, type CharsetDecoder, type CharsetEncoder } from '../../../../jdk/java/nio/charset/Charset.ts';
import { Properties } from '../../../../jdk/java/util/Properties.ts';
import { IOException } from '../../../morfologik-fsa/morfologik/fsa/FSAHeader.ts';
import { DictionaryAttribute } from './DictionaryAttribute.ts';
import { DictionaryMetadataBuilder } from './DictionaryMetadataBuilder.ts';
import { EncoderType } from './EncoderType.ts';

const {
  SEPARATOR, ENCODER, ENCODING, LOCALE, INPUT_CONVERSION, OUTPUT_CONVERSION, REPLACEMENT_PAIRS, EQUIVALENT_CHARS,
  IGNORE_PUNCTUATION, IGNORE_NUMBERS, IGNORE_CAMEL_CASE, IGNORE_ALL_UPPERCASE, IGNORE_DIACRITICS, CONVERT_CASE,
  RUN_ON_WORDS, FREQUENCY_INCLUDED, AUTHOR, LICENSE, CREATION_DATE,
} = DictionaryAttribute;

/** Boolean.valueOf(String). */
const booleanValueOf = (s: string | null): boolean => s !== null && s.toLowerCase() === 'true';

/**
 * Description of attributes, their types and default values.
 */
export class DictionaryMetadata {
  /**
   * Default attribute values.
   */
  private static m_aDefaultAttributes: Map<DictionaryAttribute, string> | undefined;
  private static get DEFAULT_ATTRIBUTES(): Map<DictionaryAttribute, string> {
    return DictionaryMetadata.m_aDefaultAttributes ??= new DictionaryMetadataBuilder()
      .frequencyIncluded(false)
      .ignorePunctuation()
      .ignoreNumbers()
      .ignoreCamelCase()
      .ignoreAllUppercase()
      .ignoreDiacritics()
      .convertCase()
      .supportRunOnWords()
      .toMap();
  }

  /**
   * Required attributes.
   */
  private static readonly REQUIRED_ATTRIBUTES: ReadonlySet<DictionaryAttribute> = new Set([
      SEPARATOR,
      ENCODER,
      ENCODING]);

  /**
   * A separator character between fields (stem, lemma, form). The character
   * must be within byte range (FSA uses bytes internally).
   */
  private separator = 0;
  private separatorChar = '';

  /**
   * Encoding used for converting bytes to characters and vice versa.
   */
  private encoding = '';

  private charset!: Charset;
  private locale = '';

  /**
   * Replacement pairs for non-obvious candidate search in a speller dictionary.
   */
  private replacementPairs = new Map<string, string[]>();

  /**
   * Conversion pairs for input conversion, for example to replace ligatures.
   */
  private inputConversion = new Map<string, string>();

  /**
   * Conversion pairs for output conversion, for example to replace ligatures.
   */
  private outputConversion = new Map<string, string>();

  /**
   * Equivalent characters (treated similarly as equivalent chars with and without
   * diacritics). For example, Polish <tt>ł</tt> can be specified as equivalent to <tt>l</tt>.
   *
   * This implements a feature similar to hunspell MAP in the affix file.
   */
  private equivalentChars = new Map<string, string[]>();

  /**
   * All attributes.
   */
  private readonly attributes: Map<DictionaryAttribute, string>;

  /**
   * All "enabled" boolean attributes.
   */
  private readonly boolAttributes: Map<DictionaryAttribute, boolean>;

  /**
   * Sequence encoder.
   */
  private encoderType!: EncoderType;

  /**
   * Expected metadata file extension.
   */
  static readonly METADATA_FILE_EXTENSION = "info";

  /**
   * @return Return all metadata attributes.
   */
  getAttributes(): ReadonlyMap<DictionaryAttribute, string> {
    return this.attributes;
  }

  // Cached attrs.
  getEncoding(): string      { return this.encoding; }
  getSeparator(): number     { return this.separator; }
  getLocale(): string        { return this.locale; }

  getInputConversionPairs(): Map<string, string> { return this.inputConversion; }
  getOutputConversionPairs(): Map<string, string> { return this.outputConversion; }

  getReplacementPairs(): Map<string, string[]> { return this.replacementPairs; }
  getEquivalentChars(): Map<string, string[]> { return this.equivalentChars; }

  // Dynamically fetched.
  isFrequencyIncluded(): boolean    { return this.boolAttributes.get(FREQUENCY_INCLUDED)!; }
  isIgnoringPunctuation(): boolean  { return this.boolAttributes.get(IGNORE_PUNCTUATION)!; }
  isIgnoringNumbers(): boolean      { return this.boolAttributes.get(IGNORE_NUMBERS)!; }
  isIgnoringCamelCase(): boolean    { return this.boolAttributes.get(IGNORE_CAMEL_CASE)!; }
  isIgnoringAllUppercase(): boolean { return this.boolAttributes.get(IGNORE_ALL_UPPERCASE)!; }
  isIgnoringDiacritics(): boolean   { return this.boolAttributes.get(IGNORE_DIACRITICS)!; }
  isConvertingCase(): boolean       { return this.boolAttributes.get(CONVERT_CASE)!; }
  isSupportingRunOnWords(): boolean { return this.boolAttributes.get(RUN_ON_WORDS)!; }

  /**
   * Create an instance from an attribute map.
   *
   * @param attrs A set of {@link DictionaryAttribute} keys and their associated values.
   * @see DictionaryMetadataBuilder
   */
  constructor(attrs: ReadonlyMap<DictionaryAttribute, string>) {
    this.boolAttributes = new Map<DictionaryAttribute, boolean>();
    this.attributes = new Map<DictionaryAttribute, string>();
    for (const a of DictionaryAttribute.values()) if (attrs.has(a)) this.attributes.set(a, attrs.get(a)!);

    const attributeMap = new Map<DictionaryAttribute, string>(DictionaryMetadata.DEFAULT_ATTRIBUTES);
    for (const [k, v] of attrs) attributeMap.set(k, v);

    // Convert some attrs from the map to local fields for performance reasons.
    const requiredAttributes = new Set(DictionaryMetadata.REQUIRED_ATTRIBUTES);

    for (const key of DictionaryAttribute.values()) {
      if (!attributeMap.has(key)) continue;
      const value_ = attributeMap.get(key)!;
      requiredAttributes.delete(key);

      // Run validation and conversion on all of them.
      const value = key.fromString(value_);
      switch (key) {
        case ENCODING:
          this.encoding = value_;
          if (!Charset.isSupported(this.encoding)) {
            throw new Error("IllegalArgumentException: Encoding not supported on this JVM: "
                + this.encoding);
          }
          this.charset = value as Charset;
          break;

        case SEPARATOR:
          this.separatorChar = value as string;
          break;

        case LOCALE:
          this.locale = value as string;
          break;

        case ENCODER:
          this.encoderType = value as EncoderType;
          break;

        case INPUT_CONVERSION:
        {
          const gvalue = value as Map<string, string>;
          this.inputConversion = gvalue;
        }
        break;

        case OUTPUT_CONVERSION:
        {
          const gvalue = value as Map<string, string>;
          this.outputConversion = gvalue;
        }
        break;

        case REPLACEMENT_PAIRS:
        {
          const gvalue = value as Map<string, string[]>;
          this.replacementPairs = gvalue;
        }
        break;

        case EQUIVALENT_CHARS:
        {
          const gvalue = value as Map<string, string[]>;
          this.equivalentChars = gvalue;
        }
        break;

        case IGNORE_PUNCTUATION:
        case IGNORE_NUMBERS:
        case IGNORE_CAMEL_CASE:
        case IGNORE_ALL_UPPERCASE:
        case IGNORE_DIACRITICS:
        case CONVERT_CASE:
        case RUN_ON_WORDS:
        case FREQUENCY_INCLUDED:
          this.boolAttributes.set(key, value as boolean);
          break;

        case AUTHOR:
        case LICENSE:
        case CREATION_DATE:
          // Just run validation.
          key.fromString(value_);
          break;

        default:
          throw new Error("Unexpected code path (attribute should be handled but is not): " + key);
      }
    }

    if (requiredAttributes.size != 0) {
      throw new Error("IllegalArgumentException: At least one the required attributes was not provided: ["
          + [...requiredAttributes].join(', ') + "]");
    }

    // Sanity check.
    const encoder = this.getEncoder();
    try {
      const encoded: ByteBuffer = encoder.encode(CharBuffer.wrap(this.separatorChar));
      if (encoded.remaining() > 1) {
        throw new Error("IllegalArgumentException: Separator character is not a single byte in encoding "
            + this.encoding + ": " + this.separatorChar);
      }
      this.separator = encoded.get();
    } catch (e) {
      if (!(e instanceof CharacterCodingException)) throw e;
      throw new Error("IllegalArgumentException: Separator character cannot be converted to a byte in "
          + this.encoding + ": " + this.separatorChar, { cause: e });
    }
  }

  /**
   * @return Returns a new {@link CharsetDecoder} for the {@link #encoding}.
   */
  getDecoder(): CharsetDecoder {
    return this.charset.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT);
  }

  /**
   * @return Returns a new {@link CharsetEncoder} for the {@link #encoding}.
   */
  getEncoder(): CharsetEncoder {
    return this.charset.newEncoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT);
  }

  /**
   * @return Return sequence encoder type.
   */
  getSequenceEncoderType(): EncoderType {
    return this.encoderType;
  }

  /**
   * @return Returns the {@link #separator} byte converted to a single
   *         <code>char</code>.
   * @throws RuntimeException
   *           if this conversion is for some reason impossible (the byte is a
   *           surrogate pair, FSA's {@link #encoding} is not available).
   */
  getSeparatorAsChar(): string {
    return this.separatorChar;
  }

  /**
   * @return A shortcut returning {@link DictionaryMetadataBuilder}.
   */
  static builder(): DictionaryMetadataBuilder {
    return new DictionaryMetadataBuilder();
  }

  /**
   * Returns the expected name of the metadata file, based on the name of the
   * dictionary file. The expected name is resolved by truncating any
   * file extension of <code>name</code> and appending
   * {@link DictionaryMetadata#METADATA_FILE_EXTENSION}.
   *
   * @param dictionaryFile The name of the dictionary (<code>*.dict</code>) file.
   * @return Returns the expected name of the metadata file.
   */
  static getExpectedMetadataFileName(dictionaryFile: string): string {
    const dotIndex = dictionaryFile.lastIndexOf('.');
    let featuresName: string;
    if (dotIndex >= 0) {
      featuresName = dictionaryFile.substring(0, dotIndex) + "." + DictionaryMetadata.METADATA_FILE_EXTENSION;
    } else {
      featuresName = dictionaryFile + "." + DictionaryMetadata.METADATA_FILE_EXTENSION;
    }

    return featuresName;
  }

  /**
   * Read dictionary metadata from a property file (stream).
   *
   * @param metadataStream The stream with metadata (the bytes of the .info file, or its text).
   * @return Returns {@link DictionaryMetadata} read from a the stream (property file).
   * @throws IOException Thrown if an I/O exception occurs.
   */
  static read(metadataStream: Uint8Array | string): DictionaryMetadata {
    const map = new Map<DictionaryAttribute, string>();
    const properties = new Properties();
    properties.load(typeof metadataStream === 'string' ? metadataStream : new TextDecoder('utf-8').decode(metadataStream));

    // Handle back-compatibility for encoder specification.
    if (properties.getProperty(DictionaryAttribute.ENCODER.propertyName) === null) {
      const hasDeprecated = properties.getProperty("fsa.dict.uses-suffixes") !== null ||
                            properties.getProperty("fsa.dict.uses-infixes") !== null ||
                            properties.getProperty("fsa.dict.uses-prefixes") !== null;

      const usesSuffixes = booleanValueOf(properties.getProperty("fsa.dict.uses-suffixes", "true"));
      const usesPrefixes = booleanValueOf(properties.getProperty("fsa.dict.uses-prefixes", "false"));
      const usesInfixes  = booleanValueOf(properties.getProperty("fsa.dict.uses-infixes",  "false"));

      let encoder: EncoderType;
      if (usesInfixes) {
        encoder = EncoderType.INFIX;
      } else if (usesPrefixes) {
        encoder = EncoderType.PREFIX;
      } else if (usesSuffixes) {
        encoder = EncoderType.SUFFIX;
      } else {
        encoder = EncoderType.NONE;
      }

      if (!hasDeprecated) {
        throw new IOException("Use an explicit " +
            DictionaryAttribute.ENCODER.propertyName + "=" + encoder.name() +
            " metadata key: ");
      }

      throw new IOException("Deprecated encoder keys in metadata. Use " +
          DictionaryAttribute.ENCODER.propertyName + "=" + encoder.name());
    }

    for (const key of properties.stringPropertyNames()) {
      map.set(DictionaryAttribute.fromPropertyName(key), properties.getProperty(key)!);
    }

    return new DictionaryMetadata(map);
  }
}
