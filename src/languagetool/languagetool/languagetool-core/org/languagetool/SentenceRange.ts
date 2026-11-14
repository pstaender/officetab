// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/SentenceRange.java faithful
// hashCode is left out.
import type { AnnotatedText } from './markup/AnnotatedText.ts';
import { Pattern } from '../../../../jdk/java/util/regex/Pattern.ts';
import { StringTrim } from '../../../../jdk/java/lang/Character.ts';

/**
 * A range in a text that makes up a sentence.
 * @since 5.8
 */
export class SentenceRange {

  private static readonly BEGINS_WITH_SPACE = Pattern.compile('^\\s*');
  private static readonly ENDS_WITH_SPACE = Pattern.compile('\\s+$');

  private readonly fromPos: number;
  private readonly toPos: number;

  constructor(fromPos: number, toPos: number) {
    this.fromPos = fromPos;
    this.toPos = toPos;
  }

  static getRangesFromSentences(annotatedText: AnnotatedText, sentences: readonly string[]): SentenceRange[] {
    const sentenceRanges: SentenceRange[] = [];
    let pos = 0;
    const markupTextLength = annotatedText.getTextWithMarkup().length;
    const diff = markupTextLength - annotatedText.getPlainText().length;
    for (const sentence of sentences) {
      if (StringTrim(sentence).length === 0) {
        //No content no sentence
        pos += sentence.length;
        continue;
      }
      //trim whitespaces
      const sentenceNoBeginWhitespace = SentenceRange.BEGINS_WITH_SPACE.matcher(sentence).replaceFirst('');
      const sentenceNoEndWhitespace = SentenceRange.ENDS_WITH_SPACE.matcher(sentence).replaceFirst('');
      //Get position without tailing and leading whitespace
      const fromPos = pos + (sentence.length - sentenceNoBeginWhitespace.length);
      const toPos = pos + sentenceNoEndWhitespace.length;

      let fromPosOrig = fromPos + diff;
      let toPosOrig = toPos + diff;
      if (fromPosOrig !== markupTextLength) {
        fromPosOrig = annotatedText.getOriginalTextPositionFor(fromPos, false);
      }
      if (toPosOrig !== markupTextLength) {
        toPosOrig = annotatedText.getOriginalTextPositionFor(toPos, true);
      }
      sentenceRanges.push(new SentenceRange(fromPosOrig, toPosOrig));
      pos += sentence.length;
    }
    return sentenceRanges;
  }

  getFromPos(): number {
    return this.fromPos;
  }

  getToPos(): number {
    return this.toPos;
  }

  toString(): string {
    return this.fromPos + '-' + this.toPos;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof SentenceRange)) return false;
    const range = o;
    return this.fromPos === range.fromPos && this.toPos === range.toPos;
  }

  compareTo(o: SentenceRange): number {
    return this.fromPos < o.fromPos ? -1 : this.fromPos === o.fromPos ? 0 : 1;
  }
}
