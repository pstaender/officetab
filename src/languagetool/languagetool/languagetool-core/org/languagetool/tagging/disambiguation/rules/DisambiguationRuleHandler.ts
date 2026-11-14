// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/rules/DisambiguationRuleHandler.java faithful
// The language is used as given (Java looks it up again with Languages.getLanguageForShortCode;
// Languages is not ported, so a language must be passed in). External entities are not resolved.
// Rules whose filter class is not ported are skipped (see XMLRuleHandler.setRuleFilter).
import { AnalyzedToken } from '../../../AnalyzedToken.ts';
import type { Language } from '../../../Language.ts';
import { CaseConversion, IncludeRange, Match, valueOf } from '../../../rules/patterns/Match.ts';
import { parseJavaInt } from '../../../rules/patterns/RuleFilter.ts';
import { XMLRuleHandler } from '../../../rules/patterns/XMLRuleHandler.ts';
import { type Attributes, SAXException } from '../../../../../../../jdk/org/xml/sax/DefaultHandler.ts';
import { DisambiguatedExample } from './DisambiguatedExample.ts';
import { DisambiguationPatternRule, DisambiguatorAction } from './DisambiguationPatternRule.ts';

const H = XMLRuleHandler;

const WD = 'wd';
const ACTION = 'action';
const DISAMBIG = 'disambig';

export class DisambiguationRuleHandler extends XMLRuleHandler {

  protected override rules: DisambiguationPatternRule[] = [];

  private inDisambiguation = false;
  private subId = 0;
  private name: string | null = null;
  private ruleGroupName: string | null = null;
  protected filterClassName: string | null = null;
  protected filterArgs: string | null = null;
  private disamb = '';
  private wd = '';
  private example = '';

  private antiPatternCounter = 0;
  private inRule = false;
  private rulegroupAntiPatterns: DisambiguationPatternRule[] | null = [];
  private ruleAntiPatterns: DisambiguationPatternRule[] | null = [];
  private inAntiPattern = false;

  private inWord = false;

  private disambiguatedPOS: string | null = null;

  private startPos = -1;
  private endPos = -1;
  private tokenCountForMarker = 0;

  private posSelector: Match | null = null;

  private uniCounter = 0;

  private newWdList: AnalyzedToken[] | null = null;
  private wdLemma: string | null = null;
  private wdPos: string | null = null;

  private inExample = false;
  private untouched = false;
  private untouchedExamples: string[] | null = null;
  private disambExamples: DisambiguatedExample[] | null = null;
  private input: string | null = null;
  private output: string | null = null;
  private readonly sourceFile: string;

  private disambigAction: DisambiguatorAction | null = null;

  constructor(lang: Language | null, xmlPath: string) {
    super();
    if (lang != null) {
      this.language = lang;
    }
    this.sourceFile = xmlPath;
  }

  getDisambRules(): DisambiguationPatternRule[] {
    return this.rules;
  }

  // ===========================================================
  // SAX DocumentHandler methods
  // ===========================================================

