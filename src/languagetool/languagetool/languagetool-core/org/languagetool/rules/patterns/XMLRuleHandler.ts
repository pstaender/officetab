// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/XMLRuleHandler.java faithful
// StringBuilders are strings; the Triple keys of the intern maps are joined strings. One addition:
// setRuleFilter returns false (instead of letting Java's RuntimeException abort the file) when the
// filter class has not been ported (registered) yet, and records a warning in
// missingFilterWarnings; the callers then skip the rule (see RuleFilterCreator).
import type { Language } from '../../Language.ts';
import { ChunkTag } from '../../chunking/ChunkTag.ts';
import type { CorrectExample } from '../CorrectExample.ts';
import type { ErrorTriggeringExample } from '../ErrorTriggeringExample.ts';
import type { IncorrectExample } from '../IncorrectExample.ts';
import type { DisambiguationPatternRule } from '../../tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { StringTrim } from '../../../../../../jdk/java/lang/Character.ts';
import { type Attributes, DefaultHandler, type Locator, SAXException } from '../../../../../../jdk/org/xml/sax/DefaultHandler.ts';
import type { AbstractPatternRule } from './AbstractPatternRule.ts';
import { CaseConversion, IncludeRange, Match, valueOf } from './Match.ts';
import { PatternToken, PosToken } from './PatternToken.ts';
import { FilterClassNotFound } from './registry.ts';
import { RegexRuleFilterCreator } from './RegexRuleFilterCreator.ts';
import { parseJavaInt } from './RuleFilter.ts';
import { RuleFilterCreator } from './RuleFilterCreator.ts';
import { StringMatcher } from './StringMatcher.ts';
import type { UnifierConfiguration } from './UnifierConfiguration.ts';

export const RegexpMode = {
  SMART: 'SMART', EXACT: 'EXACT',
} as const;
export type RegexpMode = typeof RegexpMode[keyof typeof RegexpMode];

/**
 * XML rule handler that loads rules from XML and throws
 * exceptions on errors and warnings.
 *
 * @author Daniel Naber
 */
export class XMLRuleHandler extends DefaultHandler {

  static readonly ID = 'id';
  static readonly NAME = 'name';

  /** Definitions of values in XML files. */
  protected static readonly PREMIUM = 'premium';
  protected static readonly YES = 'yes';
  protected static readonly OFF = 'off';
  protected static readonly GOAL_SPECIFIC = 'is_goal_specific';
  protected static readonly TRUE = 'true';
  protected static readonly FALSE = 'false';
  protected static readonly TEMP_OFF = 'temp_off';
  protected static readonly ON = 'on';
  protected static readonly POSTAG = 'postag';
  protected static readonly CHUNKTAG = 'chunk';
  protected static readonly CHUNKTAG_REGEXP = 'chunk_re';
  protected static readonly POSTAG_REGEXP = 'postag_regexp';
  protected static readonly REGEXP = 'regexp';
  protected static readonly NEGATE = 'negate';
  protected static readonly INFLECTED = 'inflected';
  protected static readonly NEGATE_POS = 'negate_pos';
  protected static readonly MARKER = 'marker';
  protected static readonly DEFAULT = 'default';
  protected static readonly TYPE = 'type';
  protected static readonly SPACEBEFORE = 'spacebefore';
  protected static readonly EXAMPLE = 'example';
  protected static readonly SCOPE = 'scope';
  protected static readonly IGNORE = 'ignore';
  protected static readonly SKIP = 'skip';
  protected static readonly MIN = 'min';
  protected static readonly MAX = 'max';
  protected static readonly TOKEN = 'token';
  protected static readonly FEATURE = 'feature';
  protected static readonly UNIFY = 'unify';
  protected static readonly UNIFY_IGNORE = 'unify-ignore';
  protected static readonly AND = 'and';
  protected static readonly OR = 'or';
  protected static readonly EXCEPTION = 'exception';
  protected static readonly CASE_SENSITIVE = 'case_sensitive';
  protected static readonly MARK = 'mark';
  protected static readonly PATTERN = 'pattern';
  protected static readonly ANTIPATTERN = 'antipattern';
  protected static readonly MATCH = 'match';
  protected static readonly UNIFICATION = 'unification';
  protected static readonly RULE = 'rule';
  protected static readonly RULES = 'rules';
  protected static readonly RULEGROUP = 'rulegroup';
  protected static readonly NO = 'no';
  protected static readonly PHRASES = 'phrases';
  protected static readonly MESSAGE = 'message';
  protected static readonly SUGGESTION = 'suggestion';
  protected static readonly TABNAME = 'tab';
  protected static readonly MINPREVMATCHES = 'min_prev_matches';
  protected static readonly DISTANCETOKENS = 'distance_tokens';
  protected static readonly PRIO = 'prio';

