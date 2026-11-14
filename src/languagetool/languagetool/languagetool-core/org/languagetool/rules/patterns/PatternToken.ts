// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternToken.java faithful
// The package-private constructor PatternToken(inflected, textMatcher) is the static factory
// PatternToken.create; PosToken's package-private constructor takes the matcher as an optional
// fourth parameter (PosToken(posTag, regExp, negation, matcher)). clone() is Object.clone, a
// shallow copy. Java's byte and short fields are numbers.
import type { AnalyzedToken } from '../../AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../JLanguageTool.ts';
import type { ChunkTag } from '../../chunking/ChunkTag.ts';
import type { Synthesizer } from '../../synthesis/Synthesizer.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';
import type { Match } from './Match.ts';
import { StringMatcher } from './StringMatcher.ts';

const EMPTY_ARRAY: PatternToken[] = [];

const INFLECTED_MASK = 1;
const NEGATION_MASK = 2;
const TEST_WHITESPACE_MASK = 4;
const WHITESPACE_BEFORE_MASK = 8;
const INSIDE_MARKER_MASK = 0x10;

/** True if scope=="next". */
const EXCEPTION_VALID_NEXT_MASK = 0x20;

const MAY_BE_OMITTED_MASK = 0x40;

/**
 * This var is used to determine if calling {@link #setStringElement} makes sense. This method
 * takes most time so it's best to reduce the number of its calls.
 */
const TEST_STRING_MASK = 0x80;

/** Determines whether the element should be ignored when doing unification **/
const UNIFICATION_NEUTRAL_MASK = 0x100;

const UNI_NEGATION_MASK = 0x200;

/** Set to true on tokens that close the unification block. */
const LAST_UNIFIED_MASK = 0x400;

const Byte_MAX_VALUE = 127;

/**
 * A part of a pattern, represents the 'token' element of the {@code grammar.xml}.
 */
export class PatternToken {

  /** Matches only tokens without any POS tag. **/
  static readonly UNKNOWN_TAG = 'UNKNOWN';

  private flags = 0;

  private textMatcher!: StringMatcher;
  private posToken: PosToken | null = null;

  private rareFields: RareFields | null = null;

  private skip = 0;
  private maxOccurrence = 1;

  /**
   * Creates Element that is used to match tokens in the text.
   * @param token String to be matched
   * @param caseSensitive true if the check is case-sensitive
   * @param regExp true if the check uses regular expressions
   * @param inflected true if the check refers to base forms (lemmas), note that {@code token} must be a base form for this to work
   */
  constructor(token: string | null, caseSensitive: boolean, regExp: boolean, inflected: boolean) {
    this.init(inflected, StringMatcher.create(PatternToken.normalizeTextPattern(token), regExp, caseSensitive));
  }

  /** PatternToken(boolean inflected, StringMatcher textMatcher) */
  static create(inflected: boolean, textMatcher: StringMatcher): PatternToken {
    const p = Object.create(PatternToken.prototype) as PatternToken;
    p.flags = 0;
    p.posToken = null;
    p.rareFields = null;
    p.skip = 0;
    p.maxOccurrence = 1;
    p.init(inflected, textMatcher);
    return p;
  }

  private init(inflected: boolean, textMatcher: StringMatcher): void {
    this.flags = INSIDE_MARKER_MASK | (inflected ? INFLECTED_MASK : 0);
    this.setTextMatcher(textMatcher);
  }

  clone(): PatternToken {
    return Object.assign(Object.create(PatternToken.prototype) as PatternToken, this);
  }

  /**
   * Checks whether the rule element matches the token given as a parameter.
   * @param token AnalyzedToken to check matching against
   * @return True if token matches, false otherwise.
   */
  isMatched(token: AnalyzedToken): boolean {
    if (this.hasFlag(TEST_WHITESPACE_MASK) && !this.isWhitespaceBefore(token)) {
      return false;
    }
    const posNegation = this.posToken != null && this.posToken.negation;
    if (this.hasFlag(TEST_STRING_MASK)) {
      return (this.textMatcher.matches(this.getTestToken(token)) !== this.getNegation()) &&
             (this.isPosTokenMatched(token) !== posNegation);
    } else {
      return !this.getNegation() &&
             (this.isPosTokenMatched(token) !== posNegation);
    }
  }

  hasFlag(mask: number): boolean {
    return (this.flags & mask) !== 0;
  }

