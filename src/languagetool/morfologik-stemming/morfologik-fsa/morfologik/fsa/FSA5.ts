// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/FSA5.java faithful
// Bytes are signed, as in Java (arcs is an Int8Array). The module registers the reader of its
// version with FSA.read when it is loaded.
import type { DataInputStream } from '../../../../jdk/java/io/DataInputStream.ts';
import { FSA } from './FSA.ts';
import { FSAFlags } from './FSAFlags.ts';

/**
 * FSA binary format implementation for version 5.
 *
 * <p>
 * Version 5 indicates the dictionary was built with these flags:
 * {@link FSAFlags#FLEXIBLE}, {@link FSAFlags#STOPBIT} and
 * {@link FSAFlags#NEXTBIT}. The internal representation of the FSA must
 * therefore follow this description (please note this format describes only a
 * single transition (arc), not the entire dictionary file).
 *
 * <pre>
 * ---- this node header present only if automaton was compiled with NUMBERS option.
 * Byte
 *        +-+-+-+-+-+-+-+-+\
 *      0 | | | | | | | | | \  LSB
 *        +-+-+-+-+-+-+-+-+  +
 *      1 | | | | | | | | |  |      number of strings recognized
 *        +-+-+-+-+-+-+-+-+  +----- by the automaton starting
 *        : : : : : : : : :  |      from this node.
 *        +-+-+-+-+-+-+-+-+  +
 *  ctl-1 | | | | | | | | | /  MSB
 *        +-+-+-+-+-+-+-+-+/
 *
 * ---- remaining part of the node
 *
 * Byte
 *       +-+-+-+-+-+-+-+-+\
 *     0 | | | | | | | | | +------ label
 *       +-+-+-+-+-+-+-+-+/
 *
 *                  +------------- node pointed to is next
 *                  | +----------- the last arc of the node
 *                  | | +--------- the arc is final
 *                  | | |
 *             +-----------+
 *             |    | | |  |
 *         ___+___  | | |  |
 *        /       \ | | |  |
 *       MSB           LSB |
 *        7 6 5 4 3 2 1 0  |
 *       +-+-+-+-+-+-+-+-+ |
 *     1 | | | | | | | | | \ \
 *       +-+-+-+-+-+-+-+-+  \ \  LSB
 *       +-+-+-+-+-+-+-+-+     +
 *     2 | | | | | | | | |     |
 *       +-+-+-+-+-+-+-+-+     |
 *     3 | | | | | | | | |     +----- target node address (in bytes)
 *       +-+-+-+-+-+-+-+-+     |      (not present except for the byte
 *       : : : : : : : : :     |       with flags if the node pointed to
 *       +-+-+-+-+-+-+-+-+     +       is next)
 *   gtl | | | | | | | | |    /  MSB
 *       +-+-+-+-+-+-+-+-+   /
 * gtl+1                           (gtl = gotoLength)
 * </pre>
 */
export class FSA5 extends FSA {
  /**
   * Default filler byte.
   */
  static readonly DEFAULT_FILLER = 0x5f; // '_'

  /**
   * Default annotation byte.
   */
  static readonly DEFAULT_ANNOTATION = 0x2b; // '+'

  /**
   * Automaton version as in the file header.
   */
  static readonly VERSION = 5;

  /**
   * Bit indicating that an arc corresponds to the last character of a sequence
   * available when building the automaton.
   */
  static readonly BIT_FINAL_ARC = 1 << 0;

  /**
   * Bit indicating that an arc is the last one of the node's list and the
   * following one belongs to another node.
   */
  static readonly BIT_LAST_ARC = 1 << 1;

  /**
   * Bit indicating that the target node of this arc follows it in the
   * compressed automaton structure (no goto field).
   */
  static readonly BIT_TARGET_NEXT = 1 << 2;

  /**
   * An offset in the arc structure, where the address and flags field begins.
   * In version 5 of FSA automata, this value is constant (1, skip label).
   */
  static readonly ADDRESS_OFFSET = 1;

  /**
   * An array of bytes with the internal representation of the automaton. Please
   * see the documentation of this class for more information on how this
   * structure is organized.
   */
  readonly arcs: Int8Array;

  /**
   * The length of the node header structure (if the automaton was compiled with
   * <code>NUMBERS</code> option). Otherwise zero.
   */
  readonly nodeDataLength: number;

  /**
   * Flags for this automaton version.
   */
  private flags: ReadonlySet<FSAFlags>;

  /**
   * Number of bytes each address takes in full, expanded form (goto length).
   */
  readonly gtl: number;

  /** Filler character. */
  readonly filler: number;

  /** Annotation character. */
  readonly annotation: number;

