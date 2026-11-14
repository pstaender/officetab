// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/FSA.java faithful
// Java I/O: streams are DataInputStreams over the bytes (read() also accepts the bytes). The
// automaton versions are looked up in a table that FSA5 and CFSA2 fill when they are loaded
// (FSA.read cannot import its subclasses, which import FSA); CFSA (the old version 0xc5 format)
// is not ported, read() reports it as unsupported. Iterable<ByteBuffer> is JavaScript's
// iterable; iterator() returns the Java-style ByteSequenceIterator (hasNext/next).
import { DataInputStream } from '../../../../jdk/java/io/DataInputStream.ts';
import type { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { ByteSequenceIterator } from './ByteSequenceIterator.ts';
import type { FSAFlags } from './FSAFlags.ts';
import { FSAHeader, IOException } from './FSAHeader.ts';
import type { StateVisitor } from './StateVisitor.ts';

/** Adapts a Java-style iterator (hasNext/next) to a JavaScript iterator. */
export function* javaIterator<T>(it: { hasNext(): boolean; next(): T }): Generator<T> {
  while (it.hasNext()) {
    yield it.next();
  }
}

/**
 * This is a top abstract class for handling finite state automata. These
 * automata are arc-based, a design described in Jan Daciuk's <i>Incremental
 * Construction of Finite-State Automata and Transducers, and Their Use in the
 * Natural Language Processing</i> (PhD thesis, Technical University of Gdansk).
 */
export abstract class FSA implements Iterable<ByteBuffer> {
  /** Readers of the automaton versions, by header version byte (filled by FSA5 and CFSA2). */
  static readonly m_aVersions = new Map<number, (stream: DataInputStream) => FSA>();

  /**
   * @return Returns the identifier of the root node of this automaton. Returns
   *         0 if the start node is also the end node (the automaton is empty).
   */
  abstract getRootNode(): number;

  /**
   * @param node
   *          Identifier of the node.
   * @return Returns the identifier of the first arc leaving <code>node</code>
   *         or 0 if the node has no outgoing arcs.
   */
  abstract getFirstArc(node: number): number;

  /**
   * @param arc
   *          The arc's identifier.
   * @return Returns the identifier of the next arc after <code>arc</code> and
   *         leaving <code>node</code>. Zero is returned if no more arcs are
   *         available for the node.
   */
  abstract getNextArc(arc: number): number;

  /**
   * @param node
   *          Identifier of the node.
   * @param label
   *          The arc's label.
   * @return Returns the identifier of an arc leaving <code>node</code> and
   *         labeled with <code>label</code>. An identifier equal to 0 means the
   *         node has no outgoing arc labeled <code>label</code>.
   */
  abstract getArc(node: number, label: number): number;

  /**
   * @param arc
   *          The arc's identifier.
   * @return Return the label associated with a given <code>arc</code>.
   */
  abstract getArcLabel(arc: number): number;

  /**
   * @param arc
   *          The arc's identifier.
   * @return Returns <code>true</code> if the destination node at the end of
   *         this <code>arc</code> corresponds to an input sequence created when
   *         building this automaton.
   */
  abstract isArcFinal(arc: number): boolean;

  /**
   * @param arc
   *          The arc's identifier.
   * @return Returns <code>true</code> if this <code>arc</code> does not have a
   *         terminating node (@link {@link #getEndNode(int)} will throw an
   *         exception). Implies {@link #isArcFinal(int)}.
   */
  abstract isArcTerminal(arc: number): boolean;

  /**
   * @param arc
   *          The arc's identifier.
   * @return Return the end node pointed to by a given <code>arc</code>.
   *         Terminal arcs (those that point to a terminal state) have no end
   *         node representation and throw a runtime exception.
   */
  abstract getEndNode(arc: number): number;

  /**
   * @return Returns a set of flags for this FSA instance.
   */
  abstract getFlags(): ReadonlySet<FSAFlags>;

  /**
   * @param node
   *          Identifier of the node.
   * @return Calculates and returns the number of arcs of a given node.
   */
  getArcCount(node: number): number {
    let count = 0;
    for (let arc = this.getFirstArc(node); arc != 0; arc = this.getNextArc(arc)) {
      count++;
    }
    return count;
  }

  /**
   * @param node
   *          Identifier of the node.
   *
   * @return Returns the number of sequences reachable from the given state if
   *         the automaton was compiled with {@link FSAFlags#NUMBERS}. The size
   *         of the right language of the state, in other words.
   *
   * @throws UnsupportedOperationException
   *           If the automaton was not compiled with {@link FSAFlags#NUMBERS}.
   *           The value can then be computed by manual count of
   *           {@link #getSequences}.
   */
  getRightLanguageCount(_node: number): number {
    throw new Error("UnsupportedOperationException: Automaton not compiled with NUMBERS");
  }

  /**
   * Returns an iterator over all binary sequences starting at the given FSA
   * state (node) and ending in final nodes. This corresponds to a set of
   * suffixes of a given prefix from all sequences stored in the automaton.
   *
   * <p>
   * The returned iterator is a {@link ByteBuffer} whose contents changes on
   * each call to {@link Iterator#next()}. The keep the contents between calls
   * to {@link Iterator#next()}, one must copy the buffer to some other
   * location.
   * </p>
   *
   * <p>
   * <b>Important.</b> It is guaranteed that the returned byte buffer is backed
   * by a byte array and that the content of the byte buffer starts at the
   * array's index 0.
   * </p>
   *
   * Without <code>node</code>: an alias of calling {@link #iterator} directly
   * ({@link FSA} is also {@link Iterable}), all sequences encoded in the automaton.
   *
   * @param node
   *          Identifier of the starting node from which to return subsequences.
   * @return An iterable over all sequences encoded starting at the given node.
   */
  getSequences(node: number = this.getRootNode()): Iterable<ByteBuffer> {
    if (node == 0) {
      return [];
    }

    return {
      [Symbol.iterator]: () => javaIterator(new ByteSequenceIterator(this, node)),
    };
  }

  /**
   * Returns an iterator over all binary sequences starting from the initial FSA
   * state (node) and ending in final nodes. The returned iterator is a
   * {@link ByteBuffer} whose contents changes on each call to
   * {@link Iterator#next()}. The keep the contents between calls to
   * {@link Iterator#next()}, one must copy the buffer to some other location.
   *
   * <p>
   * <b>Important.</b> It is guaranteed that the returned byte buffer is backed
   * by a byte array and that the content of the byte buffer starts at the
   * array's index 0.
   * </p>
   */
  iterator(): { hasNext(): boolean; next(): ByteBuffer } {
    const node = this.getRootNode();
    if (node == 0) {
      return { hasNext: () => false, next: () => { throw new Error('NoSuchElementException'); } };
    }
    return new ByteSequenceIterator(this, node);
  }

  [Symbol.iterator](): Iterator<ByteBuffer> {
    return this.getSequences()[Symbol.iterator]();
  }

  /**
   * Visit all states. The order of visiting is undefined. This method may be
   * faster than traversing the automaton in post or preorder since it can scan
   * states linearly. Returning false from {@link StateVisitor#accept(int)}
   * immediately terminates the traversal.
   *
   * @param v Visitor to receive traversal calls.
   * @param <T> A subclass of {@link StateVisitor}.
   * @return Returns the argument (for access to anonymous class fields).
   */
  visitAllStates<T extends StateVisitor>(v: T): T {
    return this.visitInPostOrder(v);
  }

  /**
   * Visits all states reachable from <code>node</code> in postorder (by default from the
   * root automaton node). Returning
   * false from {@link StateVisitor#accept(int)} immediately terminates the
   * traversal.
   *
   * @param v Visitor to receive traversal calls.
   * @param <T> A subclass of {@link StateVisitor}.
   * @param node Identifier of the node.
   * @return Returns the argument (for access to anonymous class fields).
   */
  visitInPostOrder<T extends StateVisitor>(v: T, node: number = this.getRootNode()): T {
    this.visitInPostOrderRec(v, node, new Set<number>());
    return v;
  }

  /** Private recursion. */
  private visitInPostOrderRec(v: StateVisitor, node: number, visited: Set<number>): boolean {
    if (visited.has(node))
      return true;
    visited.add(node);

    for (let arc = this.getFirstArc(node); arc != 0; arc = this.getNextArc(arc)) {
      if (!this.isArcTerminal(arc)) {
        if (!this.visitInPostOrderRec(v, this.getEndNode(arc), visited))
          return false;
      }
    }

    return v.accept(node);
  }

  /**
   * Visits all states in preorder (by default from the root automaton node). Returning false from
   * {@link StateVisitor#accept(int)} skips traversal of all sub-states of a
   * given state.
   *
   * @param v Visitor to receive traversal calls.
   * @param <T> A subclass of {@link StateVisitor}.
   * @param node Identifier of the node.
   * @return Returns the argument (for access to anonymous class fields).
   */
  visitInPreOrder<T extends StateVisitor>(v: T, node: number = this.getRootNode()): T {
    this.visitInPreOrderRec(v, node, new Set<number>());
    return v;
  }

  /**
   * @param in The input stream.
   * @return Reads all remaining bytes from an input stream and returns
   * them as a byte array.
   * @throws IOException Rethrown if an I/O exception occurs.
   */
  protected static readRemaining(input: DataInputStream): Int8Array {
    const buffer = new Uint8Array(input.available());
    input.readFully(buffer);
    return new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length);
  }

  /** Private recursion. */
  private visitInPreOrderRec(v: StateVisitor, node: number, visited: Set<number>): void {
    if (visited.has(node)) {
      return;
    }
    visited.add(node);

    if (v.accept(node)) {
      for (let arc = this.getFirstArc(node); arc != 0; arc = this.getNextArc(arc)) {
        if (!this.isArcTerminal(arc)) {
          this.visitInPreOrderRec(v, this.getEndNode(arc), visited);
        }
      }
    }
  }

  /**
   * A factory for reading automata in any of the supported versions; with <code>clazz</code>,
   * a factory for reading a specific FSA subclass, including proper casting.
   *
   * @param stream
   *          The input stream to read automaton data from (or the automaton's bytes). The stream is not
   *          closed.
   * @param clazz A subclass of {@link FSA} to cast the read automaton to.
   * @return Returns an instantiated automaton. Never null.
   * @throws IOException
   *           If the input stream does not represent an automaton, is otherwise
   *           invalid or the class of the automaton read from the input stream
   *           is not assignable to <code>clazz</code>.
   */
  static read<T extends FSA = FSA>(stream: DataInputStream | Uint8Array, clazz?: abstract new (...args: never[]) => T): T {
    if (stream instanceof Uint8Array) {
      stream = new DataInputStream(stream);
    }
    if (clazz !== undefined) {
      const fsa = FSA.read(stream);
      if (!(fsa instanceof clazz)) {
        throw new IOException("Expected FSA type " + clazz.name + ", but read an incompatible type " +
            fsa.constructor.name + ".");
      }
      return fsa;
    }

    const header = FSAHeader.read(stream);

    const reader = FSA.m_aVersions.get(header.version);
    if (reader !== undefined) {
      return reader(stream) as T;
    }
    throw new IOException(
        "Unsupported automaton version: 0x" + (header.version & 0xFF).toString(16).padStart(2, '0'));
  }
}
