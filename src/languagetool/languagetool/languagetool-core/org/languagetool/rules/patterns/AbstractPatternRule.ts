// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/AbstractPatternRule.java faithful
// The three constructors are one: (id, description, language, patternTokens = null,
// getUnified = false, message?).
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { Language } from '../../Language.ts';
import { ITSIssueType } from '../ITSIssueType.ts';
import { Rule } from '../Rule.ts';
import { type RuleMatch, Type as RuleMatch_Type } from '../RuleMatch.ts';
import type { DisambiguationPatternRule } from '../../tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';
import type { Match } from './Match.ts';
import { PatternRuleId } from './PatternRuleId.ts';
import type { PatternToken } from './PatternToken.ts';
import type { RuleFilter } from './RuleFilter.ts';

/**
 * An Abstract Pattern Rule that describes a pattern of words or part-of-speech tags
 * used for PatternRule and DisambiguationPatternRule.
 * Introduced to minimize code duplication between those classes.
 *
 * @author Marcin Miłkowski
 */
export abstract class AbstractPatternRule extends Rule {

  protected readonly language: Language;
  readonly patternTokens: PatternToken[] | null;
  protected readonly testUnification: boolean;
  protected readonly sentStart: boolean;
  protected suggestionMatches: Match[] | null = null;
  private adjustSuggestionCase = true;
  protected suggestionMatchesOutMsg: Match[] | null = null;
  protected antiPatterns: DisambiguationPatternRule[] | null = null;

  protected subId: string | null = null; // because there can be more than one rule in a rule group
  startPositionCorrection = 0;
  endPositionCorrection = 0;
  protected suggestionsOutMsg: string | null = null; // extra suggestions outside message
  protected filter: RuleFilter | null = null;
  protected filterArgs: string | null = null;
  protected message: string | null = null;
  protected sourceFile: string | null = null;
  protected type: RuleMatch_Type | null = null; // allow setting custom match types without relying on IssueType

  private lineNumber = -1;

  private readonly id: string;
  private readonly description: string;
  private readonly getUnified: boolean;
  private readonly groupsOrUnification: boolean;

  constructor(id: string, description: string, language: Language, patternTokens: PatternToken[] | null = null, getUnified = false, message?: string) {
    super();
    this.id = Objects_requireNonNull(id, 'id cannot be null');
    this.description = Objects_requireNonNull(description, "description ('name' in XML) cannot be null ruleID: " + id);
    this.language = Objects_requireNonNull(language, 'language cannot be null');
    this.getUnified = getUnified;
    if (patternTokens != null) {
      this.patternTokens = [...patternTokens];
      this.testUnification = this.initUnifier();
      this.sentStart = this.patternTokens.length > 0 && this.patternTokens[0]!.isSentenceStart();
      if (!this.testUnification) {
        let found = false;
        for (const elem of this.patternTokens) {
          if (elem.hasAndGroup()) {
            found = true;
            break;
          }
        }
        this.groupsOrUnification = found;
      } else {
        this.groupsOrUnification = true;
      }
    } else {
      this.patternTokens = null;
      this.groupsOrUnification = false;
      this.sentStart = false;
      this.testUnification = false;
    }
    if (message !== undefined) {
      this.message = message;
    }
  }

  override supportsLanguage(language: Language): boolean {
    return language.equalsConsiderVariantsIfSpecified(this.language);
  }

  private initUnifier(): boolean {
    for (const pToken of this.patternTokens!) {
      if (pToken.isUnified()) {
        return true;
      }
    }
    return false;
  }

  override toString(): string {
    return this.id + '[' + this.subId + ']' + (this.sourceFile != null ? '@' + this.sourceFile : '') + ':'
      + (this.patternTokens == null ? 'null' : '[' + this.patternTokens.map((t) => t.toString()).join(', ') + ']') + ':' + this.description;
  }

  override getDescription(): string {
    return this.description;
  }


  override getSourceFile(): string | null {
    return this.sourceFile;
  }

  setSourceFile(sourceFile: string | null): void {
    this.sourceFile = sourceFile;
  }

  /**
   * @see #getFullId()
   */
  override getId(): string {
    return this.id;
  }

  override match(_sentence: AnalyzedSentence): RuleMatch[] {
    return null as unknown as RuleMatch[];
  }

  /**
   * @since 2.3
   */
  getLanguage(): Language {
    return this.language;
  }

  setStartPositionCorrection(startPositionCorrection: number): void {
    this.startPositionCorrection = startPositionCorrection;
  }

  getStartPositionCorrection(): number {
    return this.startPositionCorrection;
  }

  setEndPositionCorrection(endPositionCorrection: number): void {
    this.endPositionCorrection = endPositionCorrection;
  }

  getEndPositionCorrection(): number {
    return this.endPositionCorrection;
  }

  /**
   * The rule id and its sub id, if any. The format is like {@code RULE_ID[SUB_ID]}, e.g. {@code WANT_TO[2]}.
   * @since 3.2
   * @see #getId()
   */
  override getFullId(): string {
    if (this.subId != null) {
      return this.id + '[' + this.subId + ']';
    } else {
      return this.id;
    }
  }

