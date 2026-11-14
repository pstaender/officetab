// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/multitoken/MultitokenSpeller.java faithful
// The two getSuggestions overloads are one (areTokensAcceptedBySpeller defaults to false). The
// Guava cache (maximum size 2000) is a Map that is cleared when full. The files are read with
// getFromResourceDirAsLines (BufferedReader.readLine over the UTF-8 stream). Apache Commons'
// LevenshteinDistance, StringUtils.split and substringBefore are local functions; Java floats
// are rounded with Math.fround. HashMap iteration order: Java iterates the candidates of a first
// character in hash order, here in insertion order (file order); this only matters when more
// than two candidates have distance 0 (the loop stops after two).
import { JLanguageTool } from '../../../JLanguageTool.ts';
import type { Language } from '../../../Language.ts';
import type { SpellingCheckRule } from '../SpellingCheckRule.ts';
import { WeightedSuggestion } from '../morfologik/WeightedSuggestion.ts';
import { StringTools } from '../../../tools/StringTools.ts';
import { StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const MAX_LENGTH_DIFF = 3;
const WHITESPACE_AND_SEP = Pattern.compile('\\p{Zs}+');

const CACHE_MAXIMUM_SIZE = 2000;

export class MultitokenSpeller {

  private readonly spellingRule: SpellingCheckRule;
  private readonly language: Language;

  private suggestionsMap: Map<string, Map<string, string[]>> | null = null;
  private suggestionsMapNoSpacesKey!: Map<string, string[]>;

  /*
   * Ultra-naive speller that provides spelling suggestions for multitoken words from a list of words.
   * The fastest method, so far.
   */

  constructor(lang: Language, filePaths: string[]) {
    this.language = lang;
    this.spellingRule = lang.getDefaultSpellingRule() as SpellingCheckRule;
    this.initMultitokenSpeller(filePaths);
  }

  private readonly suggestionsCache = new Map<string, string[]>();

  getSuggestions(originalWord: string, areTokensAcceptedBySpeller = false): string[] {
    originalWord = WHITESPACE_AND_SEP.matcher(originalWord).replaceAll(' ');
    const normalizedWord = originalWord;
    const accepted = areTokensAcceptedBySpeller;
    try {
      let suggestions = this.suggestionsCache.get(normalizedWord);
      if (suggestions === undefined) {
        suggestions = this.computeSuggestions(normalizedWord, accepted);
        if (this.suggestionsCache.size >= CACHE_MAXIMUM_SIZE) {
          this.suggestionsCache.clear();
        }
        this.suggestionsCache.set(normalizedWord, suggestions);
      }
      return suggestions;
    } catch (e) {
      throw new Error('RuntimeException: Error generating suggestions for: ' + normalizedWord, { cause: e });
    }
  }

  private computeSuggestions(originalWord: string, areTokensAcceptedBySpeller: boolean): string[] {
    const word = originalWord.replaceAll('- ', '-').replaceAll(' -', '-');
    if (this.discardRunOnWords(word)) {
     return [];
    }
    const normalizedWord = MultitokenSpeller.getNormalizeKey(word);
    const weightedCandidates: WeightedSuggestion[] = [];
    // try searching the key
    const normalizedWordNoSpaces = normalizedWord.replaceAll(' ', '');
    if (this.suggestionsMapNoSpacesKey.has(normalizedWordNoSpaces)) {
      const candidates = this.suggestionsMapNoSpacesKey.get(normalizedWordNoSpaces)!;
      if (this.stopSearching(candidates, originalWord)) {
        return [];
      }
      for (const candidate of candidates) {
        weightedCandidates.push(new WeightedSuggestion(candidate, 0));
      }
    }
    const firstChar = normalizedWord.charAt(0);
    if (weightedCandidates.length === 0 && this.suggestionsMap!.has(firstChar) ) {
      for (const [normalizedCandidate, candidates] of this.suggestionsMap!.get(firstChar)!) {
        if (this.stopSearching(candidates, originalWord)) {
          return [];
        }
        if (Math.abs(normalizedCandidate.length - word.length) > MAX_LENGTH_DIFF) {
          continue;
        }
        const candidateParts = MultitokenSpeller.splitBySpace(normalizedCandidate);
        const wordParts = MultitokenSpeller.splitBySpace(normalizedWord);
        const distances = this.distancesPerWord(candidateParts, wordParts, normalizedCandidate, normalizedWord);
        const totalDistance = distances.reduce((a, b) => a + b, 0);
        if (totalDistance < 1) {
          for (const candidate of candidates) {
            weightedCandidates.push(new WeightedSuggestion(candidate, 0));
          }
          // "continue" allows several candidates with different casing
          if ((weightedCandidates.length as number) === 2) {
            break;
          }
          continue;
        }
        // for very short candidates, allow only distance=0 (casing and diacritics differences)
        if (normalizedCandidate.length < 7) {
          continue;
        }
        let exceedsMaxDistancePerToken = false;
        for (let i = 0; i < distances.length; i++) {
          // usually 2, but 1 for short words
          const maxDistance = (wordParts[i]!.length > 5 && candidateParts[i]!.length > 4 ? 2 : 1);
          if (distances[i]! > maxDistance) {
            exceedsMaxDistancePerToken = true;
            break;
          }
        }
        if (exceedsMaxDistancePerToken) {
          continue;
        }
        if (totalDistance <= this.maxEditDistance(normalizedCandidate, normalizedWord)) {
          for (const candidate of candidates) {
            weightedCandidates.push(new WeightedSuggestion(candidate, totalDistance));
          }
        }
      }
    }
    for (const additionalSuggestion of this.getAdditionalSuggestions(word)) {
      if (!(additionalSuggestion.getWord() === originalWord)) {
        weightedCandidates.push(additionalSuggestion);
      } else {
        return [];
      }
    }
    if (weightedCandidates.length === 0) {
      return [];
    }
    weightedCandidates.sort((a, b) => a.compareTo(b));
    const results: string[] = [];
    const weightFirstCandidate = weightedCandidates[0]!.getWeight();
    if (areTokensAcceptedBySpeller && weightedCandidates[0]!.getWord().toUpperCase() === originalWord) {
      // don't correct all-upper case words accepted by the speller
      return [];
    }
    if (areTokensAcceptedBySpeller && weightFirstCandidate > 1) {
      return [];
    }
    for (const weightedCandidate of weightedCandidates) {
      // keep only cadidates with the distance of the first candidate
      if (weightedCandidate.getWeight() - weightFirstCandidate < 1
        && !results.includes(weightedCandidate.getWord())) {
        results.push(weightedCandidate.getWord());
      }
    }
    return results;
  }

  private stopSearching(candidates: string[], originalWord: string): boolean {
    for (const candidate of candidates) {
      if (this.isException(originalWord, candidate)) {
        return true;
      }
      if (candidate === originalWord) {
        return true;
      }
    }
    for (const candidate of candidates) {
      if (candidate === candidate.toLowerCase()
        && StringTools.convertToTitleCaseIteratingChars(candidate) === originalWord) {
        return true;
      }
    }
    return false;
  }

  private maxEditDistance(normalizedCandidate: string, normalizedWord: string): number {
    const totalLength = normalizedWord.length;
    const correctLength = totalLength - this.numberOfCorrectChars(normalizedCandidate, normalizedWord);
    const firstCharWrong = this.firstCharacterDistances(normalizedCandidate, normalizedWord).reduce((a, b) => Math.fround(a + b), 0);
    if (correctLength <= 7) {
      return Math.trunc(Math.fround(2 - firstCharWrong));
    }
    return Math.trunc(2 + 0.25 * (correctLength - 7) - 0.6 * firstCharWrong);
  }

  private distancesPerWord(parts1: string[], parts2: string[], s1: string, s2: string): number[] {
    const distances: number[] = [];
    if (parts1.length === parts2.length && parts1.length > 1) {
      for (let i = 0; i < parts1.length; i++) {
        distances.push(this.levenshteinDistance(parts1[i]!, parts2[i]!));
      }
    } else {
      distances.push(this.levenshteinDistance(s1, s2));
    }
    return distances;
  }

  private firstCharacterDistances(s1: string, s2: string): number[] {
    const distances: number[] = [];
    const parts1 = MultitokenSpeller.splitBySpace(s1);
    const parts2 = MultitokenSpeller.splitBySpace(s2);
    // for now, only phrase with two tokens
    if (parts1.length === parts2.length && parts1.length === 2) {
      for (let i = 0; i < parts1.length; i++) {
        distances.push(this.charDistance(parts1[i]!.charAt(0), parts2[i]!.charAt(0)));
      }
    } else {
      distances.push(0);
    }
    return distances;
  }

  private charDistance(a: string, b: string): number {
    //TODO: full keyboard distances
    if (a === b) {
      return 0;
    }
    if (a === 's' && b === 'z' || a === 'z' && b === 's') {
      return Math.fround(0.2);
    }
    if (a === 'b' && b === 'v' || a === 'v' && b === 'b') {
      return Math.fround(0.2);
    }
    if (a === 'i' && b === 'y' || a === 'y' && b === 'i') {
      return 0;
    }
    return 1;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    if (s1.replaceAll(' ', '') === s2.replaceAll(' ', '')) {
      return 0;
    }
    let distance = LevenshteinDistance_apply(s1, s2);
    const ns1 = this.normalizeSimilarChars(s1);
    const ns2 = this.normalizeSimilarChars(s2);
    if (!(s1 === ns1) || !(s2 === ns2)) {
      distance = Math.min(distance, LevenshteinDistance_apply(ns1, ns2));
    }
    const anagram = StringTools.isAnagram(s1, s2);
    // consider transpositions without having a Damerau-Levenshtein method
    if (distance > 1 && anagram) {
      distance--;
    }
    if (distance > 0 && s1.length === s2.length && anagram) {
      distance = 1;
    }
    return distance;
  }

  private normalizeSimilarChars(s: string): string {
    return s.replaceAll('y', 'i').replaceAll('ko', 'co').replaceAll('ka', 'ca');
  }

  private numberOfCorrectChars(s1: string, s2: string): number {
    const parts1 = JavaSplitSpace(s1);
    const parts2 = JavaSplitSpace(s2);
    let correctTokens = 0;
    if (parts1.length === parts2.length && parts1.length > 1) {
      for (let i = 0; i < parts1.length; i++) {
        if (parts1[i] === parts2[i]) {
          correctTokens += parts1[i]!.length;
        }
      }
    }
    return correctTokens;
  }

  private initMultitokenSpeller(filePaths: string[]): void {
    if (this.suggestionsMap != null) {
      return;
    }
    this.suggestionsMap = new Map();
    this.suggestionsMapNoSpacesKey = new Map();
    for (const filePath of filePaths) {
      for (const lineOriginal of JLanguageTool.getDataBroker().getFromResourceDirAsLines(filePath)) {
        if (lineOriginal.length === 0 || lineOriginal.charAt(0) === '#') { // ignore comments
          continue;
        }
        for (const line of this.language.prepareLineForSpeller(StringTrim(StringUtils_substringBefore(lineOriginal, '#')))) {
          if (line.length === 0) {
            continue;
          }
          const normalizedKey = MultitokenSpeller.getNormalizeKey(line);
          if (!normalizedKey.includes(' ')) {
            //Ignore one-token suggestions. They are provided by the spelling rule, or other rules
            continue;
          }
          const firstChar = normalizedKey.charAt(0);
          let suggestionsMapByChar = this.suggestionsMap.get(firstChar);
          if (suggestionsMapByChar === undefined) {
            suggestionsMapByChar = new Map();
            this.suggestionsMap.set(firstChar, suggestionsMapByChar);
          }
          MultitokenSpeller.addToMap(suggestionsMapByChar, normalizedKey, line);
          MultitokenSpeller.addToMap(this.suggestionsMapNoSpacesKey, normalizedKey.replaceAll(' ', ''), line);
        }
      }
    }
  }

  private static addToMap(map: Map<string, string[]>, key: string, value: string): void {
    let list = map.get(key);
    if (list === undefined) {
      list = [];
      map.set(key, list);
    }
    if (!list.includes(value)) {
      list.push(value);
    }
  }

  private static getNormalizeKey(word: string): string {
    return StringTools.removeDiacritics(word.toLowerCase()).replaceAll('-', ' ');
  }

  private discardRunOnWords(underlinedError: string): boolean {
    const parts = MultitokenSpeller.splitBySpace(underlinedError);
    if (parts.length === 2) {
      if (StringTools.isCapitalizedWord(parts[1]!)) {
        return false;
      }
      if (parts[0]!.length === 0 || parts[1]!.length === 0) {
        // probably emojis, or mal-formed chars
        return true;
      }
      const sugg1a = parts[0]!.substring(0, parts[0]!.length - 1);
      const sugg1b = parts[0]!.substring(parts[0]!.length - 1) + parts[1];
      if (!this.spellingRule.isMisspelled(sugg1a) && !this.spellingRule.isMisspelled(sugg1b)) {
        return true;
      }
      const sugg2a = parts[0]! + parts[1]!.charAt(0);
      const sugg2b = parts[1]!.substring(1);
      return !this.spellingRule.isMisspelled(sugg2a) && !this.spellingRule.isMisspelled(sugg2b);
    }
    return false;
  }

  private static splitBySpace(underlinedError: string): string[] {
    return underlinedError.split(' ').filter((s) => s.length > 0);  // StringUtils.split(underlinedError, ' ')
  }

  protected isException(_original: string, _candidate: string): boolean {
    return false;
  }

  protected getAdditionalSuggestions(_originalWord: string): WeightedSuggestion[] {
    return [];
  }

}

/** String.split(" "): trailing empty strings removed. */
function JavaSplitSpace(s: string): string[] {
  const parts = s.split(' ');
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  if (parts.length === 1 && parts[0] === '' && s.length > 0) return [];
  return parts;
}

/** StringUtils.substringBefore(str, separator) */
function StringUtils_substringBefore(str: string, separator: string): string {
  const pos = str.indexOf(separator);
  return pos === -1 ? str : str.substring(0, pos);
}

/** LevenshteinDistance.getDefaultInstance().apply(left, right) (Apache Commons Text, no threshold). */
function LevenshteinDistance_apply(left: string, right: string): number {
  let n = left.length;
  let m = right.length;
  if (n === 0) return m;
  if (m === 0) return n;
  if (n > m) {
    const tmp = left;
    left = right;
    right = tmp;
    n = m;
    m = right.length;
  }
  const p = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) p[i] = i;
  for (let j = 1; j <= m; j++) {
    let upperLeft = p[0]!;
    const rightJ = right.charAt(j - 1);
    p[0] = j;
    for (let i = 1; i <= n; i++) {
      const upper = p[i]!;
      const cost = left.charAt(i - 1) === rightJ ? 0 : 1;
      p[i] = Math.min(Math.min(p[i - 1]! + 1, p[i]! + 1), upperLeft + cost);
      upperLeft = upper;
    }
  }
  return p[n]!;
}
