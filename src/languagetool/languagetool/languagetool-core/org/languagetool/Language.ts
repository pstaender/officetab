// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/Language.java reduced
// Left out: the remote rules (getRelevantRemoteRules, getRemoteEnhancedRules: no server here).
// getLanguageModel(File) takes a directory name and returns null (no ngram data in the browser).
// The default spelling rule (SpellingCheckRule, not in core's check path yet) and the
// MultitokenSpeller are typed as Rule and object. The lazy getters are not synchronized (one
// thread); the demo tagger, disambiguator and tokenizers are created on first use instead of in
// static fields. Pattern rule files are read synchronously from the (preloaded) data broker; the
// FileInputStream fallback for rule files outside the class path is left out.
// Import cycles: this file imports the rules/patterns classes and gives JLanguageTool and Rule
// the ones they use (JLanguageTool.setPatternClasses, Rule.DisambiguationPatternRule), see
// JLanguageTool.ts. Class identity (getClass()) is the constructor.
import { JLanguageTool } from './JLanguageTool.ts';
import { LanguageMaintainedState } from './LanguageMaintainedState.ts';
import { Languages } from './Languages.ts';
import type { GlobalConfig } from './GlobalConfig.ts';
import { ResourceBundleTools } from './ResourceBundleTools.ts';
import type { UserConfig } from './UserConfig.ts';
import type { Chunker } from './chunking/Chunker.ts';
import type { Contributor } from './language/Contributor.ts';
import type { LanguageModel } from './languagemodel/LanguageModel.ts';
import type { AnnotatedText } from './markup/AnnotatedText.ts';
import { ITSIssueType } from './rules/ITSIssueType.ts';
import { Rule } from './rules/Rule.ts';
import type { RuleMatch } from './rules/RuleMatch.ts';
import { AbstractPatternRule } from './rules/patterns/AbstractPatternRule.ts';
import { ConsistencyPatternRule, ConsistencyPatternRuleTransformer } from './rules/patterns/ConsistencyPatternRuleTransformer.ts';
import { PatternRuleLoader } from './rules/patterns/PatternRuleLoader.ts';
import { RepeatedPatternRule, RepeatedPatternRuleTransformer } from './rules/patterns/RepeatedPatternRuleTransformer.ts';
import { RuleSet } from './rules/patterns/RuleSet.ts';
import type { Unifier } from './rules/patterns/Unifier.ts';
import { UnifierConfiguration } from './rules/patterns/UnifierConfiguration.ts';
import type { Synthesizer } from './synthesis/Synthesizer.ts';
import type { Tagger } from './tagging/Tagger.ts';
import type { Disambiguator } from './tagging/disambiguation/Disambiguator.ts';
import { DisambiguationPatternRule } from './tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { DemoDisambiguator } from './tagging/disambiguation/xx/DemoDisambiguator.ts';
import { DemoTagger } from './tagging/xx/DemoTagger.ts';
import type { SentenceTokenizer } from './tokenizers/SentenceTokenizer.ts';
import { SimpleSentenceTokenizer } from './tokenizers/SimpleSentenceTokenizer.ts';
import type { Tokenizer } from './tokenizers/Tokenizer.ts';
import { WordTokenizer } from './tokenizers/WordTokenizer.ts';
import { Locale } from '../../../../jdk/java/util/Locale.ts';
import { MissingResourceException, type ResourceBundle } from '../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../jdk/java/util/regex/Pattern.ts';

JLanguageTool.setPatternClasses({ AbstractPatternRule, PatternRuleLoader, RepeatedPatternRuleTransformer, ConsistencyPatternRuleTransformer, RepeatedPatternRule, ConsistencyPatternRule, RuleSet });
Rule.DisambiguationPatternRule = DisambiguationPatternRule;

let DEMO_DISAMBIGUATOR: Disambiguator | null = null;
let DEMO_TAGGER: Tagger | null = null;
let SENTENCE_TOKENIZER: SentenceTokenizer | null = null;
let WORD_TOKENIZER: Tokenizer | null = null;

