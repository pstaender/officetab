// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/Unifier.java faithful
// The equivalence types are keyed by EquivalenceTypeLocator.key(). The two isUnified overloads
// are one method with isMatched defaulting to true. Java's HashMap iteration order (of the
// unification features) is insertion order here.
import type { AnalyzedToken } from '../../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import { EquivalenceTypeLocator } from './EquivalenceTypeLocator.ts';
import type { PatternToken } from './PatternToken.ts';

const UNIFY_IGNORE = 'unify-ignore';

/**
 * Implements unification of features over tokens.
 *
 * @author Marcin Milkowski
 */
export class Unifier {

  private readonly tokSequence: AnalyzedTokenReadings[] = [];

  /**
   * List of all equivalences matched per tokens in the sequence, kept exactly
   * in sync with the list in tokSequence, so that a reading 2 of token 1 has its
   * equivalence map addressable as tokSequenceEquivalences.get(1).get(2).
   */
  private readonly tokSequenceEquivalences: Map<string, Set<string>>[][] = [];

  /**
   * A Map for storing the equivalence types for features. Features are
   * specified as Strings, and map into types defined as maps from Strings to
   * Elements.
   */
  private readonly equivalenceTypes: ReadonlyMap<string, PatternToken>;

  /**
   * A Map that stores all possible equivalence types listed for features.
   */
  private readonly equivalenceFeatures: ReadonlyMap<string, string[]>;

  /**
   * Map of sets of matched equivalences in the unified sequence.
   */
  private readonly equivalencesMatched: Map<string, Set<string>>[] = [];

  private allFeatsIn = false;
  private tokCnt: number;
  private readingsCounter: number;

  // Marks found interpretations in subsequent tokens:
  private featuresFound: boolean[] = [];

  // For checking the current token:
  private tmpFeaturesFound: boolean[] = [];

  // Maps that store equivalences to be removed or kept after every next token has been analyzed:
  private readonly equivalencesToBeKept = new Map<string, Set<string>>();

  // stores uFeatures to keep the same signature of some methods...:
  private unificationFeats: Map<string, string[]> | null = null;

  private inUnification = false;
  private uniMatched = false;
  private uniAllMatched = false;

  /**
   * Instantiates the unifier.
   */
  constructor(equivalenceTypes: ReadonlyMap<string, PatternToken>, equivalenceFeatures: ReadonlyMap<string, string[]>) {
    this.tokCnt = 0;
    this.readingsCounter = 1;
    this.equivalenceTypes = equivalenceTypes;
    this.equivalenceFeatures = equivalenceFeatures;
  }

  /**
   * Tests if a token has shared features with other tokens.
   *
   * @param aToken token to be tested
   * @param uFeatures features to be tested
   * @return true if the token shares this type of feature with other tokens
   */
  protected isSatisfied(aToken: AnalyzedToken,
      uFeatures: Map<string, string[]> | null): boolean {

    if (this.allFeatsIn && this.equivalencesMatched.length === 0) {
      return false;
    }
    if (uFeatures == null) {
      throw new Error('RuntimeException: isSatisfied called without features being set');
    }
    this.unificationFeats = uFeatures;

    let unified = true;
    if (this.allFeatsIn) {
      unified = this.checkNext(aToken, uFeatures);
    } else {
      while (this.equivalencesMatched.length <= this.tokCnt) {
        this.equivalencesMatched.push(new Map());
      }
      for (const [featKey, featValue] of uFeatures) {
        let types: string[] | null | undefined = featValue;
        if (types == null || types.length === 0) {
          types = this.equivalenceFeatures.get(featKey);
        }
        for (const typeName of types!) {
          const testElem = this.equivalenceTypes
              .get(new EquivalenceTypeLocator(featKey, typeName).key());
          if (testElem == null) {
            return false;
          }
          if (testElem.isMatched(aToken)) {
            computeIfAbsent(this.equivalencesMatched[this.tokCnt]!, featKey).add(typeName);
          }
        }
        unified = this.equivalencesMatched[this.tokCnt]!.has(featKey);
        if (!unified) {
          this.equivalencesMatched.splice(this.tokCnt, 1);
          break;
        }
      }
      if (unified) {
        if (this.tokCnt === 0 || this.tokSequence.length === 0) {
          this.tokSequence.push(new AnalyzedTokenReadings(aToken, 0));
          const equivList: Map<string, Set<string>>[] = [];
          equivList.push(this.equivalencesMatched[this.tokCnt]!);
          this.tokSequenceEquivalences.push(equivList);
        } else {
          this.tokSequence[0]!.addReading(aToken, '');
          this.tokSequenceEquivalences[0]!.push(this.equivalencesMatched[this.tokCnt]!);
        }
        this.tokCnt++;
      }
    }
    return unified;
  }

