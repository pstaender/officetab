// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tools/RuleMatchesAsJsonSerializer.java reduced
// Jackson's JsonGenerator is replaced by building a plain object (fields added in the order the
// generator writes them) and JSON.stringify; `g` is the object being written. The JSON is the
// same, except that floats print as JavaScript numbers (1 instead of Jackson's 1.0). Left out:
// the ConfidenceKey map (setRuleIdToConfidenceMap; ConfidenceKey is not ported), so rules never
// get a "confidence" field.
import { JLanguageTool, type Mode } from '../JLanguageTool.ts';
import { Premium } from '../Premium.ts';
import { CheckResults } from '../CheckResults.ts';
import type { DetectedLanguage } from '../DetectedLanguage.ts';
import type { Language } from '../Language.ts';
import type { AnnotatedText } from '../markup/AnnotatedText.ts';
import { AnnotatedTextBuilder } from '../markup/AnnotatedTextBuilder.ts';
import type { RuleMatch } from '../rules/RuleMatch.ts';
import type { Category } from '../rules/Category.ts';
import { SuggestionType } from '../rules/SuggestedReplacement.ts';
import { ContextTools } from './ContextTools.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

type JsonObject = Record<string, unknown>;

/**
 * Write rule matches and some meta information as JSON.
 * @since 3.4, public since 3.6
 */
export class RuleMatchesAsJsonSerializer {

  private static readonly API_VERSION = 1;
  private static readonly STATUS = '';
  private static readonly PREMIUM_HINT = 'You might be missing errors only the Premium version can find. Contact us at support<at>languagetoolplus.com.';
  private static readonly START_MARKER = '__languagetool_start_marker';
  private static readonly SUGGESTION = '<suggestion>';
  private static readonly SUGGESTION_END = '</suggestion>';
  private static readonly ANYTHING_SLASH_PATTERN = Pattern.compile('.*/');

  private readonly compactMode: number;
  private readonly lang: Language | null;

  /**
   * @since 4.7 (compactMode), 5.1 (lang)
   */
  constructor(compactMode = 0, lang: Language | null = null) {
    this.compactMode = compactMode;
    this.lang = lang;
  }

  /**
   * The overloads: (matches, text: string, contextSize, detectedLang),
   * (matches, hiddenMatches, text: string, contextSize, detectedLang, incompleteResultsReason) and
   * (matches, hiddenMatches, text: AnnotatedText, contextSize, detectedLang, incompleteResultsReason, showPremiumHint).
   * @param incompleteResultsReason use a string that explains why results are incomplete (e.g. due to a timeout) -
   *        a 'warnings' section will be added to the JSON. Use {@code null} if results are complete.
   * @since 3.7, 4.3
   */
  ruleMatchesToJson(matches: RuleMatch[], ...args: unknown[]): string {
    if (typeof args[0] === 'string') {
      const [text, contextSize, detectedLang] = args as [string, number, DetectedLanguage];
      return this.ruleMatchesToJson(matches, [], text, contextSize, detectedLang, null);
    }
    const [hiddenMatches, text, contextSize, detectedLang, incompleteResultsReason, showPremiumHint] =
      args as [RuleMatch[], string | AnnotatedText, number, DetectedLanguage, string | null, boolean | undefined];
    if (typeof text === 'string') {
      return this.ruleMatchesToJson(matches, hiddenMatches, new AnnotatedTextBuilder().addText(text).build(), contextSize, detectedLang, incompleteResultsReason, false);
    }
    return this.ruleMatchesToJson2([new CheckResults(matches, [])],
            hiddenMatches, text, contextSize, detectedLang, incompleteResultsReason, showPremiumHint ?? false, null);
  }

  /**
   * @param incompleteResultsReason use a string that explains why results are incomplete (e.g. due to a timeout) -
   *        a 'warnings' section will be added to the JSON. Use {@code null} if results are complete.
   * @since 5.3
   */
  ruleMatchesToJson2(res: CheckResults[], hiddenMatches: RuleMatch[] | null, text: AnnotatedText, contextSize: number,
                     detectedLang: DetectedLanguage, incompleteResultsReason: string | null, showPremiumHint: boolean, _mode: Mode | null): string {
    const contextTools = new ContextTools();
    contextTools.setEscapeHtml(false);
    contextTools.setContextSize(contextSize);
    contextTools.setErrorMarker(RuleMatchesAsJsonSerializer.START_MARKER, '');
    const g: JsonObject = {};
    this.writeSoftwareSection(g, showPremiumHint);
    this.writeWarningsSection(g, incompleteResultsReason);
    this.writeLanguageSection(g, detectedLang);
    this.writeMatchesSection('matches', g, res, text, contextTools);
    if (hiddenMatches != null && hiddenMatches.length > 0) {
      this.writeMatchesSection('hiddenMatches', g, [new CheckResults(hiddenMatches, [])], text, contextTools);
    }
    this.writeIgnoreRanges(g, res);
    this.writeSentenceRanges(g, res);
    this.writeExtendedSentenceRanges(g, res);
    return JSON.stringify(g);
  }

