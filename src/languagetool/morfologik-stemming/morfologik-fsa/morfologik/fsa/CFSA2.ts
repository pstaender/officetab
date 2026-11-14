// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/CFSA2.java faithful
// Bytes are signed, as in Java (arcs and labelMapping are Int8Arrays). The module registers the
// reader of its version with FSA.read when it is loaded.
import type { DataInputStream } from '../../../../jdk/java/io/DataInputStream.ts';
import { FSA } from './FSA.ts';
import { FSAFlags } from './FSAFlags.ts';
import { IOException } from './FSAHeader.ts';

/**
 * CFSA (Compact Finite State Automaton) binary format implementation, version 2:
 * <ul>
 *  <li>{@link #BIT_TARGET_NEXT} applicable on all arcs, not necessarily the last one.</li>
 *  <li>v-coded goto field</li>
 *  <li>v-coded perfect hashing numbers, if any</li>
 *  <li>31 most frequent labels integrated with flags byte</li>
 * </ul>
 *
 * <p>The encoding of automaton body is as follows.</p>
 *
 * <pre>
 * ---- CFSA header
 * Byte                            Description
 *       +-+-+-+-+-+-+-+-+\
 *     0 | | | | | | | | | +------ '\'
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *     1 | | | | | | | | | +------ 'f'
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *     2 | | | | | | | | | +------ 's'
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *     3 | | | | | | | | | +------ 'a'
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *     4 | | | | | | | | | +------ version (fixed 0xc6)
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *     5 | | | | | | | | | +----\
 *       +-+-+-+-+-+-+-+-+/      \ flags [MSB first]
 *       +-+-+-+-+-+-+-+-+\      /
 *     6 | | | | | | | | | +----/
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *     7 | | | | | | | | | +------ label lookup table size
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *  8-32 | | | | | | | | | +------ label value lookup table
 *       : : : : : : : : : |
 *       +-+-+-+-+-+-+-+-+/
 *
 * ---- Start of a node; only if automaton was compiled with NUMBERS option.
 *
 * Byte
 *        +-+-+-+-+-+-+-+-+\
 *      0 | | | | | | | | | \
 *        +-+-+-+-+-+-+-+-+  +
 *      1 | | | | | | | | |  |      number of strings recognized
 *        +-+-+-+-+-+-+-+-+  +----- by the automaton starting
 *        : : : : : : : : :  |      from this node. v-coding
 *        +-+-+-+-+-+-+-+-+  +
 *        | | | | | | | | | /
 *        +-+-+-+-+-+-+-+-+/
 *
 * ---- A vector of this node's arcs. An arc's layout depends on the combination of flags.
 *
 * 1) NEXT bit set, mapped arc label.
 *
 *        +----------------------- node pointed to is next
 *        | +--------------------- the last arc of the node
 *        | | +------------------- this arc leads to a final state (acceptor)
 *        | | |  _______+--------- arc's label; indexed if M &gt; 0, otherwise explicit label follows
 *        | | | / | | | |
 *       +-+-+-+-+-+-+-+-+\
 *     0 |N|L|F|M|M|M|M|M| +------ flags + (M) index of the mapped label.
 *       +-+-+-+-+-+-+-+-+/
 *       +-+-+-+-+-+-+-+-+\
 *     1 | | | | | | | | | +------ optional label if M == 0
 *       +-+-+-+-+-+-+-+-+/
 *       : : : : : : : : :
 *       +-+-+-+-+-+-+-+-+\
 *       |A|A|A|A|A|A|A|A| +------ v-coded goto address
 *       +-+-+-+-+-+-+-+-+/
 * </pre>
 */
export class CFSA2 extends FSA {
  /**
   * Automaton header version value.
   */
  static readonly VERSION = (0xc6 << 24) >> 24;

  /**
   * The target node of this arc follows the last arc of the current state
   * (no goto field).
   */
  static readonly BIT_TARGET_NEXT = 1 << 7;

  /**
   * The arc is the last one from the current node's arcs list.
   */
  static readonly BIT_LAST_ARC = 1 << 6;

  /**
   * The arc corresponds to the last character of a sequence
   * available when building the automaton (acceptor transition).
   */
  static readonly BIT_FINAL_ARC = 1 << 5;

  /**
   * The count of bits assigned to storing an indexed label.
   */
  static readonly LABEL_INDEX_BITS = 5;

  /**
   * Masks only the M bits of a flag byte.
   */
  static readonly LABEL_INDEX_MASK = (1 << CFSA2.LABEL_INDEX_BITS) - 1;

  /**
   * Maximum size of the labels index.
   */
  static readonly LABEL_INDEX_SIZE = (1 << CFSA2.LABEL_INDEX_BITS) - 1;

  /**
   * An array of bytes with the internal representation of the automaton.
   * Please see the documentation of this class for more information on how
   * this structure is organized.
   */
  arcs: Int8Array;

  /**
   * Flags for this automaton version.
   */
  private readonly flags: Set<FSAFlags>;

  /**
   * Label mapping for M-indexed labels.
   */
  readonly labelMapping: Int8Array;

  /**
   * If <code>true</code> states are prepended with numbers.
   */
  private readonly hasNumbers: boolean;

  /**
   * Epsilon node's offset.
   */
  private readonly epsilon = 0;

