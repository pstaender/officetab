// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/Rule.java faithful
// Import cycles: Rule is the base class of the pattern rules, so this file must not (even
// indirectly) import a subclass of Rule, which a static import of JLanguageTool or of
// DisambiguationPatternRule would do (a subclass module would then be evaluated before Rule
// exists). Therefore:
// - makeAntiPatterns creates DisambiguationPatternRules through Rule.DisambiguationPatternRule,
//   which Language.ts sets (it imports the pattern classes);
// - supportsLanguage gets JLanguageTool.getMessageBundle() through Rule.getMessageBundle, which
//   JLanguageTool.ts sets.
// match admits TextLevelRule's parameters too (see there). URLs are strings. The memoizing Supplier of cacheAntiPatterns is a function.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnnotatedText } from '../markup/AnnotatedText.ts';
import type { Language } from '../Language.ts';
import { UserConfig } from '../UserConfig.ts';
import { Tag, Tag_valueOf } from '../Tag.ts';
import { ToneTag, ToneTag_valueOf } from '../ToneTag.ts';
import type { PatternToken } from './patterns/PatternToken.ts';
import type { DisambiguationPatternRule, DisambiguatorAction } from '../tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Category } from './Category.ts';
import { CategoryIds } from './CategoryIds.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import type { RuleMatch } from './RuleMatch.ts';
import type { RuleOption } from './RuleOption.ts';
import { CorrectExample } from './CorrectExample.ts';
import { IncorrectExample } from './IncorrectExample.ts';
import type { ErrorTriggeringExample } from './ErrorTriggeringExample.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/** The constructor of DisambiguationPatternRule as makeAntiPatterns calls it. */
type DisambiguationPatternRuleClass = new (id: string, description: string, language: Language, patternTokens: PatternToken[],
  disambiguatedPOS: string | null, posSelect: null, disambAction: DisambiguatorAction) => DisambiguationPatternRule;

/** DisambiguationPatternRule.DisambiguatorAction.IMMUNIZE */
const IMMUNIZE: DisambiguatorAction = 'IMMUNIZE';

/**
 * Abstract rule class. A Rule describes a language error and can test whether a
 * given pre-analyzed text contains that error using the {@link Rule#match(AnalyzedSentence)}
 * method.
 *
 * <p>Rules are created whenever a {@link JLanguageTool} or
 * a {@link org.languagetool.MultiThreadedJLanguageTool} object is created.
 * As these objects are not thread-safe, this can happen often. Rules should thus
 * make sure that their initialization works fast. For example, if a rule needs
 * to load data from disk, it should store it in a static variable to make sure
 * the loading happens only once.
 *
 * Rules also need to make sure their {@code match()} code is stateless, i.e. that
 * its results are not influenced by previous calls to {@code match()} (this is relevant
 * if pipeline caching is used).
 *
 * @author Daniel Naber
 */
export abstract class Rule {

  /** Set by Language.ts (see the header). */
  static DisambiguationPatternRule: DisambiguationPatternRuleClass | null = null;
  /** JLanguageTool.getMessageBundle(), set by JLanguageTool.ts (see the header). */
  static getMessageBundle: (() => ResourceBundle) | null = null;

  private static readonly MISC = new Category(CategoryIds.MISC, 'Miscellaneous');

  protected readonly messages: ResourceBundle | null;

  private tags: Tag[] | null = null;

  private toneTags: ToneTag[] | null = null;

  private _isGoalSpecific = false;
  private correctExamples: CorrectExample[] | null = null;
  private incorrectExamples: IncorrectExample[] | null = null;
  private errorTriggeringExamples: ErrorTriggeringExample[] | null = null;
  private locQualityIssueType: ITSIssueType = ITSIssueType.Uncategorized;
  private category!: Category;
  private url: string | null = null;
  private _isPremium = false;
  private defaultOff = false;
  private defaultTempOff = false;
  private officeDefaultOn = false;
  private officeDefaultOff = false;
  private includedInHiddenMatches = true;
  private minPrevMatches = 0; // minimum number of previous matches to show the rule
  private distanceTokens = -1; // distance (number of tokens) between matches to consider a repetition
  private priority = 0;