  protected rules: AbstractPatternRule[] = [];
  protected language: Language | null = null;
  protected messages: { getString(key: string): string } | null = null; // ResourceBundle

  /** Rules skipped because their filter class is not ported (registered): "id: className". */
  protected missingFilterWarnings: string[] = [];

  protected correctExample = '';
  protected antiPatternExample = '';
  protected antiPatternForRuleGroupExample = '';
  protected incorrectExample = '';
  protected errorTriggerExample = '';
  protected exampleCorrection: string | null = null;
  protected message = '';
  protected suggestionsOutMsg = '';
  protected match = '';
  protected elements = '';
  protected exceptions = '';

  protected correctExamples: CorrectExample[] = [];
  protected antipatternExamples: CorrectExample[] = [];
  protected antipatternForRuleGroupsExamples: CorrectExample[] = [];
  protected incorrectExamples: IncorrectExample[] = [];
  protected errorTriggeringExamples: ErrorTriggeringExample[] = [];

  protected inPattern = false;
  protected inCorrectExample = false;
  protected inIncorrectExample = false;
  protected inErrorTriggerExample = false;
  protected inAntiPatternExample = false;
  protected inAntiPatternForRuleGroupExample = false;
  protected inMessage = false;
  protected inSuggestion = false;
  protected inMatch = false;
  protected inRuleGroup = false;
  protected inToken = false;
  protected inException = false;
  protected inPhrases = false;
  protected inAndGroup = false;
  protected inOrGroup = false;

  protected tokenSpaceBefore = false;
  protected tokenSpaceBeforeSet = false;
  protected posToken: string | null = null;
  protected chunkTag: ChunkTag | null = null;
  protected posNegation = false;
  protected posRegExp = false;

  protected caseSensitive = false;
  protected regExpression = false;
  protected tokenNegated = false;
  protected tokenInflected = false;
  protected premiumRuleGroupAttribute: string | null = null;
  protected premiumCategoryAttribute: string | null = null;
  protected premiumFileAttribute: string | null = null;
  protected isPremiumRule = false;
  protected categoryTags: string[] = [];
  protected ruleGroupTags: string[] = [];
  protected ruleGroupToneTags: string[] = [];
  protected categoryToneTags: string[] = [];
  protected ruleTags: string[] = [];
  protected ruleToneTags: string[] = [];
  protected isGoalSpecificCategoryAttribute: string | null = null;
  protected isGoalSpecificRuleGroupAttribute: string | null = null;
  protected isGoalSpecific = false;
  protected prioCategoryAttribute = 0;
  protected prioRuleGroupAttribute = 0;
  protected prioRuleAttribute = 0;

  protected tokenLevelCaseSensitive = false;
  protected tokenLevelCaseSet = false;

  protected exceptionPosToken: string | null = null;
  protected exceptionStringRegExp = false;
  protected exceptionStringNegation = false;
  protected exceptionStringInflected = false;
  protected exceptionPosNegation = false;
  protected exceptionPosRegExp = false;
  protected exceptionValidNext = false;
  protected exceptionValidPrev = false;
  protected exceptionSet = false;
  protected exceptionSpaceBefore = false;
  protected exceptionSpaceBeforeSet = false;

