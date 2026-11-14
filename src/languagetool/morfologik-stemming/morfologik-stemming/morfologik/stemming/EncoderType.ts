// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/EncoderType.java faithful
// The Java enum is a class with one static instance per constant (values() and valueOf() as
// Java's).
import type { ISequenceEncoder } from './ISequenceEncoder.ts';
import { NoEncoder } from './NoEncoder.ts';
import { TrimInfixAndSuffixEncoder } from './TrimInfixAndSuffixEncoder.ts';
import { TrimPrefixAndSuffixEncoder } from './TrimPrefixAndSuffixEncoder.ts';
import { TrimSuffixEncoder } from './TrimSuffixEncoder.ts';

/**
 * Known {@link ISequenceEncoder}s.
 */
export class EncoderType {
  static readonly SUFFIX = new EncoderType('SUFFIX', () => new TrimSuffixEncoder());
  static readonly PREFIX = new EncoderType('PREFIX', () => new TrimPrefixAndSuffixEncoder());
  static readonly INFIX = new EncoderType('INFIX', () => new TrimInfixAndSuffixEncoder());
  static readonly NONE = new EncoderType('NONE', () => new NoEncoder());

  static values(): EncoderType[] {
    return [EncoderType.SUFFIX, EncoderType.PREFIX, EncoderType.INFIX, EncoderType.NONE];
  }

  /** Enum.valueOf: throws IllegalArgumentException (an Error) for an unknown name. */
  static valueOf(name: string): EncoderType {
    const t = EncoderType.values().find((v) => v.m_sName === name);
    if (t === undefined) {
      throw new Error("No enum constant morfologik.stemming.EncoderType." + name);
    }
    return t;
  }

  private readonly m_sName: string;
  private readonly m_aFactory: () => ISequenceEncoder;

  private constructor(name: string, factory: () => ISequenceEncoder) {
    this.m_sName = name;
    this.m_aFactory = factory;
  }

  name(): string {
    return this.m_sName;
  }

  toString(): string {
    return this.m_sName;
  }

  get(): ISequenceEncoder {
    return this.m_aFactory();
  }
}
