// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractFindSuggestionsFilter.java faithful
// The nested Comparator StringComparator is exported from this file with a compare method; it
// is passed to Array.sort as (a, b) => c.compare(a, b) (both sorts are stable).
import { AnalyzedToken } from '../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import { RuleMatch } from './RuleMatch.ts';
import { EditDistance } from './spelling/symspell/implementation/EditDistance.ts';
import type { Synthesizer } from '../synthesis/Synthesizer.ts';
import type { Tagger } from '../tagging/Tagger.ts';
import { StringTools } from '../tools/StringTools.ts';
import { StringEqualsIgnoreCase } from '../../../../../jdk/java/lang/String.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

export abstract class AbstractFindSuggestionsFilter extends RuleFilter {

  protected readonly MAX_SUGGESTIONS = 10;

  protected abstract getTagger(): Tagger;

  //abstract protected MorfologikSpeller getSpeller();
  protected abstract getSpellingSuggestions(atr: AnalyzedTokenReadings): string[];

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {

//    if (match.getSentence().getText().contains("Toni Comin")) {
//      int ii=0;
//      ii++;
//    }

    //TODO: remove suggestions that trigger the rule again.
    // It would be needed to run again the rule with the full sentence.
    const replacements: string[] = [];
    const replacements2: string[] = [];
    const wordFrom = this.getRequired('wordFrom', args);
    const desiredPostag = this.getRequired('desiredPostag', args);
    const priorityPostag = this.getOptional('priorityPostag', args);
    const removeSuggestionsRegexp = this.getOptional('removeSuggestionsRegexp', args);
    // suppress match if there are no suggestions
    const bSuppressMatch = StringEqualsIgnoreCase(this.getOptional('suppressMatch', args, 'false')!, 'true');

    // diacriticsMode: return only changes in diacritics. If there is none, the
    // match is removed.
    const mode = this.getOptional('Mode', args);
    const diacriticsMode = (mode != null) && mode === 'diacritics';
    const generateSuggestions = true;
    let regexpPattern: Pattern | null = null;
    const synth = this.getSynthesizer();
    const usedLemmas: (string | null)[] = [];
    let stringComparator = new StringComparator('');

    if (wordFrom != null && desiredPostag != null) {
      let atrWord: AnalyzedTokenReadings;
      if (wordFrom === 'inmarker') {
        match.setOriginalErrorStr();
        atrWord = new AnalyzedTokenReadings(new AnalyzedToken(this.preProcessWrongWord(match.getOriginalErrorStr()),
          '', ''));
      } else {
        atrWord = patternTokens[this.getPosition(wordFrom, patternTokens, match)]!;
      }
      stringComparator = new StringComparator(atrWord.getToken());
      const isWordCapitalized = StringTools.isCapitalizedWord(atrWord.getToken());
      const isWordAllupper = StringTools.isAllUppercase(atrWord.getToken());

      // Check if the original token (before disambiguation) meets the requirements
      const originalWord = [atrWord.getToken()];
      const aOriginalWord = this.getTagger().tag(originalWord);
      for (const atr of aOriginalWord) {
        if (atr.matchesPosTagRegex(desiredPostag)) {
          if (diacriticsMode) {
            return null;
          }
        }
      }

      if (generateSuggestions) {
        if (removeSuggestionsRegexp != null) {
          regexpPattern = Pattern.compile(removeSuggestionsRegexp, Pattern.UNICODE_CASE);
        }
        const suggestions = this.getSpellingSuggestions(atrWord);
        let usedPriorityPostagPos = 0;
        if (suggestions.length > 0) {
          for (const suggestion of suggestions) {
            // TODO: do not tag capitalized words with tags for lower case
            const analyzedSuggestions = this.getTagger().tag([this.cleanSuggestion(suggestion)]);
            for (const analyzedSuggestion of analyzedSuggestions) {
              if (this.isSuggestionException(analyzedSuggestion)) {
                continue;
              }
              if (replacements.length >= 2 * this.MAX_SUGGESTIONS) {
                break;
              }
              let used = false;
              if (!(suggestion === atrWord.getToken())
                  && analyzedSuggestion.matchesPosTagRegex(desiredPostag)) {
                if (!replacements.includes(suggestion)
                    && !replacements.includes(suggestion.toLowerCase())
                    && (!diacriticsMode || this.equalWithoutDiacritics(suggestion, atrWord.getToken()))) {
                  if (regexpPattern == null || !regexpPattern.matcher(suggestion).matches()) {
                    let replacement = suggestion;
                    if (isWordAllupper) {
                      replacement = replacement.toUpperCase();
                    }
                    if (isWordCapitalized) {
                      replacement = StringTools.uppercaseFirstChar(replacement)!;
                    }
                    if (priorityPostag != null && analyzedSuggestion.matchesPosTagRegex(priorityPostag)) {
                      replacements.splice(usedPriorityPostagPos, 0, replacement);
                      usedPriorityPostagPos++;
                      used = true;
                    } else {
                      replacements.push(replacement);
                      used = true;
                    }
                  }
                }
              }
              // try with the synthesizer
              if (!used && synth != null) {
                const synthesizedSuggestions: string[] = [];
                for (const at of analyzedSuggestion) {
                  if (usedLemmas.includes(at.getLemma())) {
                    continue;
                  }
                  const synthesizedArray = synth.synthesize(at, desiredPostag, true);
                  usedLemmas.push(at.getLemma());
                  for (const synthesizedSuggestion of synthesizedArray) {
                    if (!synthesizedSuggestions.includes(synthesizedSuggestion)) {
                      synthesizedSuggestions.push(synthesizedSuggestion);
                    }
                  }
                  for (let replacement of synthesizedSuggestions) {
                    if (isWordAllupper) {
                      replacement = replacement.toUpperCase();
                    }
                    if (isWordCapitalized) {
                      replacement = StringTools.uppercaseFirstChar(replacement)!;
                    }
                    replacements2.push(replacement);
                  }
                }
              }
            }
          }
        }
      }
    }
    const matchContainsSomeFinishedSuggestion =
      match.getSuggestedReplacements().some((k) => !k.toLowerCase().includes('{suggestion}'));
    if (diacriticsMode && replacements.length === 0 && !matchContainsSomeFinishedSuggestion) {
      return null;
    }
    if (replacements.length + replacements2.length === 0 && bSuppressMatch && !matchContainsSomeFinishedSuggestion) {
      return null;
    }
    const message = match.getMessage();
    const ruleMatch = new RuleMatch(match.getRule(), match.getSentence(), match.getFromPos(), match.getToPos(),
        message, match.getShortMessage());
    ruleMatch.setType(match.getType());

    const definitiveReplacements: string[] = [];
    let replacementsUsed = false;
    if (generateSuggestions) {
      for (const s of match.getSuggestedReplacements()) {
        if (s.includes('{suggestion}') || s.includes('{Suggestion}') || s.includes('{SUGGESTION}')) {
          replacementsUsed = true;
          for (const s2 of replacements) {
            if (definitiveReplacements.length >= this.MAX_SUGGESTIONS) {
              break;
            }
            if (s.includes('{suggestion}')) {
              if (!definitiveReplacements.includes(s2)) {
                definitiveReplacements.push(s.replaceAll('{suggestion}', s2));
              }
            } else if (s.includes('{Suggestion}')) {
              if (!definitiveReplacements.includes(StringTools.uppercaseFirstChar(s2)!)) {
                definitiveReplacements.push(s.replaceAll('{Suggestion}', StringTools.uppercaseFirstChar(s2)!));
              }
            } else {
              if (!definitiveReplacements.includes(s2.toUpperCase())) {
                definitiveReplacements.push(s.replaceAll('{SUGGESTION}', s2.toUpperCase()));
              }
            }
          }
        } else {
          if (!definitiveReplacements.includes(s)) {
            definitiveReplacements.push(s);
          }
        }
      }
      if (!replacementsUsed) {
        if (replacements.length === 0) {
          replacements2.sort((a, b) => stringComparator.compare(a, b));
          for (const replacement of replacements2) {
            if (!replacements.includes(replacement) && !definitiveReplacements.includes(replacement)) {
              replacements.push(replacement);
            }
          }
        }
        for (const replacement of replacements) {
          if (definitiveReplacements.length >= this.MAX_SUGGESTIONS) {
            break;
          }
          if (!definitiveReplacements.includes(replacement)) {
            definitiveReplacements.push(replacement);
          }
        }
      }
    }
    const originalErrorIndex = definitiveReplacements.indexOf(match.getOriginalErrorStr());
    if (originalErrorIndex >= 0) {
      definitiveReplacements.splice(originalErrorIndex, 1);
    }
    if (definitiveReplacements.length !== 0) {
      ruleMatch.setSuggestedReplacements([...new Set(definitiveReplacements)]);
    }
    return ruleMatch;
  }

  protected isSuggestionException(_analyzedSuggestion: AnalyzedTokenReadings): boolean {
    return false;
  }

  private equalWithoutDiacritics(s: string, t: string): boolean {
    return StringEqualsIgnoreCase(StringTools.removeDiacritics(s), StringTools.removeDiacritics(t));
  }

  protected cleanSuggestion(s: string): string {
    return s;
  }

  protected getSynthesizer(): Synthesizer | null {
    return null;
  }

  protected preProcessWrongWord(word: string): string {
    return word.replaceAll(' ', '');
  }

}

export class StringComparator {
  levenstheinDistance: EditDistance;
  maxDistance = 4;

  constructor(word: string) {
    this.levenstheinDistance = new EditDistance(word, EditDistance.DistanceAlgorithm.Damerau);
  }

  compare(o1: string, o2: string): number {
    let d1 = this.levenstheinDistance.compare(o1, this.maxDistance);
    let d2 = this.levenstheinDistance.compare(o2, this.maxDistance);
    if (d1 < 0) {
      d1 = 2 * this.maxDistance;
    }
    if (d2 < 0) {
      d2 = 2 * this.maxDistance;
    }
    return d1 - d2;
  }
}