  private static readonly ERRORS_THAT_CAN_BE_CORRECTED_ALL_AT_ONCE: ReadonlySet<string> = new Set([
    'FALSCHES_ANFUEHRUNGSZEICHEN',
    'TYPOGRAFISCHE_ANFUEHRUNGSZEICHEN',
    'TYPOGRAFISCHE_ANFUEHRUNGSZEICHEN_CH',
    'TYPOGRAFISCHE_ANFUEHRUNGSZEICHEN_2',
    'TYPOGRAFISCHE_APOSTROPHE',
    'EN_QUOTES',
    'WRONG_APOSTROPHE',
    'PARAGRAF_LEERZEICHEN',
    'CONSISTENCYRULE_JE_F',
    'CONSISTENCYRULE_JE_M',
    'COMILLAS_TIPOGRAFICAS',
    'COMETES_TIPOGRAFIQUES',
    'TYPOGRAFISCHE_AANHALINGSTEKENS',
    'PT_SMART_QUOTES',
    'GL_SMART_QUOTES',
  ]);

  /**
   * Called by rules that require a translation of their messages (or without, by those that don't).
   */
  constructor(messages: ResourceBundle | null = null) {
    this.messages = messages;
    if (messages != null) {
      this.setCategory(Categories.MISC.getCategory(messages));  // the default, sub classes may overwrite this
    } else {
      this.setCategory(Rule.MISC);
    }
  }

  /**
   * A string used to identify the rule in e.g. configuration files.
   * This string is supposed to be unique and to stay the same in all upcoming
   * versions of LanguageTool. It's supposed to contain only the characters {@code A-Z}
   * and the underscore.
   */
  abstract getId(): string;

  /**
   * Same as {@link #getId()} for Java rules. For XML rules, this can contain a number
   * that identifies the subrule of a rule group.
   * @since 4.9
   */
  getFullId(): string {
    if (this.getSubId() != null) {
      return this.getId() + '[' + this.getSubId() + ']';
    } else {
      return this.getId();
    }
  }

  /**
   * Optional, mostly used for XML rules (pulled from there to all rules for uniformity)
   * @since 5.7
   */
  getSubId(): string | null {
    return null;
  }

  /**
   * Optional, mostly used for XML rules (pulled from there to all rules for uniformity)
   * For XML rules, this returns the file that this rule was loaded from
   */
  getSourceFile(): string | null {
    return null;
  }

  /**
   * A short description of the error this rule can detect, usually in the language of the text
   * that is checked.
   */
  abstract getDescription(): string;

  /**
   * Check whether the given sentence matches this error rule, i.e. whether it
   * contains the error detected by this rule. Note that the order in which
   * this method is called is not always guaranteed, i.e. the sentence order in the
   * text may be different from the order in which you get the sentences (this may be the
   * case when LanguageTool is used as a LibreOffice/OpenOffice add-on, for example).
   * In other words, implementations must be stateless, so that a previous call to
   * this method has no influence on later calls.
   *
   * @param sentence a pre-analyzed sentence
   * @return an array of {@link RuleMatch} objects
   *
   * The parameters also admit TextLevelRule's match(sentences, annotatedText): text-level rules
   * implement match(AnalyzedSentence[][, AnnotatedText]) and would otherwise not be Rules for
   * TypeScript. Sentence-level rules implement match(sentence: AnalyzedSentence).
   */
  abstract match(sentence: AnalyzedSentence | AnalyzedSentence[], annotatedText?: AnnotatedText | null): RuleMatch[];

  /**
   * A number that estimates how many words there must be after a match before we
   * can be (relatively) sure the match is valid. This is useful for check-as-you-type,
   * where a match might occur and the word that gets typed next makes the match
   * disappear (something one would obviously like to avoid).
   * Note: this may over-estimate the real context size.
   * Returns {@code -1} when the sentence needs to end to be sure there's a match.
   * @since 4.5
   */
  estimateContextForSureMatch(): number {
    return 0;
  }

  /**
   * Overwrite this to avoid false alarms by ignoring these patterns -
   * note that your {@link #match(AnalyzedSentence)} method needs to
   * call {@link #getSentenceWithImmunization} for this to be used
   * and you need to check {@link AnalyzedTokenReadings#isImmunized()}
   * @since 3.1
   */
  getAntiPatterns(): DisambiguationPatternRule[] {
    return [];
  }

  /**
   * Overwrite this to return configurable options for option panel
   * @since 6.5
   */
  getRuleOptions(): RuleOption[] | null {
    return null;
  }

  /**
   * To be called from {@link #match(AnalyzedSentence)} for rules that want
   * {@link #getAntiPatterns()} to be considered.
   * @since 3.1
   */
  protected getSentenceWithImmunization(sentence: AnalyzedSentence): AnalyzedSentence {
    const antiPatterns = this.getAntiPatterns();
    if (antiPatterns.length > 0) {
      //we need a copy of the sentence, not reference to the old one
      let immunizedSentence = sentence.copy(sentence);
      //noinspection ForLoopReplaceableByForEach
      for (let i = 0; i < antiPatterns.length; i++) {
        immunizedSentence = antiPatterns[i]!.replace(immunizedSentence);
      }
      return immunizedSentence;
    }
    return sentence;
  }

