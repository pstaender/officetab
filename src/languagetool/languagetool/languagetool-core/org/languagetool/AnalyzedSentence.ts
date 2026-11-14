// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/AnalyzedSentence.java faithful
// hashCode is not needed; the token and lemma indexes are Maps.
import { AnalyzedTokenReadings } from './AnalyzedTokenReadings.ts';
import { JLanguageTool } from './JLanguageTool.ts';
import { Arrays_equals } from '../../../../jdk/java/util/Objects.ts';

/**
 * A sentence that has been tokenized and analyzed.
 */
export class AnalyzedSentence {
  // objects of this type are cached, so everything needs to be immutable
  private readonly tokens: AnalyzedTokenReadings[];
  private readonly preDisambigTokens: AnalyzedTokenReadings[];
  private readonly nonBlankTokens: AnalyzedTokenReadings[];
  private readonly nonBlankPreDisambigTokens: AnalyzedTokenReadings[];
  private readonly whPositions: number[];  // maps positions without whitespace to positions that include whitespaces
  private readonly tokenOffsets: Map<string, readonly number[]>;
  private readonly lemmaOffsets: Map<string, readonly number[]>;
  private text: string | null = null;

  /**
   * Creates an AnalyzedSentence from the given {@link AnalyzedTokenReadings}. Whitespace is also a token.
   * @param preDisambigTokens the tokens before disambiguation (defaults to tokens)
   */
  constructor(tokens: AnalyzedTokenReadings[], preDisambigTokens: AnalyzedTokenReadings[] = tokens, internal?: { mapping: number[]; nonBlankTokens: AnalyzedTokenReadings[]; nonBlankPreDisambigTokens: AnalyzedTokenReadings[] }) {
    this.tokens = tokens;
    if (internal) {
      this.preDisambigTokens = tokens;
      this.whPositions = internal.mapping;
      this.nonBlankTokens = internal.nonBlankTokens;
      this.nonBlankPreDisambigTokens = internal.nonBlankPreDisambigTokens;
    } else {
      this.preDisambigTokens = preDisambigTokens;
      const whCounter = 0;
      const nonWhCounter = 0;
      const mapping: number[] = new Array(tokens.length + 1).fill(0);
      this.whPositions = mapping;
      this.nonBlankTokens = this.getNonBlankReadings(tokens, whCounter, nonWhCounter, mapping);
      this.nonBlankPreDisambigTokens = this.getNonBlankReadings(preDisambigTokens, whCounter, nonWhCounter, mapping);
    }
    this.tokenOffsets = AnalyzedSentence.indexTokens(this.nonBlankTokens);
    this.lemmaOffsets = AnalyzedSentence.indexLemmas(this.nonBlankTokens);
  }

  private getNonBlankReadings(tokens: AnalyzedTokenReadings[], whCounter: number, nonWhCounter: number, mapping: number[]): AnalyzedTokenReadings[] {
    const l: AnalyzedTokenReadings[] = [];
    for (const token of tokens) {
      if (!token.isWhitespace() || token.isSentenceStart() || token.isSentenceEnd() || token.isParagraphEnd()) {
        l.push(token);
        mapping[nonWhCounter] = whCounter;
        nonWhCounter++;
      }
      whCounter++;
    }
    return l;
  }

  private static indexTokens(tokens: AnalyzedTokenReadings[]): Map<string, readonly number[]> {
    const result = new Map<string, number[]>();
    for (let i = 0; i < tokens.length; i++) {
      const key = tokens[i]!.getToken().toLowerCase();
      let list = result.get(key);
      if (!list) result.set(key, list = []);
      list.push(i);
    }
    return result;
  }

  private static indexLemmas(tokens: AnalyzedTokenReadings[]): Map<string, readonly number[]> {
    const result = new Map<string, number[]>();
    for (let i = 0; i < tokens.length; i++) {
      const tr = tokens[i]!;
      const readingsLength = tr.getReadingsLength();
      for (let j = 0; j < readingsLength; j++) {
        const token = tr.getAnalyzedToken(j);
        const lemma = token.getLemma();
        const key = (lemma != null ? lemma : token.getToken()).toLowerCase();
        let list = result.get(key);
        if (!list) result.set(key, list = []);
        if (list.length === 0 || list[list.length - 1] !== i) {
          list.push(i);
        }
      }
    }
    return result;
  }

  /**
   * The method copies {@link AnalyzedSentence} and returns the copy.
   * Useful for performing local immunization (for example).
   * @since 2.5
   */
  copy(sentence: AnalyzedSentence): AnalyzedSentence {
    const copyTokens: AnalyzedTokenReadings[] = new Array(sentence.getTokens().length);
    for (let i = 0; i < copyTokens.length; i++) {
      const analyzedTokens = sentence.getTokens()[i]!;
      copyTokens[i] = new AnalyzedTokenReadings(analyzedTokens, analyzedTokens.getReadings(), '');
    }
    return new AnalyzedSentence(copyTokens, copyTokens, { mapping: sentence.whPositions, nonBlankTokens: sentence.getTokensWithoutWhitespace(), nonBlankPreDisambigTokens: sentence.getPreDisambigTokensWithoutWhitespace() });
  }