  override startElement(_namespaceURI: string, _lName: string,
                        qName: string, attrs: Attributes): void {
    switch (qName) {
      case H.RULE:
        this.inRule = true;
        this.id = attrs.getValue(H.ID);
        if (this.inRuleGroup) {
          this.subId++;
        }
        this.name = attrs.getValue(H.NAME);
        if (this.inRuleGroup && this.id == null) {
          this.id = this.ruleGroupId;
        }
        if (this.inRuleGroup && this.name == null) {
          this.name = this.ruleGroupName;
        }
        break;
      case 'rules':
        if (this.language == null) {
          throw new Error("RuntimeException: no language given for disambiguation file with lang='" + attrs.getValue('lang') + "' (Languages.getLanguageForShortCode is not ported)");
        }
        break;
      case H.PATTERN:
        this.inPattern = true;
        this.tokenCountForMarker = 0;
        if (attrs.getValue(H.CASE_SENSITIVE) != null && H.YES === attrs.getValue(H.CASE_SENSITIVE)) {
          this.caseSensitive = true;
        }
        break;
      case H.ANTIPATTERN:
        this.inAntiPattern = true;
        this.antiPatternCounter++;
        this.caseSensitive = H.YES === attrs.getValue(H.CASE_SENSITIVE);
        this.tokenCounter = 0;
        this.tokenCountForMarker = 0;
        break;
      case H.EXCEPTION:
        this.setExceptions(attrs);
        break;
      case H.AND:
        this.inAndGroup = true;
        this.tokenCountForMarker++;
        if (this.inUnification) {
          this.uniCounter++;
        }
        break;
      case H.UNIFY:
        this.inUnification = true;
        this.uniNegation = H.YES === attrs.getValue(H.NEGATE);
        this.uniCounter = 0;
        break;
      case H.UNIFY_IGNORE:
        this.inUnificationNeutral = true;
        break;
      case 'feature':
        this.uFeature = attrs.getValue(H.ID);
        break;
      case H.TYPE:
        this.uType = attrs.getValue(H.ID);
        this.uTypeList.push(this.uType!);
        break;
      case H.TOKEN:
        this.setToken(attrs);
        if (!this.inAndGroup) {
          this.tokenCountForMarker++;
        }
        break;
      case DISAMBIG:
        this.inDisambiguation = true;
        this.disambiguatedPOS = attrs.getValue(H.POSTAG);
        if (attrs.getValue(ACTION) == null) {
          // default mode:
          this.disambigAction = DisambiguatorAction.REPLACE;
        } else {
          this.disambigAction = valueOf(DisambiguatorAction, attrs.getValue(ACTION)!.toUpperCase());
        }
        this.disamb = '';
        break;
      case H.MATCH: {
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
        const mWorker = new Match(attrs.getValue(H.POSTAG), attrs
                .getValue('postag_replace'), H.YES === attrs.getValue(H.POSTAG_REGEXP), attrs
                .getValue('regexp_match'), attrs.getValue('regexp_replace'),
                caseConversion, H.YES === attrs.getValue('setpos'),
                H.YES === attrs.getValue('suppress_mispelled'),
                includeRange);
        if (this.inDisambiguation) {
          if (attrs.getValue(H.NO) != null) {
            const refNumber = parseJavaInt(attrs.getValue(H.NO)!);
            this.refNumberSanityCheck(refNumber);
            mWorker.setTokenRef(refNumber);
            this.posSelector = mWorker;
          }
        } else if (this.inToken && attrs.getValue(H.NO) != null) {
          const refNumber = parseJavaInt(attrs.getValue(H.NO)!);
          this.refNumberSanityCheck(refNumber);
          mWorker.setTokenRef(refNumber);
          this.tokenReference = mWorker;
          this.elements += '\\';
          this.elements += refNumber;
        }
        break;
      }
      case H.RULEGROUP:
        this.ruleGroupId = attrs.getValue(H.ID);
        this.ruleGroupName = attrs.getValue(H.NAME);
        this.inRuleGroup = true;
        this.subId = 0;
        if (this.rulegroupAntiPatterns != null) {
          this.rulegroupAntiPatterns.length = 0;
        }
        this.antiPatternCounter = 0;
        break;
      case H.UNIFICATION:
        this.uFeature = attrs.getValue(H.FEATURE);
        this.inUnificationDef = true;
        break;
      case 'equivalence':
        this.uType = attrs.getValue(H.TYPE);
        break;
      case WD:
        this.wdLemma = attrs.getValue('lemma');
        this.wdPos = attrs.getValue('pos');
        this.inWord = true;
        this.wd = '';
        break;
      case H.EXAMPLE:
        this.inExample = true;
        if (this.untouchedExamples == null) {
          this.untouchedExamples = [];
        }
        if (this.disambExamples == null) {
          this.disambExamples = [];
        }
        this.untouched = attrs.getValue(H.TYPE) === 'untouched';
        if (attrs.getValue(H.TYPE) === 'ambiguous') {
          this.input = attrs.getValue('inputform');
          this.output = attrs.getValue('outputform');
        }
        this.example = '';
        break;
      case 'filter':
        this.filterClassName = attrs.getValue('class');
        this.filterArgs = attrs.getValue('args');
        break;
      case H.MARKER:
        if (this.inMarker) {
          throw new Error("IllegalStateException: '<marker>' may not be nested in rule '" + this.id + "'");
        }
        this.example += '<marker>';
        if (this.inPattern || this.inAntiPattern) {
          this.startPos = this.tokenCounter;
          this.inMarker = true;
        }
        break;
    }
  }