  /**
   * Helper for implementing {@link #getAntiPatterns()}. The result of this method should better be cached, please see
   * {@link #cacheAntiPatterns} which does that.
   * @since 3.1
   */
  protected static makeAntiPatterns(patternList: PatternToken[][], language: Language): DisambiguationPatternRule[] {
    const DisambiguationPatternRule = Rule.DisambiguationPatternRule;
    if (DisambiguationPatternRule == null) {
      throw new Error('IllegalStateException: Rule.DisambiguationPatternRule is not set (Language.ts sets it)');
    }
    const rules: DisambiguationPatternRule[] = [];
    for (const patternTokens of patternList) {
      rules.push(new DisambiguationPatternRule('INTERNAL_ANTIPATTERN', '(no description)', language,
              patternTokens, null, null, IMMUNIZE));
    }
    return rules;
  }

  /**
   * @return a memoizing supplier that caches the result of {@link #makeAntiPatterns}. It makes sense
   * to store the returned value, e.g. in a field.
   * @since 5.2
   */
  protected static cacheAntiPatterns(language: Language, antiPatterns: PatternToken[][]): () => DisambiguationPatternRule[] {
    let value: DisambiguationPatternRule[] | null = null;
    return () => (value ??= Rule.makeAntiPatterns(antiPatterns, language));
  }

  /**
   * Whether this rule can be used for text in the given language.
   * Since LanguageTool 2.6, this also works {@link org.languagetool.rules.patterns.PatternRule}s
   * (before, it used to always return {@code false} for those).
   */
  supportsLanguage(language: Language): boolean {
    if (Rule.getMessageBundle == null) {
      throw new Error('IllegalStateException: Rule.getMessageBundle is not set (JLanguageTool.ts sets it)');
    }
    const relevantRuleClasses: Function[] = [];
    const config = new UserConfig();
    const relevantRules: Rule[] = [...language.getRelevantRules(Rule.getMessageBundle(),
        config, null, [])];  //  empty UserConfig has to be added to prevent null pointer exception
    relevantRules.push(...language.getRelevantLanguageModelCapableRules(Rule.getMessageBundle(), null,
      null, config, null, []));
    for (const relevantRule of relevantRules) {
      relevantRuleClasses.push(relevantRule.constructor);
    }
    return relevantRuleClasses.includes(this.constructor);
  }

  /**
   * Whether this is a spelling rule that uses a dictionary.
   * Rules that return {@code true} here are basically rules that work like
   * a simple hunspell-like spellchecker: they check words without considering
   * the words' context.
   * @since 2.5
   */
  isDictionaryBasedSpellingRule(): boolean {
    return false;
  }

  /**
   * Whether results from this rule should be filtered using the users' personal dictionary.
   * @since 6.7
   */
  useDictionaryBasedFilterForMatches(): boolean {
    return this.isDictionaryBasedSpellingRule();
  }

  /**
   * Whether this rule should be forced to be used in LO/OO extension.
   * Rules that return {@code true} will be enabled always in LO/OO extension
   * regardless of other options like isDictionaryBasedSpellingRule().
   * @since 2.6
   */
  useInOffice(): boolean {
    return false;
  }

  /**
   * Set the examples that are correct and thus do not trigger the rule.
   */
  setCorrectExamples(correctExamples: CorrectExample[]): void {
    this.correctExamples = correctExamples.length === 0 ? null : correctExamples;
  }

  /**
   * Get example sentences that are correct and thus will not match this rule.
   */
  getCorrectExamples(): readonly CorrectExample[] {
    return this.correctExamples == null ? [] : this.correctExamples;
  }

  /**
   * Set the examples that are incorrect and thus do trigger the rule.
   */
  setIncorrectExamples(incorrectExamples: IncorrectExample[]): void {
    this.incorrectExamples = incorrectExamples.length === 0 ? null : incorrectExamples;
  }

  /**
   * Get example sentences that are incorrect and thus will match this rule.
   */
  getIncorrectExamples(): readonly IncorrectExample[] {
    return this.incorrectExamples == null ? [] : this.incorrectExamples;
  }

