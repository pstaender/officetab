// SPDX-License-Identifier: MPL-2.0
// java.util.PriorityQueue for the LanguageTool ports: not a port, but the same binary heap
// (siftUp/siftDown as in the JDK), so that elements which compare equal leave the queue in the
// same order as in Java. Elements order by their compareTo (Comparable) or by a comparator.

export interface Comparable<T> { compareTo(o: T): number }

export class PriorityQueue<E> {
  private m_aQueue: E[] = [];
  private readonly m_pComparator: ((a: E, b: E) => number) | null;

  /** The initial capacity Java takes is ignored. */
  constructor(initialCapacityOrComparator?: number | ((a: E, b: E) => number), comparator?: (a: E, b: E) => number) {
    this.m_pComparator = typeof initialCapacityOrComparator === 'function' ? initialCapacityOrComparator : comparator ?? null;
  }

  private cmp(a: E, b: E): number {
    return this.m_pComparator ? this.m_pComparator(a, b) : (a as unknown as Comparable<E>).compareTo(b);
  }

  size(): number { return this.m_aQueue.length; }
  isEmpty(): boolean { return this.m_aQueue.length === 0; }
  clear(): void { this.m_aQueue.length = 0; }
  peek(): E | null { return this.m_aQueue.length ? this.m_aQueue[0] : null; }

  add(e: E): boolean { return this.offer(e); }

  offer(e: E): boolean {
    const es = this.m_aQueue;
    let k = es.length;
    es.push(e);
    // siftUp
    while (k > 0) {
      const parent = (k - 1) >>> 1;
      const p = es[parent];
      if (this.cmp(e, p) >= 0) break;
      es[k] = p;
      k = parent;
    }
    es[k] = e;
    return true;
  }

  poll(): E | null {
    const es = this.m_aQueue;
    if (es.length === 0) return null;
    const result = es[0];
    const x = es.pop() as E;
    const n = es.length;
    if (n > 0) {
      // siftDown
      let k = 0;
      const half = n >>> 1;
      while (k < half) {
        let child = (k << 1) + 1;
        let c = es[child];
        const right = child + 1;
        if (right < n && this.cmp(c, es[right]) > 0) c = es[(child = right)];
        if (this.cmp(x, c) <= 0) break;
        es[k] = c;
        k = child;
      }
      es[k] = x;
    }
    return result;
  }

  /** AbstractQueue.remove(): poll, but throws on an empty queue. */
  remove(): E {
    if (this.m_aQueue.length === 0) throw new Error('NoSuchElementException');
    return this.poll() as E;
  }
}
