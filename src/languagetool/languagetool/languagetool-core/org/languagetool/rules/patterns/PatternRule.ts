// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternRule.java partial
// toXML() (PatternRuleXmlCreator, which re-reads the XML files) is left out. The four
// constructors are one: (id, language, patternTokens, description, message, shortMessage,
// suggestionsOutMsg = '', isMember = false, interpretPosTagsPreDisambiguation = false).
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import { JLanguageTool } from '../../JLanguageTool.ts';
import type { Language } from '../../Language.ts';
import { RuleMatch } from '../RuleMatch.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';
import { AbstractTokenBasedRule } from './AbstractTokenBasedRule.ts';
import { PatternRuleMatcher } from './PatternRuleMatcher.ts';
import type { PatternToken } from './PatternToken.ts';
import type { RuleMatcher } from './RuleMatcher.ts';

/**
 * A Rule that describes a language error as a simple pattern of words or of
 * part-of-speech tags.
 *
 * @author Daniel Naber
 */
export class PatternRule extends AbstractTokenBasedRule {

  private readonly shortMessage: string;

  // A list of elements as they appear in XML file (phrases count as single tokens in case of matches or skipping).
  private readonly elementNo: number[];

  // This property is used for short-circuiting evaluation of the elementNo list order:
  private readonly useList: boolean;

  private interpretPosTagsPreDisambiguation = false;

  // Marks whether the rule is a member of a disjunctive set (in case of OR operation on phraserefs).
  private isMemberOfDisjunctiveSet = false;

  /**
   * @param id Id of the Rule. Used in configuration. Should not contain special characters and should
   *        be stable over time, unless the rule changes completely.
   * @param language Language of the Rule
   * @param description Description to be shown (name)
   * @param message Message to be displayed to the user
   * @param shortMessage Message to be displayed to the user in the context menu in OpenOffice.org/LibreOffice
   */
  constructor(id: string, language: Language,
      patternTokens: PatternToken[], description: string,
      message: string, shortMessage: string, suggestionsOutMsg = '',
      isMember = false, interpretPosTagsPreDisambiguation = false) {
    super(id, description, language, patternTokens, false);
    this.message = Objects_requireNonNull(message);
    this.shortMessage = Objects_requireNonNull(shortMessage);
    this.elementNo = [];
    Objects_requireNonNull(suggestionsOutMsg);
    this.suggestionsOutMsg = suggestionsOutMsg === '' ? '' : suggestionsOutMsg;
    let prevName: string | null = '';
    let curName: string | null;
    let cnt = 0;
    let loopCnt = 0;
    let tempUseList = false;

    for (const pToken of patternTokens) {
      if (pToken.isPartOfPhrase()) {
        curName = pToken.getPhraseName();
        if (StringTools.isEmpty(prevName) || prevName === curName) {
          cnt++;
          tempUseList = true;
        } else {
          this.elementNo.push(cnt);
          curName = '';
          cnt = 0;
        }
        prevName = curName;
        loopCnt++;
        if (loopCnt === this.patternTokens!.length && !StringTools.isEmpty(prevName)) {
          this.elementNo.push(cnt);
        }
      } else {
        if (cnt > 0) {
          this.elementNo.push(cnt);
        }
        this.elementNo.push(1);
        loopCnt++;
      }
    }
    this.useList = tempUseList;
    this.isMemberOfDisjunctiveSet = isMember;
    this.interpretPosTagsPreDisambiguation = interpretPosTagsPreDisambiguation;
  }

  override estimateContextForSureMatch(): number {
    let extendAfterMarker = 0;
    let markerSeen = false;
    for (const pToken of this.patternTokens!) {
      if (markerSeen && !pToken.isInsideMarker()) {
        extendAfterMarker++;
      }
      if (JLanguageTool.SENTENCE_END_TAGNAME === pToken.getPOStag()) {
        // e.g. for DT_JJ_NO_NOUN and all rules that match the sentence end
        extendAfterMarker++;
      }
      if (pToken.isInsideMarker()) {
        markerSeen = true;
      }
      if (pToken.getSkipNext() === -1) {
        return -1;
      } else {
        extendAfterMarker += pToken.getSkipNext();
      }
    }
    const antiPatternLengths = this.getAntiPatterns().map((p) => p.patternTokens!.length);
    const longestAntiPattern = antiPatternLengths.length === 0 ? 0 : Math.max(...antiPatternLengths);
    let longestSkip = 0;
    for (const antiPattern of this.getAntiPatterns()) {
      for (const token of antiPattern.getPatternTokens()!) {
        if (token.getSkipNext() === -1) {
          return -1;
        } else if (token.getSkipNext() > longestSkip) {
          longestSkip = token.getSkipNext();
        }
      }
    }
    //System.out.println("extendAfterMarker: " + extendAfterMarker + ", antiPatternLengths: " + antiPatternLengths + ", longestSkip: " + longestSkip);
    return extendAfterMarker + Math.max(longestAntiPattern, longestAntiPattern + longestSkip);
  }

  /**
   * Whether any POS tags from this rule should refer to the POS tags of the analyzed
   * sentence *before* disambiguation.
   * @since 4.5
   */
  isInterpretPosTagsPreDisambiguation(): boolean {
    return this.interpretPosTagsPreDisambiguation;
  }

  /**
   * Used for testing rules: only one of the set can match.
   * @return Whether the rule can non-match (as a member of disjunctive set of
   *         rules generated by phraseref in includephrases element).
   */
  isWithComplexPhrase(): boolean {
    return this.isMemberOfDisjunctiveSet;
  }

  /** Reset complex status - used for testing. **/
  notComplexPhrase(): void {
    this.isMemberOfDisjunctiveSet = false;
  }

  /**
   * Return the pattern as a string, using toString() on the pattern elements.
   * @since 0.9.2
   */
  toPatternString(): string {
    const strList: string[] = [];
    for (const patternPatternToken of this.patternTokens!) {
      strList.push(patternPatternToken.toString());
    }
    return strList.join(', ');
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    if (this.canBeIgnoredFor(sentence)) return RuleMatch.EMPTY_ARRAY as RuleMatch[];

    const matcher: RuleMatcher = new PatternRuleMatcher(this, this.useList);
    return this.checkForAntiPatterns(sentence, matcher, matcher.match(sentence));

  }

  private checkForAntiPatterns(sentence: AnalyzedSentence, matcher: RuleMatcher, matches: RuleMatch[] | null): RuleMatch[] {
    if (matches != null && matches.length > 0 && this.getAntiPatterns().length !== 0) {
      const immunized = this.getSentenceWithImmunization(sentence);
      if (immunized.getTokens().some((t) => t.isImmunized())) {
        return matcher.match(immunized);
      }
    }
    return matches!;
  }

  getElementNo(): number[] {
    return this.elementNo;
  }

  /* (non-Javadoc)
   * @see org.languagetool.rules.patterns.AbstractPatternRule#getShortMessage()
   */
  override getShortMessage(): string {
    return this.shortMessage;
  }

}
