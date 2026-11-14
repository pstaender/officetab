// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/AnalyzedToken.java faithful
// String interning is left out (JavaScript strings are values); hashCode is not needed.
import { JLanguageTool } from './JLanguageTool.ts';

/**
 * A word (or punctuation, or whitespace) and its analysis (part-of-speech tag, lemma).
 */
export class AnalyzedToken {
  private readonly token: string;
  private readonly posTag: string | null;
  private readonly lemma: string | null;
  private readonly lemmaOrToken: string; // used only for matching with Elements

  private _isWhitespaceBefore = false;
  private hasNoPOSTag: boolean;

  constructor(token: string, posTag: string | null, lemma: string | null) {
    if (token == null) throw new TypeError('token cannot be null');
    this.token = token;
    this.posTag = posTag != null ? posTag.trim() : null;
    this.lemma = lemma ?? null;
    if (this.lemma == null) {
      this.lemmaOrToken = this.token;
    } else {
      this.lemmaOrToken = this.lemma;
    }
    this.hasNoPOSTag = (posTag == null
        || JLanguageTool.SENTENCE_END_TAGNAME === posTag
        || JLanguageTool.PARAGRAPH_END_TAGNAME === posTag);
  }

  getToken(): string { return this.token; }

  /** @return the token's part-of-speech tag or {@code null} */
  getPOSTag(): string | null { return this.posTag; }

  /** @return the token's lemma or {@code null} */
  getLemma(): string | null { return this.lemma; }

  setWhitespaceBefore(whitespaceBefore: boolean): void { this._isWhitespaceBefore = whitespaceBefore; }

  isWhitespaceBefore(): boolean { return this._isWhitespaceBefore; }

  /**
   * @param an AnalyzedToken to test
   * @return true if all of the non-null values (lemma, POS, token) of AnalyzedToken match this token
   * @since 1.5
   */
  matches(an: AnalyzedToken): boolean {
    if (this.equals(an)) {
      return true;
    }
    //empty tokens never match anything
    if (an.getToken() === '' && an.getLemma() == null
        && an.getPOSTag() == null) {
      return false;
    }
    let found = true;
    if (an.getToken() !== '') { //token cannot be null
      found = an.getToken() === this.token;
    }
    if (an.getLemma() != null) {
      found = found && an.getLemma() === this.lemma;
    }
    if (an.getPOSTag() != null) {
      found = found && an.getPOSTag() === this.posTag;
    }
    return found;
  }

  /**
   * @return true if the AnalyzedToken has no real POS tag (= is not null or a special tag)
   * @since 1.5
   */
  hasNoTag(): boolean { return this.hasNoPOSTag; }

  /**
   * If other readings of the token have real POS tags,
   * you can set the flag here that they do, so that the
   * test in the Element class would be correct for all
   * cases.
   * @since 1.5
   */
  setNoPOSTag(noTag: boolean): void { this.hasNoPOSTag = noTag; }

  toString(): string { return `${this.lemmaOrToken}/${this.posTag}`; }

  equals(o: unknown): boolean {
    if (o == null) return false;
    if (o === this) return true;
    if (!(o instanceof AnalyzedToken)) return false;
    return this.token === o.token
        && this.posTag === o.posTag
        && this.lemma === o.lemma
        && this._isWhitespaceBefore === o._isWhitespaceBefore;
  }
}
