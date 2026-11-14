// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternRuleMatcher.java faithful
// The static patterns are compiled on first use. The monitoring of active rules
// (currentlyActiveRules, System property monitorActiveRules) is left out.
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import type { Language } from '../../Language.ts';
import { RuleMatch } from '../RuleMatch.ts';
import { RuleWithMaxFilter } from '../RuleWithMaxFilter.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { Character } from '../../../../../../jdk/java/lang/Character.ts';
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { AbstractPatternRulePerformer } from './AbstractPatternRulePerformer.ts';
import type { AbstractTokenBasedRule } from './AbstractTokenBasedRule.ts';
import type { Match } from './Match.ts';
import type { PatternRule } from './PatternRule.ts';
import { PatternRuleHandler } from './PatternRuleHandler.ts';
import type { PatternTokenMatcher } from './PatternTokenMatcher.ts';
import { RuleFilterEvaluator } from './RuleFilterEvaluator.ts';
import type { RuleMatcher } from './RuleMatcher.ts';

const allowedChars = '[^<>()]*?';
let SUGGESTION_PATTERN_SUPPRESS: Pattern | null = null;
let WHITESPACE_OR_PUNCT: Pattern | null = null;
let TAG_AND_PLEASE_SPELL_ME: Pattern | null = null;

/**
 * Matches a pattern rule against text.
 */
export class PatternRuleMatcher extends AbstractPatternRulePerformer implements RuleMatcher {

  static readonly MISTAKE = '<mistake/>';

  private readonly useList: boolean;

  constructor(rule: AbstractTokenBasedRule, useList: boolean) {
    super(rule, rule.getLanguage().getUnifier());
    this.useList = useList;
  }

