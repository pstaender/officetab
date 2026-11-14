// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternTokenBuilder.java faithful
// The field token is _token (it is named like the method). The two private pos overloads are one method with an optional exception regex.
import { PatternToken, PosToken } from './PatternToken.ts';
import { Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';

/**
 * Helper to build {@link PatternToken}s.
 * @since 3.1
 */
export class PatternTokenBuilder {

  private _token: string | null = null;
  private posTag: string | null = null;
  private marker = true;
  private _matchInflectedForms = false;
  private caseSensitive = false;
  private regexp = false;
  private negation = false;
  private isWhiteSpaceSet = false;
  private isWhiteSpaceBefore = false;
  private minOccurrence = 1;
  private maxOccurrence = 1;
  private skip = 0;
  private tokenException: string | null = null;

  /**
   * Add a case-insensitive token.
   */
  token(token: string): PatternTokenBuilder {
    this._token = Objects_requireNonNull(token);
    return this;
  }

  /**
   * Add a case-sensitive token.
   * @since 3.3
   */
  csToken(token: string): PatternTokenBuilder {
    this._token = Objects_requireNonNull(token);
    this.caseSensitive = true;
    return this;
  }

  tokenRegex(token: string): PatternTokenBuilder {
    this._token = Objects_requireNonNull(token);
    this.regexp = true;
    return this;
  }

  csTokenRegex(token: string): PatternTokenBuilder {
    this._token = Objects_requireNonNull(token);
    this.regexp = true;
    this.caseSensitive = true;
    return this;
  }

  pos(posTag: string, regexp = false, tokenExceptionRegex?: string): PatternTokenBuilder {
    this.posTag = Objects_requireNonNull(posTag);
    this.regexp = regexp;
    if (tokenExceptionRegex !== undefined) {
      this.tokenException = tokenExceptionRegex;
    }
    return this;
  }

  posRegex(posTag: string): PatternTokenBuilder {
    return this.pos(posTag, true);
  }

  /** @since 4.9 */
  min(val: number): PatternTokenBuilder {
    if (val < 0) {
      throw new Error('IllegalArgumentException: minOccurrence must be >= 0: ' + this.minOccurrence);
    }
    this.minOccurrence = val;
    return this;
  }

  /** @since 4.9 */
  max(val: number): PatternTokenBuilder {
    this.maxOccurrence = val;
    return this;
  }

  /**
   * Corresponds to {@code <marker>...</marker>} in XML. Note that there
   * can be more tokens with a mark, but then must all be adjacent.
   * @since 4.6
   */
  mark(isMarked: boolean): PatternTokenBuilder {
    this.marker = isMarked;
    return this;
  }

  posRegexWithStringException(posTag: string, tokenExceptionRegex: string): PatternTokenBuilder {
    return this.pos(posTag, true, tokenExceptionRegex);
  }

  /** @since 3.3 */
  negate(): PatternTokenBuilder {
    this.negation = true;
    return this;
  }

  /** @since 4.0 */
  setSkip(skip: number): PatternTokenBuilder {
    this.skip = skip;
    return this;
  }

  /** @since 4.4 */
  setIsWhiteSpaceBefore(whiteSpaceBefore: boolean): PatternTokenBuilder {
    this.isWhiteSpaceBefore = whiteSpaceBefore;
    this.isWhiteSpaceSet = true;
    return this;
  }

  /**
   * Also match inflected forms of the given word - note this will only work when the
   * given token actually is a baseform.
   * @since 3.8
   */
  matchInflectedForms(): PatternTokenBuilder {
    this._matchInflectedForms = true;
    return this;
  }

  build(): PatternToken {
    let patternToken: PatternToken;
    patternToken = new PatternToken(this._token, this.caseSensitive, this.regexp, this._matchInflectedForms);
    if (this.posTag != null) {
      patternToken.setPosToken(new PosToken(this.posTag, this.regexp, false));
    }
    if (this.isWhiteSpaceSet) {
      patternToken.setWhitespaceBefore(this.isWhiteSpaceBefore);
    }
    if (this.maxOccurrence < this.minOccurrence) {
      throw new Error('IllegalArgumentException: minOccurrence must <= maxOccurrence: minOccurrence ' + this.minOccurrence + ', maxOccurrence ' + this.maxOccurrence);
    }
    if (this.tokenException != null) {
      patternToken.setStringPosException(this.tokenException, true, false, false, false, false, null, false, false, false);
    }
    patternToken.setMinOccurrence(this.minOccurrence);
    patternToken.setMaxOccurrence(this.maxOccurrence);
    patternToken.setNegation(this.negation);
    patternToken.setSkipNext(this.skip);
    patternToken.setInsideMarker(this.marker);
    return patternToken;
  }
}