let patterns: Record<string, Pattern> | null = null;
const P = () => (patterns ??= {
  INSIDE_SUGGESTION: Pattern.compile('<suggestion>(.+?)</suggestion>'),
  APOSTROPHE: Pattern.compile("([\\p{L}\\d-])'([\\p{L}«])", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE),
  NBSPACE1: Pattern.compile('\\b([a-zA-Z]\\.) ([a-zA-Z]\\.)'),
  NBSPACE2: Pattern.compile('\\b([a-zA-Z]\\.) '),
  QUOTED_CHAR_PATTERN: Pattern.compile(" '(.)'"),
  TYPOGRAPHY_PATTERN_1: Pattern.compile("([\\u202f\\u00a0 «\"\\(])'"),
  TYPOGRAPHY_PATTERN_2: Pattern.compile("'([   !\\?,\\.;:\"\\)])"),
  TYPOGRAPHY_PATTERN_3: Pattern.compile('‘s\\b([^’])'),
  TYPOGRAPHY_PATTERN_4: Pattern.compile('([ \\(])"'),
  TYPOGRAPHY_PATTERN_5: Pattern.compile('"([\\u202f\\u00a0 !\\?,\\.;:\\)])'),
});
const SUGGESTION_OPEN_TAG = '<suggestion>';
const SUGGESTION_CLOSE_TAG = '</suggestion>';

/** StringUtils.replaceOnce */
function replaceOnce(text: string, searchString: string, replacement: string): string {
  const i = text.indexOf(searchString);
  return i < 0 || searchString.length === 0 ? text : text.substring(0, i) + replacement + text.substring(i + searchString.length);
}

const languagetoolInstances = new Map<Function, JLanguageTool>();
const spellingRules = new Map<Function, Rule | null>();

/**
 * Base class for any supported language (English, German, etc). Language classes
 * are detected at runtime by searching the classpath for files named
 * {@code META-INF/org/languagetool/language-module.properties}. Those file(s)
 * need to contain a key {@code languageClasses} which specifies the fully qualified
 * class name(s), e.g. {@code org.languagetool.language.English}. Use commas to specify
 * more than one class.
 *
 * <p>Sub classes should typically use lazy init for anything that's costly to set up.
 * This improves start up time for the LanguageTool stand-alone version.
 */
export abstract class Language {

  private readonly unifierConfig = new UnifierConfiguration();
  private readonly disambiguationUnifierConfig = new UnifierConfiguration();

  private readonly ignoredCharactersRegex = Pattern.compile('[­]');  // soft hyphen

  private patternRules: AbstractPatternRule[] | null = null;
  private disambiguator: Disambiguator | null = null;
  private tagger: Tagger | null = null;
  private sentenceTokenizer: SentenceTokenizer | null = null;
  private wordTokenizer: Tokenizer | null = null;
  private chunker: Chunker | null = null;
  private postDisambiguationChunker: Chunker | null = null;
  private synthesizer: Synthesizer | null = null;
  private shortCodeWithCountryAndVariant: string | null = null;

  // protected in Java; public here, as TypeScript subclasses without their own constructor
  // would inherit a protected one (Java gives them a public default constructor)
  constructor() {
  }

  /**
   * Get this language's character code, e.g. <code>en</code> for English.
   * For most languages this is a two-letter code according to ISO 639-1,
   * but for those languages that don't have a two-letter code, a three-letter
   * code according to ISO 639-2 is returned.
   * The country parameter (e.g. "US"), if any, is not returned.
   * @since 3.6
   */
  abstract getShortCode(): string;

  /**
   * Get this language's name in English, e.g. <code>English</code> or
   * <code>German (Germany)</code>.
   * @return language name
   */
  abstract getName(): string;

  /**
   * Get this language's country options , e.g. <code>US</code> (as in <code>en-US</code>) or
   * <code>PL</code> (as in <code>pl-PL</code>).
   * @return String[] - array of country options for the language.
   */
  abstract getCountries(): string[];

  /**
   * Get the name(s) of the maintainer(s) for this language or <code>null</code>.
   */
  abstract getMaintainers(): Contributor[] | null;

  /**
   * Get the rules classes that should run for texts in this language.
   * @since 4.3
   */
  abstract getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[];

  // -------------------------------------------------------------------------

  /**
   * A file with commons words, either in the classpath or as a filename in the file system.
   * @since 4.5
   */
  getCommonWordsPath(): string {
    return this.getShortCode() + '/common_words.txt';
  }

