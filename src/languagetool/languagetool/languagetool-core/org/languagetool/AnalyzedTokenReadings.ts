// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/AnalyzedTokenReadings.java faithful
// The constructors are one (overloads), the logger is left out, hashCode is not needed.
import { AnalyzedToken } from './AnalyzedToken.ts';
import type { ChunkTag } from './chunking/ChunkTag.ts';
import { GlobalConfig } from './GlobalConfig.ts';
import { JLanguageTool } from './JLanguageTool.ts';
import { StringTools } from './tools/StringTools.ts';
import { Pattern } from '../../../../jdk/java/util/regex/Pattern.ts';
import { Arrays_equals } from '../../../../jdk/java/util/Objects.ts';

let NON_WORD_REGEX: Pattern | null = null;

/**
 * An array of {@link AnalyzedToken}s used to store multiple POS tags and lemmas
 * for a given single token.
 */
export class AnalyzedTokenReadings implements Iterable<AnalyzedToken> {
  private readonly _isWhitespace: boolean;
  private readonly _isLinebreak: boolean;
  private readonly isSentStart: boolean;
  private readonly _isPosTagUnknown: boolean;

  private anTokReadings: AnalyzedToken[];
  private startPos: number;
  private fixPos = 0;
  private token: string;
  private cleanToken: string | null = null;
  private chunkTags: ChunkTag[] = [];
  private isSentEnd: boolean;
  private isParaEnd: boolean;
  private _isWhitespaceBefore: boolean;
  private whitespaceBeforeChar: string;
  private _hasTypographicApostrophe = false;

  // If true, then the token is marked up as immune against tests:
  // it should never be matched by any rule. Used to have generalized
  // mechanism for exceptions in rules.
  private _isImmunized = false;
  private immunizationSourceLine = 0;

  // If true, then the token is marked up as ignored in all spelling rules:
  // other rules can freely match it.
  private _isIgnoredBySpeller = false;

  // Used to hold the string representation of the disambiguator actions on a token.
  private historicalAnnotations = '';

  // True if the token has the same lemma value for all tokens.
  // Can be used internally to optimize matching.
  private _hasSameLemmas: boolean;

  /**
   * new AnalyzedTokenReadings(tokens, startPos), (token, startPos), (token), or from a previous
   * AnalyzedTokenReadings with new readings and an annotation of the change:
   * (oldAtr, newReadings, ruleApplied).
   */
  constructor(tokens: AnalyzedToken[] | AnalyzedToken | AnalyzedTokenReadings, startPos: number | AnalyzedToken[] = 0, ruleApplied?: string) {
    const oldAtr = tokens instanceof AnalyzedTokenReadings ? tokens : null;
    const list: AnalyzedToken[] = oldAtr ? startPos as AnalyzedToken[] : Array.isArray(tokens) ? tokens : [tokens as AnalyzedToken];
    this.anTokReadings = [...list];
    this.startPos = oldAtr ? oldAtr.getStartPos() : startPos as number;
    this.token = this.anTokReadings[0]!.getToken();
    this._isWhitespace = StringTools.isWhitespace(this.token);
    this._isWhitespaceBefore = this.anTokReadings[0]!.isWhitespaceBefore();
    this._isLinebreak = '\n' === this.token || '\r\n' === this.token || '\r' === this.token || '\n\r' === this.token;
    this.isSentStart = JLanguageTool.SENTENCE_START_TAGNAME === this.anTokReadings[0]!.getPOSTag();
    this.isParaEnd = this.hasPosTag(JLanguageTool.PARAGRAPH_END_TAGNAME);
    this.isSentEnd = this.hasPosTag(JLanguageTool.SENTENCE_END_TAGNAME);
    this._isPosTagUnknown = list.length === 1 && list[0]!.getPOSTag() == null;
    this.setNoRealPOStag();
    this._hasSameLemmas = this.areLemmasSame();
    this.whitespaceBeforeChar = '';
    if (oldAtr) {
      // Constructor from a previous AnalyzedTokenReadings with new readings, and annotation of the change
      if (oldAtr.isSentenceEnd()) {
        this.setSentEnd();
      }
      if (oldAtr.isParagraphEnd()) {
        this.setParagraphEnd();
      }
      this.setWhitespaceBefore(oldAtr.getWhitespaceBefore());
      this.setChunkTags(oldAtr.getChunkTags());
      if (oldAtr.isImmunized()) {
        this.immunize(oldAtr.getImmunizationSourceLine());
      }
      if (oldAtr.isIgnoredBySpeller()) {
        this.ignoreSpelling();
      }
      if (oldAtr.hasTypographicApostrophe()) {
        this.setTypographicApostrophe();
      }
      this.setHistoricalAnnotations(oldAtr.getHistoricalAnnotations());
      this.addHistoricalAnnotations(oldAtr.toString(), ruleApplied ?? '');
    }
  }