  private checkNext(aToken: AnalyzedToken,
                    uFeatures: Map<string, string[]>): boolean {
    let anyFeatUnified = false;
    const tokenFeaturesFound: boolean[] = [...this.tmpFeaturesFound];
    const equivalencesMatchedHere = new Map<string, Set<string>>();
    if (this.allFeatsIn) {
      for (let i = 0; i < this.tokCnt; i++) {
        let allFeatsUnified = true;
        for (const [featKey, featValue] of uFeatures) {
          let featUnified = false;
          let types: string[] | null | undefined = featValue;
          if (types == null || types.length === 0) {
            types = this.equivalenceFeatures.get(featKey);
          }
          for (const typeName of types!) {
            const set = this.equivalencesMatched[i]!.get(featKey);
            if (set != null && set.has(typeName)) {
              const testElem = this.equivalenceTypes.get(new EquivalenceTypeLocator(featKey, typeName).key())!;
              const matched = testElem.isMatched(aToken);
              featUnified = featUnified || matched;
              //Stores equivalences to be kept
              if (matched) {
                computeIfAbsent(this.equivalencesToBeKept, featKey).add(typeName);
                computeIfAbsent(equivalencesMatchedHere, featKey).add(typeName);
              }
            }
          }
          allFeatsUnified = allFeatsUnified && featUnified;
        }
        tokenFeaturesFound[i] = tokenFeaturesFound[i]! || allFeatsUnified;
        anyFeatUnified = anyFeatUnified || allFeatsUnified;
      }
      if (anyFeatUnified) {
        if (this.tokSequence.length === this.readingsCounter) {
          this.tokSequence.push(new AnalyzedTokenReadings(aToken, 0));
          const equivList: Map<string, Set<string>>[] = [];
          equivList.push(equivalencesMatchedHere);
          this.tokSequenceEquivalences.push(equivList);
        } else {
          if (this.readingsCounter < this.tokSequence.length) {
            this.tokSequence[this.readingsCounter]!.addReading(aToken, '');
            this.tokSequenceEquivalences[this.readingsCounter]!.push(equivalencesMatchedHere);
          } else {
            anyFeatUnified = false;
          }
        }
        this.tmpFeaturesFound = tokenFeaturesFound;
      }
    }
    return anyFeatUnified;
  }

  /**
   * Call after every complete token (AnalyzedTokenReadings) checked.
   */
  startNextToken(): void {
    this.featuresFound = [...this.tmpFeaturesFound];
    this.readingsCounter++;
    // Removes features
    for (let j = 0; j < this.tokSequence.length; j++) {
      for (let i = 0; i < this.tokSequenceEquivalences[j]!.length; i++) {
        for (const featKey of this.equivalenceFeatures.keys()) {
          if (UNIFY_IGNORE !== featKey) {
            const equivalences = this.tokSequenceEquivalences[j]![i]!;
            if (equivalences.has(featKey)) {
              if (this.equivalencesToBeKept.has(featKey)) {
                const toKeep = this.equivalencesToBeKept.get(featKey)!;
                const set = equivalences.get(featKey)!;
                for (const s of [...set]) {
                  if (!toKeep.has(s)) set.delete(s);
                }
              } else {
                equivalences.delete(featKey);
              }
            } else {
              equivalences.delete(featKey);
            }
          }
        }
      }
    }
    this.equivalencesToBeKept.clear();
  }

  /**
   * Starts testing only those equivalences that were previously matched.
   */
  startUnify(): void {
    this.allFeatsIn = true;
    for (let i = 0; i < this.tokCnt; i++) {
      this.featuresFound.push(false);
    }
    this.tmpFeaturesFound = [...this.featuresFound];
  }

  /**
   * Make sure that we really matched all the required features of the unification.
   * @param uFeatures Features to be checked
   * @return True if the token sequence has been found.
   * @since 2.5
   */
  getFinalUnificationValue(uFeatures: Map<string, string[]>): boolean {
    let tokUnified = 0;
    for (let j = 0; j < this.tokSequence.length; j++) {
      let unifiedTokensFound = false; // assume that nothing has been found
      for (let i = 0; i < this.tokSequenceEquivalences[j]!.length; i++) {
        let featUnified = 0;
        if (this.tokSequenceEquivalences[j]![i]!.has(UNIFY_IGNORE)) {
          if (i === 0) {
            tokUnified++;
          }
          unifiedTokensFound = true;
          continue;
        } else {
          for (const featKey of uFeatures.keys()) {
            const set = this.tokSequenceEquivalences[j]![i]!.get(featKey);
            if (set != null && set.size === 0) {
              featUnified = 0;
            } else {
              featUnified++;
            }
            if (featUnified === this.unificationFeats!.size && tokUnified <= j) {
              tokUnified++;
              unifiedTokensFound = true;
              break;
            }
          }
        }

      }
      if (!unifiedTokensFound) {
        return false;
      }
    }
    if (tokUnified === this.tokSequence.length) {
      return true;
    }
    return false;
  }

  /**
   * Resets after use of unification. Required.
   */
  reset(): void {
    this.equivalencesMatched.length = 0;
    this.allFeatsIn = false;
    this.tokCnt = 0;
    this.featuresFound.length = 0;
    this.tmpFeaturesFound.length = 0;
    this.tokSequence.length = 0;
    this.tokSequenceEquivalences.length = 0;
    this.readingsCounter = 1;
    this.uniMatched = false;
    this.uniAllMatched = false;
    this.inUnification = false;
  }

