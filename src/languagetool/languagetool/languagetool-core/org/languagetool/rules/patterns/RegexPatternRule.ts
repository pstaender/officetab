// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RegexPatternRule.java faithful
// Pair<Integer, Integer> is a [left, right] tuple; InterruptibleCharSequence is left out.
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { Language } from '../../Language.ts';
import { RuleMatch } from '../RuleMatch.ts';
import { Character } from '../../../../../../jdk/java/lang/Character.ts';
import { type Matcher, Pattern, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { AbstractPatternRule } from './AbstractPatternRule.ts';
import { CaseConversionHelper } from './CaseConversionHelper.ts';
import type { Match } from './Match.ts';
import type { RegexRuleFilter } from './RegexRuleFilter.ts';
import { RegexRuleFilterEvaluator } from './RegexRuleFilterEvaluator.ts';
import { parseJavaInt } from './RuleFilter.ts';
import type { RuleMatcher } from './RuleMatcher.ts';
import { StringMatcher } from './StringMatcher.ts';
import type { Substrings } from './Substrings.ts';

type Pair = [left: number, right: number];

let suggestionPattern: Pattern | null = null;  // TODO: this needs to be cleaned up, there should be no need to parse this?
let matchPattern: Pattern | null = null;

/**
 * Matches 'regexp' elements from XML rules against sentences.
 *
 * @since 3.2
 */
export class RegexPatternRule extends AbstractPatternRule implements RuleMatcher {

  // in suggestions tokens are numbered from 1, anywhere else tokens are numbered from 0.
  // see: https://dev.languagetool.org/development-overview
  // But most of the rules tend to use 1 to refer the first capturing group, so keeping that behavior as default
  private static readonly MATCHES_IN_SUGGESTIONS_NUMBERED_FROM = 0;
  static readonly MAX_SENT_LENGTH = 2000;

  private readonly pattern: Pattern;
  private readonly markGroup: number;
  private readonly shortMessage: string;
  private regexFilter: RegexRuleFilter | null = null;
  private readonly requiredSubstrings: Substrings | null;
  private readonly caseSensitive: boolean;

  constructor(id: string, description: string, message: string, shortMessage: string | null, suggestionsOutMsg: string, language: Language, regex: Pattern, regexpMark: number) {
    super(id, description, language);
    this.message = message;
    this.pattern = regex;
    this.requiredSubstrings = StringMatcher.getRequiredSubstrings(regex.toString());
    this.caseSensitive = (regex.flags() & Pattern.CASE_INSENSITIVE) === 0;
    this.shortMessage = shortMessage == null ? '' : shortMessage;
    this.suggestionsOutMsg = suggestionsOutMsg === '' ? '' : suggestionsOutMsg;
    this.markGroup = regexpMark;
  }

  getPattern(): Pattern {
    return this.pattern;
  }

  setRegexFilter(filter: RegexRuleFilter): void {
    this.regexFilter = filter;
  }

  override match(sentenceObj: AnalyzedSentence): RuleMatch[] {
    const text = sentenceObj.getText();
    const startPos = this.requiredSubstrings == null ? 0 : this.requiredSubstrings.find(text, this.caseSensitive);
    if (startPos < 0) return RuleMatch.EMPTY_ARRAY as RuleMatch[];
    return this.doMatch(sentenceObj, text, this.requiredSubstrings != null && !this.requiredSubstrings.mustStart ? 0 : startPos);
  }

  private doMatch(sentenceObj: AnalyzedSentence, text: string, startPos: number): RuleMatch[] {
    suggestionPattern ??= Pattern.compile('<suggestion>(.*?)</suggestion>');
    matchPattern ??= Pattern.compile('\\\\\\d');
    const message = this.message!;
    const suggestionsOutMsg = this.suggestionsOutMsg!;
    const suggestionsInMessage = this.getClausePositionsInMessage(suggestionPattern, message);
    const backReferencesInMessage = this.getClausePositionsInMessage(matchPattern, message);
    const suggestionsInSuggestionsOutMsg = this.getClausePositionsInMessage(suggestionPattern, suggestionsOutMsg);
    const backReferencesInSuggestionsOutMsg = this.getClausePositionsInMessage(matchPattern, suggestionsOutMsg);

    const matches: RuleMatch[] = [];

    if (text.length > RegexPatternRule.MAX_SENT_LENGTH) {
      return matches;
    }
    const patternMatcher = this.pattern.matcher(text);
    while (patternMatcher.find(startPos)) {
      try {
        const markStart = patternMatcher.start(this.markGroup);
        const markEnd = patternMatcher.end(this.markGroup);
        const processedMessage = this.processMessage(patternMatcher, message, backReferencesInMessage, suggestionsInMessage, this.getSuggestionMatches());
        const processedSuggestionsOutMsg = this.processMessage(patternMatcher, suggestionsOutMsg, backReferencesInSuggestionsOutMsg,
                suggestionsInSuggestionsOutMsg, this.getSuggestionMatchesOutMsg());
        const startsWithUpperCase = patternMatcher.start() === 0 && Character.isUpperCase(text.charAt(patternMatcher.start()));
        const ruleMatch = new RuleMatch(this, sentenceObj, markStart, markEnd, patternMatcher.start(), patternMatcher.end(),
                processedMessage, this.shortMessage, startsWithUpperCase, false, processedSuggestionsOutMsg, true);
        if (this.regexFilter != null) {
          const ruleFilterEvaluator = new RegexRuleFilterEvaluator(this.regexFilter);
          const filteredMatch = ruleFilterEvaluator.runFilter(this.getFilterArguments()!, ruleMatch, sentenceObj, patternMatcher);
          if (filteredMatch != null) {
            matches.push(ruleMatch);
          }
        } else {
          matches.push(ruleMatch);
        }
        startPos = patternMatcher.end();
      } catch (e) {
        throw new Error(`RuntimeException: Unexpected exception when processing regexp in rule with id ${this.getFullId()}.`, { cause: e });
      }
    }
    return matches;
  }

  private getClausePositionsInMessage(pattern: Pattern, message: string): Pair[] {
    const matcher = pattern.matcher(message);
    const clausePositionsInMessage: Pair[] = [];
    while (matcher.find()) {
      clausePositionsInMessage.push([matcher.start(), matcher.end()]);
    }
    return clausePositionsInMessage;
  }

  private processMessage(matcher: Matcher, message: string, backReferences: Pair[],
                         suggestions: Pair[], matches: Match[]): string {
    let closestSuggestionPosition = -1;
    let allSuggestionsPassed = suggestions.length === 0;
    if (suggestions.length !== 0) {
      closestSuggestionPosition = 0;
    }
    let insideSuggestion: boolean;
    let processedMessage = '';
    let startOfProcessingPart = 0;
    for (let i = 0; i < backReferences.length; i++) {
      const reference = backReferences[i]!;
      while (!allSuggestionsPassed && (reference[0] > suggestions[closestSuggestionPosition]![1])) {
        closestSuggestionPosition += 1;
        if (closestSuggestionPosition === suggestions.length) {
          allSuggestionsPassed = true;
        }
      }
      insideSuggestion = !allSuggestionsPassed && reference[0] >= suggestions[closestSuggestionPosition]![0];
      const inXMLMatchReferenceNo = parseJavaInt(StringSplit(message.substring(reference[0], reference[1]), '\\\\')[1]!);
      const actualMatchReferenceNo = inXMLMatchReferenceNo - (insideSuggestion ? RegexPatternRule.MATCHES_IN_SUGGESTIONS_NUMBERED_FROM : 0);
      let matchReferenceStringValue = matcher.group(actualMatchReferenceNo);
      if (matchReferenceStringValue == null) {
        matchReferenceStringValue = '';
      }
      const currentProcessingMatch = matches[i];
      if (currentProcessingMatch === undefined) {
        throw new Error('IndexOutOfBoundsException: Index ' + i + ' out of bounds for length ' + matches.length);
      }
      const regexReplace = currentProcessingMatch.getRegexReplace();
      let suggestion: string;
      if (regexReplace != null) {
        suggestion = currentProcessingMatch.getRegexMatch()!.matcher(matchReferenceStringValue).replaceFirst(regexReplace);
        suggestion = CaseConversionHelper.convertCase(currentProcessingMatch.getCaseConversionType(), suggestion, matchReferenceStringValue, this.getLanguage());
      } else {
        suggestion = matchReferenceStringValue;
      }
      processedMessage += message.substring(startOfProcessingPart, reference[0]) + suggestion;
      startOfProcessingPart = reference[1];
    }
    processedMessage += message.substring(startOfProcessingPart);
    return processedMessage;
  }

  override estimateContextForSureMatch(): number {
    return -1;
  }

  override toString(): string {
    return this.pattern.toString() + '/flags:' + this.pattern.flags();
  }

  /* (non-Javadoc)
   * @see org.languagetool.rules.patterns.AbstractPatternRule#getShortMessage()
   */
  override getShortMessage(): string {
    return this.shortMessage;
  }
}