  protected exceptionLevelCaseSensitive: boolean | null = null;
  protected exceptionLevelCaseSet = false;

  /** List of elements as specified by tokens. */
  protected patternTokens: PatternToken[] = [];

  /** true when phraseref is the last element in the rule. */
  protected lastPhrase = false;

  /** ID reference to the phrase. */
  protected phraseIdRef: string | null = null;

  /** Current phrase ID. */
  protected phraseId: string | null = null;
  protected skipPos = 0;
  protected minOccurrence = 1;
  protected maxOccurrence = 1;
  protected ruleGroupId: string | null = null;
  protected id: string | null = null;
  protected patternToken: PatternToken | null = null;
  protected tokenReference: Match | null = null;
  protected suggestionMatches: Match[] = [];
  protected suggestionMatchesOutMsg: Match[] = [];
  protected pLocator: Locator | null = null;
  protected xmlLineNumber = -1;
  protected xmlLineNumberAntiPattern = -1;

  protected startPositionCorrection = 0;
  protected endPositionCorrection = 0;
  protected tokenCounter = 0;

  /** Phrase store - elementLists keyed by phraseIds. */
  protected phraseMap: Map<string | null, PatternToken[][]> | null = null;

  /**
   * Logically forking element list, used for including multiple phrases in the
   * current one.
   */
  protected phrasePatternTokens: PatternToken[][] = [];

  protected andGroupCounter = 0;
  protected orGroupCounter = 0;

  protected inUrl = false;
  protected inUrlForRuleGroup = false;
  protected url = '';
  protected urlForRuleGroup = '';

  protected inRegex = false;
  protected regex = '';
  protected regexMode: RegexpMode = RegexpMode.SMART;
  protected regexCaseSensitive = false;
  protected regexpMark = 0;

  protected inShortMessage = false;
  protected inShortMessageForRuleGroup = false;
  protected shortMessage = '';
  protected shortMessageForRuleGroup = '';

  protected inUnification = false;
  protected inMarker = false;
  protected inUnificationDef = false;
  protected uniNegation = false;
  protected inUnificationNeutral = false;

  protected uFeature: string | null = null;
  protected uType: string | null = '';

  protected uTypeList: string[] = [];
  protected equivalenceFeatures: Map<string, string[]> = new Map();

  constructor() {
    super();
  }

  getRules(): AbstractPatternRule[] {
    return this.rules;
  }

  /** Rules skipped because their filter class is not ported: "rule id: class name". */
  getMissingFilterWarnings(): string[] {
    return this.missingFilterWarnings;
  }

  override warning(e: SAXException): void {
    throw e;
  }

  override error(e: SAXException): void {
    throw e;
  }

  override setDocumentLocator(locator: Locator): void {
    this.pLocator = locator;
    super.setDocumentLocator(locator);
  }

  protected resetToken(): void {
    this.posNegation = false;
    this.posRegExp = false;
    this.inToken = false;
    this.tokenSpaceBefore = false;
    this.tokenSpaceBeforeSet = false;
    this.resetException();
    this.exceptionSet = false;
    this.tokenReference = null;
  }

  protected resetException(): void {
    this.exceptionStringNegation = false;
    this.exceptionStringInflected = false;
    this.exceptionPosNegation = false;
    this.exceptionPosRegExp = false;
    this.exceptionStringRegExp = false;
    this.exceptionValidNext = false;
    this.exceptionValidPrev = false;
    this.exceptionSpaceBefore = false;
    this.exceptionSpaceBeforeSet = false;
  }

