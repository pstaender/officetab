// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/dictionary/serializer/Attributes.java faithful

/**
 * The Attributes class stores name value pairs.
 *
 * Problem: The HashMap for storing the name value pairs has a very high
 * memory footprint, replace it.
 */
export class Attributes {
  private mNameValueMap = new Map<string, string>();

  /**
   * Retrieves the value for the given key or null if attribute it not set.
   */
  getValue(key: string): string | null {
    return this.mNameValueMap.get(key) ?? null;
  }

  /**
   * Sets a key/value pair.
   */
  setValue(key: string, value: string): void {
    if (key == null) throw new TypeError('key must not be null');
    if (value == null) throw new TypeError('value must not be null');

    this.mNameValueMap.set(key, value);
  }

  /**
   * Iterates over the keys.
   */
  iterator(): Iterator<string> {
    return this.mNameValueMap.keys();
  }
}