  /**
   * Get this language's variant, e.g. <code>valencia</code> (as in <code>ca-ES-valencia</code>)
   * or <code>null</code>.
   * Attention: not to be confused with "country" option
   * @return variant for the language or {@code null}
   * @since 2.3
   */
  getVariant(): string | null {
    return null;
  }

  /**
   * Get enabled rules different from the default ones for this language variant.
   *
   * @return enabled rules for the language variant.
   * @since 2.4
   */
  getDefaultEnabledRulesForVariant(): string[] {
    return [];
  }

  /**
   * Get disabled rules different from the default ones for this language variant.
   *
   * @return disabled rules for the language variant.
   * @since 2.4
   */
  getDefaultDisabledRulesForVariant(): string[] {
    return [];
  }

  /**
   * @param indexDir directory with a '3grams' sub directory which contains a Lucene index with 3gram occurrence counts
   * @return a LanguageModel or {@code null} if this language doesn't support one
   * @since 2.7
   */
  getLanguageModel(_indexDir: string): LanguageModel | null {
    return null;
  }

  /**
   * Get a list of rules that require a {@link LanguageModel}. Returns an empty list for
   * languages that don't have such rules.
   * @since 2.7
   */
  getRelevantLanguageModelRules(_messages: ResourceBundle, _languageModel: LanguageModel, _userConfig: UserConfig | null): Rule[] {
    return [];
  }

  /**
   * Get a list of rules that can optionally use a {@link LanguageModel}. Returns an empty list for
   * languages that don't have such rules.
   * @param languageModel null if no language model is available
   * @since 4.5
   */
  getRelevantLanguageModelCapableRules(_messages: ResourceBundle, _languageModel: LanguageModel | null,
                                       _globalConfig: GlobalConfig | null, _userConfig: UserConfig | null, _motherTongue: Language | null, _altLanguages: Language[]): Rule[] {
    return [];
  }

  /**
   * Get the rules classes that should run for texts in this language.
   * @since 4.6
   */
  getRelevantRulesGlobalConfig(_messages: ResourceBundle, _globalConfig: GlobalConfig | null, _userConfig: UserConfig | null, _motherTongue: Language | null, _altLanguages: Language[]): Rule[] {
    return [];
  }

  /**
   * @return a spelling rule (a SpellingCheckRule) or {@code null}
   * @since 5.1
   */
  protected createDefaultSpellingRule(_messages: ResourceBundle): Rule | null {
    return null;
  }

  /**
   * @return a spelling rule (a SpellingCheckRule) or {@code null}. The rule is cached per language class.
   * @since 5.1 (messages: deprecated since 6.1)
   */
  getDefaultSpellingRule(_messages?: ResourceBundle): Rule | null {
    if (!spellingRules.has(this.constructor)) {
      spellingRules.set(this.constructor, this.createDefaultSpellingRule(ResourceBundleTools.getMessageBundle(this)));
    }
    return spellingRules.get(this.constructor)!;
  }

  /**
   * Get this language's Java locale, not considering the country code.
   */
  getLocale(): Locale {
    return new Locale(this.getShortCode());
  }

  /**
   * Get this language's Java locale, considering language code and country code (if any).
   * @since 2.1
   */
  getLocaleWithCountryAndVariant(): Locale {
    if (this.getCountries().length > 0) {
      if (this.getVariant() != null) {
        return new Locale(this.getShortCode(), this.getCountries()[0], this.getVariant()!);
      } else {
        return new Locale(this.getShortCode(), this.getCountries()[0]);
      }
    } else {
      return this.getLocale();
    }
  }

