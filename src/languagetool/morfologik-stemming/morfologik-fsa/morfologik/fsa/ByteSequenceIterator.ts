// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/ByteSequenceIterator.java faithful
// A Java-style iterator (hasNext/next); FSA.getSequences adapts it to JavaScript iteration.
import { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import type { FSA } from './FSA.ts';

/** Arrays.copyOf for byte[] and int[]. */
function copyOf<T extends Int8Array | Int32Array>(a: T, newLength: number): T {
  const r = new (a.constructor as new (n: number) => T)(newLength);
  r.set(a.subarray(0, Math.min(a.length, newLength)));
  return r;
}

/**
 * An iterator that traverses the right language of a given node (all sequences
 * reachable from a given node).
 */
export class ByteSequenceIterator {
  /**
   * Default expected depth of the recursion stack (estimated longest sequence
   * in the automaton). Buffers expand by the same value if exceeded.
   */
  private static readonly EXPECTED_MAX_STATES = 15;

  /** The FSA to which this iterator belongs. */
  private readonly fsa: FSA;

  /** An internal cache for the next element in the FSA */
  private nextElement: ByteBuffer | null = null;

  /**
   * A buffer for the current sequence of bytes from the current node to the
   * root.
   */
  private buffer = new Int8Array(ByteSequenceIterator.EXPECTED_MAX_STATES);

  /** Reusable byte buffer wrapper around {@link #buffer}. */
  private bufferWrapper = ByteBuffer.wrap(this.buffer);

  /** An arc stack for DFS when processing the automaton. */
  private arcs = new Int32Array(ByteSequenceIterator.EXPECTED_MAX_STATES);

  /** Current processing depth in {@link #arcs}. */
  private position = 0;

  /**
   * Create an instance of the iterator for a given node (by default iterating over all automaton sequences).
   * @param fsa The automaton to iterate over.
   * @param node The starting node's identifier (can be the {@link FSA#getRootNode()}).
   */
  constructor(fsa: FSA, node: number = fsa.getRootNode()) {
    this.fsa = fsa;

    if (fsa.getFirstArc(node) != 0) {
      this.restartFrom(node);
    }
  }

  /**
   * Restart walking from <code>node</code>. Allows iterator reuse.
   *
   * @param node Restart the iterator from <code>node</code>.
   * @return Returns <code>this</code> for call chaining.
   */
  restartFrom(node: number): ByteSequenceIterator {
    this.position = 0;
    this.bufferWrapper.clear();
    this.nextElement = null;

    this.pushNode(node);
    return this;
  }

  /** Returns <code>true</code> if there are still elements in this iterator. */
  hasNext(): boolean {
    if (this.nextElement == null) {
      this.nextElement = this.advance();
    }

    return this.nextElement != null;
  }

  /**
   * @return Returns a {@link ByteBuffer} with the sequence corresponding to the
   *         next final state in the automaton.
   */
  next(): ByteBuffer {
    if (this.nextElement != null) {
      const cache = this.nextElement;
      this.nextElement = null;
      return cache;
    } else {
      const cache = this.advance();
      if (cache == null) {
        throw new Error('NoSuchElementException');
      }
      return cache;
    }
  }

  /**
   * Advances to the next available final state.
   */
  private advance(): ByteBuffer | null {
    if (this.position == 0) {
      return null;
    }

    while (this.position > 0) {
      const lastIndex = this.position - 1;
      const arc = this.arcs[lastIndex]!;

      if (arc == 0) {
        // Remove the current node from the queue.
        this.position--;
        continue;
      }

      // Go to the next arc, but leave it on the stack
      // so that we keep the recursion depth level accurate.
      this.arcs[lastIndex] = this.fsa.getNextArc(arc);

      // Expand buffer if needed.
      const bufferLength = this.buffer.length;
      if (lastIndex >= bufferLength) {
        this.buffer = copyOf(this.buffer, bufferLength + ByteSequenceIterator.EXPECTED_MAX_STATES);
        this.bufferWrapper = ByteBuffer.wrap(this.buffer);
      }
      this.buffer[lastIndex] = this.fsa.getArcLabel(arc);

      if (!this.fsa.isArcTerminal(arc)) {
        // Recursively descend into the arc's node.
        this.pushNode(this.fsa.getEndNode(arc));
      }

      if (this.fsa.isArcFinal(arc)) {
        this.bufferWrapper.clear();
        this.bufferWrapper.limit(lastIndex + 1);
        return this.bufferWrapper;
      }
    }

    return null;
  }

  /**
   * Not implemented in this iterator.
   */
  remove(): void {
    throw new Error("UnsupportedOperationException: Read-only iterator.");
  }

  /**
   * Descends to a given node, adds its arcs to the stack to be traversed.
   */
  private pushNode(node: number): void {
    // Expand buffers if needed.
    if (this.position == this.arcs.length) {
      this.arcs = copyOf(this.arcs, this.arcs.length + ByteSequenceIterator.EXPECTED_MAX_STATES);
    }

    this.arcs[this.position++] = this.fsa.getFirstArc(node);
  }
}
