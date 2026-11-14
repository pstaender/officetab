// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/DictionaryAttribute.java faithful
// The Java enum is a class with one static instance per constant; a constant's fromString
// override is passed to its constructor. Value types: Character is a one-char string, Locale
// a locale name string (as written in the .info file), LinkedHashMap a Map (insertion-ordered).
import { StringTrim } from '../../../../jdk/java/lang/Character.ts';
import { Charset } from '../../../../jdk/java/nio/charset/Charset.ts';
import { EncoderType } from './EncoderType.ts';

/** String.split as Java's (trailing empty strings are removed). */
export function JavaSplit(s: string, regex: RegExp): string[] {
  const parts = s.split(regex);
  if (parts.length == 1) {
    return parts;
  }
  while (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/** Character.isHighSurrogate / isLowSurrogate. */
const isSurrogate = (c: string): boolean => {
  const u = c.charCodeAt(0);
  return u >= 0xd800 && u <= 0xdfff;
};

/**
 * Attributes applying to {@link Dictionary} and {@link DictionaryMetadata}.
 */
export class DictionaryAttribute {
  /**
   * Logical fields separator inside the FSA.
   */
  static readonly SEPARATOR = new DictionaryAttribute('SEPARATOR', "fsa.dict.separator", function (this: DictionaryAttribute, separator: string): string {
    if (separator == null || separator.length != 1) {
      throw new Error("IllegalArgumentException: Attribute " + this.propertyName
          + " must be a single character.");
    }

    const charValue = separator.charAt(0);
    if (isSurrogate(charValue)) {
      throw new Error(
          "IllegalArgumentException: Field separator character cannot be part of a surrogate pair: " + separator);
    }

    return charValue;
  });

  /**
   * Character to byte encoding used for strings inside the FSA.
   */
  static readonly ENCODING = new DictionaryAttribute('ENCODING', "fsa.dict.encoding", (charsetName: string): Charset => {
    return Charset.forName(charsetName);
  });

  /**
   * If the FSA dictionary includes frequency data.
   */
  static readonly FREQUENCY_INCLUDED = new DictionaryAttribute('FREQUENCY_INCLUDED', "fsa.dict.frequency-included", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /**
   * If the spelling dictionary is supposed to ignore words containing digits
   */
  static readonly IGNORE_NUMBERS = new DictionaryAttribute('IGNORE_NUMBERS', "fsa.dict.speller.ignore-numbers", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /**
   * If the spelling dictionary is supposed to ignore punctuation.
   */
  static readonly IGNORE_PUNCTUATION = new DictionaryAttribute('IGNORE_PUNCTUATION', "fsa.dict.speller.ignore-punctuation", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /**
   * If the spelling dictionary is supposed to ignore CamelCase words.
   */
  static readonly IGNORE_CAMEL_CASE = new DictionaryAttribute('IGNORE_CAMEL_CASE', "fsa.dict.speller.ignore-camel-case", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /**
   * If the spelling dictionary is supposed to ignore ALL UPPERCASE words.
   */
  static readonly IGNORE_ALL_UPPERCASE = new DictionaryAttribute('IGNORE_ALL_UPPERCASE', "fsa.dict.speller.ignore-all-uppercase", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /**
   * If the spelling dictionary is supposed to ignore diacritics, so that
   * 'a' would be treated as equivalent to 'ą'.
   */
  static readonly IGNORE_DIACRITICS = new DictionaryAttribute('IGNORE_DIACRITICS', "fsa.dict.speller.ignore-diacritics", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /**
   * if the spelling dictionary is supposed to treat upper and lower case
   * as equivalent.
   */
  static readonly CONVERT_CASE = new DictionaryAttribute('CONVERT_CASE', "fsa.dict.speller.convert-case", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /**
   * If the spelling dictionary is supposed to split runOnWords.
   */
  static readonly RUN_ON_WORDS = new DictionaryAttribute('RUN_ON_WORDS', "fsa.dict.speller.runon-words", (value: string) => {
    return DictionaryAttribute.booleanValue(value);
  });

  /** Locale associated with the dictionary. */
  static readonly LOCALE = new DictionaryAttribute('LOCALE', "fsa.dict.speller.locale", (value: string): string => {
    return value;
  });

  /** Locale associated with the dictionary. */
  static readonly ENCODER = new DictionaryAttribute('ENCODER', "fsa.dict.encoder", (value: string): EncoderType => {
    try {
      return EncoderType.valueOf(StringTrim(value).toUpperCase());
    } catch {
      throw new Error("IllegalArgumentException: Invalid encoder name '" + StringTrim(value) + "', only these coders are valid: [" + EncoderType.values().join(', ') + "]");
    }
  });

  /**
   * Input conversion pairs to replace non-standard characters before search in a speller dictionary.
   * For example, common ligatures can be replaced here.
   */
  static readonly INPUT_CONVERSION = new DictionaryAttribute('INPUT_CONVERSION', "fsa.dict.input-conversion", function (this: DictionaryAttribute, value: string): Map<string, string> {
    const conversionPairs = new Map<string, string>();
    const replacements = JavaSplit(value, /,\s*/);
    for (const stringPair of replacements) {
      const twoStrings = JavaSplit(StringTrim(stringPair), / /);
      if (twoStrings.length == 2) {
        if (!conversionPairs.has(twoStrings[0]!)) {
          conversionPairs.set(twoStrings[0]!, twoStrings[1]!);
        } else {
          throw new Error(
              "IllegalArgumentException: Input conversion cannot specify different values for the same input string: " + twoStrings[0]);
        }
      } else {
        throw new Error("IllegalArgumentException: Attribute " + this.propertyName
            + " is not in the proper format: " + value);
      }
    }
    return conversionPairs;
  });

  /**
   * Output conversion pairs to replace non-standard characters before search in a speller dictionary.
   * For example, standard characters can be replaced here into ligatures.
   *
   * Useful for dictionaries that do have certain standards imposed.
   *
   */
  static readonly OUTPUT_CONVERSION = new DictionaryAttribute('OUTPUT_CONVERSION', "fsa.dict.output-conversion", function (this: DictionaryAttribute, value: string): Map<string, string> {
    const conversionPairs = new Map<string, string>();
    const replacements = JavaSplit(value, /,\s*/);
    for (const stringPair of replacements) {
      const twoStrings = JavaSplit(StringTrim(stringPair), / /);
      if (twoStrings.length == 2) {
        if (!conversionPairs.has(twoStrings[0]!)) {
          conversionPairs.set(twoStrings[0]!, twoStrings[1]!);
        } else {
          throw new Error(
              "IllegalArgumentException: Input conversion cannot specify different values for the same input string: " + twoStrings[0]);
        }
      } else {
        throw new Error("IllegalArgumentException: Attribute " + this.propertyName
            + " is not in the proper format: " + value);
      }
    }
    return conversionPairs;
  });

  /**
   * Replacement pairs for non-obvious candidate search in a speller dictionary.
   * For example, Polish <tt>rz</tt> is phonetically equivalent to <tt>ż</tt>,
   * and this may be specified here to allow looking for replacements of <tt>rz</tt> with <tt>ż</tt>
   * and vice versa.
   */
  static readonly REPLACEMENT_PAIRS = new DictionaryAttribute('REPLACEMENT_PAIRS', "fsa.dict.speller.replacement-pairs", function (this: DictionaryAttribute, value: string): Map<string, string[]> {
    const replacementPairs = new Map<string, string[]>();
    const replacements = JavaSplit(value, /,\s*/);
    for (const stringPair of replacements) {
      const twoStrings = JavaSplit(StringTrim(stringPair), / /);
      if (twoStrings.length == 2) {
        if (!replacementPairs.has(twoStrings[0]!)) {
          const strList: string[] = [];
          strList.push(twoStrings[1]!);
          replacementPairs.set(twoStrings[0]!, strList);
        } else {
          replacementPairs.get(twoStrings[0]!)!.push(twoStrings[1]!);
        }
      } else {
        throw new Error("IllegalArgumentException: Attribute " + this.propertyName
            + " is not in the proper format: " + value);
      }
    }
    return replacementPairs;
  });

  /**
   * Equivalent characters (treated similarly as equivalent chars with and without
   * diacritics). For example, Polish <tt>ł</tt> can be specified as equivalent to <tt>l</tt>.
   *
   * <p>This implements a feature similar to hunspell MAP in the affix file.
   */
  static readonly EQUIVALENT_CHARS = new DictionaryAttribute('EQUIVALENT_CHARS', "fsa.dict.speller.equivalent-chars", function (this: DictionaryAttribute, value: string): Map<string, string[]> {
    const equivalentCharacters = new Map<string, string[]>();
    const eqChars = JavaSplit(value, /,\s*/);
    for (const characterPair of eqChars) {
      const twoChars = JavaSplit(StringTrim(characterPair), / /);
      if (twoChars.length == 2
          && twoChars[0]!.length == 1
          && twoChars[1]!.length == 1) {
        const fromChar = twoChars[0]!.charAt(0);
        const toChar = twoChars[1]!.charAt(0);
        if (!equivalentCharacters.has(fromChar)) {
          const chList: string[] = [];
          equivalentCharacters.set(fromChar, chList);
        }
        equivalentCharacters.get(fromChar)!.push(toChar);
      } else {
        throw new Error("IllegalArgumentException: Attribute " + this.propertyName
            + " is not in the proper format: " + value);
      }
    }
    return equivalentCharacters;
  });

  /**
   * Dictionary license attribute.
   */
  static readonly LICENSE = new DictionaryAttribute('LICENSE', "fsa.dict.license");

  /**
   * Dictionary author.
   */
  static readonly AUTHOR = new DictionaryAttribute('AUTHOR', "fsa.dict.author");

  /**
   * Dictionary creation date.
   */
  static readonly CREATION_DATE = new DictionaryAttribute('CREATION_DATE', "fsa.dict.created");

  static values(): DictionaryAttribute[] {
    const A = DictionaryAttribute;
    return [A.SEPARATOR, A.ENCODING, A.FREQUENCY_INCLUDED, A.IGNORE_NUMBERS, A.IGNORE_PUNCTUATION,
      A.IGNORE_CAMEL_CASE, A.IGNORE_ALL_UPPERCASE, A.IGNORE_DIACRITICS, A.CONVERT_CASE, A.RUN_ON_WORDS,
      A.LOCALE, A.ENCODER, A.INPUT_CONVERSION, A.OUTPUT_CONVERSION, A.REPLACEMENT_PAIRS, A.EQUIVALENT_CHARS,
      A.LICENSE, A.AUTHOR, A.CREATION_DATE];
  }

  /**
   * Property name for this attribute.
   */
  readonly propertyName: string;

  private readonly m_sName: string;
  private readonly m_aFromString: ((this: DictionaryAttribute, value: string) => unknown) | undefined;

  name(): string {
    return this.m_sName;
  }

  toString(): string {
    return this.m_sName;
  }

  /** Enum.ordinal(). */
  ordinal(): number {
    return DictionaryAttribute.values().indexOf(this);
  }

  /**
   * Converts a string to the given attribute's value.

   * @param value The value to convert to an attribute value.
   * @return Returns the attribute's value converted from a string.
   *
   * @throws IllegalArgumentException
   *             If the input string cannot be converted to the attribute's
   *             value.
   */
  fromString(value: string): unknown {
    if (this.m_aFromString !== undefined) {
      return this.m_aFromString.call(this, value);
    }
    return value;
  }

  /**
   * @param propertyName The property of a {@link DictionaryAttribute}.
   * @return Return a {@link DictionaryAttribute} associated with
   * a given {@link #propertyName}.
   */
  static fromPropertyName(propertyName: string): DictionaryAttribute {
    const value = DictionaryAttribute.attrsByPropertyName().get(propertyName);
    if (value == null) {
      throw new Error("IllegalArgumentException: No attribute for property: " + propertyName);
    }
    return value;
  }

  private static m_aAttrsByPropertyName: Map<string, DictionaryAttribute> | undefined;
  /** The static initializer, run on first use (the constants must exist first). */
  private static attrsByPropertyName(): Map<string, DictionaryAttribute> {
    if (DictionaryAttribute.m_aAttrsByPropertyName === undefined) {
      const attrsByPropertyName = new Map<string, DictionaryAttribute>();
      for (const attr of DictionaryAttribute.values()) {
        if (attrsByPropertyName.has(attr.propertyName)) {
          throw new Error("Duplicate property key for: " + attr);
        }
        attrsByPropertyName.set(attr.propertyName, attr);
      }
      DictionaryAttribute.m_aAttrsByPropertyName = attrsByPropertyName;
    }
    return DictionaryAttribute.m_aAttrsByPropertyName;
  }

  /**
   * Private enum instance constructor.
   */
  private constructor(name: string, propertyName: string, fromString?: (this: DictionaryAttribute, value: string) => unknown) {
    this.m_sName = name;
    this.propertyName = propertyName;
    this.m_aFromString = fromString;
  }

  private static booleanValue(value: string): boolean {
    value = value.toLowerCase();
    if ("true" === value || "yes" === value || "on" === value) {
      return true;
    }
    if ("false" === value || "no" === value || "off" === value) {
      return false;
    }
    throw new Error("IllegalArgumentException: Not a boolean value: " + value);
  }
}