  private refNumberSanityCheck(refNumber: number): void {
    if (refNumber > this.patternTokens.length) {
      throw new SAXException('Only backward references in match elements are possible, tried to specify token '
              + refNumber + '\n Line: ' + this.pLocator!.getLineNumber()
              + ', column: ' + this.pLocator!.getColumnNumber() + '.');
    }
  }

  override endElement(_namespaceURI: string, _sName: string,
                      qName: string): void {
    const language = this.language!;
    switch (qName) {
      case H.RULE: {
        const rule = new DisambiguationPatternRule(this.id!,
                this.name!, language, this.patternTokens, this.disambiguatedPOS, this.posSelector,
                this.disambigAction!);

        this.endPositionCorrection = this.endPos - this.tokenCountForMarker;
        if (this.startPos !== -1 && this.endPos !== -1) {
          rule.setStartPositionCorrection(this.startPos);
          rule.setEndPositionCorrection(this.endPositionCorrection);
        } else {
          this.startPos = 0;
          this.endPos = this.tokenCountForMarker;
        }
        rule.setSubId(this.inRuleGroup ? String(this.subId) : '1');

        const matchedTokenCount = this.endPos - this.startPos;
        if (this.newWdList != null) {
          if (this.disambigAction === DisambiguatorAction.ADDCHUNK ||
              this.disambigAction === DisambiguatorAction.ADD || this.disambigAction === DisambiguatorAction.REMOVE
                  || this.disambigAction === DisambiguatorAction.REPLACE) {
            if ((this.newWdList.length !== 0 && this.disambigAction === DisambiguatorAction.REPLACE)
                    && this.newWdList.length !== matchedTokenCount) {
              throw new SAXException(
                      language.getName() + ' rule error. The number of interpretations specified with wd: '
                              + this.newWdList.length
                              + ' must be equal to the number of matched tokens (' + matchedTokenCount + ')'
                              + '\n Line: ' + this.pLocator!.getLineNumber() + ', column: '
                              + this.pLocator!.getColumnNumber() + '.');
            }
            rule.setNewInterpretations(this.newWdList);
          }
          this.newWdList.length = 0;
        }
        this.caseSensitive = false;
        if (this.disambExamples != null) {
          rule.setExamples(this.disambExamples);
        }
        if (this.untouchedExamples != null) {
          rule.setUntouchedExamples(this.untouchedExamples);
        }
        const filterFound = this.setRuleFilter(this.filterClassName, this.filterArgs, rule);
        if (this.rulegroupAntiPatterns!.length !== 0) {
          rule.setAntiPatterns(this.rulegroupAntiPatterns!);
        }
        if (this.ruleAntiPatterns!.length !== 0) {
          rule.setAntiPatterns(this.ruleAntiPatterns!);
          this.ruleAntiPatterns!.length = 0;
        }
        if (filterFound) {
          this.rules.push(rule);
        }
        if (this.disambigAction === DisambiguatorAction.UNIFY && matchedTokenCount !== this.uniCounter) {
          throw new SAXException(language.getName() + ' rule error. The number unified tokens: '
                  + this.uniCounter + ' must be equal to the number of matched tokens: ' + matchedTokenCount
                  + '\n Line: ' + this.pLocator!.getLineNumber() + ', column: '
                  + this.pLocator!.getColumnNumber() + '.');
        }
        const singleTokenCorrection = this.endPos - this.startPos > 1;
        if ((!singleTokenCorrection && (this.disambigAction === DisambiguatorAction.FILTER || this.disambigAction === DisambiguatorAction.REPLACE))
                && (matchedTokenCount > 1)) {
          throw new SAXException(
                  language.getName() + ' rule error. Cannot replace or filter more than one token at a time.'
                          + '\n Line: ' + this.pLocator!.getLineNumber() + ', column: '
                          + this.pLocator!.getColumnNumber() + '.');
        }
        this.patternTokens.length = 0;
        this.posSelector = null;
        this.disambExamples = null;
        this.untouchedExamples = null;
        this.startPos = -1;
        this.endPos = -1;
        this.filterClassName = null;
        this.filterArgs = null;
        this.inRule = false;
        break;
      }
      case H.EXCEPTION:
        this.finalizeExceptions();
        break;
      case H.AND:
        this.inAndGroup = false;
        this.andGroupCounter = 0;
        this.tokenCounter++;
        break;
      case H.TOKEN:
        if (this.inUnification && !this.inAndGroup) {
          this.uniCounter++;
        }
        // The disambiguation Unifier is always in the default language variant
        this.finalizeTokens(language.getDefaultLanguageVariant().getDisambiguationUnifierConfiguration());
        break;
      case H.PATTERN:
        this.inPattern = false;
        this.tokenCounter = 0;
        break;
      case H.MATCH:
        if (this.inDisambiguation) {
          this.posSelector!.setLemmaString(this.match);
        } else if (this.inToken) {
          this.tokenReference!.setLemmaString(this.match);
        }
        this.inMatch = false;
        break;
      case DISAMBIG:
        this.inDisambiguation = false;
        break;
      case H.RULEGROUP:
        this.inRuleGroup = false;
        break;
      case H.UNIFICATION:
        if (this.inUnificationDef) {
          this.inUnificationDef = false;
          this.tokenCounter = 0;
        }
        break;
      case 'feature':
        this.equivalenceFeatures.set(this.uFeature!, this.uTypeList);
        this.uTypeList = [];
        break;
      case H.UNIFY: {
        this.inUnification = false;
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
      case WD:
        this.addNewWord(this.wd, this.wdLemma, this.wdPos);
        this.inWord = false;
        break;
      case H.ANTIPATTERN: {
        const disRule = new DisambiguationPatternRule(
                this.id + '_antipattern:' + this.antiPatternCounter,
                'antipattern', language, this.patternTokens, null, null,
                DisambiguatorAction.IMMUNIZE);
        if (this.startPos !== -1 && this.endPos !== -1) {
          disRule.setStartPositionCorrection(this.startPos);
          disRule.setEndPositionCorrection(this.endPos - this.tokenCountForMarker);
        }
        this.patternTokens.length = 0;
        if (this.inRule) {
          if (this.ruleAntiPatterns == null) {
            this.ruleAntiPatterns = [];
          }
          this.ruleAntiPatterns.push(disRule);
        } else { // a rulegroup shares all antipatterns not included in a single rule
          if (this.rulegroupAntiPatterns == null) {
            this.rulegroupAntiPatterns = [];
          }
          this.rulegroupAntiPatterns.push(disRule);
        }
        this.tokenCounter = 0;
        this.inAntiPattern = false;
        break;
      }
      case H.EXAMPLE:
        this.inExample = false;
        if (this.untouched) {
          this.untouchedExamples!.push(this.example);
        } else {
          this.disambExamples!.push(new DisambiguatedExample(this.example, this.input, this.output));
        }
        break;
      case H.MARKER:
        this.example += '</marker>';
        if (this.inPattern || this.inAntiPattern) {
          this.endPos = this.tokenCountForMarker;
          this.inMarker = false;
        }
        break;
    }
  }

  private addNewWord(word: string, lemma: string | null, pos: string | null): void {
    const newWd = new AnalyzedToken(word, pos, lemma);
    if (this.newWdList == null) {
      this.newWdList = [];
    }
    this.newWdList.push(newWd);
  }

  override characters(buf: string, offset: number, len: number): void {
    const s = buf.substring(offset, offset + len);
    if (this.inException) {
      this.exceptions += s;
    } else if (this.inToken && (this.inPattern || this.inAntiPattern)) {
      this.elements += s;
    } else if (this.inMatch) {
      this.match += s;
    } else if (this.inWord) {
      this.wd += s;
    } else if (this.inDisambiguation) {
      this.disamb += s;
    } else if (this.inExample) {
      this.example += s;
    }
  }

}
