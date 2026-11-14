// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa-builders/src/main/java/morfologik/fsa/builders/FSABuilder.java faithful
// Bytes are signed, as in Java (Int8Array). The Java asserts (input order, setPrevious) are kept
// as comments: Java runs with assertions disabled. The static import of ConstantArcSizeFSA.* is
// spelled out as local constants.
import type { FSA } from '../../../../morfologik-fsa/morfologik/fsa/FSA.ts';
import { ConstantArcSizeFSA } from './ConstantArcSizeFSA.ts';

const { ARC_SIZE, FLAGS_OFFSET, LABEL_OFFSET, ADDRESS_OFFSET, TARGET_ADDRESS_SIZE, TERMINAL_STATE, BIT_ARC_FINAL, BIT_ARC_LAST } = ConstantArcSizeFSA;

/** java.util.Arrays.copyOf for byte[] and int[]. */
function copyOf<T extends Int8Array | Int32Array>(a: T, n: number): T {
  const r = new (a.constructor as new (n: number) => T)(n);
  r.set(a.length > n ? a.subarray(0, n) : a);
  return r;
}

/**
 * Debug and information constants.
 * 
 * @see FSABuilder#getInfo()
 */
export class InfoEntry {
  static readonly SERIALIZATION_BUFFER_SIZE = new InfoEntry("Serialization buffer size");
  static readonly SERIALIZATION_BUFFER_REALLOCATIONS = new InfoEntry("Serialization buffer reallocs");
  static readonly CONSTANT_ARC_AUTOMATON_SIZE = new InfoEntry("Constant arc FSA size");
  static readonly MAX_ACTIVE_PATH_LENGTH = new InfoEntry("Max active path");
  static readonly STATE_REGISTRY_TABLE_SLOTS = new InfoEntry("Registry hash slots");
  static readonly STATE_REGISTRY_SIZE = new InfoEntry("Registry hash entries");
  static readonly ESTIMATED_MEMORY_CONSUMPTION_MB = new InfoEntry("Estimated mem consumption (MB)");

  private readonly stringified: string;

  private constructor(stringified: string) {
    this.stringified = stringified;
  }

  toString(): string {
    return this.stringified;
  }
}

/**
 * Fast, memory-conservative finite state automaton builder, returning an
 * in-memory {@link FSA} that is a tradeoff between construction speed and
 * memory consumption. Use serializers to compress the returned automaton into
 * more compact form.
 * 
 * @see FSASerializer
 */
export class FSABuilder {
  /** A megabyte. */
  private static readonly MB = 1024 * 1024;

  /**
   * Internal serialized FSA buffer expand ratio.
   */
  private static readonly BUFFER_GROWTH_SIZE = 5 * FSABuilder.MB;

  /**
   * Maximum number of labels from a single state.
   */
  private static readonly MAX_LABELS = 256;

  /**
   * A comparator comparing full byte arrays. Unsigned byte comparisons ('C'-locale).
   */
  static readonly LEXICAL_ORDERING = (o1: Int8Array, o2: Int8Array): number => {
    return FSABuilder.compare(o1, 0, o1.length, o2, 0, o2.length);
  };

  /**
   * Internal serialized FSA buffer expand ratio.
   */
  private readonly bufferGrowthSize: number;

  /**
   * Holds serialized and mutable states. Each state is a sequential list of
   * arcs, the last arc is marked with {@link #BIT_ARC_LAST}.
   */
  private serialized: Int8Array = new Int8Array(0);

  /**
   * Number of bytes already taken in {@link #serialized}. Start from 1 to keep
   * 0 a sentinel value (for the hash set and final state).
   */
  private size = 0;

  /**
   * States on the "active path" (still mutable). Values are addresses of each
   * state's first arc.
   */
  private activePath: Int32Array = new Int32Array(0);

  /**
   * Current length of the active path.
   */
  private activePathLen = 0;

  /**
   * The next offset at which an arc will be added to the given state on
   * {@link #activePath}.
   */
  private nextArcOffset: Int32Array = new Int32Array(0);

  /**
   * Root state. If negative, the automaton has been built already and cannot be
   * extended.
   */
  private root: number;

