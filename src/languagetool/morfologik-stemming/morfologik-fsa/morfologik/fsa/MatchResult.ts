// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/MatchResult.java faithful
// The three constructors are one with optional parameters.

/**
 * A matching result returned from {@link FSATraversal}.
 *
 * @see FSATraversal
 */
export class MatchResult {
  /**
   * The automaton has exactly one match for the input sequence.
   */
  static readonly EXACT_MATCH = 0;

  /**
   * The automaton has no match for the input sequence and no sequence
   * in the automaton is a prefix of the input.
   *
   * Note that to check for a general "input does not exist in the automaton"
   * you have to check for both {@link #NO_MATCH} and
   * {@link #AUTOMATON_HAS_PREFIX}.
   */
  static readonly NO_MATCH = -1;

  /**
   * The automaton contains a prefix of the input sequence (but the
   * full sequence does not exist). This translates to: one of the input sequences
   * used to build the automaton is a prefix of the input sequence, but the
   * input sequence contains a non-existent suffix.
   *
   * <p>{@link MatchResult#index} will contain an index of the
   * first character of the input sequence not present in the
   * dictionary.</p>
   */
  static readonly AUTOMATON_HAS_PREFIX = -3;

  /**
   * The sequence is a prefix of at least one sequence in the automaton.
   * {@link MatchResult#node} returns the node from which all sequences
   * with the given prefix start in the automaton.
   */
  static readonly SEQUENCE_IS_A_PREFIX = -4;

  /**
   * One of the match types defined in this class.
   *
   * @see #NO_MATCH
   * @see #EXACT_MATCH
   * @see #AUTOMATON_HAS_PREFIX
   * @see #SEQUENCE_IS_A_PREFIX
   */
  kind = 0;

  /**
   * Input sequence's index, interpretation depends on {@link #kind}.
   */
  index = 0;

  /**
   * Automaton node, interpretation depends on the {@link #kind}.
   */
  node = 0;

  constructor(kind: number = MatchResult.NO_MATCH, index = 0, node = 0) {
    this.reset(kind, index, node);
  }

  reset(kind: number, index: number, node: number): void {
    this.kind = kind;
    this.index = index;
    this.node = node;
  }
}