  /** Returns the {@link AnalyzedTokenReadings} of the analyzed text. Whitespace is also a token. */
  getTokens(): AnalyzedTokenReadings[] {
    // It would be better to return a clone here to make this object immutable,
    // but this would be bad for performance:
    return this.tokens;
  }

  /** @since 4.5 */
  getPreDisambigTokens(): AnalyzedTokenReadings[] { return this.preDisambigTokens; }

  /** Returns the {@link AnalyzedTokenReadings} of the analyzed text, with whitespace tokens removed but with the artificial <code>SENT_START</code> token included. */
  getTokensWithoutWhitespace(): AnalyzedTokenReadings[] { return [...this.nonBlankTokens]; }

  /** @since 5.1 */
  getNonWhitespaceTokenCount(): number { return this.nonBlankTokens.length; }

  /** @since 4.5 */
  getPreDisambigTokensWithoutWhitespace(): AnalyzedTokenReadings[] { return [...this.nonBlankPreDisambigTokens]; }

  /**
   * Get a position of a non-whitespace token in the original sentence with
   * whitespace.
   * @param nonWhPosition position of a non-whitespace token
   * @return position in the original sentence.
   */
  getOriginalPosition(nonWhPosition: number): number { return this.whPositions[nonWhPosition]!; }

  /**
   * Return string representation without chunk information, with readings separated by
   * the given delimiter (default ","). (toString(readingDelimiter) and toShortString.)
   */
  toString(readingDelimiter = ','): string { return this.toStringImpl(readingDelimiter, true); }

  /** Return string representation without chunk information. @since 2.3 */
  toShortString(readingDelimiter: string): string { return this.toStringImpl(readingDelimiter, false); }

  /** Text length taking position fixes (e.g. for removed soft hyphens) into account. @since 2.9 */
  getText(): string {
    let result = this.text;
    if (result == null) {
      this.text = result = this.calcText();
    }
    return result;
  }

  private calcText(): string {
    let sb = '';
    for (const element of this.tokens) {
      sb += element.getToken();
    }
    return sb;
  }

  /** @since 6.4 */
  getCorrectedTextLength(): number {
    let len = 0;
    for (let i = 0; i < this.tokens.length; i++) {
      const element = this.tokens[i]!;
      len += element.getCleanToken().length;
      if (i === this.tokens.length - 1) {  // only apply at end, so the position fix at every token doesn't add up
        len += element.getPosFix();
      }
    }
    return len;
  }

  /** Return the original text. @since 2.7 */
  toTextString(): string { return this.getText(); }

  private toStringImpl(readingDelimiter: string, includeChunks: boolean): string {
    let sb = '';
    for (const element of this.tokens) {
      if (!element.isWhitespace()) {
        sb += element.getToken();
        sb += '[';
      }
      const readings = element.getReadings();
      for (let k = 0; k < readings.length; k++) {
        const token = readings[k]!;
        const posTag = token.getPOSTag();
        if (element.isSentenceStart()) {
          sb += '<S>';
        } else if (JLanguageTool.SENTENCE_END_TAGNAME === posTag) {
          sb += '</S>';
        } else if (JLanguageTool.PARAGRAPH_END_TAGNAME === posTag) {
          sb += '<P/>';
        } else if (posTag == null && !includeChunks) {
          sb += token.getToken();
        } else {
          if (!element.isWhitespace()) {
            sb += token.toString();
            if (k + 1 < readings.length) {
              sb += readingDelimiter;
            }
          }
        }
      }
      if (!element.isWhitespace()) {
        if (includeChunks && element.getChunkTags().length > 0) {
          sb += ',';
          sb += element.getChunkTags().join('|');
        }
        if (element.isImmunized()) {
          sb += '{!}';
        }
        sb += ']';
      } else {
        sb += ' ';
      }
    }
    return sb;
  }

  /** Get disambiguator actions log. */
  getAnnotations(): string {
    let sb = 'Disambiguator log: \n';
    for (const element of this.tokens) {
      if (!element.isWhitespace() &&
              '' !== element.getHistoricalAnnotations()) {
        sb += element.getHistoricalAnnotations();
        sb += '\n';
      }
    }
    return sb;
  }

  /** Get the lowercase tokens of this sentence in a set. Used internally for performance optimization. @since 2.4 */
  getTokenSet(): Set<string> { return new Set(this.tokenOffsets.keys()); }

  /** Get the lowercase lemmas of this sentence in a set (if no lemma is available, the lowercase token). @since 2.5 */
  getLemmaSet(): Set<string> { return new Set(this.lemmaOffsets.keys()); }

  /** @return the indices of non-whitespace tokens with the given text, or null if there are none. @since 5.3 */
  getTokenOffsets(token: string): readonly number[] | undefined { return this.tokenOffsets.get(token); }

  /** @return the indices of non-whitespace tokens with the given lemma, or null if there are none. @since 5.3 */
  getLemmaOffsets(token: string): readonly number[] | undefined { return this.lemmaOffsets.get(token); }

  equals(o: unknown): boolean {
    if (this === o) {
      return true;
    }
    if (!(o instanceof AnalyzedSentence)) {
      return false;
    }
    const other = o;
    // tokenSet and lemmaSet are a subset of tokens and don't need to be included
    return Arrays_equals(this.nonBlankTokens, other.nonBlankTokens)
        && Arrays_equals(this.tokens, other.tokens)
        && Arrays_equals(this.whPositions, other.whPositions);
  }
}
