// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternRuleHandler.java faithful
// The three constructors are one: (sourceFile = null, lang = null). The language is used as
// given (Java looks the same language up again with Languages.getLanguageForShortCode); a rule
// file without a language passed in is not supported (Languages is not ported). External
// entities (RuleEntityResolver) are not resolved: the rule files use internal ones only.
// Rules whose filter class is not ported are skipped (see XMLRuleHandler.setRuleFilter).
import type { Language } from '../../Language.ts';
import { ResourceBundleTools } from '../../ResourceBundleTools.ts';
import { Category, Location as Category_Location } from '../Category.ts';
import { CategoryId } from '../CategoryId.ts';
import { CorrectExample } from '../CorrectExample.ts';
import { ErrorTriggeringExample } from '../ErrorTriggeringExample.ts';
import { IncorrectExample } from '../IncorrectExample.ts';
import { ITSIssueType } from '../ITSIssueType.ts';
import { DisambiguationPatternRule, DisambiguatorAction } from '../../tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Pattern, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import type { Attributes } from '../../../../../../jdk/org/xml/sax/DefaultHandler.ts';
import type { AbstractPatternRule } from './AbstractPatternRule.ts';
import type { Match } from './Match.ts';
import { PatternRule } from './PatternRule.ts';
import type { PatternToken } from './PatternToken.ts';
import { RegexPatternRule } from './RegexPatternRule.ts';
import { parseJavaInt } from './RuleFilter.ts';
import { RegexpMode, XMLRuleHandler } from './XMLRuleHandler.ts';

const H = XMLRuleHandler;

export class PatternRuleHandler extends XMLRuleHandler {

  static override readonly TYPE = 'type';

  static readonly MARKER_TAG = '<marker>';
  static readonly RAW_TAG = 'raw_pos';
  static readonly PLEASE_SPELL_ME = '<pleasespellme/>';

  private static readonly EXTERNAL = 'external';

  protected readonly sourceFile: string | null;

  protected category: Category | null = null;
  protected categoryIssueType: string | null = null;
  protected ruleGroupIssueType: string | null = null;
  protected ruleIssueType: string | null = null;
  protected name: string | null = null;
  protected filterClassName: string | null = null;
  protected filterArgs: string | null = null;

  private readonly rulegroupAntiPatterns: DisambiguationPatternRule[] = [];
  private readonly ruleAntiPatterns: DisambiguationPatternRule[] = [];
  private subId = 0;
  private interpretPosTagsPreDisambiguation = false;

  private defaultOff = false;
  private defaultTempOff = false;
  private ruleGroupDefaultOff = false;
  private ruleGroupDefaultTempOff = false;

  private ruleGroupDescription: string | null = null;
  private startPos = -1;
  private endPos = -1;
  private tokenCountForMarker = 0;

  private antiPatternCounter = 0;

  private inRule = false;

  private relaxedMode = false;
  private inAntiPattern = false;

  private isRuleSuppressMisspelled = false;
  private isSuggestionSuppressMisspelled = false;

  private minPrevMatches = 0;
  private ruleGroupMinPrevMatches = 0;
  private distanceTokens = 0;
  private ruleGroupDistanceTokens = 0;

  private idPrefix: string | null = null;

  constructor(sourceFile: string | null = null, lang: Language | null = null) {
    super();
    this.sourceFile = sourceFile;
    if (lang != null) {
      this.language = lang;
    }
  }

  /**
   * If set to true, don't throw an exception if id or name is not set.
   * Used for online rule editor.
   * @since 2.1
   */
  setRelaxedMode(relaxedMode: boolean): void {
    this.relaxedMode = relaxedMode;
  }

  // ===========================================================
  // SAX DocumentHandler methods
  // ===========================================================