  /**
   * Get the location of the rule file(s) in a form like {@code /org/languagetool/rules/de/grammar.xml},
   * i.e. a path in the classpath. The files must exist or an exception will be thrown, unless the filename
   * contains the string {@code -test-}.
   */
  getRuleFileNames(): string[] {
    const ruleFiles: string[] = [];
    const dataBroker = JLanguageTool.getDataBroker();
    ruleFiles.push(dataBroker.getRulesDir()
            + '/' + this.getShortCode() + '/' + JLanguageTool.PATTERN_FILE);
    if (dataBroker.ruleFileExists(this.getShortCode() + '/' + JLanguageTool.STYLE_FILE)) {
      const customFile = dataBroker.getRulesDir() + '/' + this.getShortCode() + '/' + JLanguageTool.STYLE_FILE;
      ruleFiles.push(customFile);
    }
    if (dataBroker.ruleFileExists(this.getShortCode() + '/' + JLanguageTool.CUSTOM_PATTERN_FILE)) {
      const customFile = dataBroker.getRulesDir() + '/' + this.getShortCode() + '/' + JLanguageTool.CUSTOM_PATTERN_FILE;
      ruleFiles.push(customFile);
    }
    if (this.getShortCodeWithCountryAndVariant().length > 2) {
      const fileName = this.getShortCode() + '/'
              + this.getShortCodeWithCountryAndVariant()
              + '/' + JLanguageTool.PATTERN_FILE;
      if (dataBroker.ruleFileExists(fileName)) {
        ruleFiles.push(dataBroker.getRulesDir() + '/' + fileName);
      }
      const styleFileName = this.getShortCode() + '/' + this.getShortCodeWithCountryAndVariant() + '/' + JLanguageTool.STYLE_FILE;
      if (dataBroker.ruleFileExists(styleFileName)) {
        ruleFiles.push(dataBroker.getRulesDir() + '/' + styleFileName);
      }
      const premiumFileName = this.getShortCode() + '/' + this.getShortCodeWithCountryAndVariant() + '/grammar-premium.xml';
      if (dataBroker.ruleFileExists(premiumFileName)) {
        ruleFiles.push(dataBroker.getRulesDir() + '/' + premiumFileName);
      }
    }
    return ruleFiles;
  }

  /**
   * Languages that have country variants need to overwrite this to select their most common variant.
   * @return default country variant or {@code this}
   * @since 1.8
   */
  getDefaultLanguageVariant(): Language {
    return this;
  }

  /**
   * Creates language specific disambiguator. This function will be called each time in
   * {@link #getDisambiguator()} if disambiguator is not set.
   */
  createDefaultDisambiguator(): Disambiguator {
    return DEMO_DISAMBIGUATOR ??= new DemoDisambiguator();
  }

  /**
   * Get this language's part-of-speech disambiguator implementation.
   */
  getDisambiguator(): Disambiguator {
    if (this.disambiguator == null) {
      this.disambiguator = this.createDefaultDisambiguator();
    }
    return this.disambiguator;
  }

  /**
   * Set this language's part-of-speech disambiguator implementation.
   */
  setDisambiguator(disambiguator: Disambiguator): void {
    this.disambiguator = disambiguator;
  }

  /**
   * Creates language specific part-of-speech tagger. The tagger must not use
   * the disambiguator.
   */
  createDefaultTagger(): Tagger {
    return DEMO_TAGGER ??= new DemoTagger();
  }

  /**
   * Get this language's part-of-speech tagger implementation. The tagger must not use
   * the disambiguator.
   */
  getTagger(): Tagger {
    if (this.tagger == null) {
      this.tagger = this.createDefaultTagger();
    }
    return this.tagger;
  }

  /**
   * Set this language's part-of-speech tagger implementation.
   */
  setTagger(tagger: Tagger): void {
    this.tagger = tagger;
  }

  /**
   * Creates language specific sentence tokenizer.
   */
  createDefaultSentenceTokenizer(): SentenceTokenizer {
    return SENTENCE_TOKENIZER ??= new SimpleSentenceTokenizer();
  }

  /**
   * Get this language's sentence tokenizer implementation.
   */
  getSentenceTokenizer(): SentenceTokenizer {
    if (this.sentenceTokenizer == null) {
      this.sentenceTokenizer = this.createDefaultSentenceTokenizer();
    }
    return this.sentenceTokenizer;
  }

  /**
   * Set this language's sentence tokenizer implementation.
   */
  setSentenceTokenizer(tokenizer: SentenceTokenizer): void {
    this.sentenceTokenizer = tokenizer;
  }

  /**
   * Creates language specific word tokenizer.
   */
  createDefaultWordTokenizer(): Tokenizer {
    return WORD_TOKENIZER ??= new WordTokenizer();
  }

  /**
   * Get this language's word tokenizer implementation.
   */
  getWordTokenizer(): Tokenizer {
    if (this.wordTokenizer == null) {
      this.wordTokenizer = this.createDefaultWordTokenizer();
    }
    return this.wordTokenizer;
  }