  /**
   * An epsilon state. The first and only arc of this state points either to the
   * root or to the terminal state, indicating an empty automaton.
   */
  private epsilon: number;

  /**
   * Hash set of state addresses in {@link #serialized}, hashed by
   * {@link #hash(int, int)}. Zero reserved for an unoccupied slot.
   */
  private hashSet: Int32Array = new Int32Array(2);

  /**
   * Number of entries currently stored in {@link #hashSet}.
   */
  private hashSize = 0;

  /**
   * Previous sequence added to the automaton in {@link #add(byte[], int, int)}.
   * Used in assertions only.
   */
  private previous: Int8Array | null = null;

  /**
   * Information about the automaton and its compilation.
   */
  private info: Map<InfoEntry, number> | null = null;

  /**
   * {@link #previous} sequence's length, used in assertions only.
   */
  private previousLength = 0;

  /**
   * @param bufferGrowthSize Buffer growth size (in bytes) when constructing the automaton.
   */
  constructor(bufferGrowthSize: number = FSABuilder.BUFFER_GROWTH_SIZE) {
    this.bufferGrowthSize = Math.max(bufferGrowthSize, ARC_SIZE * FSABuilder.MAX_LABELS);

    // Allocate epsilon state.
    this.epsilon = this.allocateState(1);
    this.serialized[this.epsilon + FLAGS_OFFSET] |= BIT_ARC_LAST;

    // Allocate root, with an initial empty set of output arcs.
    this.expandActivePath(1);
    this.root = this.activePath[0];
  }

  /**
   * Add a single sequence of bytes to the FSA. The input must be
   * lexicographically greater than any previously added sequence.
   * 
   * @param sequence The array holding input sequence of bytes. 
   * @param start Starting offset (inclusive)
   * @param len Length of the input sequence (at least 1 byte).
   */
  add(sequence: Int8Array, start: number, len: number): void {
    // assert serialized != null : "Automaton already built.";
    // assert previous == null || len == 0 || compare(previous, 0, previousLength, sequence, start, len) <= 0 : "Input must be sorted: ...";
    // assert setPrevious(sequence, start, len);

    // Determine common prefix length.
    const commonPrefix = this.commonPrefix(sequence, start, len);

    // Make room for extra states on active path, if needed.
    this.expandActivePath(len);

    // Freeze all the states after the common prefix.
    for (let i = this.activePathLen - 1; i > commonPrefix; i--) {
      const frozenState = this.freezeState(i);
      this.setArcTarget(this.nextArcOffset[i - 1] - ARC_SIZE, frozenState);
      this.nextArcOffset[i] = this.activePath[i];
    }

    // Create arcs to new suffix states.
    for (let i = commonPrefix + 1, j = start + commonPrefix; i <= len; i++) {
      const p = this.nextArcOffset[i - 1];

      this.serialized[p + FLAGS_OFFSET] = (i == len ? BIT_ARC_FINAL : 0);
      this.serialized[p + LABEL_OFFSET] = sequence[j++];
      this.setArcTarget(p, i == len ? TERMINAL_STATE : this.activePath[i]);

      this.nextArcOffset[i - 1] = p + ARC_SIZE;
    }

    // Save last sequence's length so that we don't need to calculate it again.
    this.activePathLen = len;
  }

  /** Number of serialization buffer reallocations. */
  private serializationBufferReallocations = 0;

  /**
   * @return Finalizes the construction of the automaton and returns it.
   */
  complete(): FSA {
    this.add(new Int8Array(0), 0, 0);

    if (this.nextArcOffset[0] - this.activePath[0] == 0) {
      // An empty FSA.
      this.setArcTarget(this.epsilon, TERMINAL_STATE);
    } else {
      // An automaton with at least a single arc from root.
      this.root = this.freezeState(0);
      this.setArcTarget(this.epsilon, this.root);
    }

    this.info = new Map<InfoEntry, number>();
    this.info.set(InfoEntry.SERIALIZATION_BUFFER_SIZE, this.serialized.length);
    this.info.set(InfoEntry.SERIALIZATION_BUFFER_REALLOCATIONS, this.serializationBufferReallocations);
    this.info.set(InfoEntry.CONSTANT_ARC_AUTOMATON_SIZE, this.size);
    this.info.set(InfoEntry.MAX_ACTIVE_PATH_LENGTH, this.activePath.length);
    this.info.set(InfoEntry.STATE_REGISTRY_TABLE_SLOTS, this.hashSet.length);
    this.info.set(InfoEntry.STATE_REGISTRY_SIZE, this.hashSize);
    this.info.set(InfoEntry.ESTIMATED_MEMORY_CONSUMPTION_MB, 
        (this.serialized.length + this.hashSet.length * 4) / FSABuilder.MB);

    const fsa: FSA = new ConstantArcSizeFSA(copyOf(this.serialized, this.size), this.epsilon);
    this.serialized = null!;
    this.hashSet = null!;
    return fsa;
  }