  protected preparePhrase(attrs: Attributes): void {
    this.phraseIdRef = attrs.getValue('idref');
    if (this.phraseMap!.has(this.phraseIdRef)) {
      for (const curPhrTokens of this.phraseMap!.get(this.phraseIdRef)!) {
        for (const pToken of curPhrTokens) {
          pToken.setPhraseName(this.phraseIdRef!);
        }
        const copy = [...curPhrTokens];
        for (const patternToken of copy) {
          patternToken.setInsideMarker(this.inMarker);
        }
        if (this.patternTokens.length === 0) {
          this.phrasePatternTokens.push([...copy]);
        } else {
          const prevList = [...this.patternTokens];
          prevList.push(...copy);
          this.phrasePatternTokens.push([...prevList]);
          prevList.length = 0;
        }
      }
      this.lastPhrase = true;
    }
  }

  protected finalizePhrase(): void {
    // lazy init
    if (this.phraseMap == null) {
      this.phraseMap = new Map();
    }
    for (const patternToken of this.patternTokens) {
      patternToken.setInsideMarker(this.inMarker);
    }
    if (this.phrasePatternTokens.length === 0) {
      this.phrasePatternTokens.push([...this.patternTokens]);
    } else {
      for (const ph of this.phrasePatternTokens) {
        ph.push(...this.patternTokens);
      }
    }

    this.phraseMap.set(this.phraseId, [...this.phrasePatternTokens]);
    this.patternTokens.length = 0;

    this.phrasePatternTokens = [];
  }