  private writeSoftwareSection(g: JsonObject, showPremiumHint: boolean): void {
    if (this.compactMode === 1) {
      return;
    }
    const o: JsonObject = {};
    g['software'] = o;
    o['name'] = 'LanguageTool';
    o['version'] = JLanguageTool.VERSION;
    o['buildDate'] = JLanguageTool.BUILD_DATE;
    o['apiVersion'] = RuleMatchesAsJsonSerializer.API_VERSION;
    o['premium'] = Premium.isPremiumVersion();
    if (showPremiumHint) {
      o['premiumHint'] = RuleMatchesAsJsonSerializer.PREMIUM_HINT;
    }
    o['status'] = RuleMatchesAsJsonSerializer.STATUS;
  }

  private writeWarningsSection(g: JsonObject, incompleteResultsReason: string | null): void {
    if (this.compactMode === 1 && incompleteResultsReason == null) {
      return;
    }
    const o: JsonObject = {};
    g['warnings'] = o;
    if (incompleteResultsReason != null) {
      o['incompleteResults'] = true;
      o['incompleteResultsReason'] = incompleteResultsReason;
    } else {
      o['incompleteResults'] = false;
    }
  }

  private writeLanguageSection(g: JsonObject, detectedLang: DetectedLanguage): void {
    const o: JsonObject = {};
    g['language'] = o;
    o['name'] = detectedLang.getGivenLanguage().getName();
    o['code'] = detectedLang.getGivenLanguage().getShortCodeWithCountryAndVariant();
    if (detectedLang.getGivenLanguage().isSpellcheckOnlyLanguage()) {
      o['spellCheckOnly'] = true;
    }
    const d: JsonObject = {};
    o['detectedLanguage'] = d;
    d['name'] = detectedLang.getDetectedLanguage().getName();
    d['code'] = detectedLang.getDetectedLanguage().getShortCodeWithCountryAndVariant();
    d['confidence'] = detectedLang.getDetectionConfidence();
    if (detectedLang.getDetectedLanguage().isSpellcheckOnlyLanguage()) {
      d['spellCheckOnly'] = true;
    }
    d['source'] = detectedLang.getDetectionSource();
  }

  private writeMatchesSection(sectionName: string, g: JsonObject, res: readonly CheckResults[], text: AnnotatedText, contextTools: ContextTools): void {
    const a: JsonObject[] = [];
    g[sectionName] = a;
    for (const r of res) {
      for (const match of r.getRuleMatches()) {
        const m: JsonObject = {};
        a.push(m);
        m['message'] = this.cleanSuggestion(match.getMessage());
        if (match.getShortMessage() != null) {
          m['shortMessage'] = this.cleanSuggestion(match.getShortMessage());
        }
        this.writeReplacements(m, match);
        m['offset'] = match.getFromPos();
        m['length'] = match.getToPos() - match.getFromPos();
        this.writeContext(m, match, text, contextTools);
        m['type'] = { typeName: match.getType().toString() };
        this.writeRule(m, match);
        // 3 is a guess - key 'ignoreForIncompleteSentence' isn't official and can hopefully be removed in the future
        // now that we have 'contextForSureMatch':
        const contextEstimate = match.getRule().estimateContextForSureMatch();
        m['ignoreForIncompleteSentence'] = contextEstimate === -1 || contextEstimate > 3;
        m['contextForSureMatch'] = contextEstimate;
      }
    }
  }

  private writeIgnoreRanges(g: JsonObject, res: readonly CheckResults[]): void {
    if (res.every(k => k.getIgnoredRanges().length === 0)) {
      return;
    }
    const a: JsonObject[] = [];
    g['ignoreRanges'] = a;
    for (const r of res) {
      for (const range of r.getIgnoredRanges()) {
        a.push({
          from: range.getFromPos(),
          to: range.getToPos(),
          language: { code: range.getLang() },
        });
      }
    }
  }

  private writeSentenceRanges(g: JsonObject, res: readonly CheckResults[]): void {
    const a: number[][] = [];
    g['sentenceRanges'] = a;
    for (const r of res) {
      for (const range of r.getSentenceRanges()) {
        a.push([range.getFromPos(), range.getToPos()]);
      }
    }
  }