  /**
   * Gets a full sequence of filtered tokens.
   * @return Array of AnalyzedTokenReadings that match equivalence relation
   *         defined for features tested, or {@code null}
   */
  getUnifiedTokens(): AnalyzedTokenReadings[] | null {
    if (this.tokSequence.length === 0) {
      return null;
    }
    const uTokens: AnalyzedTokenReadings[] = [];
    for (let j = 0; j < this.tokSequence.length; j++) {
      let unifiedTokensFound = false; // assume that nothing has been found
      for (let i = 0; i < this.tokSequenceEquivalences[j]!.length; i++) {
        let featUnified = 0;
        if (this.tokSequenceEquivalences[j]![i]!.has(UNIFY_IGNORE)) {
          this.addTokenToSequence(uTokens, this.tokSequence[j]!.getAnalyzedToken(i), j);
          unifiedTokensFound = true;
        } else {
          for (const featKey of this.unificationFeats!.keys()) {
            const set = this.tokSequenceEquivalences[j]![i]!.get(featKey);
            if (set != null && set.size === 0) {
              featUnified = 0;
            } else {
              featUnified++;
            }
            if (featUnified === this.unificationFeats!.size) {
              this.addTokenToSequence(uTokens, this.tokSequence[j]!.getAnalyzedToken(i), j);
              unifiedTokensFound = true;
            }
          }
        }
      }
      if (!unifiedTokensFound) {
        return null;
      }
    }
    return uTokens;
  }

  private addTokenToSequence(tokenSequence: AnalyzedTokenReadings[], token: AnalyzedToken, pos: number): void {
    if (tokenSequence.length <= pos || tokenSequence.length === 0) {
      const tmpATR = new AnalyzedTokenReadings(token, 0);
      tokenSequence.push(tmpATR);
    } else {
      tokenSequence[pos]!.addReading(token, '');
    }
  }

  /**
   * Tests if the token sequence is unified.
   *
   * <p>Usage note: to test if the sequence of tokens is unified (i.e.,
   * shares a group of features, such as the same gender, number,
   * grammatical case etc.), you need to test all tokens but the last one
   * in the following way: call {@code isUnified()} for every reading of a token,
   * and set {@code lastReading} to {@code true}. For the last token, check the
   * truth value returned by this method. In previous cases, it may actually be
   * discarded before the final check. See {@link AbstractPatternRule} for
   * an example.</p>
   *
   * To make it work in XML rules, the Elements built based on {@code <token>}s inside
   * the unify block have to be processed in a special way: namely the last Element has to be
   * marked as the last one (by using {@link PatternToken#setLastInUnification}).
   *
   * @param matchToken {@link AnalyzedToken} token to unify
   * @param lastReading true when the matchToken is the last reading in the {@link AnalyzedTokenReadings}
   * @param isMatched true if the reading matches the element in the pattern rule,
   *          otherwise the reading is not considered in the unification
   * @return true if the tokens in the sequence are unified
   */
  isUnified(matchToken: AnalyzedToken,
      uFeatures: Map<string, string[]> | null, lastReading: boolean, isMatched = true): boolean {
    if (this.inUnification) {
      if (isMatched) {
        const satisfied = this.isSatisfied(matchToken, uFeatures);
        this.uniMatched = this.uniMatched || satisfied;
      }
      this.uniAllMatched = this.uniMatched;

      if (lastReading) {
        this.startNextToken();
        this.uniMatched = false;
      }
      return this.uniAllMatched && this.getFinalUnificationValue(uFeatures!);
    } else {
      if (isMatched) {
        this.isSatisfied(matchToken, uFeatures);
      }
    }
    if (lastReading) {
      this.inUnification = true;
      this.uniMatched = false;
      this.startUnify();
    }
    return true;
  }

  /**
   * Used to add neutral elements ({@link AnalyzedTokenReadings} to the
   * unified sequence. Useful if the sequence contains punctuation or connectives, for example.
   * @param analyzedTokenReadings A neutral element to be added.
   * @since 2.5
   */
  addNeutralElement(analyzedTokenReadings: AnalyzedTokenReadings): void {
    this.tokSequence.push(analyzedTokenReadings);
    const tokEquivs: Map<string, Set<string>>[] = [];
    const map = new Map<string, Set<string>>();
    map.set(UNIFY_IGNORE, new Set());
    for (let i = 0; i < analyzedTokenReadings.getReadingsLength(); i++) {
      tokEquivs.push(map);
    }
    this.tokSequenceEquivalences.push(tokEquivs);
    this.readingsCounter++;
  }

  /**
   * Used for getting a unified sequence in case when simple test method
   * {@link #isUnified(AnalyzedToken, Map, boolean)}} was used.
   * @return An array of {@link AnalyzedTokenReadings} or {@code null} when not in unification
   */
  getFinalUnified(): AnalyzedTokenReadings[] | null {
    if (this.inUnification) {
      return this.getUnifiedTokens();
    }
    return null;
  }
}

/** Map.computeIfAbsent(key, __ -> new HashSet<>()) */
function computeIfAbsent(map: Map<string, Set<string>>, key: string): Set<string> {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}
