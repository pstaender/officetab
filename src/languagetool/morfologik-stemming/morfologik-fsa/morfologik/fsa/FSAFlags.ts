// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/FSAFlags.java faithful
// The Java enum is a class with one static instance per constant (values() in declaration order).

/**
 * FSA automaton flags. Where applicable, flags follow Daciuk's <code>fsa</code>
 * package.
 */
export class FSAFlags {
  /** Daciuk: flexible FSA encoding. */
  static readonly FLEXIBLE = new FSAFlags('FLEXIBLE', 1 << 0);

  /** Daciuk: stop bit in use. */
  static readonly STOPBIT = new FSAFlags('STOPBIT', 1 << 1);

  /** Daciuk: next bit in use. */
  static readonly NEXTBIT = new FSAFlags('NEXTBIT', 1 << 2);

  /** Daciuk: tails compression. */
  static readonly TAILS = new FSAFlags('TAILS', 1 << 3);

  /*
   * These flags are outside of byte range (never occur in Daciuk's FSA).
   */

  /**
   * The FSA contains right-language count numbers on states.
   *
   * @see FSA#getRightLanguageCount(int)
   */
  static readonly NUMBERS = new FSAFlags('NUMBERS', 1 << 8);

  /**
   * The FSA supports legacy built-in separator and filler characters (Daciuk's
   * FSA package compatibility).
   */
  static readonly SEPARATORS = new FSAFlags('SEPARATORS', 1 << 9);

  static values(): FSAFlags[] {
    return [FSAFlags.FLEXIBLE, FSAFlags.STOPBIT, FSAFlags.NEXTBIT, FSAFlags.TAILS, FSAFlags.NUMBERS, FSAFlags.SEPARATORS];
  }

  /**
   * Bit mask for the corresponding flag.
   */
  readonly bits: number;

  private readonly m_sName: string;

  /** */
  private constructor(name: string, bits: number) {
    this.m_sName = name;
    this.bits = bits;
  }

  name(): string {
    return this.m_sName;
  }

  toString(): string {
    return this.m_sName;
  }

  /**
   * @param flags The bitset with flags.
   * @return Returns <code>true</code> iff this flag is set in <code>flags</code>.
   */
  isSet(flags: number): boolean {
    return (flags & this.bits) != 0;
  }

  /**
   * @param flags A set of flags to encode.
   * @return Returns the set of flags encoded as packed <code>short</code>.
   */
  static asShort(flags: Iterable<FSAFlags>): number {
    let value = 0;
    for (const f of flags) {
      value |= f.bits;
    }
    return (value << 16) >> 16;
  }
}
