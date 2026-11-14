// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/Cache.java faithful
// LinkedHashMap is a JavaScript Map (insertion order); put and computeIfAbsent are the Java
// Map methods the callers use. Keys compare as in a Map: strings by value, arrays by identity
// (as Java's arrays, which have no equals).

/** Provides fixed size, pre-allocated, least recently used replacement cache. */
export class Cache<K, V> extends Map<K, V> {
  private capacity: number;

  constructor(capacity: number) {
    super();
    this.capacity = capacity;
  }

  override set(key: K, value: V): this {
    const isNew = !this.has(key);
    super.set(key, value);
    if (isNew && this.removeEldestEntry()) {
      this.delete(this.keys().next().value as K);
    }
    return this;
  }

  put(key: K, value: V): V | null {
    const old = super.get(key);
    this.set(key, value);
    return old ?? null;
  }

  computeIfAbsent(key: K, mappingFunction: (k: K) => V): V {
    let v = super.get(key);
    if (v === undefined) {
      v = mappingFunction(key);
      if (v != null) this.set(key, v);
    }
    return v;
  }

  protected removeEldestEntry(): boolean {
    return this.size > this.capacity;
  }
}