  /**
   * Set this language's word tokenizer implementation.
   */
  setWordTokenizer(tokenizer: Tokenizer): void {
    this.wordTokenizer = tokenizer;
  }

  /**
   * Creates language specific chunker.
   */
  createDefaultChunker(): Chunker | null {
    return null;
  }

  /**
   * Get this language's chunker implementation or {@code null}.
   * @since 2.3
   */
  getChunker(): Chunker | null {
    if (this.chunker == null) {
      this.chunker = this.createDefaultChunker();
    }
    return this.chunker;
  }

  /**
   * Set this language's chunker implementation or {@code null}.
   */
  setChunker(chunker: Chunker | null): void {
    this.chunker = chunker;
  }

  /**
   * Creates language specific post disambiguation chunker.
   */
  createDefaultPostDisambiguationChunker(): Chunker | null {
    return null;
  }

  /**
   * Get this language's chunker implementation or {@code null}.
   * @since 2.9
   */
  getPostDisambiguationChunker(): Chunker | null {
    if (this.postDisambiguationChunker == null) {
      this.postDisambiguationChunker = this.createDefaultPostDisambiguationChunker();
    }
    return this.postDisambiguationChunker;
  }

  /**
   * Set this language's chunker implementation or {@code null}.
   */
  setPostDisambiguationChunker(chunker: Chunker | null): void {
    this.postDisambiguationChunker = chunker;
  }

  /**
   * Create a shared instance of JLanguageTool to use in rules for further processing
   * Instances are shared by Language
   * @return a shared JLanguageTool instance for this language
   * @since 6.1
   */
  createDefaultJLanguageTool(): JLanguageTool {
    const clazz = this.constructor;
    let lt = languagetoolInstances.get(clazz);
    if (lt === undefined) {
      lt = new JLanguageTool(this);
      languagetoolInstances.set(clazz, lt);
    }
    return lt;
  }

  /**
   * Creates language specific part-of-speech synthesizer.
   */
  createDefaultSynthesizer(): Synthesizer | null {
    return null;
  }

  /**
   * Get this language's part-of-speech synthesizer implementation or {@code null}.
   */
  getSynthesizer(): Synthesizer | null {
    if (this.synthesizer == null) {
      this.synthesizer = this.createDefaultSynthesizer();
    }
    return this.synthesizer;
  }

  /**
   * Set this language's part-of-speech synthesizer implementation or {@code null}.
   */
  setSynthesizer(synthesizer: Synthesizer | null): void {
    this.synthesizer = synthesizer;
  }

  /**
   * Get this language's feature unifier.
   * @return Feature unifier for analyzed tokens.
   */
  getUnifier(): Unifier {
    return this.unifierConfig.createUnifier();
  }

  /**
   * Get this language's feature unifier used for disambiguation.
   * Note: it might be different from the normal rule unifier.
   * @return Feature unifier for analyzed tokens.
   */
  getDisambiguationUnifier(): Unifier {
    return this.disambiguationUnifierConfig.createUnifier();
  }

  /**
   * @since 2.3
   */
  getUnifierConfiguration(): UnifierConfiguration {
    return this.unifierConfig;
  }

  /**
   * @since 2.3
   */
  getDisambiguationUnifierConfiguration(): UnifierConfiguration {
    return this.disambiguationUnifierConfig;
  }

  /**
   * Get the name of the language translated to the current locale,
   * if available. Otherwise, get the untranslated name.
   */
  getTranslatedName(messages: ResourceBundle): string {
    try {
      return messages.getString(this.getShortCodeWithCountryAndVariant());
    } catch (e) {
      if (!(e instanceof MissingResourceException)) throw e;
      try {
        return messages.getString(this.getShortCode());
      } catch (e1) {
        if (!(e1 instanceof MissingResourceException)) throw e1;
        return this.getName();
      }
    }
  }

  /**
   * Get the short name of the language with country and variant (if any), if it is
   * a single-country language. For generic language classes, this returns a string
   * with only the language code, e.g. "en".
   * @since 3.6
   */
  getShortCodeWithCountryAndVariant(): string {
    if (this.shortCodeWithCountryAndVariant == null) {
      this.shortCodeWithCountryAndVariant = this.buildShortCodeWithCountryAndVariant();
    }
    return this.shortCodeWithCountryAndVariant;
  }

