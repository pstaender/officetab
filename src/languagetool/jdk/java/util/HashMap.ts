// SPDX-License-Identifier: MPL-2.0
// Not a port: java.util.HashMap's iteration order, for ports whose results depend on it. A JavaScript
// Map iterates in insertion order; Java's HashMap iterates by bucket (the spread String.hashCode
// masked by the table size), and within a bucket in insertion order. Only String keys, maps
// that were only added to (no removals), and buckets that never became trees (fewer than 8 keys
// in a bucket) are modelled.

/** String.hashCode */
export function String_hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** The table size a HashMap with default capacity and load factor has after `size` insertions. */
function tableSize(size: number): number {
  let cap = 16;
  while (size > cap * 0.75) {
    cap *= 2;
  }
  return cap;
}

/**
 * A Map with the entries of `map` (filled by insertions only, as a Java HashMap would have been) in
 * the order a java.util.HashMap iterates them.
 */
export function HashMap_inJavaOrder<V>(map: ReadonlyMap<string, V>): Map<string, V> {
  const mask = tableSize(map.size) - 1;
  const entries = [...map].map(([k, v], i) => {
    const h = String_hashCode(k);
    return { k, v, i, bucket: (h ^ (h >>> 16)) & mask };
  });
  entries.sort((a, b) => a.bucket - b.bucket || a.i - b.i);
  return new Map(entries.map((e) => [e.k, e.v]));
}