  override startElement(_namespaceURI: string, _lName: string,
                        qName: string, attrs: Attributes): void {
    switch (qName) {
      case 'category': {
        const catName = attrs.getValue(H.NAME);
        this.premiumCategoryAttribute = attrs.getValue(H.PREMIUM); //check if all rules should be premium by default in this category
        const catId = attrs.getValue(H.ID);
        const location = H.YES === attrs.getValue(PatternRuleHandler.EXTERNAL) ?
          Category_Location.EXTERNAL : Category_Location.INTERNAL;
        const onByDefault = H.OFF !== attrs.getValue(H.DEFAULT);
        const tabName = attrs.getValue(H.TABNAME);
        this.category = new Category(new CategoryId(catId!), catName!, location, onByDefault, tabName);
        if (attrs.getValue(PatternRuleHandler.TYPE) != null) {
          this.categoryIssueType = attrs.getValue(PatternRuleHandler.TYPE);
        }
        if (attrs.getValue('tags') != null) {
          this.categoryTags.push(...StringSplit(attrs.getValue('tags')!, ' '));
        }
        if (attrs.getValue('tone_tags') != null) {
          this.categoryToneTags.push(...StringSplit(attrs.getValue('tone_tags')!, ' '));
        }
        this.isGoalSpecificCategoryAttribute = attrs.getValue(H.GOAL_SPECIFIC);
        const prioCategoryAttributeValue = attrs.getValue(H.PRIO);
        if (prioCategoryAttributeValue != null) {
          this.prioCategoryAttribute = parseJavaInt(prioCategoryAttributeValue);
        }
        break;
      }
      case 'rules': {
        const languageStr = attrs.getValue('lang');
        this.premiumFileAttribute = attrs.getValue(H.PREMIUM); //check if all rules should be premium by default in this file
        this.idPrefix = attrs.getValue('idprefix');
        if (this.language == null) {
          throw new Error("RuntimeException: no language given for rule file with lang='" + languageStr + "' (Languages.getLanguageForShortCode is not ported)");
        }
        this.messages = ResourceBundleTools.getMessageBundle(this.language);
        break;
      }
      case 'regexp':
        this.inRegex = true;
        this.regexMode = 'exact' === attrs.getValue('type') ? RegexpMode.EXACT : RegexpMode.SMART;
        this.regexCaseSensitive = attrs.getValue(H.CASE_SENSITIVE) != null && H.YES === attrs.getValue(H.CASE_SENSITIVE);
        this.regexpMark = attrs.getValue(H.MARK) != null ? parseJavaInt(attrs.getValue(H.MARK)!) : 0;
        break;
      case H.RULE: {
        this.xmlLineNumber = this.pLocator!.getLineNumber();
        this.regex = '';
        this.inRule = true;
        this.shortMessage = '';
        this.message = '';
        this.suggestionsOutMsg = '';
        this.url = '';
        this.id = attrs.getValue(H.ID);
        this.name = attrs.getValue(H.NAME);
        const minPrevMatchesStr = attrs.getValue(H.MINPREVMATCHES);
        if (minPrevMatchesStr != null) {
          if (this.inRuleGroup && this.ruleGroupMinPrevMatches > 0) {
            throw new Error('RuntimeException: Rule group ' + this.ruleGroupId + ' has ' + H.MINPREVMATCHES + '=' + this.ruleGroupMinPrevMatches
                + ', thus rule ' + this.id + ' cannot specify ' + H.MINPREVMATCHES);
          }
          this.minPrevMatches = parseJavaInt(minPrevMatchesStr);
        } else {
          this.minPrevMatches = this.ruleGroupMinPrevMatches;
        }
        const distanceTokensStr = attrs.getValue(H.DISTANCETOKENS);
        if (distanceTokensStr != null) {
          if (this.inRuleGroup && this.ruleGroupDistanceTokens > 0) {
            throw new Error('RuntimeException: Rule group ' + this.ruleGroupId + ' has ' + H.DISTANCETOKENS + '=' + this.ruleGroupDistanceTokens
                + ', thus rule ' + this.id + ' cannot specify ' + H.DISTANCETOKENS);
          }
          this.distanceTokens = parseJavaInt(distanceTokensStr);
        } else {
          this.distanceTokens = this.ruleGroupDistanceTokens;
        }
        const premiumRule = attrs.getValue(H.PREMIUM);
        //check if this rule is premium
        if (premiumRule != null) {
          if (H.YES === premiumRule) {
            this.isPremiumRule = true;
          } else if (H.NO === premiumRule) {
            this.isPremiumRule = false;
          }
        } else if (this.premiumRuleGroupAttribute != null) {
          if (H.YES === this.premiumRuleGroupAttribute) {
            this.isPremiumRule = true;
          } else if (H.NO === this.premiumRuleGroupAttribute) {
            this.isPremiumRule = false;
          }
        } else if (this.premiumCategoryAttribute != null) {
          if (H.YES === this.premiumCategoryAttribute) {
            this.isPremiumRule = true;
          } else if (H.NO === this.premiumCategoryAttribute) {
            this.isPremiumRule = false;
          }
        } else if (this.premiumFileAttribute != null) {
          if (H.YES === this.premiumFileAttribute) {
            this.isPremiumRule = true;
          } else if (H.NO === this.premiumFileAttribute) {
            this.isPremiumRule = false;
          }
        } else {
          this.isPremiumRule = false;
        }
        if (this.inRuleGroup) {
          this.subId++;
          if (this.id == null) {
            this.id = this.ruleGroupId;
          }
          if (this.name == null) {
            this.name = this.ruleGroupDescription;
          }
        }
        if (this.id == null && !this.relaxedMode) {
          throw new Error("RuntimeException: id is null for rule with name '" + this.name + "'");
        }
        this.id = this.idPrefix != null ? this.idPrefix + this.id : this.id;
        if (this.inRuleGroup && this.ruleGroupDefaultOff && attrs.getValue(H.DEFAULT) != null) {
          throw new Error('RuntimeException: Rule group ' + this.ruleGroupId + ' is off by default, thus a subrule of ' + this.id + " cannot specify 'default=...'. \u001b[1m Remove 'default=...' from rule group or subrule level in " + this.ruleGroupId + '!\u001b[0m');
        }
        if (this.inRuleGroup && this.ruleGroupDefaultTempOff && attrs.getValue(H.DEFAULT) != null) {
          throw new Error('RuntimeException: Rule group ' + this.ruleGroupId + ' is off by default, thus a subrule of ' + this.id + " cannot specify 'default=...'. \u001b[1m Remove 'default=...' from rule group or subrule level in " + this.ruleGroupId + '!\u001b[0m');
        }
        if (this.inRuleGroup && this.ruleGroupDefaultOff) {
          this.defaultOff = true;
        } else if (this.inRuleGroup && this.ruleGroupDefaultTempOff) {
          this.defaultTempOff = true;
        } else {
          this.defaultOff = H.OFF === attrs.getValue(H.DEFAULT);
          this.defaultTempOff = H.TEMP_OFF === attrs.getValue(H.DEFAULT);
        }
        this.correctExamples = [];
        this.antipatternExamples = [];
        this.incorrectExamples = [];
        this.errorTriggeringExamples = [];
        this.suggestionMatches.length = 0;
        this.suggestionMatchesOutMsg.length = 0;
        if (attrs.getValue(PatternRuleHandler.TYPE) != null) {
          this.ruleIssueType = attrs.getValue(PatternRuleHandler.TYPE);
        }
        this.isRuleSuppressMisspelled = false;
        if (attrs.getValue('tags') != null) {
          this.ruleTags.push(...StringSplit(attrs.getValue('tags')!, ' '));
        }
        if (attrs.getValue('tone_tags') != null) {
          this.ruleToneTags.push(...StringSplit(attrs.getValue('tone_tags')!, ' '));
        }
        const isGoalSpecificRule = attrs.getValue(H.GOAL_SPECIFIC);
        //check if this rule is goal specific
        if (isGoalSpecificRule != null) {
          if (H.TRUE === isGoalSpecificRule) {
            this.isGoalSpecific = true;
          } else if (H.FALSE === isGoalSpecificRule) {
            this.isGoalSpecific = false;
          }
        } else if (this.isGoalSpecificRuleGroupAttribute != null) {
          if (H.TRUE === this.isGoalSpecificRuleGroupAttribute) {
            this.isGoalSpecific = true;
          } else if (H.FALSE === this.isGoalSpecificRuleGroupAttribute) {
            this.isGoalSpecific = false;
          }
        } else if (this.isGoalSpecificCategoryAttribute != null) {
          if (H.TRUE === this.isGoalSpecificCategoryAttribute) {
            this.isGoalSpecific = true;
          } else if (H.FALSE === this.isGoalSpecificCategoryAttribute) {
            this.isGoalSpecific = false;
          }
        } else {
          this.isGoalSpecific = false;
        }
        const prioRuleAttributeValue = attrs.getValue(H.PRIO);
        if (prioRuleAttributeValue != null) {
          this.prioRuleAttribute = parseJavaInt(prioRuleAttributeValue);
        }
        break;
      }
      case H.PATTERN:
        this.startPattern(attrs);
        this.tokenCountForMarker = 0;
        this.interpretPosTagsPreDisambiguation = H.YES === attrs.getValue(PatternRuleHandler.RAW_TAG);
        break;
      case H.ANTIPATTERN:
        this.xmlLineNumberAntiPattern = this.pLocator!.getLineNumber();
        this.inAntiPattern = true;
        this.antiPatternCounter++;
        this.caseSensitive = H.YES === attrs.getValue(H.CASE_SENSITIVE);
        this.tokenCounter = 0;
        this.tokenCountForMarker = 0;
        break;
      case H.AND:
        this.inAndGroup = true;
        this.tokenCountForMarker++;
        break;
      case H.OR:
        this.inOrGroup = true;
        this.tokenCountForMarker++;
        break;
      case H.UNIFY:
        this.inUnification = true;
        this.uniNegation = H.YES === attrs.getValue(H.NEGATE);
        break;
      case H.UNIFY_IGNORE:
        this.inUnificationNeutral = true;
        break;
      case H.FEATURE:
        this.uFeature = attrs.getValue(H.ID);
        break;
      case PatternRuleHandler.TYPE:
        this.uType = attrs.getValue(H.ID);
        this.uTypeList.push(this.uType!);
        break;
      case H.TOKEN:
        this.setToken(attrs);
        if (!this.inAndGroup && !this.inOrGroup) {
          this.tokenCountForMarker++;
        }
        break;
      case H.EXCEPTION:
        this.setExceptions(attrs);
        break;
      case H.EXAMPLE: {
        const typeVal = attrs.getValue(PatternRuleHandler.TYPE);
        if (this.inAntiPattern) {
          if (this.inRuleGroup && !this.inRule) {
            this.inAntiPatternForRuleGroupExample = true;
            this.antiPatternForRuleGroupExample = '';
          } else {
            this.inAntiPatternExample = true;
            this.antiPatternExample = '';
          }
        } else if ('incorrect' === typeVal || attrs.getValue('correction') != null) {
          this.inIncorrectExample = true;
          this.incorrectExample = '';
          if (attrs.getValue('correction') != null) {
            this.exampleCorrection = '';
            this.exampleCorrection += attrs.getValue('correction');
          }
        } else if ('triggers_error' === typeVal) {
          this.inErrorTriggerExample = true;
          this.errorTriggerExample = '';
        } else {
          // no attribute implies the sentence is a correct example
          this.inCorrectExample = true;
          this.correctExample = '';
        }
        break;
      }
      case 'filter':
        this.filterClassName = attrs.getValue('class');
        this.filterArgs = attrs.getValue('args');
        break;
      case H.MESSAGE:
        this.inMessage = true;
        this.inSuggestion = false;
        this.message = '';
        this.isRuleSuppressMisspelled = H.YES === attrs.getValue('suppress_misspelled');
        if (this.isRuleSuppressMisspelled) {
          this.message += PatternRuleHandler.PLEASE_SPELL_ME;
        }
        break;
      case H.SUGGESTION: {
        let strToAppend = '<suggestion>';
        this.isSuggestionSuppressMisspelled = H.YES === attrs.getValue('suppress_misspelled');
        if (this.isSuggestionSuppressMisspelled || this.isRuleSuppressMisspelled) {
          strToAppend = strToAppend + PatternRuleHandler.PLEASE_SPELL_ME;
        }
        if (this.inMessage) {
          this.message += strToAppend;
        } else { // suggestions outside message
          this.suggestionsOutMsg += strToAppend;
        }
        this.inSuggestion = true;
        break;
      }
      case 'short':
        if (this.inRule) {
          this.inShortMessage = true;
          this.shortMessage = '';
        } else {
          this.inShortMessageForRuleGroup = true;
          this.shortMessageForRuleGroup = '';
        }
        break;
      case 'url':
        if (this.inRule) {
          this.inUrl = true;
          this.url = '';
        } else {
          this.inUrlForRuleGroup = true;
          this.urlForRuleGroup = '';
        }
        break;
      case H.RULEGROUP: {
        this.ruleGroupId = attrs.getValue(H.ID);
        this.premiumRuleGroupAttribute = attrs.getValue(H.PREMIUM);
        this.ruleGroupDescription = attrs.getValue(H.NAME);
        this.ruleGroupDefaultOff = H.OFF === attrs.getValue(H.DEFAULT);
        this.ruleGroupDefaultTempOff = H.TEMP_OFF === attrs.getValue(H.DEFAULT);
        this.urlForRuleGroup = '';
        this.shortMessageForRuleGroup = '';
        this.inRuleGroup = true;
        this.subId = 0;
        if (attrs.getValue(PatternRuleHandler.TYPE) != null) {
          this.ruleGroupIssueType = attrs.getValue(PatternRuleHandler.TYPE);
        }
        if (attrs.getValue('tags') != null) {
          this.ruleGroupTags.push(...StringSplit(attrs.getValue('tags')!, ' '));
        }
        if (attrs.getValue('tone_tags') != null) {
          this.ruleGroupToneTags.push(...StringSplit(attrs.getValue('tone_tags')!, ' '));
        }
        this.isGoalSpecificRuleGroupAttribute = attrs.getValue(H.GOAL_SPECIFIC);
        const minPrevMatchesStr2 = attrs.getValue(H.MINPREVMATCHES);
        if (minPrevMatchesStr2 != null) {
          this.ruleGroupMinPrevMatches = parseJavaInt(minPrevMatchesStr2);
        }
        const distanceTokensStr2 = attrs.getValue(H.DISTANCETOKENS);
        if (distanceTokensStr2 != null) {
          this.ruleGroupDistanceTokens = parseJavaInt(distanceTokensStr2);
        }
        this.antipatternForRuleGroupsExamples = [];
        const prioRuleGroupAttributeValue = attrs.getValue(H.PRIO);
        if (prioRuleGroupAttributeValue != null) {
          this.prioRuleGroupAttribute = parseJavaInt(prioRuleGroupAttributeValue);
        }
        break;
      }
      case H.MATCH:
        this.setMatchElement(attrs, this.inSuggestion && (this.isSuggestionSuppressMisspelled || this.isRuleSuppressMisspelled));
        break;
      case H.MARKER:
        if (this.inMarker) {
          throw new Error("IllegalStateException: '<marker>' may not be nested in rule '" + this.id + "'");
        }
        if (this.inIncorrectExample) {
          this.incorrectExample += PatternRuleHandler.MARKER_TAG;
        } else if (this.inCorrectExample) {
          this.correctExample += PatternRuleHandler.MARKER_TAG;
        } else if (this.inErrorTriggerExample) {
          this.errorTriggerExample += PatternRuleHandler.MARKER_TAG;
        } else if (this.inPattern || this.inAntiPattern) {
          this.startPos = this.tokenCounter;
          this.inMarker = true;
        }
        break;
      case H.UNIFICATION:
        this.uFeature = attrs.getValue('feature');
        this.inUnificationDef = true;
        break;
      case 'equivalence':
        this.uType = attrs.getValue(PatternRuleHandler.TYPE);
        break;
      case H.PHRASES:
        this.inPhrases = true;
        break;
      case 'includephrases':
        break;
      case 'phrase':
        if (this.inPhrases) {
          this.phraseId = attrs.getValue(H.ID);
        }
        break;
      case 'phraseref':
        if (attrs.getValue('idref') != null) {
          this.preparePhrase(attrs);
          this.tokenCountForMarker++;
        }
        break;
    }
  }