  getReadings(): AnalyzedToken[] { return [...this.anTokReadings]; }

  /** Get a token reading. */
  getAnalyzedToken(idx: number): AnalyzedToken { return this.anTokReadings[idx]!; }

  /** Checks if the token has a particular POS tag. */
  hasPosTag(posTag: string): boolean {
    for (const reading of this.anTokReadings) {
      if (posTag === reading.getPOSTag()) {
        return true;
      }
    }
    return false;
  }

  /** Checks if the token has a particular POS tag and lemma. */
  hasPosTagAndLemma(posTag: string, lemma: string): boolean {
    for (const reading of this.anTokReadings) {
      if (posTag === reading.getPOSTag() && lemma === reading.getLemma()) {
        return true;
      }
    }
    return false;
  }

  hasReading(): boolean { return this.anTokReadings != null && this.anTokReadings.length > 0; }

  /** Checks if one of the token's readings has a particular lemma. */
  hasLemma(lemma: string): boolean {
    const found = false;
    for (const reading of this.anTokReadings) {
      if (reading.getLemma() != null && lemma === reading.getLemma()) {
        return true;
      }
    }
    return found;
  }

  /** Checks if one of the token's readings has one of the given lemmas */
  hasAnyLemma(...lemmas: string[]): boolean {
    for (const lemma of lemmas) {
      for (const reading of this.anTokReadings) {
        if (lemma === reading.getLemma()) {
          return true;
        }
      }
    }
    return false;
  }

  /** Checks if the token has a particular POS tag, where only a part of the given POS tag needs to match. */
  hasPartialPosTag(posTag: string): boolean {
    for (const reading of this.anTokReadings) {
      if (reading.getPOSTag() != null && reading.getPOSTag()!.includes(posTag)) {
        return true;
      }
    }
    return false;
  }

  /** Checks if the token has any of the given particular POS tags (only a part of the given POS tag needs to match) */
  hasAnyPartialPosTag(...posTags: string[]): boolean {
    for (const posTag of posTags) {
      if (this.hasPartialPosTag(posTag)) {
        return true;
      }
    }
    return false;
  }

  /** Checks if the token has a POS tag starting with the given string. */
  hasPosTagStartingWith(posTag: string): boolean {
    for (const reading of this.anTokReadings) {
      if (reading.getPOSTag() != null && reading.getPOSTag()!.startsWith(posTag)) {
        return true;
      }
    }
    return false;
  }

  /** Checks if at least one of the readings matches a given POS tag regex. */
  matchesPosTagRegex(posTagRegex: string | Pattern): boolean {
    const pattern = typeof posTagRegex === 'string' ? Pattern.compile(posTagRegex) : posTagRegex;
    for (const reading of this.anTokReadings) {
      if (reading.getPOSTag() != null && pattern.matcher(reading.getPOSTag()!).matches()) {
        return true;
      }
    }
    return false;
  }

  /** Checks if at least one of the chunk tags matches a given regex. @since 6.4 */
  matchesChunkRegex(chunkRegex: string): boolean {
    const pattern = Pattern.compile(chunkRegex);
    for (const chunk of this.getChunkTags()) {
      if (chunk != null && pattern.matcher(chunk.getChunkTag()).matches()) {
        return true;
      }
    }
    return false;
  }