  /**
   * Set the examples that are correct but still trigger the rule due to an issue with the rule.
   * @since 3.5
   */
  setErrorTriggeringExamples(examples: ErrorTriggeringExample[]): void {
    this.errorTriggeringExamples = examples.length === 0 ? null : examples;
  }

  /**
   * Get the examples that are correct but still trigger the rule due to an issue with the rule.
   * @since 3.5
   */
  getErrorTriggeringExamples(): readonly ErrorTriggeringExample[] {
    return this.errorTriggeringExamples == null ? [] : this.errorTriggeringExamples;
  }

  /**
   * @return a category (never null since LT 3.4)
   */
  getCategory(): Category {
    return this.category;
  }

  setCategory(category: Category): void {
    this.category = Objects_requireNonNull(category, 'category cannot be null');
  }

  protected toRuleMatchArray(ruleMatches: readonly RuleMatch[]): RuleMatch[] {
    return [...ruleMatches];
  }

  /**
   * Checks whether the rule has been turned off by default by the rule author.
   * @return True if the rule is turned off by default.
   */
  isDefaultOff(): boolean {
    return this.defaultOff;
  }

  /**
   * Checks whether the rule has been turned off using "default='temp_off'" by default by the rule author.
   * This is a special case where the rule is off for users but active for nightly regression checks.
   */
  isDefaultTempOff(): boolean {
    return this.defaultTempOff;
  }

  /**
   * Turns the rule off by default.
   */
  setDefaultOff(): void {
    this.defaultOff = true;
  }

  /**
   * Turns the pattern rule off by default, expect for internal regression tests.
   */
  setDefaultTempOff(): void {
    this.defaultOff = true;
    this.defaultTempOff = true;
  }

  /**
   * Turns the rule on by default.
   */
  setDefaultOn(): void {
    this.defaultOff = false;
  }

  /**
   * Checks whether the rule has been turned off by default for Office Extension by the rule author.
   * @return True if the rule is turned off. Overrides the default for LO/OO.
   * @since 4.0
  */
  isOfficeDefaultOff(): boolean {
    return this.officeDefaultOff;
  }

  /**
   * Checks whether the rule has been turned on by default for Office Extension by the rule author.
   * @return True if the rule is turned on. Overrides the default for LO/OO.
   * @since 4.0
   */
  isOfficeDefaultOn(): boolean {
    return this.officeDefaultOn;
  }

  /**
   * Turns the rule off for Office Extension by default.
   * @since 4.0
   */
  setOfficeDefaultOff(): void {
    this.officeDefaultOff = true;
  }

  /**
   * Turns the rule on for Office Extension by default.
   * @since 4.0
   */
  setOfficeDefaultOn(): void {
    this.officeDefaultOn = true;
  }

  /**
   * An optional URL describing the rule match in more detail. Typically points to a dictionary or grammar website
   * with explanations and examples. Will return {@code null} for rules that have no URL.
   * @since 1.8
   */
  getUrl(): string | null {
    return this.url;
  }

  /**
   * @since 1.8
   * @see #getUrl()
   */
  setUrl(url: string | null): void {
    this.url = url;
  }

  /**
   * Returns the Localization Quality Issue Type, as defined
   * at <a href="http://www.w3.org/International/multilingualweb/lt/drafts/its20/its20.html#lqissue-typevalues"
   * >http://www.w3.org/International/multilingualweb/lt/drafts/its20/its20.html#lqissue-typevalues</a>.
   *
   * <p>Note that not all languages nor all rules actually map yet to a type yet. In those
   * cases, <code>uncategorized</code> is returned.
   *
   * @return the Localization Quality Issue Type - <code>uncategorized</code> if no type has been assigned
   * @since 2.5
   */
  getLocQualityIssueType(): ITSIssueType {
    return this.locQualityIssueType;
  }

  /**
   * Set the Localization Quality Issue Type.
   * @see #getLocQualityIssueType()
   * @since 2.5
   */
  setLocQualityIssueType(locQualityIssueType: ITSIssueType): void {
    this.locQualityIssueType = Objects_requireNonNull(locQualityIssueType);
  }

  /**
   * Convenience method to add a pair of sentences: an incorrect sentence and the same sentence
   * with the error corrected.
   * @since 2.5
   */
  protected addExamplePair(incorrectSentence: IncorrectExample, correctSentence: CorrectExample): void {
    if (this.correctExamples == null) {
      this.correctExamples = [];
    }
    if (this.incorrectExamples == null) {
      this.incorrectExamples = [];
    }
    const correctExample = correctSentence.getExample();
    const markerStart = correctExample.indexOf('<marker>');
    const markerEnd = correctExample.indexOf('</marker>');
    if (markerStart !== -1 && markerEnd !== -1) {
      const correction = [correctExample.substring(markerStart + '<marker>'.length, markerEnd)];
      this.incorrectExamples.push(new IncorrectExample(incorrectSentence.getExample(), correction));
    } else {
      this.incorrectExamples.push(incorrectSentence);
    }
    this.correctExamples.push(correctSentence);
  }

