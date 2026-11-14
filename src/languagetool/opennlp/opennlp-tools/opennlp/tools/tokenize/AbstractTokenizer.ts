// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/AbstractTokenizer.java faithful
import { Span } from '../util/Span.ts';
import type { Tokenizer } from './Tokenizer.ts';

export abstract class AbstractTokenizer implements Tokenizer {
  tokenize(s: string): string[] {
    return Span.spansToStrings(this.tokenizePos(s), s);
  }

  abstract tokenizePos(s: string): Span[];
}