  /**
   * Reads an automaton from a byte stream.
   */
  constructor(input: DataInputStream) {
    super();

    // Read flags.
    const flagBits = input.readShort();
    this.flags = new Set<FSAFlags>();
    for (const f of FSAFlags.values()) {
      if (f.isSet(flagBits)) {
        this.flags.add(f);
      }
    }

    if (flagBits != FSAFlags.asShort(this.flags)) {
      throw new IOException("Unrecognized flags: 0x" + (flagBits >>> 0).toString(16));
    }

    this.hasNumbers = this.flags.has(FSAFlags.NUMBERS);

    /*
     * Read mapping dictionary.
     */
    const labelMappingSize = input.readByte() & 0xff;
    const labelMapping = new Uint8Array(labelMappingSize);
    input.readFully(labelMapping);
    this.labelMapping = new Int8Array(labelMapping.buffer, labelMapping.byteOffset, labelMapping.length);

    /*
     * Read arcs' data.
     */
    this.arcs = CFSA2.readRemaining(input);
  }

  /**
   * {@inheritDoc}
   */
  override getRootNode(): number {
    // Skip dummy node marking terminating state.
    return this.getDestinationNodeOffset(this.getFirstArc(this.epsilon));
  }

  /**
   * {@inheritDoc}
   */
  override getFirstArc(node: number): number {
    if (this.hasNumbers) {
      return this.skipVInt(node);
    } else {
      return node;
    }
  }

  /**
   * {@inheritDoc}
   */
  override getNextArc(arc: number): number {
    if (this.isArcLast(arc)) {
      return 0;
    } else {
      return this.skipArc(arc);
    }
  }

  /**
   * {@inheritDoc}
   */
  override getArc(node: number, label: number): number {
    for (let arc = this.getFirstArc(node); arc != 0; arc = this.getNextArc(arc)) {
      if (this.getArcLabel(arc) == label) {
        return arc;
      }
    }

    // An arc labeled with "label" not found.
    return 0;
  }

  /**
   * {@inheritDoc}
   */
  override getEndNode(arc: number): number {
    const nodeOffset = this.getDestinationNodeOffset(arc);
    // assert nodeOffset != 0 : "Can't follow a terminal arc: " + arc;
    // assert nodeOffset < arcs.length : "Node out of bounds.";
    return nodeOffset;
  }

  /**
   * {@inheritDoc}
   */
  override getArcLabel(arc: number): number {
    const index = this.arcs[arc]! & CFSA2.LABEL_INDEX_MASK;
    if (index > 0) {
      return this.labelMapping[index]!;
    } else {
      return this.arcs[arc + 1]!;
    }
  }

  /**
   * {@inheritDoc}
   */
  override getRightLanguageCount(node: number): number {
    // assert getFlags().contains(FSAFlags.NUMBERS) : "This FSA was not compiled with NUMBERS.";
    return CFSA2.readVInt(this.arcs, node);
  }

  /**
   * {@inheritDoc}
   */
  override isArcFinal(arc: number): boolean {
    return (this.arcs[arc]! & CFSA2.BIT_FINAL_ARC) != 0;
  }

  /**
   * {@inheritDoc}
   */
  override isArcTerminal(arc: number): boolean {
    return (0 == this.getDestinationNodeOffset(arc));
  }

  /**
   * Returns <code>true</code> if this arc has <code>NEXT</code> bit set.
   *
   * @see #BIT_LAST_ARC
   * @param arc The node's arc identifier.
   * @return Returns true if the argument is the last arc of a node.
   */
  isArcLast(arc: number): boolean {
    return (this.arcs[arc]! & CFSA2.BIT_LAST_ARC) != 0;
  }

  /**
   * @see #BIT_TARGET_NEXT
   * @param arc The node's arc identifier.
   * @return Returns true if {@link #BIT_TARGET_NEXT} is set for this arc.
   */
  isNextSet(arc: number): boolean {
    return (this.arcs[arc]! & CFSA2.BIT_TARGET_NEXT) != 0;
  }

  /**
   * {@inheritDoc}
   */
  override getFlags(): ReadonlySet<FSAFlags> {
    return this.flags;
  }

  /**
   * Returns the address of the node pointed to by this arc.
   */
  getDestinationNodeOffset(arc: number): number {
    if (this.isNextSet(arc)) {
      /* Follow until the last arc of this state. */
      while (!this.isArcLast(arc)) {
        arc = this.getNextArc(arc);
      }

      /* And return the byte right after it. */
      return this.skipArc(arc);
    } else {
      /*
       * The destination node address is v-coded. v-code starts either
       * at the next byte (label indexed) or after the next byte (label explicit).
       */
      return CFSA2.readVInt(this.arcs, arc + ((this.arcs[arc]! & CFSA2.LABEL_INDEX_MASK) == 0 ? 2 : 1));
    }
  }

  /**
   * Read the arc's layout and skip as many bytes, as needed, to skip it.
   */
  private skipArc(offset: number): number {
    const flag = this.arcs[offset++]!;

    // Explicit label?
    if ((flag & CFSA2.LABEL_INDEX_MASK) == 0) {
      offset++;
    }

    // Explicit goto?
    if ((flag & CFSA2.BIT_TARGET_NEXT) == 0) {
      offset = this.skipVInt(offset);
    }

    // assert offset < this.arcs.length;
    return offset;
  }

  /**
   * Read a v-int.
   */
  static readVInt(array: Int8Array, offset: number): number {
    let b = array[offset]!;
    let value = b & 0x7F;

    for (let shift = 7; b < 0; shift += 7) {
      b = array[++offset]!;
      value |= (b & 0x7F) << shift;
    }

    return value;
  }

  /**
   * Return the byte-length of a v-coded int.
   */
  static vIntLength(value: number): number {
    // assert value >= 0 : "Can't v-code negative ints.";

    let bytes: number;
    for (bytes = 1; value >= 0x80; bytes++) {
      value >>= 7;
    }

    return bytes;
  }

  /**
   * Skip a v-int.
   */
  private skipVInt(offset: number): number {
    while (this.arcs[offset++]! < 0) {
      // Do nothing.
    }
    return offset;
  }
}

FSA.m_aVersions.set(CFSA2.VERSION, (stream) => new CFSA2(stream));