  /**
   * The rule id and its sub id, if any.
   * @since 3.2
   */
  getPatternRuleId(): PatternRuleId {
    if (this.subId != null) {
      return new PatternRuleId(this.id, this.subId);
    } else {
      return new PatternRuleId(this.id);
    }
  }

  override getSubId(): string | null {
    return this.subId;
  }

  setSubId(subId: string | null): void {
    this.subId = subId;
  }

  /**
   * @since 2.3
   */
  isGroupsOrUnification(): boolean {
    return this.groupsOrUnification;
  }

  /**
   * @since 2.3
   */
  isGetUnified(): boolean {
    return this.getUnified;
  }

  /**
   * @since 2.3
   */
  isSentStart(): boolean {
    return this.sentStart;
  }

  /**
   * @since 2.3
   */
  isTestUnification(): boolean {
    return this.testUnification;
  }

  /**
   * @since 2.3
   */
  getPatternTokens(): PatternToken[] | null {
    return this.patternTokens;
  }

  /** Add formatted suggestion elements. */
  addSuggestionMatch(m: Match): void {
    if (this.suggestionMatches == null) {
      this.suggestionMatches = [];
    }
    this.suggestionMatches.push(m);
  }

  /** Add formatted suggestion elements outside message. */
  addSuggestionMatchOutMsg(m: Match): void {
    if (this.suggestionMatchesOutMsg == null) {
      this.suggestionMatchesOutMsg = [];
    }
    this.suggestionMatchesOutMsg.push(m);
  }

  getSuggestionMatches(): Match[] {
    return this.suggestionMatches == null ? [] : this.suggestionMatches;
  }

  getSuggestionMatchesOutMsg(): Match[] {
    return this.suggestionMatchesOutMsg == null ? [] : this.suggestionMatchesOutMsg;
  }

  getSuggestionsOutMsg(): string {
    return this.suggestionsOutMsg!;
  }

  /**
   * Get the message shown to the user if this rule matches.
   */
  getMessage(): string {
    return this.message!;
  }

  /**
   * Set the message shown to the user if this rule matches.
   */
  setMessage(message: string): void {
    this.message = message;
  }

  /** @since 2.7 (public since 3.2) */
  setFilter(filter: RuleFilter | null): void {
    this.filter = filter;
  }

  /** @since 2.7 (public since 3.2) */
  getFilter(): RuleFilter | null {
    return this.filter;
  }

  /** @since 2.7 (public since 3.2) */
  setFilterArguments(filterArgs: string | null): void {
    this.filterArgs = filterArgs;
  }

  /** @since 2.7 (public since 3.2) */
  getFilterArguments(): string | null {
    return this.filterArgs;
  }

  /**
   * Set up the list of antipatterns used to immunize tokens, i.e., make them
   * non-matchable by the current rule. Useful for multi-word complex exceptions,
   * such as multi-word idiomatic expressions.
   * @param antiPatterns A list of antiPatterns, implemented as {@code DisambiguationPatternRule}.
   * @since 2.5
   */
  setAntiPatterns(antiPatterns: readonly DisambiguationPatternRule[]): void {
    if (this.antiPatterns == null) {
      this.antiPatterns = [];
    }
    this.antiPatterns.push(...antiPatterns);
  }

  /**
   * @since 3.1
   */
  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns == null ? [] : this.antiPatterns;
  }

  /**
   * @return String of short message as specified in &lt;short&gt;...&lt;/short&gt;
   * @since 4.4
   */
  getShortMessage(): string {
    return '';
  }

  /**
   * Determines the match type, based on the type variable if set (to allow overriding) or {@link org.languagetool.rules.Rule#getLocQualityIssueType()}
   * @since 5.7
   * @return The match type for the matches created by this rule
   */
  getType(): RuleMatch_Type | null {
    if (this.type == null) {
      const issueType = this.getLocQualityIssueType();
      if (issueType === ITSIssueType.Style || issueType === ITSIssueType.LocaleViolation || issueType === ITSIssueType.Register) {
        // interpret the issue type - this is what the clients have done so far before there was RuleMatch.Type
        return RuleMatch_Type.Hint;
      } else {
        // default type as defined in RuleMatch
        return RuleMatch_Type.Other;
      }
    }
    return this.type;
  }

  /**
   * Allows overriding the match type, otherwise determined by {@link org.languagetool.rules.Rule#getLocQualityIssueType()}
   * @since 5.7
   * @param type the desired match type
   */
  setType(type: RuleMatch_Type | null): void {
    this.type = type;
  }

  /**
   * Allows adjusting the behavior of uppercasing suggestions when the matched text started with an upper-case letter
   */
  isAdjustSuggestionCase(): boolean {
    return this.adjustSuggestionCase;
  }

  /**
   * Allows adjusting the behavior of uppercasing suggestions when the matched text started with an upper-case letter
   */
  setAdjustSuggestionCase(adjustSuggestionCase: boolean): void {
    this.adjustSuggestionCase = adjustSuggestionCase;
  }

  setXmlLineNumber(lineNumber: number): void {
    this.lineNumber = lineNumber;
  }

  /**
   * Returns the line in the XML file where this rule is located. Will return <code>-1</code>
   * if the line isn't known.
   */
  getXmlLineNumber(): number {
    return this.lineNumber;
  }
}