  override endElement(_namespaceURI: string, _sName: string,
      qName: string): void {
    switch (qName) {
      case 'category':
        this.categoryIssueType = null;
        this.categoryTags.length = 0;
        this.categoryToneTags.length = 0;
        this.isGoalSpecific = false;
        this.premiumCategoryAttribute = null;
        this.isGoalSpecificCategoryAttribute = null;
        this.prioCategoryAttribute = 0;
        break;
      case 'regexp':
        this.inRegex = false;
        break;
      case H.RULE:
        this.suggestionMatchesOutMsg = this.addLegacyMatches(this.suggestionMatchesOutMsg, this.suggestionsOutMsg, false);
        if (this.relaxedMode && this.id == null) {
          this.id = '';
        }
        if (this.relaxedMode && this.name == null) {
          this.name = '';
        }
        if (this.phrasePatternTokens.length === 0) {
          // Elements contain information whether they are inside a <marker>...</marker>,
          // but for phraserefs this depends on the position where the phraseref is used
          // not where it's defined. Thus we have to copy the elements so each use of
          // the phraseref can carry their own information:
          const tmpPatternTokens: PatternToken[] = [];
          this.createRules([...this.patternTokens], tmpPatternTokens, 0);
        } else {
          if (this.patternTokens.length !== 0) {
            for (const ph of this.phrasePatternTokens) {
              ph.push(...this.patternTokens);
            }
          }
          for (const phrasePatternToken of this.phrasePatternTokens) {
            this.processElement(phrasePatternToken);
            const tmpPatternTokens: PatternToken[] = [];
            this.createRules(phrasePatternToken, tmpPatternTokens, 0);
          }
        }
        this.patternTokens.length = 0;
        if (this.phrasePatternTokens != null) {
          this.phrasePatternTokens.length = 0;
        }
        this.ruleIssueType = null;
        this.inRule = false;
        this.filterClassName = null;
        this.filterArgs = null;
        this.minPrevMatches = 0;
        this.distanceTokens = 0;
        this.ruleTags.length = 0;
        this.ruleToneTags.length = 0;
        this.isPremiumRule = false;
        this.isGoalSpecific = false;
        this.prioRuleAttribute = 0;
        break;
      case H.EXCEPTION:
        this.finalizeExceptions();
        break;
      case H.AND:
        this.inAndGroup = false;
        this.andGroupCounter = 0;
        this.tokenCounter++;
        break;
      case H.OR:
        this.inOrGroup = false;
        this.orGroupCounter = 0;
        this.tokenCounter++;
        break;
      case H.TOKEN:
        this.finalizeTokens(this.language!.getUnifierConfiguration());
        break;
      case H.PATTERN:
        this.inPattern = false;
        if (this.lastPhrase) {
          this.patternTokens.length = 0;
        }
        this.tokenCounter = 0;
        break;
      case H.ANTIPATTERN: {
        let antiId = this.id;
        if (this.inRuleGroup) {
          if (this.subId > 0) {
            antiId = this.ruleGroupId + '[' + this.subId + ']';
          } else {
            antiId = this.ruleGroupId;
          }
        }
        const rule = new DisambiguationPatternRule(
            antiId + '_antipattern:' + this.antiPatternCounter,
            'antipattern', this.language!, this.patternTokens, null, null,
            DisambiguatorAction.IMMUNIZE);
        rule.setXmlLineNumber(this.xmlLineNumberAntiPattern);
        if (this.startPos !== -1 && this.endPos !== -1) {
          rule.setStartPositionCorrection(this.startPos);
          rule.setEndPositionCorrection(this.endPos - this.tokenCountForMarker);
        } else {
          // No '<marker>'? Then add artificial <marker>s around all tokens to work
          // around issue https://github.com/languagetool-org/languagetool/issues/189:
          for (const patternToken of this.patternTokens) {
            patternToken.setInsideMarker(true);
          }
        }
        this.patternTokens.length = 0;
        if (this.inRule) {
          this.ruleAntiPatterns.push(rule);
        } else { // a rulegroup shares all antipatterns not included in a single rule
          this.rulegroupAntiPatterns.push(rule);
        }
        this.tokenCounter = 0;
        this.inAntiPattern = false;
        this.endPos = -1;
        this.startPos = -1;
        this.inAntiPatternExample = false;
        this.xmlLineNumberAntiPattern = -1;
        break;
      }
      case H.EXAMPLE:
        if (this.inAntiPatternExample) {
          this.antipatternExamples.push(new CorrectExample(this.antiPatternExample));
        } else if (this.inAntiPatternForRuleGroupExample) {
          this.antipatternForRuleGroupsExamples.push(new CorrectExample(this.antiPatternForRuleGroupExample));
        } else if (this.inCorrectExample) {
          this.correctExamples.push(new CorrectExample(this.correctExample));
        } else if (this.inIncorrectExample) {
          if (this.inAntiPattern) {
            throw new Error("RuntimeException: <antipattern>s can only contain <example>s without errors (i.e. no 'correction=...'). " +
              'Rule id: ' + this.id + '[' + this.subId + '], antipattern no ' + this.antiPatternCounter);
          }
          let example: IncorrectExample;
          if (this.exampleCorrection == null) {
            example = new IncorrectExample(this.incorrectExample);
          } else {
            const corrections = [...StringSplit(this.exampleCorrection, '\\|')];
            if (this.exampleCorrection.endsWith('|')) {  // suggestions plus an empty suggestion (split() will ignore trailing empty items)
              corrections.push('');
            }
            example = new IncorrectExample(this.incorrectExample, corrections);
          }
          this.incorrectExamples.push(example);
        } else if (this.inErrorTriggerExample) {
          this.errorTriggeringExamples.push(new ErrorTriggeringExample(this.errorTriggerExample));
        }
        this.inCorrectExample = false;
        this.inIncorrectExample = false;
        this.inErrorTriggerExample = false;
        this.correctExample = '';
        this.incorrectExample = '';
        this.errorTriggerExample = '';
        this.exampleCorrection = null;
        this.antiPatternExample = '';
        this.antiPatternForRuleGroupExample = '';
        this.inAntiPatternExample = false;
        this.inAntiPatternForRuleGroupExample = false;
        break;
      case H.MESSAGE:
        this.suggestionMatches = this.addLegacyMatches(this.suggestionMatches, this.message, true);
        this.inMessage = false;
        break;
      case H.SUGGESTION:
        if (this.inMessage) {
          this.message += '</suggestion>';
        } else { //suggestion outside message
          this.suggestionsOutMsg += '</suggestion>';
        }
        this.inSuggestion = false;
        break;
      case 'short':
        this.inShortMessage = false;
        this.inShortMessageForRuleGroup = false;
        break;
      case 'url':
        this.inUrl = false;
        this.inUrlForRuleGroup = false;
        break;
      case H.MATCH:
        if (this.inMessage) {
          this.suggestionMatches[this.suggestionMatches.length - 1]!.
              setLemmaString(this.match);
        } else if (this.inSuggestion) {
          this.suggestionMatchesOutMsg[this.suggestionMatchesOutMsg.length - 1]!.
              setLemmaString(this.match);
        } else if (this.inToken) {
          this.tokenReference!.setLemmaString(this.match);
        }
        this.inMatch = false;
        break;
      case H.RULEGROUP:
        this.urlForRuleGroup = '';
        this.shortMessageForRuleGroup = '';
        this.inRuleGroup = false;
        this.ruleGroupIssueType = null;
        this.rulegroupAntiPatterns.length = 0;
        this.antiPatternCounter = 0;
        this.ruleGroupDefaultOff = false;
        this.ruleGroupDefaultTempOff = false;
        this.defaultOff = false;
        this.defaultTempOff = false;
        this.ruleGroupMinPrevMatches = 0;
        this.ruleGroupDistanceTokens = 0;
        this.ruleGroupTags.length = 0;
        this.ruleGroupToneTags.length = 0;
        this.premiumRuleGroupAttribute = null;
        this.isGoalSpecificRuleGroupAttribute = null;
        this.antipatternForRuleGroupsExamples.length = 0;
        this.prioRuleGroupAttribute = 0;
        break;
      case H.MARKER:
        if (this.inCorrectExample) {
          this.correctExample += '</marker>';
        } else if (this.inIncorrectExample) {
          this.incorrectExample += '</marker>';
        } else if (this.inErrorTriggerExample) {
          this.errorTriggerExample += '</marker>';
        } else if (this.inPattern || this.inAntiPattern) {
          this.endPos = this.tokenCountForMarker;
          this.inMarker = false;
        }
        break;
      case 'phrase':
        if (this.inPhrases) {
          this.finalizePhrase();
        }
        break;
      case 'includephrases':
        this.patternTokens.length = 0;
        break;
      case H.PHRASES:
        if (this.inPhrases) {
          this.inPhrases = false;
        }
        break;
      case H.UNIFICATION:
        this.inUnificationDef = false;
        break;
      case H.FEATURE:
        this.equivalenceFeatures.set(this.uFeature!, this.uTypeList);
        this.uTypeList = [];
        break;
      case H.UNIFY: {
        this.inUnification = false;
        //clear the features...
        this.equivalenceFeatures = new Map();
        //set negation on the last token only!
        const lastElement = this.patternTokens.length - 1;
        this.patternTokens[lastElement]!.setLastInUnification();
        if (this.uniNegation) {
          this.patternTokens[lastElement]!.setUniNegation();
        }
        break;
      }
      case H.UNIFY_IGNORE:
        this.inUnificationNeutral = false;
        break;
    }
  }

