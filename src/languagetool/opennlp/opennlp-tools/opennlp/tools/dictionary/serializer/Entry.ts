// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/dictionary/serializer/Entry.java faithful
import type { StringList } from '../../util/StringList.ts';
import type { Attributes } from './Attributes.ts';

/**
 * An Entry is a StringList which can
 * optionally be mapped to attributes.
 *
 * Entries is a read only class.
 */
export class Entry {
  private tokens: StringList;
  private attributes: Attributes;

  /**
   * Initializes the current instance.
   */
  constructor(tokens: StringList, attributes: Attributes) {
    this.tokens = tokens;
    this.attributes = attributes;
  }

  /**
   * Retrieves the tokens.
   */
  getTokens(): StringList {
    return this.tokens;
  }

  /**
   * Retrieves the Attributes.
   */
  getAttributes(): Attributes {
    return this.attributes;
  }
}
