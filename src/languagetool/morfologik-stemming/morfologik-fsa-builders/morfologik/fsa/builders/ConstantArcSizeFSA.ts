// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa-builders/src/main/java/morfologik/fsa/builders/ConstantArcSizeFSA.java faithful
// Bytes are signed, as in Java (data is an Int8Array).
import { FSA } from '../../../../morfologik-fsa/morfologik/fsa/FSA.ts';
import type { FSAFlags } from '../../../../morfologik-fsa/morfologik/fsa/FSAFlags.ts';

/**
 * An FSA with constant-size arc representation produced directly by
 * {@link FSABuilder}.
 * 
 * @see FSABuilder
 */
export class ConstantArcSizeFSA extends FSA {
  /** Size of the target address field (constant for the builder). */
  static readonly TARGET_ADDRESS_SIZE = 4;

  /** Size of the flags field (constant for the builder). */
  static readonly FLAGS_SIZE = 1;

  /** Size of the label field (constant for the builder). */
  static readonly LABEL_SIZE = 1;

  /**
   * Size of a single arc structure.
   */
  static readonly ARC_SIZE = ConstantArcSizeFSA.FLAGS_SIZE + ConstantArcSizeFSA.LABEL_SIZE + ConstantArcSizeFSA.TARGET_ADDRESS_SIZE;

  /** Offset of the flags field inside an arc. */
  static readonly FLAGS_OFFSET = 0;

  /** Offset of the label field inside an arc. */
  static readonly LABEL_OFFSET = ConstantArcSizeFSA.FLAGS_SIZE;

  /** Offset of the address field inside an arc. */
  static readonly ADDRESS_OFFSET = ConstantArcSizeFSA.LABEL_OFFSET + ConstantArcSizeFSA.LABEL_SIZE;

  /** A dummy address of the terminal state. */
  static readonly TERMINAL_STATE = 0;

  /**
   * An arc flag indicating the target node of an arc corresponds to a final
   * state.
   */
  static readonly BIT_ARC_FINAL = 1 << 1;

  /** An arc flag indicating the arc is last within its state. */
  static readonly BIT_ARC_LAST = 1 << 0;

  /**
   * An epsilon state. The first and only arc of this state points either to the
   * root or to the terminal state, indicating an empty automaton.
   */
  private readonly epsilon: number;

  /**
   * FSA data, serialized as a byte array.
   */
  private readonly data: Int8Array;

  /**
   * @param data
   *          FSA data. There must be no trailing bytes after the last state.
   */
  constructor(data: Int8Array, epsilon: number) {
    super();
    // assert epsilon == 0 : "Epsilon is not zero?";

    this.epsilon = epsilon;
    this.data = data;
  }

  override getRootNode(): number {
    return this.getEndNode(this.getFirstArc(this.epsilon));
  }

  override getFirstArc(node: number): number {
    return node;
  }

  override getArc(node: number, label: number): number {
    for (let arc = this.getFirstArc(node); arc != 0; arc = this.getNextArc(arc)) {
      if (this.getArcLabel(arc) == label)
        return arc;
    }
    return 0;
  }

  override getNextArc(arc: number): number {
    if (this.isArcLast(arc))
      return 0;
    return arc + ConstantArcSizeFSA.ARC_SIZE;
  }

  override getArcLabel(arc: number): number {
    return this.data[arc + ConstantArcSizeFSA.LABEL_OFFSET];
  }

  /**
   * Fills the target state address of an arc.
   */
  private getArcTarget(arc: number): number {
    const data = this.data;
    arc += ConstantArcSizeFSA.ADDRESS_OFFSET;
    return (data[arc]           ) << 24 | 
           (data[arc + 1] & 0xff) << 16 | 
           (data[arc + 2] & 0xff) << 8  | 
           (data[arc + 3] & 0xff);
  }

  override isArcFinal(arc: number): boolean {
    return (this.data[arc + ConstantArcSizeFSA.FLAGS_OFFSET] & ConstantArcSizeFSA.BIT_ARC_FINAL) != 0;
  }

  override isArcTerminal(arc: number): boolean {
    return this.getArcTarget(arc) == 0;
  }

  private isArcLast(arc: number): boolean {
    return (this.data[arc + ConstantArcSizeFSA.FLAGS_OFFSET] & ConstantArcSizeFSA.BIT_ARC_LAST) != 0;
  }

  override getEndNode(arc: number): number {
    return this.getArcTarget(arc);
  }

  override getFlags(): ReadonlySet<FSAFlags> {
    return new Set();
  }
}