  /** Returns the first reading that matches a given POS tag regex. */
  readingWithTagRegex(posTagRegex: string | Pattern): AnalyzedToken | null {
    const pattern = typeof posTagRegex === 'string' ? Pattern.compile(posTagRegex) : posTagRegex;
    for (const reading of this.anTokReadings) {
      if (reading.getPOSTag() != null && pattern.matcher(reading.getPOSTag()!).matches()) {
        return reading;
      }
    }
    return null;
  }

  /** Returns the first reading that matches a given lemma. */
  readingWithLemma(lemma: string): AnalyzedToken | null {
    for (const reading of this.anTokReadings) {
      if (reading.getLemma() != null && reading.getLemma() === lemma) {
        return reading;
      }
    }
    return null;
  }

  /**
   * Add a new reading.
   * @param token new reading, given as {@link AnalyzedToken}
   */
  addReading(token: AnalyzedToken, ruleApplied: string): void {
    const oldValue = this.toString();
    const l: AnalyzedToken[] = this.anTokReadings.slice(0, this.anTokReadings.length - 1);
    if (this.anTokReadings[this.anTokReadings.length - 1]!.getPOSTag() != null) {
      l.push(this.anTokReadings[this.anTokReadings.length - 1]!);
    }
    token.setWhitespaceBefore(this._isWhitespaceBefore);
    l.push(token);
    this.anTokReadings = l;
    if (token.getToken().length > this.token.length) { //in case a longer token is added
      this.token = token.getToken();
    }
    this.anTokReadings[this.anTokReadings.length - 1]!.setWhitespaceBefore(this._isWhitespaceBefore);
    this.isParaEnd = this.hasPosTag(JLanguageTool.PARAGRAPH_END_TAGNAME);
    this.isSentEnd = this.hasPosTag(JLanguageTool.SENTENCE_END_TAGNAME);
    this.setNoRealPOStag();
    this._hasSameLemmas = this.areLemmasSame();
    this.addHistoricalAnnotations(oldValue, ruleApplied);
  }

  /** Removes a reading from the list of readings. Note: if the token has only one reading, then a new reading with an empty POS tag and an empty lemma is created. */
  removeReading(token: AnalyzedToken, ruleApplied: string): void {
    const oldValue = this.toString();
    const l: AnalyzedToken[] = [];
    const tmpTok = new AnalyzedToken(token.getToken(), token.getPOSTag(), token.getLemma());
    tmpTok.setWhitespaceBefore(this._isWhitespaceBefore);
    let removedSentEnd = false;
    let removedParaEnd = false;
    for (const anTokReading of this.anTokReadings) {
      if (!anTokReading.matches(tmpTok)) {
        l.push(anTokReading);
      } else if (JLanguageTool.SENTENCE_END_TAGNAME === anTokReading.getPOSTag()) {
        removedSentEnd = true;
      } else if (JLanguageTool.PARAGRAPH_END_TAGNAME === anTokReading.getPOSTag()) {
        removedParaEnd = true;
      }
    }
    if (l.length === 0) {
      l.push(new AnalyzedToken(this.token, null, null));
      l[0]!.setWhitespaceBefore(this._isWhitespaceBefore);
    }
    this.anTokReadings = l;
    this.setNoRealPOStag();
    if (removedSentEnd) {
      this.isSentEnd = false;
      this.setSentEnd();
    }
    if (removedParaEnd) {
      this.isParaEnd = false;
      this.setParagraphEnd();
    }
    this._hasSameLemmas = this.areLemmasSame();
    this.addHistoricalAnnotations(oldValue, ruleApplied);
  }

  /** Removes all readings but the one that matches the token given. */
  leaveReading(token: AnalyzedToken): void {
    const l: AnalyzedToken[] = [];
    const tmpTok = new AnalyzedToken(token.getToken(), token.getPOSTag(), token.getLemma());
    tmpTok.setWhitespaceBefore(this._isWhitespaceBefore);
    for (const anTokReading of this.anTokReadings) {
      if (anTokReading.matches(tmpTok)) {
        l.push(anTokReading);
      }
    }
    if (l.length === 0) {
      l.push(new AnalyzedToken(this.token, null, null));
      l[0]!.setWhitespaceBefore(this._isWhitespaceBefore);
    }
    this.anTokReadings = l;
    this.setNoRealPOStag();
    this._hasSameLemmas = this.areLemmasSame();
  }