  private buildShortCodeWithCountryAndVariant(): string {
    let name = this.getShortCode();
    if (this.getCountries().length === 1 && !name.includes('-x-')) {   // e.g. "de-DE-x-simple-language"
      name += '-' + this.getCountries()[0];
      if (this.getVariant() != null) {   // e.g. "ca-ES-valencia"
        name += '-' + this.getVariant();
      }
    }
    return name;
  }

  /**
   * Get the pattern rules as defined in the files returned by {@link #getRuleFileNames()}.
   * @since 2.7
   */
  protected getPatternRules(): AbstractPatternRule[] {
    // use lazy loading to speed up server use case and start of stand-alone LT, where all the languages get initialized:
    if (this.patternRules == null) {
      this.patternRules = this.initializePatternRules();
    }
    return this.patternRules;
  }

  private initializePatternRules(): AbstractPatternRule[] {
    const rules: AbstractPatternRule[] = [];
    const ruleLoader = new PatternRuleLoader();
    for (const fileName of this.getRuleFileNames()) {
      const is = JLanguageTool.getDataBroker().getAsStream(fileName);
      let ignore = false;
      if (is == null) {                     // files loaded via the dialog
        if (fileName.includes('-test-')) {
          // ignore, used for testing
          ignore = true;
        } else {
          throw new Error('FileNotFoundException: ' + fileName);
        }
      }
      if (!ignore) {
        rules.push(...ruleLoader.getRules(is!, fileName, this));
      }
    }
    return Object.freeze(rules) as AbstractPatternRule[];
  }

  toString(): string {
    return this.getName();
  }