  match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    try {
      const tokens = this.isInterpretPosTagsPreDisambiguation()
                     ? sentence.getPreDisambigTokensWithoutWhitespace()
                     : sentence.getTokensWithoutWhitespace();
      this.doMatch(sentence, tokens, (tokenPositions, firstMatchToken, lastMatchToken, firstMarkerMatchToken, lastMarkerMatchToken) => {
        const ruleMatch = this.createRuleMatch(tokenPositions, tokens, firstMatchToken, lastMatchToken, firstMarkerMatchToken, lastMarkerMatchToken, sentence);
        if (ruleMatch != null) {
          ruleMatches.push(ruleMatch);
        }
      });
      const maxFilter = new RuleWithMaxFilter();
      const filteredMatches = maxFilter.filter(ruleMatches);
      return [...filteredMatches];
    } catch (e) {
      throw new Error("RuntimeException: Error analyzing sentence: '" + sentence.toString() + "' with rule " + this.rule.getFullId(), { cause: e });
    }
  }

  protected override testAllReadings(tokens: AnalyzedTokenReadings[], matcher: PatternTokenMatcher, prevElement: PatternTokenMatcher | null, tokenNo: number, firstMatchToken: number, prevSkipNext: number): boolean {
    if (tokens[tokenNo]!.isImmunized()) return false;

    return super.testAllReadings(tokens, matcher, prevElement, tokenNo, firstMatchToken, prevSkipNext);
  }

  private createRuleMatch(tokenPositions: number[],
                          tokens: AnalyzedTokenReadings[], firstMatchToken: number,
                          lastMatchToken: number, firstMarkerMatchToken: number, lastMarkerMatchToken: number,
                          sentence: AnalyzedSentence): RuleMatch | null {
    const rule = this.rule;
    const errMessage = this.formatMatches(tokens, tokenPositions,
            firstMatchToken, rule.getMessage(), rule.getSuggestionMatches());
    const shortErrMessage = this.formatMatches(tokens, tokenPositions,
        firstMatchToken, rule.getShortMessage(), rule.getSuggestionMatches());
    const suggestionsOutMsg = this.formatMatches(tokens, tokenPositions,
            firstMatchToken, rule.getSuggestionsOutMsg(), rule.getSuggestionMatchesOutMsg());
    let correctedStPos = 0;
    if (rule.startPositionCorrection > 0) {
      for (let l = 0; l <= Math.min(rule.startPositionCorrection, tokenPositions.length - 1); l++) {
        correctedStPos += tokenPositions[l]!;
      }
      correctedStPos--;
    }
    let idx = firstMatchToken + correctedStPos;
    if (idx >= tokens.length) {
      // TODO: hacky workaround, find a proper solution. See EnglishPatternRuleTest.testBug()
      // This is important when the reference points to a token with min="0", which has not been
      // matched... the subsequent match elements need to be renumbered, I guess, and that one
      // silently discarded
      idx = tokens.length - 1;
    }
    let firstMatchTokenObj = tokens[idx]!;
    const inputTokens: string[] = [];
    for (let i = idx; i <= lastMatchToken; i++) {
      inputTokens.push(tokens[i]!.getToken());
    }
    const isInputAllUppercase = StringTools.isAllUppercase(inputTokens);
    // one-character words (A, J', L') are not enough to consider it an all-uppercase word
    let isAllUppercase = isInputAllUppercase &&
      (firstMatchTokenObj.getToken().replaceAll("'", '').length > 1 || lastMatchToken > idx)
      && this.matchPreservesCase(rule.getSuggestionMatches(), rule.getMessage())
      && this.matchPreservesCase(rule.getSuggestionMatchesOutMsg(), rule.getSuggestionsOutMsg());
    isAllUppercase = isAllUppercase && rule.isAdjustSuggestionCase();

    let startsWithUppercase = StringTools.startsWithUppercase(firstMatchTokenObj.getToken())
        && this.matchPreservesCase(rule.getSuggestionMatches(), rule.getMessage())
        && this.matchPreservesCase(rule.getSuggestionMatchesOutMsg(), rule.getSuggestionsOutMsg());

    if (firstMatchTokenObj.isSentenceStart() && tokens.length > firstMatchToken + correctedStPos + 1) {
      // make uppercasing work also at sentence start:
      firstMatchTokenObj = tokens[firstMatchToken + correctedStPos + 1]!;
      startsWithUppercase = StringTools.startsWithUppercase(firstMatchTokenObj.getToken());
    }
    startsWithUppercase = startsWithUppercase && rule.isAdjustSuggestionCase();
    if (firstMarkerMatchToken === -1) {
      firstMarkerMatchToken = firstMatchToken;
    }
    let fromPos = tokens[firstMarkerMatchToken]!.getStartPos();
    // FIXME: this is fishy, assumes that comma should always come before whitespace:
    if (firstMarkerMatchToken >= 1 && (errMessage.includes(RuleMatch.SUGGESTION_START_TAG + ',')
        || suggestionsOutMsg.includes(RuleMatch.SUGGESTION_START_TAG + ','))) {
      fromPos = tokens[firstMarkerMatchToken - 1]!.getStartPos()
          + tokens[firstMarkerMatchToken - 1]!.getToken().length;
    }
    if (lastMarkerMatchToken === -1) {
      lastMarkerMatchToken = lastMatchToken;
    }
    const token = tokens[Math.min(lastMarkerMatchToken, tokens.length - 1)]!;
    const toPos = token.getEndPos();
    if (fromPos < toPos) { // this can happen with some skip="-1" when the last token is not matched
      // if the message is "suppress_misspelled" and there are no suggestions,
      // then do not create the rule match
      if (!(errMessage.includes(PatternRuleHandler.PLEASE_SPELL_ME) && !errMessage.includes(RuleMatch.SUGGESTION_START_TAG)
          && !suggestionsOutMsg.includes(RuleMatch.SUGGESTION_START_TAG))) {
        let clearMsg = errMessage.replaceAll(PatternRuleHandler.PLEASE_SPELL_ME, '');
        clearMsg = clearMsg.replaceAll(PatternRuleMatcher.MISTAKE, '');
        const ruleMatch = new RuleMatch(rule, sentence, fromPos, toPos, tokens[firstMatchToken]!.getStartPos(), tokens[lastMatchToken]!.getEndPos(),
                clearMsg, shortErrMessage, startsWithUppercase, isAllUppercase, suggestionsOutMsg, true);
        ruleMatch.setType(rule.getType()!);
        if (rule.getFilter() != null) {
          const evaluator = new RuleFilterEvaluator(rule.getFilter()!);
          const patternTokens = tokens.slice(firstMatchToken, lastMatchToken + 1);
          return evaluator.runFilter(rule.getFilterArguments()!, ruleMatch, patternTokens, firstMatchToken, [...tokenPositions]);
        } else {
          return ruleMatch;
        }
      }
    } // failed to create any rule match...
    return null;
  }

  /**
   * Checks if the suggestion starts with a match that is supposed to preserve
   * case. If it does not, perform the default conversion to uppercase.
   * @return true, if the match preserves the case of the token.
   */
  private matchPreservesCase(suggestionMatches: Match[] | null, msg: string): boolean {
    if (suggestionMatches != null && suggestionMatches.length !== 0) {
      //PatternRule rule = (PatternRule) this.rule;
      //FIXME: this only considers properly the first match in first suggestion.
      let sugStart = msg.indexOf(RuleMatch.SUGGESTION_START_TAG) + RuleMatch.SUGGESTION_START_TAG.length;
      if (msg.includes(PatternRuleHandler.PLEASE_SPELL_ME)) {
        sugStart += PatternRuleHandler.PLEASE_SPELL_ME.length;
      }
      for (const sMatch of suggestionMatches) {
        if (!sMatch.isInMessageOnly() && sMatch.convertsCase()
            && charAt(msg, sugStart) === '\\') {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Gets the index of the element indexed by i, adding any offsets because of
   * the phrases in the rule.
   * @param i Current element index.
   * @return int Index translated into XML element no.
   */
  override translateElementNo(i: number): number {
    if (!this.useList || i < 0) {
      return i;
    }
    let j = 0;
    const rule = this.rule as PatternRule;
    for (let k = 0; k < i; k++) {
      j += rule.getElementNo()[k]!;
    }
    return j;
  }

  /**
   * Replace back references generated with &lt;match&gt; and \\1 in message
   * using Match class, and take care of skipping.
   * @param tokenReadings Array of AnalyzedTokenReadings that were matched against the pattern
   * @param positions Array of relative positions of matched tokens
   * @param firstMatchTok Position of the first matched token
   * @param errorMsg String containing suggestion markup
   * @return String Formatted message.
   */
  private formatMatches(tokenReadings: AnalyzedTokenReadings[],
      positions: number[], firstMatchTok: number, errorMsg: string,
      suggestionMatches: Match[]): string {
    let errorMessage = errorMsg;
    let matchCounter = 0;
    //int prevMatchesLength = 0;
    const numbersToMatches: number[] = new Array<number>(errorMsg.length).fill(0);
    let newWay = false;
    let errLen = errorMessage.length;
    /*
    track position of already replaced text to avoid recursion
    otherwise, if we insert user matches into text and these contain backslashes
    we will try to interpret these as well -> this can lead to array index violations, etc.
     */
    let errorMessageProcessed = 0;
    let errMarker = errorMessage.indexOf('\\', errorMessageProcessed);
    let numberFollows = false;
    if (errMarker >= 0 && errMarker < errLen - 1) {
      numberFollows = StringTools.isPositiveNumber(errorMessage.charAt(errMarker + 1));
    }
    while (errMarker >= 0 && numberFollows) {
      const backslashPos = errorMessage.indexOf('\\', errorMessageProcessed);
      if (backslashPos >= 0 && StringTools.isPositiveNumber(charAt(errorMessage, backslashPos + 1))) {
        let numLen = 1;
        while (backslashPos + numLen < errorMessage.length
            && Character.isDigit(errorMessage.charAt(backslashPos + numLen))) {
          numLen++;
        }
        const j = parseInt(errorMessage.substring(backslashPos + 1, backslashPos
            + numLen), 10) - 1;
        let repTokenPos = 0;
        let nextTokenPos = 0;
        for (let l = 0; l <= Math.min(j, positions.length - 1); l++) {
          repTokenPos += positions[l]!;
        }
        if (j + 1 < positions.length) {
          nextTokenPos = firstMatchTok + repTokenPos + positions[j + 1]!;
        }

        if (suggestionMatches != null && suggestionMatches.length > 0) {
          if (matchCounter < suggestionMatches.length) {
            numbersToMatches[j] = matchCounter;
            // if token is optional remove it from suggestions:
            let matches: string[];
            if (j >= positions.length) {
              matches = this.concatMatches(matchCounter, j, firstMatchTok + repTokenPos, tokenReadings, nextTokenPos, suggestionMatches);
            } else if (positions[j] !== 0) {
              matches = this.concatMatches(matchCounter, j, firstMatchTok + repTokenPos, tokenReadings, nextTokenPos, suggestionMatches);
            } else {
              matches = [''];
            }
            const leftSide = errorMessage.substring(0, backslashPos);
            const rightSide = errorMessage.substring(backslashPos + numLen);
            if (matches.length === 1) {
              // if we removed optional token from suggestion then remove leading space from the next word
              if (matches[0] === '') {
                errorMessage = PatternRuleMatcher.concatWithoutExtraSpace(leftSide, rightSide);
                errorMessageProcessed = leftSide.length;
              } else {
                errorMessage = leftSide + matches[0] + rightSide;
                errorMessageProcessed = leftSide.length + matches[0]!.length;
              }
            } else {
              // TODO compute/return errorMessageProcessed here as well
              errorMessage = PatternRuleMatcher.formatMultipleSynthesis(matches, leftSide, rightSide);
            }
            //TODO keep the previous matches length and handle it appropriately
            //prevMatchesLength =  matches.length;
            matchCounter++;
            newWay = true;
          } else {
            // FIXME: is this correct? this is how we deal with multiple matches
            suggestionMatches.push(suggestionMatches[numbersToMatches[j]!]!);
          }
        }
        if (!newWay) {
          // in case <match> elements weren't used (yet)
          const newErrorMessageProcessed = errorMessage.lastIndexOf('\\' + (j + 1)) +
            tokenReadings[firstMatchTok + repTokenPos - 1]!.getToken().length;
          errorMessage = errorMessage.substring(0, errorMessageProcessed) +
            errorMessage.substring(errorMessageProcessed).replaceAll('\\' + (j + 1),
              tokenReadings[firstMatchTok + repTokenPos - 1]!.getToken());
          errorMessageProcessed = newErrorMessageProcessed;
        }
      }
      errMarker = errorMessage.indexOf('\\', errorMessageProcessed);
      numberFollows = false;
      errLen = errorMessage.length;
      if (errMarker >= 0 && errMarker < errLen - 1) {
        numberFollows = StringTools.isPositiveNumber(errorMessage.charAt(errMarker + 1));
      }
    }
    return PatternRuleMatcher.removeSuppressMisspelled(errorMessage);
  }

  private static concatWithoutExtraSpace(leftSide: string, rightSide: string): string {
    // can't do \\p{Punct} as it catches \2 placeholder
    if ((leftSide.endsWith(' ') && rightSide.startsWith('</suggestion>'))
      || (leftSide.endsWith(' ') && (WHITESPACE_OR_PUNCT ??= Pattern.compile('[\\s,:;.!?].*')).matcher(rightSide).matches())) {
      return leftSide.substring(0, leftSide.length - 1) + rightSide;
    }
    if (leftSide.endsWith('suggestion>') && rightSide.startsWith(' ')) {
      return leftSide + rightSide.substring(1);
    }
    return leftSide + rightSide;
  }

  private static removeSuppressMisspelled(s: string): string {
    let result = s;
    // remove suggestions not synthesized: <suggestion><pleasespellme/>...(...)...</suggestion>
    // remove misspelled words: <suggestion><pleasespellme/>...<mistake/>...</suggestion>
    SUGGESTION_PATTERN_SUPPRESS ??= Pattern
      .compile(RuleMatch.SUGGESTION_START_TAG + PatternRuleHandler.PLEASE_SPELL_ME
          + allowedChars + '(\\(' + allowedChars + '\\)|' + PatternRuleMatcher.MISTAKE + ')' + allowedChars
          + RuleMatch.SUGGESTION_END_TAG);
    const matcher = SUGGESTION_PATTERN_SUPPRESS.matcher(result);
    result = matcher.replaceAll('');
    // remove the remaining tags <pleasespellme/> in suggestions but not in the message
    TAG_AND_PLEASE_SPELL_ME ??= Pattern.compile(RuleMatch.SUGGESTION_START_TAG + PatternRuleHandler.PLEASE_SPELL_ME);
    result = TAG_AND_PLEASE_SPELL_ME.matcher(result).replaceAll(RuleMatch.SUGGESTION_START_TAG);
    return result;
  }

  // non-private for tests
  static formatMultipleSynthesis(matches: string[],
      leftSide: string, rightSide: string): string {
    let errorMessage: string;
    let suggestionLeft = '';
    let suggestionRight = '';
    let rightSideNew = rightSide;
    const sPos = leftSide.lastIndexOf(RuleMatch.SUGGESTION_START_TAG);
    if (sPos >= 0) {
      suggestionLeft = leftSide.substring(sPos + RuleMatch.SUGGESTION_START_TAG.length);
    }
    if (StringTools.isEmpty(suggestionLeft)) {
      errorMessage = leftSide;
    } else {
      errorMessage = leftSide.substring(0, leftSide.lastIndexOf(RuleMatch.SUGGESTION_START_TAG)) + RuleMatch.SUGGESTION_START_TAG;
    }
    const rPos = rightSide.indexOf(RuleMatch.SUGGESTION_END_TAG);
    if (rPos >= 0) {
      suggestionRight = rightSide.substring(0, rPos);
    }
    if (!StringTools.isEmpty(suggestionRight)) {
      rightSideNew = rightSide.substring(rightSide.indexOf(RuleMatch.SUGGESTION_END_TAG));
    }
    const lastLeftSugEnd = leftSide.indexOf(RuleMatch.SUGGESTION_END_TAG);
    const lastLeftSugStart = leftSide.lastIndexOf(RuleMatch.SUGGESTION_START_TAG);
    let sb = '';
    sb += errorMessage;
    for (let z = 0; z < matches.length; z++) {
      sb += suggestionLeft;
      sb += matches[z];
      sb += suggestionRight;
      if (z < matches.length - 1 && lastLeftSugEnd < lastLeftSugStart) {
        sb += RuleMatch.SUGGESTION_END_TAG;
        sb += ', ';
        sb += RuleMatch.SUGGESTION_START_TAG;
      }
    }
    sb += rightSideNew;
    return sb;
  }

  /**
   * Concatenates the matches, and takes care of phrases (including inflection
   * using synthesis).
   * @param start Position of the element as referenced by match element in the rule.
   * @param index The index of the element found in the matching sentence.
   * @param tokenIndex The position of the token in the AnalyzedTokenReadings array.
   * @param tokens Array of AnalyzedTokenReadings
   * @return @String[] Array of concatenated strings
   */
  private concatMatches(start: number, index: number,
      tokenIndex: number, tokens: AnalyzedTokenReadings[],
      nextTokenPos: number, suggestionMatches: Match[]): string[] {
    let finalMatch: string[];
    const len = this.phraseLen(index);
    const language = this.rule.getLanguage();
    if (len === 1) {
      const skippedTokens = nextTokenPos - tokenIndex;
      const matchState = suggestionMatches[start]!.createState(language.getSynthesizer(), tokens, tokenIndex - 1, skippedTokens);
      finalMatch = matchState.toFinalString(language);
    } else {
      const matchList: string[][] = [];
      for (let i = 0; i < len; i++) {
        const skippedTokens = nextTokenPos - (tokenIndex + i);
        const matchState = suggestionMatches[start]!.createState(language.getSynthesizer(), tokens, tokenIndex - 1 + i, skippedTokens);
        matchList.push(matchState.toFinalString(language));
      }
      return PatternRuleMatcher.combineLists(matchList,
          new Array<string>(matchList.length), 0, language);
    }
    return finalMatch;
  }

  private phraseLen(i: number): number {
    const rule = this.rule as PatternRule;
    const elementNo = rule.getElementNo();
    if (!this.useList || i > elementNo.length - 1) {
      return 1;
    }
    return elementNo[i]!;
  }

  /**
   * Creates a Cartesian product of the arrays stored in the input array.
   * @param input Array of string arrays to combine.
   * @param output Work array of strings.
   * @param r Starting parameter (use 0 to get all combinations).
   * @param lang Text language for adding spaces in some languages.
   * @return Combined array of String.
   */
  private static combineLists(input: string[][],
      output: string[], r: number, lang: Language): string[] {
    const outputList: string[] = [];
    if (r === input.length) {
      let sb = '';
      for (let k = 0; k < output.length; k++) {
        sb += output[k];
        if (k < output.length - 1) {
          sb += StringTools.addSpace(output[k + 1]!, lang);
        }
      }
      outputList.push(sb);
    } else {
      for (let c = 0; c < input[r]!.length; c++) {
        output[r] = input[r]![c]!;
        const sList = PatternRuleMatcher.combineLists(input, output, r + 1, lang);
        outputList.push(...sList);
      }
    }
    return outputList;
  }

}

/** String.charAt, which throws outside the string as Java's does. */
function charAt(s: string, i: number): string {
  if (i < 0 || i >= s.length) throw new Error(`StringIndexOutOfBoundsException: index ${i}, length ${s.length}`);
  return s.charAt(i);
}