  /**
   * Convenience method to set a pair of sentences: an incorrect sentence and the same sentence
   * with the error corrected.
   * @since 4.9
   */
  protected setExamplePair(incorrectSentence: IncorrectExample, correctSentence: CorrectExample): void {
    if (this.incorrectExamples != null) {
      this.incorrectExamples.length = 0;
    }
    if (correctSentence != null) {
      this.correctExamples!.length = 0;
    }
    this.addExamplePair(incorrectSentence, correctSentence);
  }

  /**
   * @since 5.1
   */
  addTags(tags: readonly string[]): void {
    if (tags.length === 0) return;

    let myTags = this.tags;
    if (myTags == null) {
      this.tags = myTags = [];
    }
    for (const tag of tags) {
      if (!myTags.some((k) => k === tag)) {
        myTags.push(Tag_valueOf(tag));
      }
    }
  }

  /**
   * @since 5.1
   */
  setTags(tags: Tag[]): void {
    this.tags = tags.length === 0 ? null : Objects_requireNonNull(tags);
  }

  /** @since 5.1 */
  getTags(): readonly Tag[] {
    return this.tags == null ? [] : this.tags;
  }

  /** @since 5.1 */
  hasTag(tag: Tag): boolean {
    return this.tags != null && this.tags.includes(tag);
  }

  /**
   * @since 6.2
   */
  addToneTags(toneTags: readonly string[] | null): void {
    if (toneTags == null || toneTags.length === 0) {
      return;
    }
    let tags = this.toneTags;
    if (tags == null) {
      this.toneTags = tags = [];
    }
    for (const toneTag of toneTags) {
      if (!tags.some((k) => k === toneTag)) {
        tags.push(ToneTag_valueOf(toneTag));
      }
    }
  }

  /**
   * @since 6.2
   */
  setToneTags(toneTags: ToneTag[]): void {
    this.toneTags = toneTags.length === 0 ? null : Objects_requireNonNull(toneTags);
  }

  /**
   * @since 6.2
   */
  getToneTags(): readonly ToneTag[] {
    return this.toneTags == null ? [] : this.toneTags;
  }

  /**
   * @since 6.2
   */
  hasToneTag(toneTag: ToneTag): boolean {
    return this.toneTags != null && this.toneTags.includes(toneTag);
  }

  isPremium(): boolean {
    return this._isPremium;
  }

  setPremium(premium: boolean): void {
    this._isPremium = premium;
  }

  setMinPrevMatches(i: number): void {
    this.minPrevMatches = i;
  }

  getMinPrevMatches(): number {
    return this.minPrevMatches;
  }

  setDistanceTokens(i: number): void {
    this.distanceTokens = i;
  }

  getDistanceTokens(): number {
    return this.distanceTokens;
  }

  isGoalSpecific(): boolean {
    return this._isGoalSpecific;
  }

  setGoalSpecific(goalSpecific: boolean): void {
    this._isGoalSpecific = goalSpecific;
  }

  getPriority(): number {
    return this.priority;
  }

  setPriority(priority: number): void {
    this.priority = priority;
  }

  /**
   * @since 6.5
   * @return whether this rule should be run when hidden rules are enabled
   * when Rule.isPremium is true and QueryParams.premium is false,
   * this rule will only be run when both Rule.isIncludedInHiddenMatches and QueryParams.enableHiddenRules are true
   * No effect otherwise
   */
  isIncludedInHiddenMatches(): boolean {
    return this.includedInHiddenMatches;
  }

/**
 * @since 6.5
 * @param includedInHiddenMatches whether this rule should be run when hidden rules are enabled (if it's a Premium rule)
 */
  setIncludedInHiddenMatches(includedInHiddenMatches: boolean): void {
    this.includedInHiddenMatches = includedInHiddenMatches;
  }

  /**
   * @return Whether this rule supports the "correct all errors at once" feature, e.g., for typographic tweaks
   */
  isIncludedInErrorsCorrectedAllAtOnce(): boolean {
    return Rule.ERRORS_THAT_CAN_BE_CORRECTED_ALL_AT_ONCE.has(this.getId());
  }
}