  /**
   * Whether this is a country variant of another language, i.e. whether it doesn't
   * directly extend {@link Language}, but a subclass of {@link Language}.
   * @since 1.8
   */
  isVariant(): boolean {
    for (const language of Languages.get()) {
      const skip = language.getShortCodeWithCountryAndVariant() === this.getShortCodeWithCountryAndVariant();
      if (!skip && this instanceof (language.constructor as abstract new () => Language)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether this class has at least one subclass that implements variants of this language.
   * @since 1.8
   */
  hasVariant(): boolean {
    for (const language of Languages.get()) {
      const skip = language.getShortCodeWithCountryAndVariant() === this.getShortCodeWithCountryAndVariant();
      if (!skip && language instanceof (this.constructor as abstract new () => Language)) {
        return true;
      }
    }
    return false;
  }

  /**
   * For internal use only. Overwritten to return {@code true} for languages that
   * have been loaded from an external file after start-up.
   */
  isExternal(): boolean {
    return false;
  }

  /**
   * Return true if this is the same language as the given one, considering country
   * variants only if set for both languages. For example: en = en, en = en-GB, en-GB = en-GB,
   * but en-US != en-GB
   * @since 1.8
   */
  equalsConsiderVariantsIfSpecified(otherLanguage: Language): boolean {
    if (this.getShortCode() === otherLanguage.getShortCode()) {
      const thisHasCountry = this.hasCountry();
      const otherHasCountry = otherLanguage.hasCountry();
      return !(thisHasCountry && otherHasCountry) ||
              this.getShortCodeWithCountryAndVariant() === otherLanguage.getShortCodeWithCountryAndVariant();
    } else {
      return false;
    }
  }

  private hasCountry(): boolean {
    return this.getCountries().length === 1;
  }

  /**
   * @return Return compiled regular expression to ignore inside tokens
   * @since 2.9
   */
  getIgnoredCharactersRegex(): Pattern | null {
    return this.ignoredCharactersRegex;
  }

  /**
   * Information about whether the support for this language in LanguageTool is actively maintained.
   * If not, the user interface might show a warning.
   * @since 3.3
   */
  getMaintainedState(): LanguageMaintainedState {
    return LanguageMaintainedState.LookingForNewMaintainer;
  }

  /*
   * True if language should be hidden on GUI (i.e. en, de, pt,
   * instead of en-US, de-DE, pt-PT)
   * @since 3.3
   */
  isHiddenFromGui(): boolean {
    return this.hasVariant() && !this.isVariant() && !this.isTheDefaultVariant();
  }

  private isTheDefaultVariant(): boolean {
    if (this.getDefaultLanguageVariant() != null) {
      return this.constructor === this.getDefaultLanguageVariant().constructor;
    }
    return false;
  }

  /**
   * Returns a priority for Rule or Category Id (default: 0).
   * Positive integers have higher priority.
   * Negative integers have lower priority.
   * @since 3.6
   */
  protected getPriorityForId(id: string): number {
    if (id.toLowerCase() === 'TOO_LONG_SENTENCE'.toLowerCase()) {
      return -101;  // don't hide spelling errors
    }
    if (id === 'REPETITIONS_STYLE') {  // category
      return -55;  // don't let style issues hide more important errors
    }
    if (id.includes('STYLE')) {  // category
      return -50;  // don't let style issues hide more important errors
    }
    return 0;
  }

  /**
   * Returns a priority for Rule (default: 0).
   * Positive integers have higher priority.
   * Negative integers have lower priority.
   * @since 5.0
   */
  getRulePriority(rule: Rule): number {
    const categoryPriority = this.getPriorityForId(rule.getCategory().getId().toString());
    const rulePriority = this.getPriorityForId(rule.getId());
    const rulePriorityFromRule = rule.getPriority();
    // if there is a priority defined for rule it takes precedence over category priority
    if (rulePriority !== 0) {
      return rulePriority;
    } else if (rulePriorityFromRule !== 0) {
      return rulePriorityFromRule;
    } else if (categoryPriority !== 0) {
      return categoryPriority;
    } else if (this.getDefaultRulePriorityForStyle() !== 0 && rule.getLocQualityIssueType() === ITSIssueType.Style) {
      return this.getDefaultRulePriorityForStyle();
    }
    return 0;
  }

  /**
   * Returns a priority for rules with ITSIssueType.Style (default: 0).
   * Positive integers have higher priority.
   * Negative integers have lower priority.
   * @since 6.4
   */
  protected getDefaultRulePriorityForStyle(): number {
    return 0;
  }

  /**
   * Whether this language supports spell checking only and no advanced grammar and style checking.
   * @since 4.5
   */
  isSpellcheckOnlyLanguage(): boolean {
    return false;
  }

  /**
   * Return true if language has ngram-based false friend rule returned by {@link #getRelevantLanguageModelCapableRules}.
   * @since 4.6
   */
  hasNGramFalseFriendRule(_motherTongue: Language | null): boolean {
    return false;
  }

  /** @since 5.1 */
  getOpeningDoubleQuote(): string {
    return '"';
  }

  /** @since 5.1 */
  getClosingDoubleQuote(): string {
    return '"';
  }

  /** @since 5.1 */
  getOpeningSingleQuote(): string {
    return "'";
  }

  /** @since 5.1 */
  getClosingSingleQuote(): string {
    return "'";
  }

  /** @since 5.1 */
  isAdvancedTypographyEnabled(): boolean {
    return false;
  }

  /** @since 5.1 */
  toAdvancedTypography(input: string): string {
    if (!this.isAdvancedTypographyEnabled()) {
      return input.replaceAll(SUGGESTION_OPEN_TAG, this.getOpeningDoubleQuote())
        .replaceAll(SUGGESTION_CLOSE_TAG, this.getClosingDoubleQuote());
    }
    let output = input;
    //Preserve content inside <suggestion></suggestion>
    const preservedStrings: string[] = [];
    let countPreserved = 0;
    const m = P().INSIDE_SUGGESTION!.matcher(output);
    let offset = 0;
    while (m.find(offset)) {
      const group = m.group(1)!;
      preservedStrings.push(group);
      output = replaceOnce(output, '<suggestion>' + group + '</suggestion>', '\\' + countPreserved);
      countPreserved++;
      offset = m.end();
    }
    // Ellipsis (for all languages?)
    output = output.replaceAll('...', '…');
    // non-breaking space
    output = P().NBSPACE1!.matcher(output).replaceAll('$1 $2');
    output = P().NBSPACE2!.matcher(output).replaceAll('$1 ');
    const matcher = P().APOSTROPHE!.matcher(output);
    output = matcher.replaceAll('$1’$2');
    // single quotes
    if (output.startsWith("'")) {
      output = this.getOpeningSingleQuote() + output.substring(1);
    }
    if (output.endsWith("'")) {
      output = output.substring(0, output.length - 1) + this.getClosingSingleQuote();
    }
    output = P().QUOTED_CHAR_PATTERN!.matcher(output).replaceAll(' ' + this.getOpeningSingleQuote() + '$1' + this.getClosingSingleQuote()); //exception single character
    output = P().TYPOGRAPHY_PATTERN_1!.matcher(output).replaceAll('$1' + this.getOpeningSingleQuote());
    output = P().TYPOGRAPHY_PATTERN_2!.matcher(output).replaceAll(this.getClosingSingleQuote() + '$1');
    output = P().TYPOGRAPHY_PATTERN_3!.matcher(output).replaceAll('’s$1'); // exception genitive
    // double quotes
    if (output.startsWith('"')) {
      output = this.getOpeningDoubleQuote() + output.substring(1);
    }
    if (output.endsWith('"')) {
      output = output.substring(0, output.length - 1) + this.getClosingDoubleQuote();
    }
    output = P().TYPOGRAPHY_PATTERN_4!.matcher(output).replaceAll('$1' + this.getOpeningDoubleQuote());
    output = P().TYPOGRAPHY_PATTERN_5!.matcher(output).replaceAll(this.getClosingDoubleQuote() + '$1');
    //restore suggestions
    for (let i = 0; i < preservedStrings.length; i++) {
      output = replaceOnce(output, '\\' + i, this.getOpeningDoubleQuote() + preservedStrings[i] + this.getClosingDoubleQuote());
    }
    return output.replaceAll(SUGGESTION_OPEN_TAG, this.getOpeningDoubleQuote())
      .replaceAll(SUGGESTION_CLOSE_TAG, this.getClosingDoubleQuote());
  }

  /**
   * Considers languages as equal if their language code, including the country and variant codes are equal.
   * @since 5.1
   */
  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof Language) || o.constructor !== this.constructor) return false;
    const other = o;
    return this.getShortCodeWithCountryAndVariant() === other.getShortCodeWithCountryAndVariant();
  }