  /**
   * Create rule from an Element list.
   * In case of OR groups, several rules are created recursively.
   * @since 2.3
   *
   * @param elemList The complete original Element list
   * @param tmpPatternTokens Temporary list being created
   * @param numElement Index of elemList being analyzed
   */
  private createRules(elemList: PatternToken[],
    tmpPatternTokens: PatternToken[], numElement: number): void {
    let shortMessage = '';
    if (this.shortMessage != null && this.shortMessage.length > 0) {
      shortMessage = this.shortMessage;
    } else if (this.shortMessageForRuleGroup != null && this.shortMessageForRuleGroup.length > 0) {
      shortMessage = this.shortMessageForRuleGroup;
    }
    if (this.minPrevMatches > 0 && shortMessage === '' && this.messages != null) {
      // it's a word repetition rule
      shortMessage = this.messages.getString('desc_repetition_short');
    }
    if (numElement >= elemList.length) {
      let rule: AbstractPatternRule;
      if (tmpPatternTokens.length > 0) {
        rule = new PatternRule(this.id!, this.language!, tmpPatternTokens, this.name!,
          this.message, shortMessage,
          this.suggestionsOutMsg, this.phrasePatternTokens.length > 1, this.interpretPosTagsPreDisambiguation);
        rule.addTags(this.ruleTags);
        rule.addTags(this.ruleGroupTags);
        rule.addTags(this.categoryTags);
        rule.addToneTags(this.ruleToneTags);
        rule.addToneTags(this.ruleGroupToneTags);
        rule.setSourceFile(this.sourceFile);
        rule.setMinPrevMatches(this.minPrevMatches);
        rule.setDistanceTokens(this.distanceTokens);
        rule.setXmlLineNumber(this.xmlLineNumber);
      } else if (this.regex.length > 0) {
        const flags = this.regexCaseSensitive ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
        let regexStr = this.regex;
        if (this.regexMode === RegexpMode.SMART) {
          // Note: it's not that easy to add \b because the regex might look like '(foo)' or '\d' so we cannot just look at the last character
          regexStr = this.replaceSpacesInRegex(regexStr);
        }
        if (this.ruleAntiPatterns.length > 0 || this.rulegroupAntiPatterns.length > 0) {
          throw new Error('RuntimeException: <regexp> rules currently cannot be used together with <antipattern>. Rule id: ' + this.id + '[' + this.subId + ']');
        }
        rule = new RegexPatternRule(this.id!, this.name!, this.message, shortMessage, this.suggestionsOutMsg, this.language!, Pattern.compile(regexStr, flags), this.regexpMark);
        rule.setSourceFile(this.sourceFile);
      } else {
        throw new Error("IllegalStateException: Neither '<pattern>' tokens nor '<regexp>' is set in rule '" + this.id + "'");
      }
      const filterFound = this.setRuleFilter(this.filterClassName, this.filterArgs, rule);
      this.prepareRule(rule);
      if (filterFound) {
        this.rules.push(rule);
      }
    } else {
      const patternToken = elemList[numElement]!;
      if (patternToken.hasOrGroup()) {
        // When creating a new rule, we finally clear the backed-up variables. All the elements in
        // the OR group should share the values of backed-up variables. That's why these variables
        // are backed-up.
        const suggestionMatchesBackup: Match[] = [...this.suggestionMatches];
        const suggestionMatchesOutMsgBackup: Match[] = [...this.suggestionMatchesOutMsg];
        const startPosBackup = this.startPos;
        const endPosBackup = this.endPos;
        const ruleAntiPatternsBackup = [...this.ruleAntiPatterns];
        for (const patternTokenOfOrGroup of patternToken.getOrGroup()) {
          const tmpElements2: PatternToken[] = [];
          tmpElements2.push(...tmpPatternTokens);
          tmpElements2.push(patternTokenOfOrGroup.clone());
          this.createRules(elemList, tmpElements2, numElement + 1);
          this.startPos = startPosBackup;
          this.endPos = endPosBackup;
          this.suggestionMatches = suggestionMatchesBackup;
          this.suggestionMatchesOutMsg = suggestionMatchesOutMsgBackup;
          this.ruleAntiPatterns.push(...ruleAntiPatternsBackup);
        }
      }
      tmpPatternTokens.push(patternToken.clone());
      this.createRules(elemList, tmpPatternTokens, numElement + 1);
    }
  }