  private setFlag(mask: number, value: boolean): void {
    if (value) {
      this.flags |= mask;
    } else {
      this.flags &= ~mask;
    }
  }

  /**
   * Checks whether an exception matches.
   * @param token AnalyzedToken to check matching against
   * @return True if any of the exceptions matches (logical disjunction).
   */
  isExceptionMatched(token: AnalyzedToken): boolean {
    if (this.rareFields != null && this.rareFields.currentAndNextExceptions.length > 0) {
      for (const testException of this.rareFields.currentAndNextExceptions) {
        if (!testException.hasNextException() && testException.isMatched(token)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Enables testing multiple conditions specified by multiple element exceptions.
   * Works as logical AND operator.
   * @param token the token checked for exceptions.
   * @return true if all conditions are met, false otherwise.
   */
  isAndExceptionGroupMatched(token: AnalyzedToken): boolean {
    const andGroupList = this.rareFields == null ? null : this.rareFields.andGroupList;
    if (andGroupList == null) return false;
    for (const testAndGroup of andGroupList) {
      if (testAndGroup.isExceptionMatched(token)) {
        return true;
      }
    }
    return false;
  }

  /**
   * This method checks exceptions both in AND-group and the token. Introduced to for clarity.
   * @param token Token to match
   * @return True if matched.
   */
  isExceptionMatchedCompletely(token: AnalyzedToken): boolean {
    // note: short-circuiting possible
    return this.isExceptionMatched(token) || this.isAndExceptionGroupMatched(token);
  }

  setAndGroupElement(andToken: PatternToken): void {
    const rareFields = this.initRareFields();
    if (rareFields.andGroupList == null) {
      rareFields.andGroupList = [];
    }
    rareFields.andGroupList.push(Objects_requireNonNull(andToken));
  }

  /**
   * Checks if this element has an AND group associated with it.
   * @return true if the element has a group of elements that all should match.
   */
  hasAndGroup(): boolean {
    return this.rareFields != null && this.rareFields.andGroupList != null;
  }

  /**
   * Returns the group of elements linked with AND operator.
   */
  getAndGroup(): readonly PatternToken[] {
    const andGroupList = this.rareFields == null ? null : this.rareFields.andGroupList;
    return andGroupList == null ? [] : andGroupList;
  }

  /** @since 2.3 */
  setOrGroupElement(orToken: PatternToken): void {
    const rareFields = this.initRareFields();
    if (rareFields.orGroupList == null) {
      rareFields.orGroupList = [];
    }
    rareFields.orGroupList.push(Objects_requireNonNull(orToken));
  }

  /**
   * Checks if this element has an OR group associated with it.
   * @return true if the element has a group of elements that all should match.
   * @since 2.3
   */
  hasOrGroup(): boolean {
    return this.rareFields != null && this.rareFields.orGroupList != null;
  }

  /**
   * Returns the group of elements linked with OR operator.
   * @since 2.3
   */
  getOrGroup(): readonly PatternToken[] {
    const orGroupList = this.rareFields == null ? null : this.rareFields.orGroupList;
    return orGroupList == null ? [] : orGroupList;
  }

  /**
   * Checks whether a previously set exception matches (in case the exception had scope == "next").
   * @param token {@link AnalyzedToken} to check matching against.
   * @return True if any of the exceptions matches.
   */
  isMatchedByScopeNextException(token: AnalyzedToken): boolean {
    if (this.rareFields != null) {
      for (const testException of this.rareFields.currentAndNextExceptions) {
        if (testException.hasNextException() && testException.isMatched(token)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Checks whether an exception for a previous token matches (in case the exception had scope ==
   * "previous"), for one reading (AnalyzedToken) or for all readings of a token (AnalyzedTokenReadings).
   * @return True if any of the exceptions matches.
   */
  isMatchedByPreviousException(token: AnalyzedToken | AnalyzedTokenReadings): boolean {
    if (isReadings(token)) {
      const prevToken = token;
      for (const analyzedToken of prevToken) {
        if (this.isMatchedByPreviousException(analyzedToken)) {
          return true;
        }
      }
      return false;
    }
    if (this.hasPreviousException()) {
      for (const testException of this.rareFields!.previousExceptions) {
        if (!testException.hasNextException() && testException.isMatched(token)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Checks if the token is a sentence start.
   * @return True if the element starts the sentence and the element hasn't been set to have negated POS token.
   */
  isSentenceStart(): boolean {
    return this.posToken != null && JLanguageTool.SENTENCE_START_TAGNAME === this.posToken.posTag && !this.posToken.negation;
  }

  /** @since 2.9 */
  setPosToken(posToken: PosToken | null): void {
    this.posToken = posToken;
  }

  /** @since 2.9 */
  setChunkTag(chunkTag: ChunkTag): void {
    this.initRareFields().chunkTag = chunkTag;
  }

  getString(): string {
    return this.textMatcher.pattern;
  }

  setStringElement(token: string | null): void {
    this.setTextMatcher(StringMatcher.create(PatternToken.normalizeTextPattern(token), this.isRegularExpression(), this.isCaseSensitive()));
  }

  setTextMatcher(matcher: StringMatcher): void {
    this.textMatcher = matcher;
    this.setFlag(TEST_STRING_MASK, !StringTools.isEmpty(matcher.pattern));
  }

  static normalizeTextPattern(token: string | null): string {
    return token == null ? '' : StringTools.trimWhitespace(token);
  }

  /**
   * Sets a string and/or pos exception for matching tokens.
   * @param token The string in the exception.
   * @param regExp True if the string is specified as a regular expression.
   * @param inflected True if the string is a base form (lemma).
   * @param negation True if the exception is negated.
   * @param scopeNext True if the exception scope is next tokens.
   * @param scopePrevious True if the exception should match only a single previous token.
   * @param posToken The part of the speech tag in the exception.
   * @param posRegExp True if the POS is specified as a regular expression.
   * @param posNegation True if the POS exception is negated.
   * @param caseSensitivity if null, use this element's setting for case sensitivity, otherwise the specified value
   * @since 2.9
   */
  setStringPosException(
          token: string | null, regExp: boolean, inflected: boolean,
          negation: boolean, scopeNext: boolean, scopePrevious: boolean,
          posToken: string | null, posRegExp: boolean, posNegation: boolean, caseSensitivity: boolean | null): void {
    const exception = new PatternToken(token, caseSensitivity == null ? this.isCaseSensitive() : caseSensitivity, regExp, inflected);
    exception.setNegation(negation);
    exception.setPosToken(new PosToken(posToken, posRegExp, posNegation));
    this.addException(scopeNext, scopePrevious, exception);
  }

  addException(scopeNext: boolean, scopePrevious: boolean, exception: PatternToken): void {
    exception.setFlag(EXCEPTION_VALID_NEXT_MASK, scopeNext);
    this.initRareFields().addException(exception, scopePrevious);
  }

  private initRareFields(): RareFields {
    if (this.rareFields == null) {
      this.rareFields = new RareFields();
    }
    return this.rareFields;
  }

  /**
   * Tests if part of speech matches a given string.
   * Special value UNKNOWN_TAG matches null POS tags.
   * @param token Token to test.
   * @return true if matches
   */
  private isPosTokenMatched(token: AnalyzedToken): boolean {
    const pos = this.posToken;
    if (pos == null || pos.posTag == null || pos.posUnknown && token.hasNoTag()) {
      return true;
    }
    const tokenPos = token.getPOSTag();
    if (tokenPos == null) {
      return false;
    }
    return pos.posPattern != null ? pos.posPattern.matches(tokenPos) : pos.posTag === tokenPos;
  }

  private getTestToken(token: AnalyzedToken): string {
    // enables using words with lemmas and without lemmas
    // in the same regexp with inflected="yes"
    if (this.hasFlag(INFLECTED_MASK)) {
      if (token.getLemma() != null) {
        return token.getLemma()!;
      } else {
        return token.getToken();
      }
    }
    return token.getToken();
  }

  /**
   * Gets the exception scope length.
   * @return scope length in tokens
   */
  getSkipNext(): number {
    return this.skip;
  }

  /**
   * The minimum number of times the element needs to occur.
   */
  getMinOccurrence(): number {
    return this.hasFlag(MAY_BE_OMITTED_MASK) ? 0 : 1;
  }

  /**
   * The maximum number of times the element may occur.
   */
  getMaxOccurrence(): number {
    return this.maxOccurrence;
  }

  /**
   * @param i exception scope length.
   */
  setSkipNext(i: number): void {
    if (i < -1 || i > Byte_MAX_VALUE) {
      throw new Error("IllegalArgumentException: 'skip' should be between -1 and " + Byte_MAX_VALUE);
    }
    this.skip = i;
  }

  /**
   * The minimum number of times this element may occur.
   * @param i currently only {@code 0} and {@code 1} are supported
   */
  setMinOccurrence(i: number): void {
    if (i !== 0 && i !== 1) {
      throw new Error('IllegalArgumentException: minOccurrences must be 0 or 1: ' + i);
    }
    this.setFlag(MAY_BE_OMITTED_MASK, i === 0);
  }

  /**
   * The maximum number of times this element may occur.
   * @param i a number &gt;= 1 or {@code -1} for unlimited occurrences
   */
  setMaxOccurrence(i: number): void {
    if (i === 0) {
      throw new Error('IllegalArgumentException: maxOccurrences may not be 0');
    }
    if (i < -1 || i > Byte_MAX_VALUE) {
      throw new Error('IllegalArgumentException: maxOccurrences should be between -1 and ' + Byte_MAX_VALUE + ' but was: ' + i);
    }
    this.maxOccurrence = i;
  }

  /**
   * Checks if the element has an exception for a previous token.
   * @return True if the element has a previous token matching exception.
   */
  hasPreviousException(): boolean {
    return this.rareFields != null && this.rareFields.previousExceptions.length > 0;
  }

  /**
   * Checks if the element has an exception for a next scope.
   * (only used for testing)
   * @return True if the element has exception for the next scope.
   */
  hasNextException(): boolean {
    return this.hasFlag(EXCEPTION_VALID_NEXT_MASK);
  }

  /**
   * Negates the matching so that non-matching elements match and vice-versa.
   */
  setNegation(negation: boolean): void {
    this.setFlag(NEGATION_MASK, negation);
  }

  /**
   * see {@link #setNegation}
   * @since 0.9.3
   */
  getNegation(): boolean {
    return this.hasFlag(NEGATION_MASK);
  }

  /**
   * @return true when this element refers to another token.
   */
  isReferenceElement(): boolean {
    return this.getMatch() != null;
  }

  /**
   * Sets the reference to another token.
   * @param match Formatting object for the token reference.
   */
  setMatch(match: Match): void {
    this.initRareFields().tokenReference = Objects_requireNonNull(match);
  }

  getMatch(): Match | null {
    return this.rareFields == null ? null : this.rareFields.tokenReference;
  }

  /**
   * Prepare PatternToken for matching by formatting its string token and POS (if the Element is supposed
   * to refer to some other token).
   * @param token the token specified as {@link AnalyzedTokenReadings}
   * @param synth the language synthesizer ({@link Synthesizer})
   */
  compile(token: AnalyzedTokenReadings, synth: Synthesizer | null): PatternToken {
    const compiledPatternToken = this.clone();
    compiledPatternToken.doCompile(token, synth);
    return compiledPatternToken;
  }

  private doCompile(token: AnalyzedTokenReadings, synth: Synthesizer | null): void {
    const tokenReference = this.rareFields!.tokenReference!;
    const matchState = tokenReference.createState(synth, token);
    const reference = '\\' + tokenReference.getTokenRef();
    if (tokenReference.setsPos()) {
      const posReference = matchState.getTargetPosTag();
      if (posReference != null) {
        this.setPosToken(new PosToken(posReference, tokenReference.posRegExp(), this.getNegation()));
      }
      this.setStringElement(this.getString().replaceAll(reference, ''));
    } else {
      this.setStringElement(this.getString().replaceAll(reference, matchState.toTokenString()));
    }
  }

  /**
   * Sets the phrase the element is in.
   * @param id ID of the phrase.
   */
  setPhraseName(id: string): void {
    this.initRareFields().phraseName = id;
  }

  /**
   * Checks if the Element is in any phrase.
   * @return True if the Element is contained in the phrase.
   */
  isPartOfPhrase(): boolean {
    return this.rareFields != null && this.rareFields.phraseName != null;
  }

  /**
   * Whether the element matches case sensitively.
   * @since 2.3
   */
  isCaseSensitive(): boolean {
    return this.textMatcher.caseSensitive;
  }

  /**
   * Tests whether the element matches a regular expression.
   * @since 0.9.6
   */
  isRegularExpression(): boolean {
    return this.textMatcher.isRegExp;
  }

  /**
   * Tests whether the POS matches a regular expression.
   * @since 1.3.0
   */
  isPOStagRegularExpression(): boolean {
    return this.posToken != null && this.posToken.posPattern != null;
  }

  /**
   * @return the POS of the Element or {@code null}
   * @since 0.9.6
   */
  getPOStag(): string | null {
    return this.posToken != null ? this.posToken.posTag : null;
  }

  /**
   * @return the chunk tag of the Element or {@code null}
   * @since 2.3
   */
  getChunkTag(): ChunkTag | null {
    return this.rareFields == null ? null : this.rareFields.chunkTag;
  }

  /**
   * @return true if the POS is negated.
   */
  getPOSNegation(): boolean {
    return this.posToken != null && this.posToken.negation;
  }

  /**
   * @return true if the token matches all inflected forms
   */
  isInflected(): boolean {
    return this.hasFlag(INFLECTED_MASK);
  }

  /**
   * Gets the phrase the element is in.
   * @return String The name of the phrase.
   */
  getPhraseName(): string | null {
    return this.rareFields == null ? null : this.rareFields.phraseName;
  }

  isUnified(): boolean {
    return this.rareFields != null && this.rareFields.unificationFeatures != null;
  }

  setUnification(uniFeatures: Map<string, string[]>): void {
    this.initRareFields().unificationFeatures = Objects_requireNonNull(uniFeatures);
  }

  /**
   * Get unification features and types.
   * @return A map from features to a list of types or {@code null}
   * @since 1.0.1
   */
  getUniFeatures(): Map<string, string[]> | null {
    return this.rareFields == null ? null : this.rareFields.unificationFeatures;
  }

  setUniNegation(): void {
    this.setFlag(UNI_NEGATION_MASK, true);
  }

  isUniNegated(): boolean {
    return this.hasFlag(UNI_NEGATION_MASK);
  }

  isLastInUnification(): boolean {
    return this.hasFlag(LAST_UNIFIED_MASK);
  }

  setLastInUnification(): void {
    this.setFlag(LAST_UNIFIED_MASK, true);
  }

  /**
   * Determines whether the element should be silently ignored during unification,
   * and simply added.
   * @return True when the element is not included in unifying.
   * @since 2.5
   */
  isUnificationNeutral(): boolean {
    return this.hasFlag(UNIFICATION_NEUTRAL_MASK);
  }

  /**
   * Sets the element as ignored during unification.
   * @since 2.5
   */
  setUnificationNeutral(): void {
    this.setFlag(UNIFICATION_NEUTRAL_MASK, true);
  }


  setWhitespaceBefore(isWhite: boolean): void {
    this.setFlag(WHITESPACE_BEFORE_MASK, isWhite);
    this.setFlag(TEST_WHITESPACE_MASK, true);
  }

  isInsideMarker(): boolean {
    return this.hasFlag(INSIDE_MARKER_MASK);
  }

  setInsideMarker(isInsideMarker: boolean): void {
    this.setFlag(INSIDE_MARKER_MASK, isInsideMarker);
  }

  /**
   * Sets the attribute on the exception that determines matching of patterns
   * that depends on whether there was a space before the token matching the exception
   * or not.
   * The same procedure is used for tokens that are valid for previous or current tokens.
   *
   * @param isWhite If true, the space before exception is required.
   */
  setExceptionSpaceBefore(isWhite: boolean): void {
    if (this.rareFields != null) {
      const array = this.hasPreviousException() ? this.rareFields.previousExceptions : this.rareFields.currentAndNextExceptions;
      if (array.length > 0) {
        array[array.length - 1]!.setWhitespaceBefore(isWhite);
      }
    }
  }

  isWhitespaceBefore(token: AnalyzedToken): boolean {
    return this.hasFlag(WHITESPACE_BEFORE_MASK) === token.isWhitespaceBefore();
  }

  /**
   * @return A List of Exceptions. Used for testing.
   * @since 1.0.0
   */
  getExceptionList(): readonly PatternToken[] {
    const array = this.rareFields == null ? EMPTY_ARRAY : this.rareFields.currentAndNextExceptions;
    return array;
  }

  hasCurrentOrNextExceptions(): boolean {
    return this.rareFields != null && this.rareFields.currentAndNextExceptions.length > 0;
  }

  hasExceptionList(): boolean {
    return this.rareFields != null &&
           (this.rareFields.currentAndNextExceptions.length > 0 || this.rareFields.previousExceptions.length > 0);
  }

  /**
   * @return all possible forms that this token pattern can accept, or {@code null} if such set is unknown/unbounded.
   * This is used internally for performance optimizations.
   */
  calcFormHints(): Set<string> | null {
    return this.calcStringHints(false);
  }

  /**
   * @return all possible forms that this token pattern can accept, or {@code null} if such set is unknown/unbounded.
   * This is used internally for performance optimizations.
   */
  calcLemmaHints(): Set<string> | null {
    return this.calcStringHints(true);
  }

  private calcStringHints(inflected: boolean): Set<string> | null {
    let result = inflected !== this.isInflected() ? null : this.calcOwnPossibleStringValues();
    if (result == null) return null;

    const andGroupList = this.rareFields == null ? null : this.rareFields.andGroupList;
    const orGroupList = this.rareFields == null ? null : this.rareFields.orGroupList;
    if (andGroupList != null) {
      result = new Set(result);

      for (const token of andGroupList) {
        const hints = token.calcStringHints(inflected);
        if (hints != null) {
          for (const s of [...result]) {
            if (!hints.has(s)) result.delete(s);
          }
        }
      }
    } else if (orGroupList != null) {
      result = new Set(result);

      for (const token of orGroupList) {
        const hints = token.calcStringHints(inflected);
        if (hints == null) return null;

        for (const s of hints) result.add(s);
      }
    }

    return result.size === 0 ? null : result;
  }

  private calcOwnPossibleStringValues(): Set<string> | null {
    if (this.getNegation() || !this.hasStringThatMustMatch()) {
      return null;
    }
    return this.textMatcher.getPossibleValues();
  }

  hasStringThatMustMatch(): boolean {
    return !this.isReferenceElement() && !this.hasFlag(MAY_BE_OMITTED_MASK) && this.getString() !== '';
  }

  toString(): string {
    let sb = '';
    if (this.getNegation()) {
      sb += '!';
    }
    sb += this.getString();
    const phraseName = this.getPhraseName();
    if (phraseName != null) {
      sb += ' {';
      sb += phraseName;
      sb += '}';
    }
    if (this.posToken != null) {
      sb += '/';
      sb += this.posToken.toString();
    }
    const chunkTag = this.getChunkTag();
    if (chunkTag != null) {
      sb += '/';
      sb += chunkTag.toString();
    }
    const exceptionList = this.getExceptionList();
    if (exceptionList.length !== 0) {
      sb += '/exceptions=';
      sb += '[' + exceptionList.map((e) => e.toString()).join(', ') + ']';
    }
    return sb;
  }

}

function isReadings(token: AnalyzedToken | AnalyzedTokenReadings): token is AnalyzedTokenReadings {
  return typeof (token as AnalyzedTokenReadings).getReadings === 'function';
}

export class PosToken {

  readonly posTag: string | null;
  readonly negation: boolean;
  readonly posPattern: StringMatcher | null;
  readonly posUnknown: boolean;

  constructor(posTag: string | null, regExp: boolean, negation: boolean, matcher?: StringMatcher | null) {
    this.posTag = posTag;
    this.negation = negation;
    // PosToken(posTag, regExp, negation) is PosToken(posTag, negation, regExp ? StringMatcher.regexp(posTag) : null)
    this.posPattern = matcher !== undefined ? matcher : regExp ? StringMatcher.regexp(posTag!) : null;
    this.posUnknown = this.posPattern != null ? this.posPattern.matches(PatternToken.UNKNOWN_TAG) : PatternToken.UNKNOWN_TAG === posTag;
  }

  toString(): string {
    return String(this.posTag);
  }
}

/** Fields that are null in most instances of PatternToken */
class RareFields {
  /**  List of exceptions that are valid for the current token and / or some next tokens. */
  currentAndNextExceptions: PatternToken[] = EMPTY_ARRAY;

  /** List of exceptions that are valid for a previous token. */
  previousExceptions: PatternToken[] = EMPTY_ARRAY;

  unificationFeatures: Map<string, string[]> | null = null;

  /** String ID of the phrase the element is in. **/
  phraseName: string | null = null;

  andGroupList: PatternToken[] | null = null;
  orGroupList: PatternToken[] | null = null;

  /** The reference to another element in the pattern. **/
  tokenReference: Match | null = null;

  chunkTag: ChunkTag | null = null;

  addException(pToken: PatternToken, scopePrevious: boolean): void {
    if (scopePrevious) {
      this.previousExceptions = [...this.previousExceptions, pToken];
    } else {
      this.currentAndNextExceptions = [...this.currentAndNextExceptions, pToken];
    }
  }
}