  /** Number of readings. */
  getReadingsLength(): number { return this.anTokReadings.length; }

  isWhitespace(): boolean { return this._isWhitespace; }

  /** Returns true if the token equals {@code \n}, {@code \r}, {@code \n\r}, or {@code \r\n}. */
  isLinebreak(): boolean { return this._isLinebreak; }

  isSentenceStart(): boolean { return this.isSentStart; }

  /** @return true when the token is a last token in a paragraph. */
  isParagraphEnd(): boolean { return this.isParaEnd; }

  /** Add PARA_END tag. */
  setParagraphEnd(): void {
    if (!this.isParagraphEnd()) {
      const paragraphEnd = new AnalyzedToken(this.getToken(),
          JLanguageTool.PARAGRAPH_END_TAGNAME, this.getAnalyzedToken(0).getLemma());
      this.addReading(paragraphEnd, 'add_paragaph_end');
    }
  }

  /** @return true when the token is a last token in a sentence. */
  isSentenceEnd(): boolean { return this.isSentEnd; }

  /** @return true if the token is LibreOffice/OpenOffice field code. @since 0.9.9 */
  isFieldCode(): boolean { return '\u0001' === this.token || '\u0002' === this.token; }

  /** Add a SENT_END tag. */
  setSentEnd(): void {
    if (!this.isSentenceEnd()) {
      const sentenceEnd = new AnalyzedToken(this.getToken(),
          JLanguageTool.SENTENCE_END_TAGNAME, this.getAnalyzedToken(0).getLemma());
      this.addReading(sentenceEnd, '');
    }
  }

  getStartPos(): number { return this.startPos; }

  /** @since 2.9 */
  getEndPos(): number { return this.startPos + this.token.length; }

  setStartPos(position: number): void { this.startPos = position; }

  /** @since 6.4 */
  setPosFix(fix: number): void { this.fixPos = fix; }

  /** @since 6.4 */
  getPosFix(): number { return this.fixPos; }

  getToken(): string { return this.token; }

  setWhitespaceBefore(prevToken: string): void {
    this._isWhitespaceBefore = prevToken !== '' && StringTools.isWhitespace(prevToken);
    for (const aTok of this.anTokReadings) {
      aTok.setWhitespaceBefore(this._isWhitespaceBefore);
    }
    if (this._isWhitespaceBefore) {
      this.whitespaceBeforeChar = prevToken;
    }
  }

  getWhitespaceBefore(): string { return this.whitespaceBeforeChar; }

  isWhitespaceBefore(): boolean { return this._isWhitespaceBefore; }

  immunize(sourceLine: number): void {
    this._isImmunized = true;
    this.immunizationSourceLine = sourceLine;
  }

  isImmunized(): boolean { return this._isImmunized; }

  /** @since 6.3 */
  getImmunizationSourceLine(): number { return this.immunizationSourceLine; }

  /** Make the token ignored by all spelling rules. @since 2.5 */
  ignoreSpelling(): void { this._isIgnoredBySpeller = true; }

  /** Test if the token can be ignored by spelling rules. @since 2.5 */
  isIgnoredBySpeller(): boolean { return this._isIgnoredBySpeller; }

  /** Test if the token's POStag equals null. @since 2.5 */
  isPosTagUnknown(): boolean { return this._isPosTagUnknown; }

  /** Sets the flag on AnalyzedTokens to make matching on {@code UNKNOWN} POS tag correct in the Element class. */
  private setNoRealPOStag(): void {
    let hasNoPOStag = !this.isLinebreak();
    for (const an of this.anTokReadings) {
      const posTag = an.getPOSTag();
      if (JLanguageTool.PARAGRAPH_END_TAGNAME === posTag ||
          JLanguageTool.SENTENCE_END_TAGNAME === posTag) {
        continue;
      }
      if (posTag != null) {
        hasNoPOStag = false;
        break;
      }
    }
    for (const an of this.anTokReadings) {
      an.setNoPOSTag(hasNoPOStag);
    }
  }

  /** Used to track disambiguator actions. @return the historicalAnnotations */
  getHistoricalAnnotations(): string { return this.historicalAnnotations; }