  private writeExtendedSentenceRanges(g: JsonObject, res: readonly CheckResults[]): void {
    const a: JsonObject[] = [];
    g['extendedSentenceRanges'] = a;
    for (const r of res) {
      for (const range of r.getExtendedSentenceRanges()) {
        const o: JsonObject = {};
        a.push(o);
        o['from'] = range.getFromPos();
        o['to'] = range.getToPos();
        const langs: JsonObject[] = [];
        o['detectedLanguages'] = langs;
        for (const [language, rate] of range.getLanguageConfidenceRates()) {
          langs.push({ language: language, rate: rate });
        }
      }
    }
  }

  private cleanSuggestion(s: string): string {
    if (this.lang != null) {
      return this.lang.toAdvancedTypography(s); //.replaceAll("<suggestion>", lang.getOpeningDoubleQuote()).replaceAll("</suggestion>", lang.getClosingDoubleQuote())
    } else {
      return s.replaceAll(RuleMatchesAsJsonSerializer.SUGGESTION, '"').replaceAll(RuleMatchesAsJsonSerializer.SUGGESTION_END, '"');
    }
  }

  private writeReplacements(g: JsonObject, match: RuleMatch): void {
    const a: JsonObject[] = [];
    g['replacements'] = a;
    let autoCorrect = match.isAutoCorrect();
    let i = 0;
    for (const replacement of match.getSuggestedReplacementObjects()) {
      i++;
      if (this.compactMode === 1 && i > 5) {  // these clients only show up to 5 suggestions anyway
        break;
      }
      const o: JsonObject = {};
      a.push(o);
      o['value'] = replacement.getReplacement();
      if (replacement.getShortDescription() != null) {
        o['shortDescription'] = replacement.getShortDescription();
      }
      if (replacement.getSuffix() != null) {
        o['suffix'] = replacement.getSuffix();
      }
      if (replacement.getType() !== SuggestionType.Default) {
        o['type'] = replacement.getType();
      }
      if (autoCorrect) {
        o['autoCorrect'] = true;
        autoCorrect = false; // only for first replacement
      }
      if (replacement.getConfidence() != null) {
        o['confidence'] = replacement.getConfidence();
      }
    }
  }

  private writeContext(g: JsonObject, match: RuleMatch, text: AnnotatedText, contextTools: ContextTools): void {
    if (this.compactMode !== 1) {
      let context = contextTools.getContext(match.getFromPos(), match.getToPos(), text.getTextWithMarkup());
      const contextOffset = context.indexOf(RuleMatchesAsJsonSerializer.START_MARKER);
      context = context.replace(RuleMatchesAsJsonSerializer.START_MARKER, '');  // StringUtils.replaceOnce
      g['context'] = {
        text: context,
        offset: contextOffset,
        length: match.getToPos() - match.getFromPos(),
      };
      const sentence = match.getSentence();
      if (sentence != null) {
        g['sentence'] = StringTrim(sentence.getText());
      }
    }
  }

  private writeRule(g: JsonObject, match: RuleMatch): void {
    const o: JsonObject = {};
    g['rule'] = o;
    const rule = match.getRule();
    o['id'] = match.getSpecificRuleId(); // rule.getId()
    if (rule.getSubId() != null) {
      o['subId'] = rule.getSubId();
    }
    const sourceFile = rule.getSourceFile();
    if (sourceFile != null && this.compactMode !== 1) {
      o['sourceFile'] = RuleMatchesAsJsonSerializer.ANYTHING_SLASH_PATTERN.matcher(sourceFile).replaceFirst('');
    }
    o['description'] = rule.getDescription();
    o['issueType'] = rule.getLocQualityIssueType().toString();
    if (rule.isDefaultTempOff()) {
      o['tempOff'] = true;
    }
    if (match.getUrl() != null || rule.getUrl() != null) {
      const u: JsonObject = {};
      o['urls'] = [u];  // currently only one, but keep it extensible
      if (match.getUrl() != null) {
        u['value'] = match.getUrl()!.toString();
      } else if (rule.getUrl() != null) {
        u['value'] = rule.getUrl()!.toString();
      }
    }
    this.writeCategory(o, rule.getCategory());
    if (Premium.isPremiumVersion()) {
      o['isPremium'] = Premium.get().isPremiumRule(rule);
    }
    if (rule.getTags().length > 0) {
      o['tags'] = [...rule.getTags()];
    }
  }

  private writeCategory(g: JsonObject, category: Category): void {
    const catId = category.getId();
    g['category'] = {
      id: catId.toString(),
      name: category.getName(),
    };
  }
}