  protected startPattern(attrs: Attributes): void {
    this.tokenCounter = 0;
    this.inPattern = true;
    this.caseSensitive = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.CASE_SENSITIVE);
  }

  /**
   * Calculates the offset of the match reference (if any) in case the match
   * element has been used in the group.
   *
   * @param patternTokens token list where the match element was used. It is directly changed.
   */
  protected processElement(patternTokens: PatternToken[]): void {
    let counter = 0;
    for (const pToken of patternTokens) {
        if (pToken.getPhraseName() != null && counter > 0 && pToken.isReferenceElement()) {
            const tokRef = pToken.getMatch()!.getTokenRef();
            pToken.getMatch()!.setTokenRef(tokRef + counter - 1);
            const offsetToken = pToken.getString().replaceAll('\\' + tokRef,
                    '\\' + (tokRef + counter - 1));
            pToken.setStringElement(offsetToken);
        }
      counter++;
    }
  }

  protected setMatchElement(attrs: Attributes, isSuppressMisspelled: boolean): void {
    this.inMatch = true;
    this.match = '';
    let caseConversion: CaseConversion = CaseConversion.NONE;
    if (attrs.getValue('case_conversion') != null) {
      caseConversion = valueOf(CaseConversion, attrs
          .getValue('case_conversion')!.toUpperCase());
    }
    let includeRange: IncludeRange = IncludeRange.NONE;
    if (attrs.getValue('include_skipped') != null) {
      includeRange = valueOf(IncludeRange, attrs
          .getValue('include_skipped')!.toUpperCase());
    }
    const mWorker = new Match(attrs.getValue(XMLRuleHandler.POSTAG), attrs.getValue('postag_replace'),
        XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.POSTAG_REGEXP),
        attrs.getValue('regexp_match'), attrs.getValue('regexp_replace'),
        caseConversion, XMLRuleHandler.YES === attrs.getValue('setpos'),
        isSuppressMisspelled,
        includeRange);
    mWorker.setInMessageOnly(!this.inSuggestion);
    if (this.inMessage) {
      this.suggestionMatches.push(mWorker);
      // add incorrect XML character for simplicity
      this.message += '\u0001\\';
      this.message += attrs.getValue('no');
      this.checkNumber(attrs);
    } else if (this.inSuggestion) {
      this.suggestionMatchesOutMsg.push(mWorker);
      // add incorrect XML character for simplicity
      this.suggestionsOutMsg += '\u0001\\';
      this.suggestionsOutMsg += attrs.getValue('no');
      this.checkNumber(attrs);
    } else if (this.inToken && attrs.getValue('no') != null) {
      const refNumber = parseJavaInt(attrs.getValue('no')!);
      this.checkRefNumber(refNumber);
      mWorker.setTokenRef(refNumber);
      this.tokenReference = mWorker;
      this.elements += '\\';
      this.elements += refNumber;
    }
  }

  private checkNumber(attrs: Attributes): void {
    if (StringTools.isEmpty(attrs.getValue('no'))) {
      throw new SAXException('References cannot be empty: ' + '\n Line: '
          + this.pLocator!.getLineNumber() + ', column: '
          + this.pLocator!.getColumnNumber() + '.');
    } else if (parseJavaInt(attrs.getValue('no')!) < 1 && this.regex.length === 0) {
      throw new SAXException('References must be larger than 0: '
          + attrs.getValue('no') + '\n Line: ' + this.pLocator!.getLineNumber()
          + ', column: ' + this.pLocator!.getColumnNumber() + '.');
    }
  }

  private checkRefNumber(refNumber: number): void {
    if (refNumber > this.patternTokens.length) {
      throw new SAXException('Only backward references in match elements are possible, tried to specify token '
          + refNumber + '\n' + 'Line: ' + this.pLocator!.getLineNumber()
          + ', column: ' + this.pLocator!.getColumnNumber() + '.');
    }
  }

  protected setExceptions(attrs: Attributes): void {
    this.inException = true;
    this.exceptions = '';
    this.resetException();

    this.exceptionStringNegation = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.NEGATE);
    this.exceptionValidNext = 'next' === attrs.getValue(XMLRuleHandler.SCOPE);
    this.exceptionValidPrev = 'previous' === attrs.getValue(XMLRuleHandler.SCOPE);
    this.exceptionStringInflected = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.INFLECTED);

    if (attrs.getValue(XMLRuleHandler.POSTAG) != null) {
      this.exceptionPosToken = attrs.getValue(XMLRuleHandler.POSTAG);
      this.exceptionPosRegExp = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.POSTAG_REGEXP);
      this.exceptionPosNegation = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.NEGATE_POS);
    }
    this.exceptionStringRegExp = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.REGEXP);
    if (attrs.getValue(XMLRuleHandler.SPACEBEFORE) != null) {
      this.exceptionSpaceBefore = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.SPACEBEFORE);
      this.exceptionSpaceBeforeSet = XMLRuleHandler.IGNORE !== attrs.getValue(XMLRuleHandler.SPACEBEFORE);
    }

    if (attrs.getValue(XMLRuleHandler.CASE_SENSITIVE) != null) {
      this.exceptionLevelCaseSet = true;
      this.exceptionLevelCaseSensitive = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.CASE_SENSITIVE);
    } else {
      this.exceptionLevelCaseSet = false;
    }
  }

  protected finalizeExceptions(): void {
    this.inException = false;
    if (!this.exceptionSet) {
      let tokenCase = this.caseSensitive;
      if (this.tokenLevelCaseSet) {
        tokenCase = this.tokenLevelCaseSensitive;
      }
      this.patternToken = PatternToken.create(this.tokenInflected, this.internMatcher(StringTrim(this.elements), this.regExpression, tokenCase));
      this.exceptionSet = true;
    }
    const patternToken = this.patternToken!;
    patternToken.setNegation(this.tokenNegated);
    if (!StringTools.isEmpty(this.exceptions) || this.exceptionPosToken != null) {
      if (this.hasPosixCharacterClass(this.exceptions)) {
        this.exceptionLevelCaseSensitive = true;
      }
      const caseSensitive = this.exceptionLevelCaseSensitive == null ? patternToken.isCaseSensitive() : this.exceptionLevelCaseSensitive;
      const exception = PatternToken.create(this.exceptionStringInflected, this.internMatcher(StringTrim(this.exceptions), this.exceptionStringRegExp, caseSensitive));
      exception.setNegation(this.exceptionStringNegation);
      exception.setPosToken(this.obtainPosToken(this.exceptionPosToken, this.exceptionPosRegExp, this.exceptionPosNegation));
      patternToken.addException(this.exceptionValidNext, this.exceptionValidPrev, exception);
      this.exceptionPosToken = null;
      this.exceptionLevelCaseSensitive = null;
    }
    if (this.exceptionSpaceBeforeSet) {
      patternToken.setExceptionSpaceBefore(this.exceptionSpaceBefore);
    }
    this.resetException();
  }

  // To be compatible with Java 15, we make p{Lu} and p{Ll} imply case-sensitivity,
  // see https://github.com/languagetool-org/languagetool/issues/4061
  private hasPosixCharacterClass(s: string): boolean {
    const res = s.includes('\\p{Lu}') || s.includes('\\p{Ll}');
    if (res && s.includes('(?i')) {
      throw new Error("RuntimeException: Contradicting regex contains both '?i' (case-insensitive) and \\p{Lu}/\\p{Ll} (case-sensitive): "
              + s + ' in rule ' + this.id);
    }
    return res;
  }

  protected setToken(attrs: Attributes): void {
    this.inToken = true;
    if (this.lastPhrase) {
      this.patternTokens.length = 0;
    }
    this.lastPhrase = false;
    this.tokenNegated = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.NEGATE);
    this.tokenInflected = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.INFLECTED);
    if (attrs.getValue(XMLRuleHandler.SKIP) != null) {
      this.skipPos = parseJavaInt(attrs.getValue(XMLRuleHandler.SKIP)!);
    }
    if (attrs.getValue(XMLRuleHandler.MIN) != null) {
      this.minOccurrence = parseJavaInt(attrs.getValue(XMLRuleHandler.MIN)!);
    }
    if (attrs.getValue(XMLRuleHandler.MAX) != null) {
      this.maxOccurrence = parseJavaInt(attrs.getValue(XMLRuleHandler.MAX)!);
    }
    this.elements = '';
    if (attrs.getValue(XMLRuleHandler.POSTAG) != null) {
      this.posToken = attrs.getValue(XMLRuleHandler.POSTAG);
      this.posRegExp = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.POSTAG_REGEXP);
      this.posNegation = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.NEGATE_POS);
    }
    if (attrs.getValue(XMLRuleHandler.CHUNKTAG) != null && attrs.getValue(XMLRuleHandler.CHUNKTAG_REGEXP) != null) {
      throw new SAXException("You cannot set both 'chunk' and 'chunk_re' for " + this.id);
    }
    if (attrs.getValue(XMLRuleHandler.CHUNKTAG) != null) {
      this.chunkTag = new ChunkTag(attrs.getValue(XMLRuleHandler.CHUNKTAG)!);
    } else if (attrs.getValue(XMLRuleHandler.CHUNKTAG_REGEXP) != null) {
      this.chunkTag = new ChunkTag(attrs.getValue(XMLRuleHandler.CHUNKTAG_REGEXP)!, true);
    }
    this.regExpression = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.REGEXP);
    if (attrs.getValue(XMLRuleHandler.SPACEBEFORE) != null) {
      this.tokenSpaceBefore = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.SPACEBEFORE);
      this.tokenSpaceBeforeSet = XMLRuleHandler.IGNORE !== attrs.getValue(XMLRuleHandler.SPACEBEFORE);
    }
    if (!this.inAndGroup && !this.inOrGroup) {
      this.tokenCounter++;
    }
    if (attrs.getValue(XMLRuleHandler.CASE_SENSITIVE) != null) {
      this.tokenLevelCaseSet = true;
      this.tokenLevelCaseSensitive = XMLRuleHandler.YES === attrs.getValue(XMLRuleHandler.CASE_SENSITIVE);
    } else {
      this.tokenLevelCaseSensitive = false;
      this.tokenLevelCaseSet = false;
    }
  }

  /**
   * Adds Match objects for all references to tokens
   * (including '\1' and the like).
   */
  protected addLegacyMatches(existingSugMatches: Match[], messageStr: string,
      inMessage: boolean): Match[] {
    const sugMatch: Match[] = [];
    let pos = 0;
    let ind = 0;
    let matchCounter = 0;
    while (pos !== -1) {
      pos = messageStr.indexOf('\\', ind);
      if (pos !== -1 && messageStr.length > pos && charIsDigit(messageStr, pos + 1)) {
        if (pos === 0 || messageStr.charAt(pos - 1) !== '\u0001') {
          const mWorker = new Match(null, null, false, null,
              null, CaseConversion.NONE, false, false, IncludeRange.NONE);
          mWorker.setInMessageOnly(true);
          sugMatch.push(mWorker);
        } else if (messageStr.charAt(pos - 1) === '\u0001') { // real suggestion marker
          sugMatch.push(existingSugMatches[matchCounter]!);
          if (inMessage) {
            this.message = deleteCharAt(this.message, pos - 1 - matchCounter);
          } else {
            this.suggestionsOutMsg = deleteCharAt(this.suggestionsOutMsg, pos - 1 - matchCounter);
          }
          matchCounter++;
        }
      }
      ind = pos + 1;
    }

    if (sugMatch.length === 0) {
      return existingSugMatches;
    }
    return sugMatch;
  }

  protected finalizeTokens(unifierConfiguration: UnifierConfiguration): void {
    if (!this.exceptionSet || this.patternToken == null) {
      let tokenCase = this.caseSensitive || this.hasPosixCharacterClass(this.elements);
      if (this.tokenLevelCaseSet) {
        tokenCase = this.tokenLevelCaseSensitive;
      }
      this.patternToken = PatternToken.create(this.tokenInflected, this.internMatcher(StringTrim(this.elements), this.regExpression, tokenCase));
      this.patternToken.setNegation(this.tokenNegated);
    } else {
      const caseSensitive = this.patternToken.isCaseSensitive() || this.hasPosixCharacterClass(this.elements);
      this.patternToken.setTextMatcher(this.internMatcher(StringTrim(this.elements), this.patternToken.isRegularExpression(), caseSensitive));
    }
    const patternToken = this.patternToken;
    if (this.skipPos !== 0) {
      patternToken.setSkipNext(this.skipPos);
      this.skipPos = 0;
    }
    if (this.minOccurrence === 0) {
      patternToken.setMinOccurrence(0);
    }
    if (this.maxOccurrence !== 1) {
      patternToken.setMaxOccurrence(this.maxOccurrence);
      this.maxOccurrence = 1;
    }
    if (this.posToken != null) {
      patternToken.setPosToken(this.obtainPosToken(this.posToken, this.posRegExp, this.posNegation));
      this.posToken = null;
    }
    if (this.chunkTag != null) {
      patternToken.setChunkTag(this.chunkTag);
      this.chunkTag = null;
    }
    if (this.tokenReference != null) {
      patternToken.setMatch(this.tokenReference);
    }
    if (this.inAndGroup && this.andGroupCounter > 0) {
      this.patternTokens[this.patternTokens.length - 1]!.setAndGroupElement(patternToken);
        if (this.minOccurrence !== 1 || this.maxOccurrence !== 1) {
            throw new SAXException('Please set min and max attributes on the ' +
                    'first token in the AND group.\n You attempted to set these ' +
                    'attributes on the token no. ' + (this.andGroupCounter + 1) + '.' + '\n Line: '
                    + this.pLocator!.getLineNumber() + ', column: '
                    + this.pLocator!.getColumnNumber() + '.');
        }
    } else if (this.inOrGroup && this.orGroupCounter > 0) {
      this.patternTokens[this.patternTokens.length - 1]!.setOrGroupElement(patternToken);
    } else {
      if (this.minOccurrence < 1) {
        this.patternTokens.push(patternToken);
      }
      for (let i = 1; i <= this.minOccurrence; i ++) {
        this.patternTokens.push(patternToken);
      }
      this.minOccurrence = 1;
    }
    if (this.inAndGroup) {
      this.andGroupCounter++;
    }
    if (this.inOrGroup) {
      this.orGroupCounter++;
    }
    if (this.inUnification) {
      patternToken.setUnification(this.equivalenceFeatures);
    }
    if (this.inUnificationNeutral) {
      patternToken.setUnificationNeutral();
    }
    patternToken.setInsideMarker(this.inMarker);
    if (this.inUnificationDef) {
      unifierConfiguration.setEquivalence(this.uFeature!, this.uType!, patternToken);
      this.patternTokens.length = 0;
    }
    if (this.tokenSpaceBeforeSet) {
      patternToken.setWhitespaceBefore(this.tokenSpaceBefore);
    }
    this.resetToken();
  }

  private obtainPosToken(posToken: string | null, regExp: boolean, negated: boolean): PosToken {
    const key = `${posToken}\u0000${regExp}\u0000${negated}`;
    let result = this.internedPos.get(key);
    if (result === undefined) {
      const matcher = regExp ? this.internMatcher(posToken, true, true) : null;
      result = new PosToken(posToken, regExp, negated, matcher);
      this.internedPos.set(key, result);
    }
    return result;
  }

  /**
   * Sets the filter of a rule. Returns false, with a warning in missingFilterWarnings, if the
   * filter class has not been ported (registered); Java would throw instead.
   */
  protected setRuleFilter(filterClassName: string | null, filterArgs: string | null, rule: AbstractPatternRule): boolean {
    if (filterClassName != null && filterArgs != null) {
      try {
        XMLRuleHandler.setRuleFilter(filterClassName, filterArgs, rule);
      } catch (e) {
        if (e instanceof FilterClassNotFound) {
          this.missingFilterWarnings.push(rule.getFullId() + ': ' + filterClassName);
          return false;
        }
        throw e;
      }
    }
    return true;
  }

  protected static setRuleFilter(filterClassName: string | null, filterArgs: string | null, rule: AbstractPatternRule): void {
    if (filterClassName != null && filterArgs != null) {
      // rule instanceof RegexPatternRule / PatternRule / DisambiguationPatternRule, by method, to keep
      // those modules out of this one's imports
      const r = rule as AbstractPatternRule & { setRegexFilter?: (f: unknown) => void; getElementNo?: unknown; getAction?: unknown };
      if (typeof r.setRegexFilter === 'function') {
        const creator = new RegexRuleFilterCreator();
        const filter = creator.getFilter(filterClassName);
        r.setRegexFilter(filter);
        rule.setFilterArguments(filterArgs);
      } else if (typeof r.getElementNo === 'function' || typeof r.getAction === 'function') {
        const filter = RuleFilterCreator.getInstance().getFilter(filterClassName);
        rule.setFilter(filter);
        rule.setFilterArguments(filterArgs);
      } else {
        throw new Error('RuntimeException: Rule ' + rule.getFullId() + ' of type ' + rule.constructor.name + ' cannot have a filter (' + filterClassName + ')');
      }
    }
  }

  private readonly internedMatchers = new Map<string, StringMatcher>();

  private internMatcher(text: string | null, regexp: boolean, caseSensitive: boolean): StringMatcher {
    text = PatternToken.normalizeTextPattern(text);
    const key = `${text}\u0000${regexp}\u0000${caseSensitive}`;
    let matcher = this.internedMatchers.get(key);
    if (matcher === undefined) {
      matcher = StringMatcher.create(text, regexp, caseSensitive);
      this.internedMatchers.set(key, matcher);
    }
    return matcher;
  }

  private readonly internedPos = new Map<string, PosToken>();

}

/** Character.isDigit(s.charAt(i)), with Java's exception outside the string. */
function charIsDigit(s: string, i: number): boolean {
  if (i >= s.length) throw new Error(`StringIndexOutOfBoundsException: index ${i}, length ${s.length}`);
  const c = s.charAt(i);
  return /\p{Nd}/u.test(c);
}

/** StringBuilder.deleteCharAt */
function deleteCharAt(s: string, i: number): string {
  return s.substring(0, i) + s.substring(i + 1);
}