  replaceSpacesInRegex(s: string): string {
    let sb = '';
    let inBracket = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charAt(i);
      if (c === '[') {
        inBracket = true;
      } else if (c === ']') {
        inBracket = false;
      }
      if (c === ' ' && !inBracket) {
        sb += '(?:[\\s  ]+)';
      } else {
        sb += c;
      }
    }
    return sb;
  }

  protected prepareRule(rule: AbstractPatternRule): void {
    rule.setPremium(this.isPremiumRule);
    rule.setSourceFile(this.sourceFile);
    if (this.startPos !== -1 && this.endPos !== -1) {
      rule.setStartPositionCorrection(this.startPos);
      rule.setEndPositionCorrection(this.endPos - this.tokenCountForMarker);
    }
    this.startPos = -1;
    this.endPos = -1;
    const allCorrectExamples: CorrectExample[] = [];
    allCorrectExamples.push(...this.correctExamples);
    allCorrectExamples.push(...this.antipatternExamples);
    allCorrectExamples.push(...this.antipatternForRuleGroupsExamples);
    if (allCorrectExamples.length !== 0) {
      rule.setCorrectExamples(allCorrectExamples);
    }
    if (this.incorrectExamples.length !== 0) {
      rule.setIncorrectExamples(this.incorrectExamples);
    }
    if (this.errorTriggeringExamples.length !== 0) {
      rule.setErrorTriggeringExamples(this.errorTriggeringExamples);
    }
    rule.setCategory(this.category!);
    if (this.rulegroupAntiPatterns.length !== 0) {
      rule.setAntiPatterns(this.rulegroupAntiPatterns);
    }
    if (this.ruleAntiPatterns.length !== 0) {
      rule.setAntiPatterns(this.ruleAntiPatterns);
      this.ruleAntiPatterns.length = 0;
    }
    rule.addTags(this.ruleTags);
    rule.addTags(this.ruleGroupTags);
    rule.addTags(this.categoryTags);
    rule.addToneTags(this.ruleToneTags);
    rule.addToneTags(this.ruleGroupToneTags);
    rule.addToneTags(this.categoryToneTags);
    rule.setGoalSpecific(this.isGoalSpecific);
    if (this.inRuleGroup) {
      rule.setSubId(String(this.subId));
    } else {
      rule.setSubId('1');
    }
    this.caseSensitive = false;
    for (const m of this.suggestionMatches) {
      rule.addSuggestionMatch(m);
    }
    if (this.phrasePatternTokens.length <= 1) {
      this.suggestionMatches.length = 0;
    }
    for (const m of this.suggestionMatchesOutMsg) {
      rule.addSuggestionMatchOutMsg(m);
    }
    this.suggestionMatchesOutMsg.length = 0;
    if (this.category == null) {
      throw new Error("RuntimeException: Cannot activate rule '" + this.id + "', it is outside of a <category>...</category>");
    }
    if (this.defaultOff) {
      rule.setDefaultOff();
    }
    if (this.defaultTempOff) {
      rule.setDefaultTempOff();
    }
    if (this.url != null && this.url.length > 0) {
      try {
        const s = this.url;
        rule.setUrl(this.internUrl(s));
      } catch (e) {
        throw new Error('RuntimeException: Could not parse URL for rule: ' + rule.toString() + ": '" + this.url + "'", { cause: e });
      }
    } else if (this.urlForRuleGroup != null && this.urlForRuleGroup.length > 0) {
      try {
        rule.setUrl(this.internUrl(this.urlForRuleGroup));
      } catch (e) {
        throw new Error('RuntimeException: Could not parse URL for rule: ' + rule.toString() + ": '" + this.urlForRuleGroup + "'", { cause: e });
      }
    }
    // inheritance of values - if no type value is defined for a rule, take the rule group's value etc:
    if (this.ruleIssueType != null) {
      rule.setLocQualityIssueType(ITSIssueType.getIssueType(this.ruleIssueType));
    } else if (this.ruleGroupIssueType != null) {
      rule.setLocQualityIssueType(ITSIssueType.getIssueType(this.ruleGroupIssueType));
    } else if (this.categoryIssueType != null) {
      rule.setLocQualityIssueType(ITSIssueType.getIssueType(this.categoryIssueType));
    }
    let prio = 0;
    if (this.prioCategoryAttribute !== 0) {
      prio = this.prioCategoryAttribute;
    }
    if (this.prioRuleGroupAttribute !== 0) {
      prio = this.prioRuleGroupAttribute;
    }
    if (this.prioRuleAttribute !== 0) {
      prio = this.prioRuleAttribute;
    }
    rule.setPriority(prio);
  }

  private readonly internedUrls = new Map<string, string>();

  /** URLs are strings (as in Rule); new URL() checks them as Java's does. */
  private internUrl(s: string): string {
    let url = this.internedUrls.get(s);
    if (url == null) {
      new URL(s); // throws on a malformed URL
      url = s;
      this.internedUrls.set(s, url);
    }
    return url;
  }

  override characters(buf: string, offset: number, len: number): void {
    const s = buf.substring(offset, offset + len);
    if (this.inException) {
      this.exceptions += s;
    } else if (this.inToken) {
      this.elements += s;
    } else if (this.inCorrectExample) {
      this.correctExample += s;
    } else if (this.inAntiPatternExample) {
      this.antiPatternExample += s;
    } else if (this.inAntiPatternForRuleGroupExample) {
      this.antiPatternForRuleGroupExample += s;
    } else if (this.inIncorrectExample) {
      this.incorrectExample += s;
    } else if (this.inErrorTriggerExample) {
      this.errorTriggerExample += s;
    } else if (this.inMatch) {
      this.match += s;
    } else if (this.inMessage) {
      this.message += s;
    } else if (this.inSuggestion) {  //Suggestion outside message
      this.suggestionsOutMsg += s;
    } else if (this.inShortMessage) {
      this.shortMessage += s;
    } else if (this.inShortMessageForRuleGroup) {
      this.shortMessageForRuleGroup += s;
    } else if (this.inUrl) {
      this.url += s;
    } else if (this.inUrlForRuleGroup) {
      this.urlForRuleGroup += s;
    } else if (this.inRegex) {
      this.regex += s;
    }
  }

}