  /**
   * Build a minimal, deterministic automaton from a sorted list of byte
   * sequences (an array or an iterable list).
   * 
   * @param input Input sequences to build automaton from. 
   * @return Returns the automaton encoding all input sequences.
   */
  static build(input: Int8Array[] | Iterable<Int8Array>): FSA {
    const builder = new FSABuilder();

    for (const chs of input) {
      builder.add(chs, 0, chs.length);
    }

    return builder.complete();
  }

  /**
   * @return Returns various statistics concerning the FSA and its compilation.
   * @see InfoEntry
   */
  getInfo(): Map<InfoEntry, number> | null {
    return this.info;
  }

  /** Is this arc the state's last? */
  private isArcLast(arc: number): boolean {
    return (this.serialized[arc + FLAGS_OFFSET] & BIT_ARC_LAST) != 0;
  }

  /** Is this arc final? */
  private isArcFinal(arc: number): boolean {
    return (this.serialized[arc + FLAGS_OFFSET] & BIT_ARC_FINAL) != 0;
  }

  /** Get label's arc. */
  private getArcLabel(arc: number): number {
    return this.serialized[arc + LABEL_OFFSET];
  }

  /**
   * Fills the target state address of an arc.
   */
  private setArcTarget(arc: number, state: number): void {
    arc += ADDRESS_OFFSET + TARGET_ADDRESS_SIZE;
    for (let i = 0; i < TARGET_ADDRESS_SIZE; i++) {
      this.serialized[--arc] = state;
      state >>>= 8;
    }
  }

  /**
   * Returns the address of an arc.
   */
  private getArcTarget(arc: number): number {
    const serialized = this.serialized;
    arc += ADDRESS_OFFSET;
    return (serialized[arc]           ) << 24 | 
           (serialized[arc + 1] & 0xff) << 16 | 
           (serialized[arc + 2] & 0xff) << 8  |
           (serialized[arc + 3] & 0xff);
  }

  /**
   * @return The number of common prefix characters with the previous sequence.
   */
  private commonPrefix(sequence: Int8Array, start: number, len: number): number {
    // Empty root state case.
    const max = Math.min(len, this.activePathLen);
    let i: number;
    for (i = 0; i < max; i++) {
      const lastArc = this.nextArcOffset[i] - ARC_SIZE;
      if (sequence[start++] != this.getArcLabel(lastArc)) {
        break;
      }
    }

    return i;
  }

  /**
   * Freeze a state: try to find an equivalent state in the interned states
   * dictionary first, if found, return it, otherwise, serialize the mutable
   * state at <code>activePathIndex</code> and return it.
   */
  private freezeState(activePathIndex: number): number {
    const start = this.activePath[activePathIndex];
    const end = this.nextArcOffset[activePathIndex];
    const len = end - start;

    // Set the last arc flag on the current active path's state.
    this.serialized[end - ARC_SIZE + FLAGS_OFFSET] |= BIT_ARC_LAST;

    // Try to locate a state with an identical content in the hash set.
    const bucketMask = (this.hashSet.length - 1);
    let slot = this.hash(start, len) & bucketMask;
    for (let i = 0;;) {
      let state = this.hashSet[slot];
      if (state == 0) {
        state = this.hashSet[slot] = this.serialize(activePathIndex);
        if (++this.hashSize > this.hashSet.length / 2)
          this.expandAndRehash();
        return state;
      } else if (this.equivalent(state, start, len)) {
        return state;
      }

      slot = (slot + (++i)) & bucketMask;
    }
  }