  /**
   * @return Return true if the language has rules with min_prev_matches
   * @since 5.5
   */
  hasMinMatchesRules(): boolean {
    return false;
  }

  /**
   * Adapt suggestions depending on the language and on the original error.
   * @since 5.8
   */
  adaptSuggestion(s: string, _originalErrorStr: string): string {
    return s;
  }

  /**
   * Adapt the list of suggestions depending on the language and on the original error.
   * @since 6.1
   */
  adaptSuggestionsList(suggestions: readonly string[], originalErrorStr: string): string[] {
    const newSuggestions: string[] = [];
    for (const s of suggestions) {
      newSuggestions.push(this.adaptSuggestion(s, originalErrorStr));
    }
    return newSuggestions;
  }

  /**
   * @since 6.1
   */
  getConsistencyRulePrefix(): string {
    return 'PREFIXFORCONSISTENCYRULES_';
  }

  /**
   * This function is called by JLanguageTool before CleanOverlappingFilter removes overlapping ruleMatches
   * @since 6.1
   */
  adjustMatch(rm: RuleMatch, _features: string[]): RuleMatch {
    return rm;
  }

  /**
   * Prepare a line in a spelling file (add words, phrases, etc.) for the speller.
   * @since 6.2
   */
  prepareLineForSpeller(s: string): string[] {
    return [s];
  }

  /**
   * This function is called by JLanguageTool before CleanOverlappingFilter removes overlapping ruleMatches
   * @return filtered ruleMatches
   * @since 6.2
   */
  filterRuleMatches(ruleMatches: RuleMatch[], _text: AnnotatedText, _enabledRules: ReadonlySet<string>): RuleMatch[] {
    return ruleMatches;
  }

  /**
   * This function is called by JLanguageTool after CleanOverlappingFilter removes overlapping ruleMatches
   * @return filtered ruleMatches
   * @since 6.3
   */
  filterRuleMatchesAfterOverlapping(ruleMatches: RuleMatch[]): RuleMatch[] {
    return ruleMatches;
  }

  /**
   * @return the MultitokenSpeller or {@code null}
   * @since 6.3
   */
  getMultitokenSpeller(): object | null {
    return null;
  }

  /** @since 6.3 */
  getPriorityMap(): Map<string, number> {
    return new Map();
  }

  /**
   * @since 6.4
   */
  getSpellerMaxWeightDiff(): number {
    return -1;
  }
}