  /**
   * Read and wrap a binary automaton in FSA version 5.
   */
  constructor(input: DataInputStream) {
    super();

    this.filler = input.readByte();
    this.annotation = input.readByte();
    const hgtl = input.readByte();

    /*
     * Determine if the automaton was compiled with NUMBERS. If so, modify
     * ctl and goto fields accordingly.
     */
    const flags = new Set<FSAFlags>([FSAFlags.FLEXIBLE, FSAFlags.STOPBIT, FSAFlags.NEXTBIT]);
    if ((hgtl & 0xf0) != 0) {
      flags.add(FSAFlags.NUMBERS);
    }

    this.flags = flags;

    this.nodeDataLength = (hgtl >>> 4) & 0x0f;
    this.gtl = hgtl & 0x0f;

    this.arcs = FSA5.readRemaining(input);
  }

  /**
   * Returns the start node of this automaton.
   */
  override getRootNode(): number {
    // Skip dummy node marking terminating state.
    const epsilonNode = this.skipArc(this.getFirstArc(0));

    // And follow the epsilon node's first (and only) arc.
    return this.getDestinationNodeOffset(this.getFirstArc(epsilonNode));
  }

  /**
   * {@inheritDoc}
   */
  override getFirstArc(node: number): number {
    return this.nodeDataLength + node;
  }

  /**
   * {@inheritDoc}
   */
  override getNextArc(arc: number): number {
    if (this.isArcLast(arc))
      return 0;
    else
      return this.skipArc(arc);
  }

  /**
   * {@inheritDoc}
   */
  override getArc(node: number, label: number): number {
    for (let arc = this.getFirstArc(node); arc != 0; arc = this.getNextArc(arc)) {
      if (this.getArcLabel(arc) == label)
        return arc;
    }

    // An arc labeled with "label" not found.
    return 0;
  }

  /**
   * {@inheritDoc}
   */
  override getEndNode(arc: number): number {
    const nodeOffset = this.getDestinationNodeOffset(arc);
    // assert nodeOffset != 0 : "No target node for terminal arcs.";
    return nodeOffset;
  }

  /**
   * {@inheritDoc}
   */
  override getArcLabel(arc: number): number {
    return this.arcs[arc]!;
  }

  /**
   * {@inheritDoc}
   */
  override isArcFinal(arc: number): boolean {
    return (this.arcs[arc + FSA5.ADDRESS_OFFSET]! & FSA5.BIT_FINAL_ARC) != 0;
  }

  /**
   * {@inheritDoc}
   */
  override isArcTerminal(arc: number): boolean {
    return (0 == this.getDestinationNodeOffset(arc));
  }

  /**
   * Returns the number encoded at the given node. The number equals the count
   * of the set of suffixes reachable from <code>node</code> (called its right
   * language).
   */
  override getRightLanguageCount(node: number): number {
    // assert getFlags().contains(FSAFlags.NUMBERS) : "This FSA was not compiled with NUMBERS.";
    return FSA5.decodeFromBytes(this.arcs, node, this.nodeDataLength);
  }

  /**
   * {@inheritDoc}
   *
   * <p>
   * For this automaton version, an additional {@link FSAFlags#NUMBERS} flag may
   * be set to indicate the automaton contains extra fields for each node.
   * </p>
   */
  override getFlags(): ReadonlySet<FSAFlags> {
    return this.flags;
  }

  /**
   * Returns <code>true</code> if this arc has <code>NEXT</code> bit set.
   *
   * @see #BIT_LAST_ARC
   * @param arc The node's arc identifier.
   * @return Returns true if the argument is the last arc of a node.
   */
  isArcLast(arc: number): boolean {
    return (this.arcs[arc + FSA5.ADDRESS_OFFSET]! & FSA5.BIT_LAST_ARC) != 0;
  }

  /**
   * @see #BIT_TARGET_NEXT
   * @param arc The node's arc identifier.
   * @return Returns true if {@link #BIT_TARGET_NEXT} is set for this arc.
   */
  isNextSet(arc: number): boolean {
    return (this.arcs[arc + FSA5.ADDRESS_OFFSET]! & FSA5.BIT_TARGET_NEXT) != 0;
  }

  /**
   * Returns an n-byte integer encoded in byte-packed representation.
   */
  static decodeFromBytes(arcs: Int8Array, start: number, n: number): number {
    let r = 0;
    for (let i = n; --i >= 0;) {
      r = r << 8 | (arcs[start + i]! & 0xff);
    }
    return r;
  }

  /**
   * Returns the address of the node pointed to by this arc.
   */
  getDestinationNodeOffset(arc: number): number {
    if (this.isNextSet(arc)) {
      /* The destination node follows this arc in the array. */
      return this.skipArc(arc);
    } else {
      /*
       * The destination node address has to be extracted from the arc's
       * goto field.
       */
      return FSA5.decodeFromBytes(this.arcs, arc + FSA5.ADDRESS_OFFSET, this.gtl) >>> 3;
    }
  }

  /**
   * Read the arc's layout and skip as many bytes, as needed.
   */
  private skipArc(offset: number): number {
    return offset +
        (this.isNextSet(offset)
            ? 1 + 1   /* label + flags */
            : 1 + this.gtl /* label + flags/address */);
  }
}

FSA.m_aVersions.set(FSA5.VERSION, (stream) => new FSA5(stream));