  /** Used to track disambiguator actions. */
  private setHistoricalAnnotations(historicalAnnotations: string): void {
    if (GlobalConfig.isVerbose()) {
      this.historicalAnnotations = historicalAnnotations;
    }
  }

  private addHistoricalAnnotations(oldValue: string, ruleApplied: string): void {
    if (ruleApplied !== '' && GlobalConfig.isVerbose()) {
      this.historicalAnnotations = `${this.getHistoricalAnnotations()}\n${ruleApplied}: ${oldValue} -> ${this}`;
    }
  }

  /** @since 2.3 */
  setChunkTags(chunkTags: ChunkTag[]): void {
    if (chunkTags == null) throw new TypeError('NullPointerException');
    this.chunkTags = chunkTags;
  }

  /** @since 2.3 */
  getChunkTags(): ChunkTag[] { return this.chunkTags; }

  toString(): string {
    let sb = this.token;
    sb += '[';
    for (const element of this.anTokReadings) {
      sb += element.toString();
      if (!element.isWhitespaceBefore()) {
        sb += '*';
      }
      sb += ',';
    }
    sb = sb.slice(0, -1);
    if (this.chunkTags.length > 0) {
      sb += ',';
      sb += this.chunkTags.join('|');
    }
    sb += ']';
    if (this.isImmunized()) {
      sb += '{!},';
    }
    return sb;
  }

  /** @return true if AnalyzedTokenReadings has some real POS tag (= not null or a special tag) @since 2.3 */
  isTagged(): boolean {
    for (const element of this.anTokReadings) {
      if (!element.hasNoTag()) {
        return true;
      }
    }
    return false;
  }

  /** Used to optimize pattern matching. */
  private areLemmasSame(): boolean {
    const previousLemma = this.anTokReadings[0]!.getLemma();
    if (previousLemma == null) {
      for (const element of this.anTokReadings) {
        if (element.getLemma() != null) {
          return false;
        }
      }
      return true;
    }
    for (const element of this.anTokReadings) {
      if (previousLemma !== element.getLemma()) {
        return false;
      }
    }
    return true;
  }

  /** Used to optimize pattern matching. @return true if all {@link AnalyzedToken} lemmas are the same. */
  hasSameLemmas(): boolean { return this._hasSameLemmas; }

  /** @return true if the token is a punctuation mark or other non-word character (not including whitespace). @since 4.5 */
  isNonWord(): boolean {
    NON_WORD_REGEX ??= Pattern.compile('[.?!…:;,~’\'"„“”»«‚‘›‹()\\[\\]\\-–—*×∗·+÷/=]');
    return NON_WORD_REGEX.matcher(this.token).matches();
  }

  equals(obj: unknown): boolean {
    if (this === obj) { return true; }
    if (!(obj instanceof AnalyzedTokenReadings)) {
      return false;
    }
    const other = obj;
    return Arrays_equals(this.anTokReadings, other.anTokReadings)
      && this._isLinebreak === other._isLinebreak
      && this.isParaEnd === other.isParaEnd
      && this.isSentEnd === other.isSentEnd
      && this.isSentStart === other.isSentStart
      && this._isWhitespace === other._isWhitespace
      && this._isWhitespaceBefore === other._isWhitespaceBefore
      && this._isImmunized === other._isImmunized
      && this.startPos === other.startPos
      && Arrays_equals(this.chunkTags, other.chunkTags)
      && this._hasSameLemmas === other._hasSameLemmas
      && this._isIgnoredBySpeller === other._isIgnoredBySpeller
      && this.token === other.token
      && this._hasTypographicApostrophe === other._hasTypographicApostrophe;
  }

  /** @since 2.3 */
  [Symbol.iterator](): Iterator<AnalyzedToken> { return this.anTokReadings[Symbol.iterator](); }

  /** @since 6.4 */
  setCleanToken(cleanToken: string): void { this.cleanToken = cleanToken; }

  /** @since 6.4 */
  getCleanToken(): string { return this.cleanToken != null ? this.cleanToken : this.token; }

  /** @since 6.4 */
  setTypographicApostrophe(): void { this._hasTypographicApostrophe = true; }

  /** @since 6.4 */
  hasTypographicApostrophe(): boolean { return this._hasTypographicApostrophe; }
}
