// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/FSATraversal.java faithful
// The perfectHash overloads are one method with optional parameters; match keeps its Java
// overloads as TypeScript overload signatures (their parameters are not in the same order).
import type { FSA } from './FSA.ts';
import { MatchResult } from './MatchResult.ts';

const { EXACT_MATCH, NO_MATCH, AUTOMATON_HAS_PREFIX, SEQUENCE_IS_A_PREFIX } = MatchResult;

/**
 * This class implements some common matching and scanning operations on a
 * generic FSA.
 */
export class FSATraversal {
  /**
   * Target automaton.
   */
  private readonly fsa: FSA;

  /**
   * Traversals of the given FSA.
   *
   * @param fsa The target automaton for traversals.
   */
  constructor(fsa: FSA) {
    this.fsa = fsa;
  }

  /**
   * Calculate perfect hash for a given input sequence of bytes. The perfect hash requires
   * that {@link FSA} is built with {@link FSAFlags#NUMBERS} and corresponds to the sequential
   * order of input sequences used at automaton construction time.
   *
   * @param sequence The byte sequence to calculate perfect hash for.
   * @param start Start index in the sequence array.
   * @param length Length of the byte sequence, must be at least 1.
   * @param node The node to start traversal from, typically the {@linkplain FSA#getRootNode() root node}.
   *
   * @return Returns a unique integer assigned to the input sequence in the automaton (reflecting
   * the number of that sequence in the input used to build the automaton). Returns a negative
   * integer if the input sequence was not part of the input from which the automaton was created.
   * The type of mismatch is a constant defined in {@link MatchResult}.
   */
  perfectHash(sequence: Int8Array, start = 0, length: number = sequence.length, node: number = this.fsa.getRootNode()): number {
    // assert fsa.getFlags().contains(FSAFlags.NUMBERS) : "FSA not built with NUMBERS option.";
    // assert length > 0 : "Must be a non-empty sequence.";

    let hash = 0;
    const end = start + length - 1;

    let seqIndex = start;
    let label = sequence[seqIndex]!;

    // Seek through the current node's labels, looking for 'label', update hash.
    for (let arc = this.fsa.getFirstArc(node); arc != 0;) {
      if (this.fsa.getArcLabel(arc) == label) {
        if (this.fsa.isArcFinal(arc)) {
          if (seqIndex == end) {
            return hash;
          }

          hash++;
        }

        if (this.fsa.isArcTerminal(arc)) {
          /* The automaton contains a prefix of the input sequence. */
          return AUTOMATON_HAS_PREFIX;
        }

        // The sequence is a prefix of one of the sequences stored in the automaton.
        if (seqIndex == end) {
          return SEQUENCE_IS_A_PREFIX;
        }

        // Make a transition along the arc, go the target node's first arc.
        arc = this.fsa.getFirstArc(this.fsa.getEndNode(arc));
        label = sequence[++seqIndex]!;
        continue;
      } else {
        if (this.fsa.isArcFinal(arc)) {
          hash++;
        }
        if (!this.fsa.isArcTerminal(arc)) {
          hash += this.fsa.getRightLanguageCount(this.fsa.getEndNode(arc));
        }
      }

      arc = this.fsa.getNextArc(arc);
    }

    if (seqIndex > start) {
      return AUTOMATON_HAS_PREFIX;
    } else {
      // Labels of this node ended without a match on the sequence.
      // Perfect hash does not exist.
      return NO_MATCH;
    }
  }

  /**
   * Finds a matching path in the dictionary for a given sequence of labels from
   * <code>sequence</code> and starting at node <code>node</code>. The Java overloads:
   * match(reuse, sequence, start, length, node) allows passing
   * a reusable {@link MatchResult} object so that no intermediate garbage is
   * produced; match(sequence, start, length, node); match(sequence, node); match(sequence)
   * (from the root node).
   *
   * @param reuse The {@link MatchResult} to reuse.
   * @param sequence Input sequence to look for in the automaton.
   * @param start Start index in the sequence array.
   * @param length Length of the byte sequence, must be at least 1.
   * @param node The node to start traversal from, typically the {@linkplain FSA#getRootNode() root node}.
   *
   * @return The same object as <code>reuse</code>, but with updated match {@link MatchResult#kind}
   *        and other relevant fields.
   */
  match(reuse: MatchResult, sequence: Int8Array, start: number, length: number, node: number): MatchResult;
  match(sequence: Int8Array, start: number, length: number, node: number): MatchResult;
  match(sequence: Int8Array, node?: number): MatchResult;
  match(a0: MatchResult | Int8Array, a1?: Int8Array | number, a2?: number, a3?: number, a4?: number): MatchResult {
    let reuse: MatchResult, sequence: Int8Array, start: number, length: number, node: number;
    if (a0 instanceof MatchResult) {
      [reuse, sequence, start, length, node] = [a0, a1 as Int8Array, a2!, a3!, a4!];
    } else if (a2 !== undefined) {
      [reuse, sequence, start, length, node] = [new MatchResult(), a0, a1 as number, a2, a3!];
    } else {
      [reuse, sequence, start, length, node] = [new MatchResult(), a0, 0, a0.length, (a1 as number | undefined) ?? this.fsa.getRootNode()];
    }
    if (node == 0) {
      reuse.reset(NO_MATCH, start, node);
      return reuse;
    }

    const fsa = this.fsa;
    const end = start + length;
    for (let i = start; i < end; i++) {
      const arc = fsa.getArc(node, sequence[i]!);
      if (arc != 0) {
        if (i + 1 == end && fsa.isArcFinal(arc)) {
          /* The automaton has an exact match of the input sequence. */
          reuse.reset(EXACT_MATCH, i, node);
          return reuse;
        }

        if (fsa.isArcTerminal(arc)) {
          /* The automaton contains a prefix of the input sequence. */
          reuse.reset(AUTOMATON_HAS_PREFIX, i + 1, node);
          return reuse;
        }

        // Make a transition along the arc.
        node = fsa.getEndNode(arc);
      } else {
        if (i > start) {
          reuse.reset(AUTOMATON_HAS_PREFIX, i, node);
        } else {
          reuse.reset(NO_MATCH, i, node);
        }
        return reuse;
      }
    }

    /* The sequence is a prefix of at least one sequence in the automaton. */
    reuse.reset(SEQUENCE_IS_A_PREFIX, 0, node);
    return reuse;
  }
}
