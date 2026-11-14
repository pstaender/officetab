// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/WhitespaceTokenizer.java faithful
import { Span } from '../util/Span.ts';
import { StringUtil } from '../util/StringUtil.ts';
import { AbstractTokenizer } from './AbstractTokenizer.ts';

/**
 * This tokenizer uses white spaces to tokenize the input text.
 *
 * To obtain an instance of this tokenizer use the static final
 * INSTANCE field.
 */
export class WhitespaceTokenizer extends AbstractTokenizer {
  /**
   * Use this static reference to retrieve an instance of the
   * WhitespaceTokenizer.
   */
  static readonly INSTANCE: WhitespaceTokenizer = new WhitespaceTokenizer();

  private constructor() {
    super();
  }

  tokenizePos(d: string): Span[] {
    let tokStart = -1;
    const tokens: Span[] = [];
    let inTok = false;

    //gather up potential tokens
    const end = d.length;
    for (let i = 0; i < end; i++) {
      if (StringUtil.isWhitespace(d.charAt(i))) {
        if (inTok) {
          tokens.push(new Span(tokStart, i));
          inTok = false;
          tokStart = -1;
        }
      }
      else {
        if (!inTok) {
          tokStart = i;
          inTok = true;
        }
      }
    }

    if (inTok) {
      tokens.push(new Span(tokStart, end));
    }

    return tokens;
  }
}
