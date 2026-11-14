// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/Match.java faithful
// The two createState overloads are one method: (synthesizer, token) or (synthesizer, tokens, index, next).
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import type { Synthesizer } from '../../synthesis/Synthesizer.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { MatchState } from './MatchState.ts';

/** Possible string case conversions. **/
export const CaseConversion = {
  NONE: 'NONE', STARTLOWER: 'STARTLOWER', STARTUPPER: 'STARTUPPER', ALLLOWER: 'ALLLOWER', ALLUPPER: 'ALLUPPER',
  PRESERVE: 'PRESERVE', FIRSTUPPER: 'FIRSTUPPER', NOTASHKEEL: 'NOTASHKEEL',
} as const;
export type CaseConversion = typeof CaseConversion[keyof typeof CaseConversion];

export const IncludeRange = {
  NONE: 'NONE', FOLLOWING: 'FOLLOWING', ALL: 'ALL',
} as const;
export type IncludeRange = typeof IncludeRange[keyof typeof IncludeRange];

/** Enum.valueOf for CaseConversion and IncludeRange. */
export function valueOf<T extends Record<string, string>>(e: T, name: string): T[keyof T] {
  if (!Object.prototype.hasOwnProperty.call(e, name)) throw new Error('IllegalArgumentException: No enum constant ' + name);
  return e[name] as T[keyof T];
}

/**
 * A {@link Match} is the configuration of an algorithm used to match {@link AnalyzedTokenReadings}s.
 * In XML, it's the {@code <match/>} element.
 * Use {@link #createState(Synthesizer, AnalyzedTokenReadings)} and {@link #createState(Synthesizer, AnalyzedTokenReadings[], int, int)}
 * to create a {@link MatchState} used to actually match {@link AnalyzedTokenReadings}.
 *
 * @author Marcin Miłkowski
 */
export class Match {

  private readonly posTag: string | null;
  private readonly suppressMisspelled: boolean;
  private readonly regexReplace: string | null;
  private readonly posTagReplace: string | null;
  private readonly caseConversionType: CaseConversion;
  private readonly includeSkipped: IncludeRange;
  // Pattern used to define parts of the matched token:
  private readonly pRegexMatch: Pattern | null;
  // True if this match element is used for formatting POS token:
  private readonly setPos: boolean;

  private postagRegexp: boolean;
  // True if this match element formats a statically defined lemma which is
  // enclosed by the element, e.g., <match...>word</match>:
  private staticLemma = false;
  private lemma: string | null = null;
  private tokenRef = 0;
  // Pattern used to define parts of the matched POS token:
  private pPosRegexMatch: Pattern | null = null;
  // True when the match is not in the suggestion:
  private inMessageOnly = false;

  constructor(posTag: string | null, posTagReplace: string | null,
      postagRegexp: boolean, regexMatch: string | null,
      regexReplace: string | null, caseConversionType: CaseConversion,
      setPOS: boolean,
      suppressMisspelled: boolean,
      includeSkipped: IncludeRange) {
    this.posTag = posTag;
    this.postagRegexp = postagRegexp;
    this.caseConversionType = caseConversionType;
    this.pRegexMatch = regexMatch != null ? Pattern.compile(regexMatch) : null;
    if (postagRegexp && posTag != null) {
      this.pPosRegexMatch = Pattern.compile(posTag);
    }
    this.regexReplace = regexReplace;
    this.posTagReplace = posTagReplace;
    this.setPos = setPOS;
    this.includeSkipped = includeSkipped;
    this.suppressMisspelled = suppressMisspelled;
  }

  /**
   * Creates a state used for actually matching a token.
   * @since 2.3
   */
  createState(synthesizer: Synthesizer | null, token: AnalyzedTokenReadings | AnalyzedTokenReadings[], index?: number, next?: number): MatchState {
    const state = new MatchState(this, synthesizer);
    if (Array.isArray(token)) {
      state.setToken(token, index!, next!);
    } else {
      state.setToken(token);
    }
    return state;
  }

  /**
   * Checks if the Match element is used for setting the part of speech: {@code setpos="yes"} in XML.
   * @return True if Match sets POS.
   */
  setsPos(): boolean {
    return this.setPos;
  }

  /**
   * Checks if the Match element uses regexp-based form of the POS tag.
   * @return True if regexp is used in POS.
   */
  posRegExp(): boolean {
    return this.postagRegexp;
  }

  /**
   * Sets a base form (lemma) that will be formatted, or synthesized, using the
   * specified POS regular expressions.
   * @param lemmaString String that specifies the base form.
   */
  setLemmaString(lemmaString: string | null): void {
    if (!StringTools.isEmpty(lemmaString)) {
      this.lemma = lemmaString;
      this.staticLemma = true;
      this.postagRegexp = true;
      if (this.posTag != null) {
        this.pPosRegexMatch = Pattern.compile(this.posTag);
      }
    }
  }

  /** @since 2.3 */
  getLemma(): string | null {
    return this.lemma;
  }

  /** @since 2.3 */
  isStaticLemma(): boolean {
    return this.staticLemma;
  }

  /**
   * Used to tell whether the Match class will spell-check the result so
   * that misspelled suggestions are suppressed.
   * @return True if this is so.
   */
  checksSpelling(): boolean {
    return this.suppressMisspelled;
  }

  /**
   * Sets the token number referenced by the match.
   * @param i Token number.
   */
  setTokenRef(i: number): void {
    this.tokenRef = i;
  }

  /**
   * Gets the token number referenced by the match.
   * @return token number.
   */
  getTokenRef(): number {
    return this.tokenRef;
  }

  /**
   * Used to let LT know that it should change the case of the match.
   * @return true if match converts the case of the token.
   */
  convertsCase(): boolean {
    return this.caseConversionType !== CaseConversion.NONE;
  }

  /** @since 2.3 */
  getCaseConversionType(): CaseConversion {
    return this.caseConversionType;
  }

  setInMessageOnly(inMessageOnly: boolean): void {
    this.inMessageOnly = inMessageOnly;
  }

  isInMessageOnly(): boolean {
    return this.inMessageOnly;
  }

  /** @since 2.3 */
  getPosTag(): string | null {
    return this.posTag;
  }

  /** @since 2.3 */
  getRegexMatch(): Pattern | null {
    return this.pRegexMatch;
  }

  /** @since 2.3 */
  getRegexReplace(): string | null {
    return this.regexReplace;
  }

  /** @since 2.3 */
  getPosRegexMatch(): Pattern | null {
    return this.pPosRegexMatch;
  }

  /** @since 2.3 */
  isPostagRegexp(): boolean {
    return this.postagRegexp;
  }

  /** @since 2.3 */
  getPosTagReplace(): string | null {
    return this.posTagReplace;
  }

  /** @since 2.3 */
  getIncludeSkipped(): IncludeRange {
    return this.includeSkipped;
  }

}