  /**
   * Reallocate and rehash the hash set.
   */
  private expandAndRehash(): void {
    const newHashSet = new Int32Array(this.hashSet.length * 2);
    const bucketMask = (newHashSet.length - 1);

    for (let j = 0; j < this.hashSet.length; j++) {
      const state = this.hashSet[j];
      if (state > 0) {
        let slot = this.hash(state, this.stateLength(state)) & bucketMask;
        for (let i = 0; newHashSet[slot] > 0;) {
          slot = (slot + (++i)) & bucketMask;
        }
        newHashSet[slot] = state;
      }
    }
    this.hashSet = newHashSet;
  }

  /**
   * The total length of the serialized state data (all arcs).
   */
  private stateLength(state: number): number {
    let arc = state;
    while (!this.isArcLast(arc)) {
      arc += ARC_SIZE;
    }
    return arc - state + ARC_SIZE;
  }

  /**
   * Return <code>true</code> if two regions in {@link #serialized} are
   * identical.
   */
  private equivalent(start1: number, start2: number, len: number): boolean {
    if (start1 + len > this.size || start2 + len > this.size)
      return false;

    while (len-- > 0)
      if (this.serialized[start1++] != this.serialized[start2++])
        return false;

    return true;
  }

  /**
   * Serialize a given state on the active path.
   */
  private serialize(activePathIndex: number): number {
    this.expandBuffers();

    const newState = this.size;
    const start = this.activePath[activePathIndex];
    const len = this.nextArcOffset[activePathIndex] - start;
    this.serialized.copyWithin(newState, start, start + len);

    this.size += len;
    return newState;
  }

  /**
   * Hash code of a fragment of {@link #serialized} array.
   */
  private hash(start: number, byteCount: number): number {
    // assert byteCount % ARC_SIZE == 0 : "Not an arc multiply?";

    let h = 0;
    for (let arcs = byteCount / ARC_SIZE; --arcs >= 0; start += ARC_SIZE) {
      h = (Math.imul(17, h) + this.getArcLabel(start)) | 0;
      h = (Math.imul(17, h) + this.getArcTarget(start)) | 0;
      if (this.isArcFinal(start))
        h = (h + 17) | 0;
    }

    return h;
  }

  /**
   * Append a new mutable state to the active path.
   */
  private expandActivePath(size: number): void {
    if (this.activePath.length < size) {
      const p = this.activePath.length;
      this.activePath = copyOf(this.activePath, size);
      this.nextArcOffset = copyOf(this.nextArcOffset, size);

      for (let i = p; i < size; i++) {
        this.nextArcOffset[i] = this.activePath[i] = this.allocateState(/* assume max labels count */FSABuilder.MAX_LABELS);
      }
    }
  }

  /**
   * Expand internal buffers for the next state.
   */
  private expandBuffers(): void {
    if (this.serialized.length < this.size + ARC_SIZE * FSABuilder.MAX_LABELS) {
      this.serialized = copyOf(this.serialized, this.serialized.length + this.bufferGrowthSize);
      this.serializationBufferReallocations++;
    }
  }

  /**
   * Allocate space for a state with the given number of outgoing labels.
   * 
   * @return state offset
   */
  private allocateState(labels: number): number {
    this.expandBuffers();
    const state = this.size;
    this.size += labels * ARC_SIZE;
    return state;
  }

  /**
   * Copy <code>current</code> into an internal buffer.
   */
  private setPrevious(sequence: Int8Array, start: number, length: number): boolean {
    if (this.previous == null || this.previous.length < length) {
      this.previous = new Int8Array(length);
    }

    this.previous.set(sequence.subarray(start, start + length), 0);
    this.previousLength = length;
    return true;
  }

  /**
   * Lexicographic order of input sequences. By default, consistent with the "C"
   * sort (absolute value of bytes, 0-255).
   */
  private static compare(s1: Int8Array, start1: number, lens1: number, s2: Int8Array, start2: number, lens2: number): number {
    const max = Math.min(lens1, lens2);

    for (let i = 0; i < max; i++) {
      const c1 = s1[start1++];
      const c2 = s2[start2++];
      if (c1 != c2)
        return (c1 & 0xff) - (c2 & 0xff);
    }

    return lens1 - lens2;
  }
}
