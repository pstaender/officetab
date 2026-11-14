// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/JLanguageTool.java reduced
// The check pipeline is ported as it is: sentence tokenizing, getAnalyzedSentence /
// getRawAnalyzedSentence (word tokenizing, tagging, chunking, disambiguation, soft hyphens and
// clean tokens), the text-level and sentence-level rules (TextCheckCallable, sequentially),
// position adjustment through AnnotatedText, the match filters (SameRuleGroupFilter,
// LanguageDependentRuleMatchFilter, CleanOverlappingFilter, custom RuleMatchFilters), rule and
// category enabling, the level and tone tag rule sets, and analyzeText.
// Left out:
// - remote rules (activateRemoteRules, checkRemoteRules, fetchRemoteRuleResults, the GRPC post
//   processing, isRuleActiveForLanguageWithModel, which only acts on remote rule results);
// - language models and ngram rules (activateLanguageModelRules; the optional language model
//   rules are created without a model, as Java does without an ngram directory);
// - ResultCache (the cache constructor parameter must be null) and the input logging flag;
// - false friend rules (loadFalseFriendRules, activateDefaultFalseFriendRules: FalseFriendRuleLoader
//   is not ported; they only apply with a mother tongue);
// - check2 and sentence ranges, getAllSpellingCheckRules, the class broker, the password
//   authenticator, temporary files, metrics, logging and threads (everything runs sequentially);
// - the JLanguageTool(language, cache, userConfig) constructor (no ResultCache).
// setOutput takes a function receiving each line instead of a PrintStream.
// The constructors are one (see its comment); the check overloads are one method.
//
// Import cycles: AnalyzedToken(Readings) import this file for its constants, and the pattern rule
// classes import those, so this file must not import the rules/patterns classes statically (one
// of them would be evaluated before its base class). Language.ts, which every JLanguageTool needs,
// imports them and passes them to setPatternClasses. Rule.getMessageBundle is set here.
import { AnalyzedSentence } from './AnalyzedSentence.ts';
import { AnalyzedToken } from './AnalyzedToken.ts';
import { AnalyzedTokenReadings } from './AnalyzedTokenReadings.ts';
import { CheckResults } from './CheckResults.ts';
import { ErrorRateTooHighException } from './ErrorRateTooHighException.ts';
import { ExtendedSentenceRange } from './ExtendedSentenceRange.ts';
import type { GlobalConfig } from './GlobalConfig.ts';
import type { Language } from './Language.ts';
import { Range } from './Range.ts';
import { ResourceBundleTools } from './ResourceBundleTools.ts';
import type { RuleMatchListener } from './RuleMatchListener.ts';
import { ShortDescriptionProvider } from './ShortDescriptionProvider.ts';
import { Tag } from './Tag.ts';
import { ToneTag, ToneTag_REAL_TONE_TAGS } from './ToneTag.ts';
import { UserConfig } from './UserConfig.ts';
import { DefaultResourceDataBroker } from './broker/DefaultResourceDataBroker.ts';
import type { ResourceDataBroker } from './broker/ResourceDataBroker.ts';
import type { AnnotatedText } from './markup/AnnotatedText.ts';
import { AnnotatedTextBuilder } from './markup/AnnotatedTextBuilder.ts';
import { TextPart } from './markup/TextPart.ts';
import type { Category } from './rules/Category.ts';
import type { CategoryId } from './rules/CategoryId.ts';
import { CleanOverlappingFilter } from './rules/CleanOverlappingFilter.ts';
import { LanguageDependentRuleMatchFilter } from './rules/LanguageDependentRuleMatchFilter.ts';
import { Rule } from './rules/Rule.ts';
import { RuleMatch } from './rules/RuleMatch.ts';
import type { RuleMatchFilter } from './rules/RuleMatchFilter.ts';
import { SameRuleGroupFilter } from './rules/SameRuleGroupFilter.ts';
import { SuggestedReplacement } from './rules/SuggestedReplacement.ts';
import { TextLevelRule } from './rules/TextLevelRule.ts';
import type { AbstractPatternRule } from './rules/patterns/AbstractPatternRule.ts';
import type { ConsistencyPatternRule, ConsistencyPatternRuleTransformer } from './rules/patterns/ConsistencyPatternRuleTransformer.ts';
import type { PatternRuleLoader } from './rules/patterns/PatternRuleLoader.ts';
import type { PatternRuleTransformer } from './rules/patterns/PatternRuleTransformer.ts';
import type { RepeatedPatternRule, RepeatedPatternRuleTransformer } from './rules/patterns/RepeatedPatternRuleTransformer.ts';
import type { RuleSet } from './rules/patterns/RuleSet.ts';
import { Character, StringTrim } from '../../../../jdk/java/lang/Character.ts';
import { List_contains, Objects_requireNonNull } from '../../../../jdk/java/util/Objects.ts';
import { ResourceBundle } from '../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Constants for correct paragraph-rule handling.
 */
export const ParagraphHandling = {
  /**
   * Handle normally - all kinds of rules run.
   */
  NORMAL: 'NORMAL',
  /**
   * Run only paragraph-level rules.
   */
  ONLYPARA: 'ONLYPARA',
  /**
   * Run only sentence-level rules.
   */
  ONLYNONPARA: 'ONLYNONPARA',
} as const;
export type ParagraphHandling = typeof ParagraphHandling[keyof typeof ParagraphHandling];

export const Mode = {
  // IMPORTANT: directly logged via toString into check_log database table.
  // column is varchar(32), so take care to not exceed this length here
  /**
   * Use all active rules for checking.
   */
  ALL: 'ALL',
  /**
   * Use only text-level rules for checking. This is typically much faster then using all rules or {@code ALL_BUT_TEXTLEVEL_ONLY}.
   */
  TEXTLEVEL_ONLY: 'TEXTLEVEL_ONLY',
  /**
   * Use all activate rules for checking except the text-level rules.
   */
  ALL_BUT_TEXTLEVEL_ONLY: 'ALL_BUT_TEXTLEVEL_ONLY',
} as const;
export type Mode = typeof Mode[keyof typeof Mode];

export const Level = {
  DEFAULT: 'DEFAULT',
  PICKY: 'PICKY',
  ACADEMIC: 'ACADEMIC',
  CLARITY: 'CLARITY',
  PROFESSIONAL: 'PROFESSIONAL',
  CREATIVE: 'CREATIVE',
  CUSTOMER: 'CUSTOMER',
  JOBAPP: 'JOBAPP',
  OBJECTIVE: 'OBJECTIVE',
  ELEGANT: 'ELEGANT',
} as const;
export type Level = typeof Level[keyof typeof Level];

/**
 * Callback for checking if result of {@link #check(String)} is still needed.
 */
export interface CheckCancelledCallback {
  /**
   * @return true if request was cancelled else false
   */
  checkCancelled(): boolean;
}

/** The rules/patterns classes this file uses (see the header). */
export interface PatternClasses {
  AbstractPatternRule: typeof AbstractPatternRule;
  PatternRuleLoader: typeof PatternRuleLoader;
  RepeatedPatternRuleTransformer: typeof RepeatedPatternRuleTransformer;
  ConsistencyPatternRuleTransformer: typeof ConsistencyPatternRuleTransformer;
  RepeatedPatternRule: typeof RepeatedPatternRule;
  ConsistencyPatternRule: typeof ConsistencyPatternRule;
  RuleSet: typeof RuleSet;
}

let patternClasses: PatternClasses | null = null;
const PC = (): PatternClasses => {
  if (patternClasses == null) throw new Error('IllegalStateException: the pattern rule classes are not set (Language.ts sets them)');
  return patternClasses;
};

let ZERO_WIDTH_NBSP: Pattern | null = null;

const isModeValue = (v: unknown): v is Mode => typeof v === 'string' && Object.prototype.hasOwnProperty.call(Mode, v);

/** StringUtils.abbreviate */
const abbreviate = (str: string, maxWidth: number): string => str.length <= maxWidth ? str : str.substring(0, maxWidth - 3) + '...';

/** String.stripLeading */
const stripLeading = (s: string): string => {
  let i = 0;
  while (i < s.length && Character.isWhitespace(s.charAt(i))) i++;
  return s.substring(i);
};

class CleanToken {
  readonly origToken: string;
  readonly cleanToken: string;
  constructor(origToken: string, cleanToken: string) {
    this.origToken = origToken;
    this.cleanToken = cleanToken;
  }
}

export class SentenceData {
  readonly analyzed: AnalyzedSentence;
  readonly text: string;
  readonly startOffset: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly wordCount: number;

  constructor(analyzed: AnalyzedSentence, text: string, startOffset: number, startLine: number, startColumn: number) {
    this.analyzed = analyzed;
    this.text = text;
    this.startOffset = startOffset;
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.wordCount = analyzed.getTokensWithoutWhitespace().length;
  }
}

class LineColumnPosition {
  line: number;
  column: number;

  constructor(line: number, column: number) {
    this.line = line;
    this.column = column;
  }
}

/**
 * The main class used for checking text against different rules:
 * <ul>
 * <li>built-in Java rules (for English: <i>a</i> vs. <i>an</i>, whitespace after commas, ...)
 * <li>built-in pattern rules loaded from external XML files (usually called {@code grammar.xml})
 * <li>your own implementation of the abstract {@link Rule} classes added with {@link #addRule(Rule)}
 * </ul>
 *
 * <p><b>Thread-safety:</b> this class is not thread safe. Create one instance per thread,
 * but create the language only once (e.g. {@code new AmericanEnglish}) and use it for all
 * instances of JLanguageTool.</p>
 */
export class JLanguageTool {

  static readonly ParagraphHandling = ParagraphHandling;
  static readonly Mode = Mode;
  static readonly Level = Level;

  /**
   * The name of the file with error patterns.
   */
  static readonly PATTERN_FILE = 'grammar.xml';
  /**
   * The name of the file with style patterns.
   */
  static readonly STYLE_FILE = 'style.xml';
  /**
   * The name of the file with error patterns.
   */
  static readonly CUSTOM_PATTERN_FILE = 'grammar_custom.xml';
  /**
   * The name of the file with false friend information.
   */
  static readonly FALSE_FRIEND_FILE = 'false-friends.xml';
  /**
   * The internal tag used to mark the beginning of a sentence.
   */
  static readonly SENTENCE_START_TAGNAME = 'SENT_START';
  /**
   * The internal tag used to mark the end of a sentence.
   */
  static readonly SENTENCE_END_TAGNAME = 'SENT_END';
  /**
   * The internal tag used to mark the end of a paragraph.
   */
  static readonly PARAGRAPH_END_TAGNAME = 'PARA_END';
  /**
   * Name of the message bundle for translations.
   */
  static readonly MESSAGE_BUNDLE = 'org.languagetool.MessagesBundle';
  /**
   * Extension of dictionary files read by Spellers
   */
  static readonly DICTIONARY_FILENAME_EXTENSION = '.dict';

  private readonly userConfig: UserConfig;
  private readonly globalConfig: GlobalConfig | null;
  private readonly descProvider: ShortDescriptionProvider;

  private maxErrorsPerWordRate = 0;

  private static dataBroker: ResourceDataBroker | null = null;

  private readonly builtinRules: Rule[];
  private readonly userRules: Rule[] = []; // rules added via addRule() method
  // rules fetched via getRelevantLanguageModelCapableRules()
  private readonly optionalLanguageModelRules = new Set<string>();
  private readonly disabledRules = new Set<string>();
  private readonly disabledRuleCategories: CategoryId[] = [];
  private readonly enabledRules = new Set<string>();
  private readonly enabledRuleCategories: CategoryId[] = [];
  private readonly language: Language;
  private readonly altLanguages: Language[];
  private readonly motherTongue: Language | null;

  private readonly matchFilters: RuleMatchFilter[] = [];

  private checkCancelledCallback: CheckCancelledCallback | null = null;

  private printStream: ((line: string) => void) | null = null;
  private listUnknownWords = false;
  private unknownWords = new Set<string>();
  private cleanOverlappingMatches: boolean;

  private readonly ruleSetCache = new Map<string, RuleSet>();

  /** Not in Java: Language.ts passes the rules/patterns classes (see the header). */
  static setPatternClasses(classes: PatternClasses): void {
    patternClasses = classes;
  }

  /**
   * Create a JLanguageTool and setup the built-in rules for the
   * given language and false friend rules for the text language / mother tongue pair.
   *
   * Forms (Java overloads):
   * - (language[, motherTongue[, cache[, userConfig]]])
   * - (language, altLanguages, motherTongue, cache, globalConfig, userConfig[, inputLogging[, withLanguageModel[, customRules]]])
   *
   * @param language     the language of the text to be checked
   * @param altLanguages The languages that are accepted as alternative languages - currently this means
   *                     words are accepted if they are in an alternative language and not similar to
   *                     a word from {@code language}. If there's a similar word in {@code language},
   *                     there will be an error of type {@link RuleMatch.Type#Hint} (EXPERIMENTAL)
   * @param motherTongue the user's mother tongue, used for false friend rules, or <code>null</code>.
   *          The mother tongue may also be used as a source language for checking bilingual texts.
   * @param cache must be null (ResultCache is not ported)
   * @param withLanguageModel will not call updateOptionalLanguageModelRules(null) if this is true
   * @param customRules rules to use for the JLanguageTool instance instead of initializing with the built-in ones, or null to use built-in rules
   */
  constructor(language: Language, motherTongue?: Language | null, cache?: null, userConfig?: UserConfig | null);
  constructor(language: Language, altLanguages: Language[], motherTongue: Language | null, cache: null, globalConfig: GlobalConfig | null,
              userConfig: UserConfig | null, inputLogging?: boolean, withLanguageModel?: boolean, customRules?: Rule[] | null);
  constructor(language: Language, a?: Language[] | Language | null, b?: Language | null, _cache?: null, c?: GlobalConfig | UserConfig | null,
              d?: UserConfig | null, _inputLogging = true, withLanguageModel = false, customRules: Rule[] | null = null) {
    let altLanguages: Language[];
    let motherTongue: Language | null;
    let globalConfig: GlobalConfig | null;
    let userConfig: UserConfig | null;
    if (Array.isArray(a)) {
      altLanguages = a;
      motherTongue = b ?? null;
      globalConfig = (c ?? null) as GlobalConfig | null;
      userConfig = d ?? null;
    } else {
      // this(language, Collections.emptyList(), motherTongue, cache, null, userConfig)
      altLanguages = [];
      motherTongue = a ?? null;
      globalConfig = null;
      userConfig = (c ?? null) as UserConfig | null;
    }
    this.language = Objects_requireNonNull(language, 'language cannot be null');
    this.altLanguages = Objects_requireNonNull(altLanguages, 'altLanguages cannot be null (but empty)');
    this.motherTongue = motherTongue;
    this.userConfig = userConfig ?? new UserConfig();
    this.globalConfig = globalConfig;
    this.cleanOverlappingMatches = true;
    const messages = ResourceBundleTools.getMessageBundle(language);
    if (customRules != null) {
      this.builtinRules = [...customRules];
    } else {
      this.builtinRules = this.getAllBuiltinRules(language, messages, userConfig, globalConfig);
      try {
        this.activateDefaultPatternRules();
        // (false friend rules: not ported, see the header)
        if (!withLanguageModel) {
          this.updateOptionalLanguageModelRules(null); // start out with rules without language model
        }
      } catch (e) {
        throw new Error('RuntimeException: Could not activate rules: ' + (e instanceof Error ? e.message : e), { cause: e });
      }
    }
    this.descProvider = new ShortDescriptionProvider();
  }

  /**
   * The grammar checker needs resources from following
   * directories:
   * <ul>
   *   <li>{@code /resource}</li>
   *   <li>{@code /rules}</li>
   * </ul>
   *
   * @return The currently set data broker which allows obtaining
   * resources from the mentioned directories above. If no
   * data broker was set, a new {@link DefaultResourceDataBroker} will
   * be instantiated and returned.
   * @since 1.0.1
   */
  static getDataBroker(): ResourceDataBroker {
    if (JLanguageTool.dataBroker == null) {
      JLanguageTool.dataBroker = new DefaultResourceDataBroker();
    }
    return JLanguageTool.dataBroker;
  }

  /**
   * The grammar checker needs resources from following
   * directories:
   * <ul>
   * <li>{@code /resource}</li>
   * <li>{@code /rules}</li>
   * </ul>
   *
   * @param broker The new resource broker to be used.
   * @since 1.0.1
   */
  static setDataBroker(broker: ResourceDataBroker): void {
    JLanguageTool.dataBroker = broker;
    ResourceBundle.clearCache();
  }

  /**
   * Whether the {@link #check(String)} methods store unknown words. If set to
   * <code>true</code> (default: false), you can get the list of unknown words
   * using {@link #getUnknownWords()}.
   */
  setListUnknownWords(listUnknownWords: boolean): void {
    this.listUnknownWords = listUnknownWords;
  }

  /**
   * Whether the {@link #check(String)} methods return overlapping errors. If set to
   * <code>true</code> (default: true), it removes overlapping errors according to
   * the priorities established for the language.
   *
   * @since 3.6
   */
  setCleanOverlappingMatches(cleanOverlappingMatches: boolean): void {
    this.cleanOverlappingMatches = cleanOverlappingMatches;
  }

  /**
   * Maximum errors per word rate, checking will stop with an exception if the rate is higher.
   * For example, with a rate of 0.33, the checking would stop if the user's
   * text has so many errors that more than every 3rd word causes a rule match.
   * Note that this may not apply for very short texts.
   *
   * @since 4.0
   */
  setMaxErrorsPerWordRate(maxErrorsPerWordRate: number): void {
    this.maxErrorsPerWordRate = maxErrorsPerWordRate;
  }

  /**
   * Callback to determine if result of executing {@link #check(String)} is still needed.
   */
  setCheckCancelledCallback(callback: CheckCancelledCallback | null): void {
    this.checkCancelledCallback = callback;
  }

  /**
   * Gets the ResourceBundle (i18n strings) for the given user interface language
   * (since 2.4), or for the default language of the user's system.
   */
  static getMessageBundle(lang?: Language | null): ResourceBundle {
    return ResourceBundleTools.getMessageBundle(lang);
  }

  private getAllBuiltinRules(language: Language, messages: ResourceBundle, userConfig: UserConfig | null, globalConfig: GlobalConfig | null): Rule[] {
    try {
      const rules: Rule[] = [...language.getRelevantRules(messages, userConfig, this.motherTongue, this.altLanguages)];
      rules.push(...language.getRelevantRulesGlobalConfig(messages, globalConfig, userConfig, this.motherTongue, this.altLanguages));
      return rules;
    } catch (e) {
      throw new Error('RuntimeException: Could not get rules of language ' + language + ': ' + (e instanceof Error ? e.message : e), { cause: e });
    }
  }

  /**
   * Set a function that will receive verbose output (one call per line). Set to
   * {@code null} (which is the default) to disable verbose output.
   */
  setOutput(printStream: ((line: string) => void) | null): void {
    this.printStream = printStream;
  }

  /**
   * Load pattern rules from an XML file. Use {@link #addRule(Rule)} to add these
   * rules to the checking process.
   *
   * @param filename path to an XML file in the classpath
   * @return a List of {@link PatternRule} objects
   */
  loadPatternRules(filename: string): AbstractPatternRule[] {
    const ruleLoader = new (PC().PatternRuleLoader)();
    const is = JLanguageTool.getDataBroker().getAsStream(filename);
    if (is == null) {
      // happens for external rules plugged in as an XML file or testing files:
      if (filename.includes('-test-')) {
        // ignore, for testing
        return [];
      } else {
        throw new Error('IOException: ' + filename + ' not found (rule files outside the class path are not supported)');
      }
    } else {
      return ruleLoader.getRules(is, filename, this.language);
    }
  }

  /**
   * Remove rules that can profit from a language model, recreate them with the given model and add them again
   *
   * @param lm the language model or null if none is available
   */
  private updateOptionalLanguageModelRules(lm: null): void {
    const messages = JLanguageTool.getMessageBundle(this.language);
    try {
      const rules = this.language.getRelevantLanguageModelCapableRules(messages, lm, this.globalConfig, this.userConfig, this.motherTongue, this.altLanguages);
      for (let i = this.userRules.length - 1; i >= 0; i--) {
        if (this.optionalLanguageModelRules.has(this.userRules[i]!.getId())) this.userRules.splice(i, 1);
      }
      this.optionalLanguageModelRules.clear();
      rules.map((r) => r.getId()).forEach((id) => this.optionalLanguageModelRules.add(id));
      this.userRules.push(...rules);
    } catch (e) {
      throw new Error('RuntimeException: Could not load language model capable rules: ' + (e instanceof Error ? e.message : e), { cause: e });
    }
    this.ruleSetCache.clear();
  }

  /**
   * Loads and activates the pattern rules from
   * {@code org/languagetool/rules/<languageCode>/grammar.xml}.
   */
  private activateDefaultPatternRules(): void {
    // Language.getPatternRules is protected (package access in Java)
    const patternRules = (this.language as unknown as { getPatternRules(): AbstractPatternRule[] }).getPatternRules();
    const enabledRules = this.language.getDefaultEnabledRulesForVariant();
    const disabledRules = this.language.getDefaultDisabledRulesForVariant();
    if (enabledRules.length > 0 || disabledRules.length > 0) {
      for (const patternRule of patternRules) {
        if (enabledRules.includes(patternRule.getId())) {
          patternRule.setDefaultOn();
        }
        if (disabledRules.includes(patternRule.getId())) {
          patternRule.setDefaultOff();
        }
      }
    }
    const transformed = this.transformPatternRules(patternRules, this.language);
    this.userRules.push(...transformed);
  }

  private transformPatternRules(patternRules: readonly AbstractPatternRule[], lang: Language): Rule[] {
    let rules: AbstractPatternRule[] = [...patternRules];
    const transforms: PatternRuleTransformer[] = [new (PC().RepeatedPatternRuleTransformer)(lang),
      new (PC().ConsistencyPatternRuleTransformer)(lang)];
    const transformed: Rule[] = [];
    for (const op of transforms) {
      const result = op.apply(rules);
      rules = [...result.getRemainingRules()];
      transformed.push(...result.getTransformedRules());
    }
    transformed.push(...rules);
    return transformed;
  }

  /**
   * Add a {@link RuleMatchFilter} for post-processing of rule matches
   * Filters are called sequentially in the same order as added
   *
   * @param filter filter to add
   * @since 4.7
   */
  addMatchFilter(filter: RuleMatchFilter): void {
    this.matchFilters.push(Objects_requireNonNull(filter));
  }

  /**
   * Add a rule to be used by the next call to the check methods like {@link #check(String)}.
   */
  addRule(rule: Rule): void {
    this.userRules.push(rule);
    this.ruleSetCache.clear();
  }

  /**
   * Disable a given rule so the check methods like {@link #check(String)} won't use it.
   *
   * @param ruleId the id of the rule to disable - no error will be thrown if the id does not exist
   * @see #enableRule(String)
   */
  disableRule(ruleId: string): void {
    this.disabledRules.add(ruleId);
    this.enabledRules.delete(ruleId);
    this.ruleSetCache.clear();
  }

  /**
   * Disable the given rules so the check methods like {@link #check(String)} won't use them.
   *
   * @param ruleIds the ids of the rules to disable - no error will be thrown if the id does not exist
   * @since 2.4
   */
  disableRules(ruleIds: readonly string[]): void {
    for (const id of ruleIds) this.disabledRules.add(id);
    for (const id of ruleIds) this.enabledRules.delete(id);
    this.ruleSetCache.clear();
  }

  /**
   * Updates the rules for the system by replacing the user-defined rules with the provided set of rules.
   * Clears any existing user and built-in rules, as well as the cached rule set, before applying the new rules.
   *
   * @param rules a list of Rule objects to be set as the new user-defined rules
   * @since 6.8
   */
  setRules(rules: readonly Rule[]): void {
    this.builtinRules.length = 0;
    this.userRules.length = 0;
    this.userRules.push(...rules);
    this.ruleSetCache.clear();
  }

  /**
   * Disable the given rule category so the check methods like {@link #check(String)} won't use it.
   *
   * @param id the id of the category to disable - no error will be thrown if the id does not exist
   * @see #enableRuleCategory(CategoryId)
   * @since 3.3
   */
  disableCategory(id: CategoryId): void {
    if (!List_contains(this.disabledRuleCategories, id)) this.disabledRuleCategories.push(id);
    JLanguageTool.removeCategory(this.enabledRuleCategories, id);
    this.ruleSetCache.clear();
  }

  private static removeCategory(list: CategoryId[], id: CategoryId): void {
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.equals(id)) list.splice(i, 1);
  }

  /**
   * Returns true if a category is explicitly disabled.
   *
   * @param id the id of the category to check - no error will be thrown if the id does not exist
   * @return true if this category is explicitly disabled.
   * @see #disableCategory(CategoryId)
   * @since 3.5
   */
  isCategoryDisabled(id: CategoryId): boolean {
    return List_contains(this.disabledRuleCategories, id);
  }

  /**
   * Get the language that was used to configure this instance.
   */
  getLanguage(): Language {
    return this.language;
  }

  /**
   * Get rule ids of the rules that have been explicitly disabled.
   */
  getDisabledRules(): Set<string> {
    return this.disabledRules;
  }

  /**
   * Enable a given rule so the check methods like {@link #check(String)} will use it.
   * This will <em>not</em> throw an exception if the given rule id doesn't exist.
   *
   * @param ruleId the id of the rule to enable
   * @see #disableRule(String)
   */
  enableRule(ruleId: string): void {
    this.disabledRules.delete(ruleId);
    this.enabledRules.add(ruleId);
    this.ruleSetCache.clear();
  }

  /**
   * Enable all rules of the given category so the check methods like {@link #check(String)} will use it.
   * This will <em>not</em> throw an exception if the given rule id doesn't exist.
   *
   * @see #disableCategory(CategoryId)
   * @since 3.3
   */
  enableRuleCategory(id: CategoryId): void {
    JLanguageTool.removeCategory(this.disabledRuleCategories, id);
    if (!List_contains(this.enabledRuleCategories, id)) this.enabledRuleCategories.push(id);
    this.ruleSetCache.clear();
  }

  /**
   * Tokenizes the given text into sentences.
   */
  sentenceTokenize(text: string): string[] {
    return this.language.getSentenceTokenizer().tokenize(text);
  }

  /**
   * The main check method. Tokenizes the text into sentences and matches these
   * sentences against all currently active rules, adjusting error positions so they refer
   * to the original text <em>including</em> markup (for an AnnotatedText).
   *
   * Forms (Java overloads):
   * - check(text: string | AnnotatedText)
   * - check(text: string, level: Level)
   * - check(text, listener: RuleMatchListener)
   * - check(text, tokenizeText: boolean, paraMode[, listener[, level]])
   * - check(text, tokenizeText, paraMode, listener, mode: Mode, level[, textSessionID])
   *
   * @param tokenizeText  If true, then the text is tokenized into sentences.
   *                      Otherwise, it is assumed it's already tokenized, i.e. it is only one sentence
   * @param paraMode      Uses paragraph-level rules only if true.
   * @return a List of {@link RuleMatch} objects, describing potential errors in the text
   */
  check(text: string | AnnotatedText, tokenizeTextOrOther?: boolean | Level | RuleMatchListener | null, paraMode: ParagraphHandling = ParagraphHandling.NORMAL,
        listener: RuleMatchListener | null = null, modeOrLevel?: Mode | Level, levelArg?: Level, _textSessionID?: number | null): RuleMatch[] {
    let annotatedText = typeof text === 'string' ? new AnnotatedTextBuilder().addText(text).build() : text;
    let tokenizeText = true;
    let level: Level = Level.DEFAULT;
    if (typeof tokenizeTextOrOther === 'boolean') {
      tokenizeText = tokenizeTextOrOther;
    } else if (typeof tokenizeTextOrOther === 'string') {
      level = tokenizeTextOrOther;
    } else if (tokenizeTextOrOther != null) {
      listener = tokenizeTextOrOther;
    }
    let mode: Mode;
    if (isModeValue(modeOrLevel)) {
      mode = modeOrLevel;
      level = levelArg ?? Level.DEFAULT;
    } else {
      if (modeOrLevel !== undefined) level = modeOrLevel;
      if (paraMode === ParagraphHandling.ONLYNONPARA) {
        mode = Mode.ALL_BUT_TEXTLEVEL_ONLY;
      } else if (paraMode === ParagraphHandling.ONLYPARA) {
        mode = Mode.TEXTLEVEL_ONLY;
      } else {
        mode = Mode.ALL;
      }
    }
    annotatedText = this.cleanText(annotatedText);
    const sentences = this.getSentences(annotatedText, tokenizeText);
    const analyzedSentences = this.analyzeSentences(sentences);
    return this.checkInternal(annotatedText, paraMode, listener, mode, level, sentences, analyzedSentences).getRuleMatches();
  }

  private getSentences(annotatedText: AnnotatedText, tokenizeText: boolean): string[] {
    let sentences: string[];
    if (tokenizeText) {
      sentences = this.sentenceTokenize(annotatedText.getPlainText());
    } else {
      sentences = [];
      sentences.push(annotatedText.getPlainText());
    }
    return sentences;
  }

  private cleanText(annotatedText: AnnotatedText): AnnotatedText {
    const atb = new AnnotatedTextBuilder();
    annotatedText.getGlobalMetaData().forEach((value, key) => atb.addGlobalMetaData(key, value));
    annotatedText.getCustomMetaData().forEach((value, key) => atb.addGlobalMetaData(key, value));
    const parts = annotatedText.getParts();
    for (const part of parts) {
      if (part.getType() === TextPart.Type.TEXT) {
        const byteOrderMark = '﻿';  // BOM or zero-width non-breaking space
        // split by byteOrderMark and let the delimiter also be part of the array
        const split = (ZERO_WIDTH_NBSP ??= Pattern.compile('(?<=﻿)|(?=﻿)')).split(part.getPart());
        for (const text of split) {
          if ('﻿' === text) {
            atb.addMarkup(byteOrderMark);
          } else {
            atb.addText(text);
          }
        }
      } else {
        atb.add(part);
      }
    }
    return atb.build();
  }

  protected checkInternal(annotatedText: AnnotatedText, paraMode: ParagraphHandling, listener: RuleMatchListener | null,
                          mode: Mode, level: Level, sentences: string[], analyzedSentences: AnalyzedSentence[],
                          toneTags: ReadonlySet<ToneTag> = new Set()): CheckResults {
    const rules = this.getActiveRulesForLevelAndToneTags(level, toneTags);
    return this.checkInternalWithCustomRules(rules, annotatedText, paraMode, listener, mode, level, toneTags, sentences, analyzedSentences);
  }

  checkInternalWithCustomRules(rules: RuleSet, annotatedText: AnnotatedText, paraMode: ParagraphHandling, listener: RuleMatchListener | null,
                               mode: Mode, level: Level, toneTags: ReadonlySet<ToneTag>,
                               sentences: string[], analyzedSentences: AnalyzedSentence[]): CheckResults {
    if (this.printStream != null) {
      this.printIfVerbose(rules.allRules().length + ' rules activated for language ' + this.language);
    }

    // (remote rules: not ported, see the header)
    const res = this.performCheck(analyzedSentences, sentences, rules,
            paraMode, annotatedText, listener, mode, level, true, toneTags);

    let ruleMatches = res.getRuleMatches();

    if (ruleMatches.length === 0) {
      return res;
    }

    ruleMatches = this.filterMatches(annotatedText, rules, ruleMatches, level, toneTags);

    // (GRPC post processing: not ported)

    return new CheckResults(ruleMatches, res.getIgnoredRanges(), res.getExtendedSentenceRanges());
  }

  private filterMatches(annotatedText: AnnotatedText, rules: RuleSet, ruleMatches: RuleMatch[], level: Level,
                        toneTags: ReadonlySet<ToneTag>): RuleMatch[] {
    // rules can create matches with rule IDs different from the original rule (see e.g. RemoteRules)
    // so while we can't avoid execution of these rules, we still want disabling them to work
    // so do another pass with ignoreRule here
    ruleMatches = ruleMatches.filter((match) => !this.ignoreRule(match.getRule()));

    // (isRuleActiveForLanguageWithModel: only acts on remote rule results, not ported)

    ruleMatches = ruleMatches.filter((match) => JLanguageTool.isRuleActiveForLevelAndToneTags(
      match.getRule(), level, toneTags));

    ruleMatches = new SameRuleGroupFilter().filter(ruleMatches);
    // no sorting: SameRuleGroupFilter sorts rule matches already
    ruleMatches = new LanguageDependentRuleMatchFilter(this.language, rules).filter(ruleMatches, annotatedText);
    if (this.cleanOverlappingMatches) {
      ruleMatches = new CleanOverlappingFilter(this.language, this.userConfig.getHidePremiumMatches()).filter(ruleMatches);
    }
    ruleMatches = this.language.filterRuleMatchesAfterOverlapping(ruleMatches);
    return this.applyCustomFilters(ruleMatches, annotatedText);
  }

  static isRuleActiveForLevelAndToneTags(rule: Rule, level: Level, toneTags: ReadonlySet<ToneTag>): boolean {

    if (level === Level.DEFAULT && rule.hasTag(Tag.picky)) {
      return false;
    }

    let enabledToneTags: readonly ToneTag[];
    if (toneTags.has(ToneTag.ALL_TONE_RULES)) {
      enabledToneTags = ToneTag_REAL_TONE_TAGS;
    } else if (toneTags.has(ToneTag.NO_TONE_RULE)) {
      enabledToneTags = []; //Even clarity rules will be disabled.
    } else if (toneTags.size === 0 || toneTags.has(ToneTag.ALL_WITHOUT_GOAL_SPECIFIC)) {
      enabledToneTags = [ToneTag.ALL_WITHOUT_GOAL_SPECIFIC];
    } else {
      enabledToneTags = [...toneTags];
    }

    if (rule.getToneTags().length === 0) {
      return true;
    }
    if (enabledToneTags.includes(ToneTag.ALL_WITHOUT_GOAL_SPECIFIC)) {
      return !rule.isGoalSpecific();
    }
    let removeRule = true;
    for (const toneTag of enabledToneTags) {
      if (rule.hasToneTag(toneTag)) {
        removeRule = false;
        break;
      }
    }
    return !removeRule;
  }

  private getActiveRulesForLevelAndToneTags(level: Level, toneTags: ReadonlySet<ToneTag>): RuleSet {
    // LevelToneTagCacheKey
    const key = level + '|' + [...toneTags].sort().join(',');
    let ruleSet = this.ruleSetCache.get(key);
    if (ruleSet === undefined) {
      const allRules: Rule[] = [...this.getAllActiveRules()]
        .filter((rule) => JLanguageTool.isRuleActiveForLevelAndToneTags(rule, level, toneTags));
      ruleSet = PC().RuleSet.textLemmaHinted(allRules);
      this.ruleSetCache.set(key, ruleSet);
    }
    return ruleSet;
  }

  /**
   * Use this method if you want to access LanguageTool's otherwise
   * internal analysis of the text. For actual text checking, use the {@code check...} methods instead.
   *
   * @param text The text to be analyzed
   * @since 2.5
   */
  analyzeText(text: string): AnalyzedSentence[] {
    const sentences = this.sentenceTokenize(text);
    return this.analyzeSentences(sentences);
  }

  protected analyzeSentences(sentences: string[]): AnalyzedSentence[] {
    this.unknownWords = new Set();
    const analyzedSentences: AnalyzedSentence[] = [];
    let j = 0;
    for (const sentence of sentences) {
      if (this.checkCancelledCallback != null && this.checkCancelledCallback.checkCancelled()) {
        break;
      }
      let analyzedSentence = this.getAnalyzedSentence(sentence);
      this.rememberUnknownWords(analyzedSentence);
      if (++j === sentences.length) {
        analyzedSentence = JLanguageTool.markAsParagraphEnd(analyzedSentence);
      }
      analyzedSentences.push(analyzedSentence);
      this.printSentenceInfo(analyzedSentence);
    }
    return analyzedSentences;
  }

  static markAsParagraphEnd(analyzedSentence: AnalyzedSentence): AnalyzedSentence {
    const anTokens = analyzedSentence.getTokens();
    anTokens[anTokens.length - 1]!.setParagraphEnd();
    const preDisambigAnTokens = analyzedSentence.getPreDisambigTokens();
    preDisambigAnTokens[anTokens.length - 1]!.setParagraphEnd();
    return new AnalyzedSentence(anTokens, preDisambigAnTokens);  ///TODO: why???
  }

  protected printSentenceInfo(analyzedSentence: AnalyzedSentence): void {
    if (this.printStream != null) {
      this.printIfVerbose(analyzedSentence.toString());
      this.printIfVerbose(analyzedSentence.getAnnotations());
    }
  }

  /**
   * @since 5.2
   */
  protected performCheck(analyzedSentences: AnalyzedSentence[], sentenceTexts: string[],
                         ruleSet: RuleSet, paraMode: ParagraphHandling, annotatedText: AnnotatedText, listener: RuleMatchListener | null,
                         mode: Mode, level: Level, checkRemoteRules: boolean, toneTags: ReadonlySet<ToneTag>): CheckResults {
    const sentences = this.computeSentenceData(analyzedSentences, sentenceTexts);
    const matcher = new JLanguageTool.TextCheckCallable(this, ruleSet, sentences, paraMode, annotatedText, listener, mode, level, checkRemoteRules, toneTags);
    return matcher.call();
  }

  protected computeSentenceData(analyzedSentences: AnalyzedSentence[] | null, texts: string[]): SentenceData[] {
    let charCount = 0;
    let lineCount = 0;
    let columnCount = 1;
    const result: SentenceData[] = [];

    if (analyzedSentences == null || analyzedSentences.length === 0) {
      return result;
    }

    for (let i = 0; i < texts.length; i++) {
      const sentence = texts[i]!;
      result.push(new SentenceData(analyzedSentences[i]!, sentence, charCount, lineCount, columnCount));

      charCount += sentence.length;
      lineCount += JLanguageTool.countLineBreaks(sentence);
      columnCount = this.processColumnChange(columnCount, sentence);
    }
    return result;
  }

  private processColumnChange(columnCount: number, sentence: string): number {
    const lineBreakPos = sentence.lastIndexOf('\n');
    if (lineBreakPos === -1) {
      columnCount += sentence.length;
    } else {
      columnCount = sentence.length - lineBreakPos;
      if (lineBreakPos === 0 && !this.language.getSentenceTokenizer().singleLineBreaksMarksPara()) {
        columnCount--;
      }
    }
    return columnCount;
  }

  /**
   * This is an internal method that's public only for technical reasons, please use one
   * of the {@link #check(String)} methods instead.
   * Without checkRemoteRules (deprecated since 2.3), ignored rules are filtered out first.
   *
   * @since 4.9
   */
  checkAnalyzedSentence(paraMode: ParagraphHandling, rules: readonly Rule[], analyzedSentence: AnalyzedSentence,
                        checkRemoteRules?: boolean, wordCounter = -1): RuleMatch[] {
    if (checkRemoteRules === undefined) {
      const nonIgnored = rules.filter((r) => !this.ignoreRule(r));
      return this.checkAnalyzedSentence(paraMode, nonIgnored, analyzedSentence, false);
    }
    if (paraMode === ParagraphHandling.ONLYPARA) {
      return [];
    }
    let sentenceMatches: RuleMatch[] = [];
    const errorRateLog: string[] = [];
    let tmpErrorsPerWord = 0.0;
    for (let i = 0, rulesSize = rules.length; i < rulesSize; i++) {
      const rule = rules[i]!;
      if (rule instanceof TextLevelRule /* || !checkRemoteRules && rule instanceof RemoteRule */) {
        continue;
      }
      if (this.checkCancelledCallback != null && this.checkCancelledCallback.checkCancelled()) {
        break;
      }
      const thisMatches = rule.match(analyzedSentence);
      sentenceMatches.push(...thisMatches);
      if (wordCounter > 0) {
        //check if the maxErrorsPerWordRate is already reached for the full text with this sentence and rule
        const errorsPerWord = sentenceMatches.length / wordCounter;
        if (tmpErrorsPerWord < errorsPerWord) {
          errorRateLog.push('With rule: ' + rule.getFullId() + ' ' + (i + 1) + '/' + rulesSize + ' the sentence error rate increased by: ' + (errorsPerWord - tmpErrorsPerWord) + ' from: ' + tmpErrorsPerWord + ' to total: ' + errorsPerWord);
          tmpErrorsPerWord = errorsPerWord;
        }
        if (this.maxErrorsPerWordRate > 0 && errorsPerWord > this.maxErrorsPerWordRate && wordCounter > 25) {
          throw new ErrorRateTooHighException('ErrorRateTooHigh is reached by a single sentence after rule: ' + rule.getFullId() + '. ' +
            'The whole text contains ' + wordCounter + ' words ' +
            'and this sentence has ' + sentenceMatches.length + ' matches.');
        }
      }
    }
    if (sentenceMatches.length === 0) {
      return sentenceMatches;
    }

    const text = new AnnotatedTextBuilder().addText(analyzedSentence.getText()).build();
    // rules can create matches with rule IDs different from the original rule (see e.g. RemoteRules)
    // so while we can't avoid execution of these rules, we still want disabling them to work
    // so do another pass with ignoreRule here
    sentenceMatches = sentenceMatches
      .filter((match) => !this.ignoreRule(match.getRule()));
    return this.applyCustomFilters(new SameRuleGroupFilter().filter(sentenceMatches), text);
  }

  private ignoreRule(rule: Rule): boolean {
    const ruleCategory: Category = rule.getCategory();
    const isCategoryDisabled = (List_contains(this.disabledRuleCategories, ruleCategory.getId()) || rule.getCategory().isDefaultOff())
      && !List_contains(this.enabledRuleCategories, ruleCategory.getId());
    const isRuleDisabled = this.disabledRules.has(rule.getFullId()) || this.disabledRules.has(rule.getId())
      || (rule.isDefaultOff() && !(this.enabledRules.has(rule.getFullId()) || this.enabledRules.has(rule.getId())));
    let isDisabled: boolean;
    if (isCategoryDisabled) {
      isDisabled = !(this.enabledRules.has(rule.getFullId()) || this.enabledRules.has(rule.getId()));
    } else {
      isDisabled = isRuleDisabled;
    }
    return isDisabled;
  }

  /**
   * Change RuleMatch positions so they are relative to the complete text,
   * not just to the sentence.
   *
   * @param charCount   Count of characters in the sentences before
   * @param columnCount Current column number
   * @param lineCount   Current line number
   * @param sentence    The text being checked
   * @return The RuleMatch object with adjustments
   */
  adjustRuleMatchPos(match: RuleMatch, charCount: number,
                     columnCount: number, lineCount: number, sentence: string, annotatedText: AnnotatedText | null): RuleMatch {
    let fromPos = match.getFromPos() + charCount;
    let toPos = match.getToPos() + charCount;
    if (annotatedText != null) {
      fromPos = annotatedText.getOriginalTextPositionFor(fromPos, false);
      toPos = annotatedText.getOriginalTextPositionFor(toPos - 1, true) + 1;
    }
    const thisMatch = new RuleMatch(match);
    thisMatch.setOffsetPosition(fromPos, toPos);
    //keep the positions with respect to sentence start
    thisMatch.setSentencePosition(match.getFromPos(), match.getToPos());

    const startPos = match.getPatternFromPos() + charCount;
    const endPos = match.getPatternToPos() + charCount;
    thisMatch.setPatternPosition(startPos, endPos);

    thisMatch.setLazySuggestedReplacements(() => this.extendSuggestions(match.getSuggestedReplacementObjects()));

    const sentencePartToError = sentence.substring(0, match.getFromPos());
    const sentencePartToEndOfError = sentence.substring(0, match.getToPos());
    const lastLineBreakPos = sentencePartToError.lastIndexOf('\n');
    let column: number;
    let endColumn: number;
    if (lastLineBreakPos === -1) {
      column = sentencePartToError.length + columnCount;
    } else {
      column = sentencePartToError.length - lastLineBreakPos;
    }
    const lastLineBreakPosInError = sentencePartToEndOfError.lastIndexOf('\n');
    if (lastLineBreakPosInError === -1) {
      endColumn = sentencePartToEndOfError.length + columnCount;
    } else {
      endColumn = sentencePartToEndOfError.length - lastLineBreakPosInError;
    }
    const lineBreaksToError = JLanguageTool.countLineBreaks(sentencePartToError);
    const lineBreaksToEndOfError = JLanguageTool.countLineBreaks(sentencePartToEndOfError);
    thisMatch.setLine(lineCount + lineBreaksToError);
    thisMatch.setEndLine(lineCount + lineBreaksToEndOfError);
    thisMatch.setColumn(column);
    thisMatch.setEndColumn(endColumn);
    return thisMatch;
  }

  private extendSuggestions(replacements: readonly SuggestedReplacement[]): SuggestedReplacement[] {
    const extended: SuggestedReplacement[] = [];
    for (const replacement of replacements) {
      const newReplacement = new SuggestedReplacement(replacement);
      if (replacement.getShortDescription() == null) {  // don't overwrite more specific suggestions from the rule
        const descOrNull = this.descProvider.getShortDescription(replacement.getReplacement(), this.language);
        newReplacement.setShortDescription(descOrNull);
        newReplacement.setSuffix(replacement.getSuffix());
      }
      extended.push(newReplacement);
    }
    return extended;
  }

  protected rememberUnknownWords(analyzedText: AnalyzedSentence): void {
    if (this.listUnknownWords) {
      const atr = analyzedText.getTokensWithoutWhitespace();
      for (const reading of atr) {
        if (!reading.isTagged()) {
          this.unknownWords.add(reading.getToken());
        }
      }
    }
  }

  /**
   * Get the alphabetically sorted list of unknown words in the latest run of one of the {@link #check(String)} methods.
   *
   * @throws IllegalStateException if {@link #setListUnknownWords(boolean)} has been set to {@code false}
   */
  getUnknownWords(): string[] {
    if (!this.listUnknownWords) {
      throw new Error('IllegalStateException: listUnknownWords is set to false, unknown words not stored');
    }
    const words = [...this.unknownWords];
    words.sort();
    return words;
  }

  // non-private only for test case
  static countLineBreaks(s: string): number {
    let pos = -1;
    let count = 0;
    while (true) {
      const nextPos = s.indexOf('\n', pos + 1);
      if (nextPos === -1) {
        break;
      }
      pos = nextPos;
      count++;
    }
    return count;
  }

  /**
   * Tokenizes the given {@code sentence} into words and analyzes it,
   * and then disambiguates POS tags.
   *
   * @param sentence sentence to be analyzed
   */
  getAnalyzedSentence(sentence: string): AnalyzedSentence {
    // (ResultCache: not ported)
    const raw = this.getRawAnalyzedSentence(sentence);
    const disambig = this.language.getDisambiguator().disambiguate(raw, this.checkCancelledCallback);
    const analyzedSentence = new AnalyzedSentence(disambig.getTokens(), raw.getTokens());
    if (this.language.getPostDisambiguationChunker() != null) {
      this.language.getPostDisambiguationChunker()!.addChunkTags([...analyzedSentence.getTokens()]);
    }
    return analyzedSentence;
  }

  /**
   * Tokenizes the given {@code sentence} into words and analyzes it.
   * This is the same as {@link #getAnalyzedSentence(String)} but it does not run
   * the disambiguator.
   *
   * @param sentence sentence to be analyzed
   * @since 0.9.8
   */
  getRawAnalyzedSentence(sentence: string): AnalyzedSentence {
    const tokens = this.language.getWordTokenizer().tokenize(sentence);
    const softHyphenTokens = this.replaceSoftHyphens(tokens);

    const aTokens = this.language.getTagger().tag(tokens);
    if (this.language.getChunker() != null) {
      this.language.getChunker()!.addChunkTags(aTokens);
    }

    const tokenArray: AnalyzedTokenReadings[] = new Array(tokens.length + 1);
    const startTokenArray: AnalyzedToken[] = new Array(1);
    let toArrayCount = 0;
    const sentenceStartToken = new AnalyzedToken('', JLanguageTool.SENTENCE_START_TAGNAME, null);
    startTokenArray[0] = sentenceStartToken;
    tokenArray[toArrayCount++] = new AnalyzedTokenReadings(startTokenArray, 0);
    let startPos = 0;
    for (const posTag of aTokens) {
      posTag.setStartPos(startPos);
      tokenArray[toArrayCount++] = posTag;
      startPos += posTag.getToken().length;
    }

    const numTokens = aTokens.length;
    let posFix = 0;
    for (let i = 0; i < numTokens; i++) {
      if (i > 0) {
        aTokens[i]!.setWhitespaceBefore(aTokens[i - 1]!.getToken());
        aTokens[i]!.setStartPos(aTokens[i]!.getStartPos() + posFix);
        aTokens[i]!.setPosFix(posFix);
      }
      if (softHyphenTokens.size !== 0 && softHyphenTokens.get(i) != null) {
        // addReading() modifies a readings.token if last token is longer - need to use it first
        posFix += softHyphenTokens.get(i)!.origToken.length - aTokens[i]!.getToken().length;
        const newToken = this.language.getTagger().createToken(softHyphenTokens.get(i)!.origToken, null);
        aTokens[i]!.addReading(newToken, 'softHyphenTokens');
        aTokens[i]!.setCleanToken(softHyphenTokens.get(i)!.cleanToken);
      }
    }

    // add additional tags
    let lastToken = toArrayCount - 1;
    // make SENT_END appear at last not whitespace token
    for (let i = 0; i < toArrayCount - 1; i++) {
      if (!tokenArray[lastToken - i]!.isWhitespace()) {
        lastToken -= i;
        break;
      }
    }

    tokenArray[lastToken]!.setSentEnd();

    if (tokenArray.length === lastToken + 1 && tokenArray[lastToken]!.isLinebreak()) {
      tokenArray[lastToken]!.setParagraphEnd();
    }
    return new AnalyzedSentence(tokenArray);
  }

  private replaceSoftHyphens(tokens: string[]): Map<number, CleanToken> {
    const ignoredCharacterRegex = this.language.getIgnoredCharactersRegex();
    const ignoredCharsTokens = new Map<number, CleanToken>();
    if (ignoredCharacterRegex == null) {
      return ignoredCharsTokens;
    }
    for (let i = 0; i < tokens.length; i++) {
      const matcher = ignoredCharacterRegex.matcher(tokens[i]!);
      if (matcher.find()) {
        const cleaned = matcher.replaceAll('');
        ignoredCharsTokens.set(i, new CleanToken(tokens[i]!, cleaned));
        tokens[i] = matcher.replaceAll('');
      }
    }
    return ignoredCharsTokens;
  }

  /**
   * Get all rule categories for the current language.
   *
   * @return a map of {@link Category Categories}, keyed by their {@link CategoryId id} (its string).
   * @since 3.5
   */
  getCategories(): Map<string, Category> {
    const map = new Map<string, Category>();
    for (const rule of this.getAllRules()) {
      map.set(rule.getCategory().getId().toString(), rule.getCategory());
    }
    return map;
  }

  /**
   * Get all rules for the current language that are built-in or that have been
   * added using {@link #addRule(Rule)}. Please note that XML rules that are grouped
   * will appear as multiple rules with the same id. To tell them apart, check if
   * they are of type {@code AbstractPatternRule}, cast them to that type and call
   * their {@link AbstractPatternRule#getSubId()} method.
   *
   * @return a List of {@link Rule} objects
   */
  getAllRules(): Rule[] {
    const rules: Rule[] = [];
    rules.push(...this.builtinRules);
    rules.push(...this.userRules);
    return rules;
  }

  /**
   * Get all active (not disabled) rules for the current language that are built-in or that
   * have been added using e.g. {@link #addRule(Rule)}. See {@link #getAllRules()} for hints
   * about rule ids.
   *
   * @return a List of {@link Rule} objects
   */
  getAllActiveRules(): Rule[] {
    const rules: Rule[] = [];
    const rulesActive: Rule[] = [];
    rules.push(...this.builtinRules);
    rules.push(...this.userRules);
    // Some rules have an internal state so they can do checks over sentence
    // boundaries. These need to be reset so the checks don't suddenly
    // work on different texts with the same data. However, it could be useful
    // to keep the state information if we're checking a continuous text.
    for (const rule of rules) {
      if (!this.ignoreRule(rule)) {
        rulesActive.push(rule);
      }
    }
    return rulesActive;
  }

  /**
   * Works like getAllActiveRules but overrides defaults by office defaults
   *
   * @return a List of {@link Rule} objects
   * @since 4.0
   */
  getAllActiveOfficeRules(): Rule[] {
    const rules: Rule[] = [];
    const rulesActive: Rule[] = [];
    rules.push(...this.builtinRules);
    rules.push(...this.userRules);
    for (const rule of rules) {
      if (!this.ignoreRule(rule) && !rule.isOfficeDefaultOff()) {
        rulesActive.push(rule);
      } else if (rule.isOfficeDefaultOn() && !this.disabledRules.has(rule.getId())) {
        rulesActive.push(rule);
        this.enableRule(rule.getId());
      } else if (!this.ignoreRule(rule) && rule.isOfficeDefaultOff() && !this.enabledRules.has(rule.getId())) {
        this.disableRule(rule.getId());
      }
    }
    return rulesActive;
  }

  /**
   * Get pattern rules by Id and SubId. This returns a list because rules that use {@code <or>...</or>}
   * are internally expanded into several rules.
   *
   * @return a List of {@link Rule} objects
   * @since 2.3
   */
  getPatternRulesByIdAndSubId(id: string, subId: string): AbstractPatternRule[] {
    const rules = this.getAllRules();
    const rulesById: AbstractPatternRule[] = [];
    for (const rule of rules) {
      if (id.startsWith(rule.getId())) {
        // test wrapped rules as normal in PatternRuleTest
        if (rule instanceof PC().ConsistencyPatternRule) {
          const wrappedRules = (rule as ConsistencyPatternRule).getWrappedRules();
          rulesById.push(...wrappedRules.filter((r) => r.getSubId() === subId));
        }
      }
      if (rule.getId() === id) {
        // test wrapped rules as normal in PatternRuleTest
        if (rule instanceof PC().RepeatedPatternRule) {
          const wrappedRules = (rule as RepeatedPatternRule).getWrappedRules();
          rulesById.push(...wrappedRules.filter((r) => r.getSubId() === subId));
        }
        else if (rule instanceof PC().AbstractPatternRule && rule.getSubId() === subId){
          rulesById.push(rule);
        }
      }
    }
    return rulesById;
  }

  protected printIfVerbose(s: string): void {
    if (this.printStream != null) {
      this.printStream(s);
    }
  }

  /**
   * should be called just once with complete list of matches, before returning them to caller
   *
   * @param matches matches after applying rules and default filters
   * @param text    text that matches refer to
   * @return transformed matches (after applying filters in {@link #matchFilters})
   * @since 4.7
   */
  protected applyCustomFilters(matches: RuleMatch[], text: AnnotatedText): RuleMatch[] {
    let transformed = matches;
    for (const filter of this.matchFilters) {
      transformed = filter.filter(transformed, text);
    }
    return transformed;
  }

  static readonly TextCheckCallable = class TextCheckCallable {
    private readonly outer: JLanguageTool;
    private readonly rules: RuleSet;
    private readonly checkRemoteRules: boolean;
    private readonly paraMode: ParagraphHandling;
    private readonly annotatedText: AnnotatedText;
    private readonly sentences: SentenceData[];
    private readonly listener: RuleMatchListener | null;
    private readonly mode: Mode;
    private readonly level: Level;
    private readonly toneTags: ReadonlySet<ToneTag>;

    constructor(outer: JLanguageTool, rules: RuleSet, sentences: SentenceData[],
                paraMode: ParagraphHandling, annotatedText: AnnotatedText,
                listener: RuleMatchListener | null, mode: Mode, level: Level, checkRemoteRules: boolean, toneTags: ReadonlySet<ToneTag>) {
      this.outer = outer;
      this.rules = rules;
      this.checkRemoteRules = checkRemoteRules;
      this.sentences = Objects_requireNonNull(sentences);
      this.paraMode = Objects_requireNonNull(paraMode);
      this.annotatedText = Objects_requireNonNull(annotatedText);
      this.listener = listener;
      this.mode = Objects_requireNonNull(mode);
      this.level = Objects_requireNonNull(level);
      this.toneTags = toneTags;
    }

    call(): CheckResults {
      const ruleMatches: RuleMatch[] = [];
      const ignoreRanges: Range[] = [];
      const extendedSentenceRanges: ExtendedSentenceRange[] = [];
      if (this.mode === Mode.ALL) {
        ruleMatches.push(...this.getTextLevelRuleMatches());
        const otherRuleMatches = this.getOtherRuleMatches(this.toneTags);
        ruleMatches.push(...otherRuleMatches.getRuleMatches());
        ignoreRanges.push(...otherRuleMatches.getIgnoredRanges());
        extendedSentenceRanges.push(...otherRuleMatches.getExtendedSentenceRanges());
      } else if (this.mode === Mode.ALL_BUT_TEXTLEVEL_ONLY) {
        const otherRuleMatches = this.getOtherRuleMatches(this.toneTags);
        ruleMatches.push(...otherRuleMatches.getRuleMatches());
        ignoreRanges.push(...otherRuleMatches.getIgnoredRanges());
        extendedSentenceRanges.push(...otherRuleMatches.getExtendedSentenceRanges());
      } else if (this.mode === Mode.TEXTLEVEL_ONLY) {
        ruleMatches.push(...this.getTextLevelRuleMatches());
      } else {
        throw new Error('IllegalArgumentException: Unknown mode: ' + this.mode);
      }
      // can't call applyCustomRuleFilters here, done in performCheck ->
      // should run just once w/ complete list of matches
      return new CheckResults(ruleMatches, ignoreRanges, extendedSentenceRanges);
    }

    private getTextLevelRuleMatches(): RuleMatch[] {
      const outer = this.outer;
      const ruleMatches: RuleMatch[] = [];
      let analyzedSentences: AnalyzedSentence[] | null = null;
      for (const rule of this.rules.allRules()) {
        if (rule instanceof TextLevelRule && this.paraMode !== ParagraphHandling.ONLYNONPARA) {
          if (outer.checkCancelledCallback != null && outer.checkCancelledCallback.checkCancelled()) {
            break;
          }
          if (analyzedSentences == null) {
            analyzedSentences = this.sentences.map((s) => s.analyzed);
          }
          const matches = rule.match(analyzedSentences, this.annotatedText);
          const adaptedMatches: RuleMatch[] = [];
          for (const match of matches) {
            let from: LineColumnPosition;
            let to: LineColumnPosition;
            try {
              from = this.findLineColumn(match.getFromPos());
              to = this.findLineColumn(match.getToPos());
            } catch (e) {
              throw new Error('RuntimeException: Getting line/column positions failed for match ' + match + ' Sentence: ' + match.getSentence()?.getText(), { cause: e });
            }
            let newFromPos: number;
            let newToPos: number;
            try {
              newFromPos = this.annotatedText.getOriginalTextPositionFor(match.getFromPos(), false);
              newToPos = this.annotatedText.getOriginalTextPositionFor(match.getToPos() - 1, true) + 1;
            } catch (e) {
              throw new Error('RuntimeException: Getting positions failed for match ' + match + ' Sentence: ' + match.getSentence()?.getText(), { cause: e });
            }
            const newMatch = new RuleMatch(match);
            newMatch.setOffsetPosition(newFromPos, newToPos);
            newMatch.setLine(from.line);
            newMatch.setEndLine(to.line);
            newMatch.setColumn(from.column - (from.line === 0 ? 1 : 0));
            newMatch.setEndColumn(to.column - (to.line === 0 ? 1 : 0));
            newMatch.setSuggestedReplacementObjects(outer.extendSuggestions(match.getSuggestedReplacementObjects()));
            adaptedMatches.push(newMatch);
          }
          ruleMatches.push(...adaptedMatches);
          if (this.listener != null) {
            for (const adaptedMatch of adaptedMatches) {
              this.listener.matchFound(adaptedMatch);
            }
          }
        }
      }
      return ruleMatches;
    }

    private getOtherRuleMatches(_toneTags: ReadonlySet<ToneTag>): CheckResults {
      const outer = this.outer;
      const ruleMatches: RuleMatch[] = [];
      const ignoreRanges: Range[] = []; //TODO: remove later
      const extendedSentenceRanges: ExtendedSentenceRange[] = [];

      const textWordCounter = this.sentences.map((sentenceData) => sentenceData.wordCount).reduce((a, b) => a + b, 0);
      let wordCounter = 0;
      let tmpErrorsPerWord = 0.0;
      const errorRateLog: string[] = [];
      for (let i = 0, sentencesSize = this.sentences.length; i < sentencesSize; i++) {
        const sentence = this.sentences[i]!;
        wordCounter += sentence.wordCount;
        let whitespaceFix = 0;
        // Check if sentence in sentenceData has more than 1 whitespace at begin, if yes fix the range to match with the normal sentenceRange
        if (sentence.text.startsWith(' ', 1)) {
          const sentenceStripLeading = stripLeading(sentence.text);
          whitespaceFix = (sentence.text.length - sentenceStripLeading.length);
        }
        const extendedSentenceRange = new ExtendedSentenceRange(sentence.startOffset + whitespaceFix, sentence.startOffset + whitespaceFix + StringTrim(sentence.text).length, outer.language.getShortCode());
        extendedSentenceRanges.push(extendedSentenceRange);
        try {
          //comment in to trigger an exception via input text:
          //if (analyzedSentence.getText().contains("fakecrash")) {
          //  throw new RuntimeException("fake crash");
          //}
          // (ResultCache: not ported)
          const rules: Rule[] = [...this.rules.rulesForSentence(sentence.analyzed)];
          rules.push(...outer.userConfig.getRules());
          const sentenceMatches = outer.checkAnalyzedSentence(this.paraMode, rules, sentence.analyzed, this.checkRemoteRules, textWordCounter);
          if (sentenceMatches.length !== 0) {
            if (outer.checkCancelledCallback != null && outer.checkCancelledCallback.checkCancelled()) {
              break;
            }
            for (const elem of sentenceMatches) {
              const thisMatch = outer.adjustRuleMatchPos(elem, sentence.startOffset, sentence.startColumn, sentence.startLine, sentence.text, this.annotatedText);
              if (elem.getNewLanguageMatches().size !== 0) {
                //TODO: remove after the addon is updated
                const ignoreRange = new Range(sentence.startOffset, sentence.startOffset + sentence.text.length, elem.getNewLanguageMatches().keys().next().value!);
                if (!List_contains(ignoreRanges, ignoreRange)) {
                  ignoreRanges.push(ignoreRange);
                }
                extendedSentenceRange.updateLanguageConfidenceRates(elem.getNewLanguageMatches());
              }
              ruleMatches.push(thisMatch);
              if (this.listener != null) {
                this.listener.matchFound(thisMatch);
              }
            }
          }
          const errorsPerWord = ruleMatches.length / wordCounter;
          if (tmpErrorsPerWord < errorsPerWord) {
            errorRateLog.push('With sentence: ' + (i + 1) + ' (of ' + sentencesSize + ') the text error rate increased by: ' + (errorsPerWord - tmpErrorsPerWord) + ' from: ' + tmpErrorsPerWord + ' to total: ' + errorsPerWord);
            tmpErrorsPerWord = errorsPerWord;
          }
          if (outer.maxErrorsPerWordRate > 0 && errorsPerWord > outer.maxErrorsPerWordRate && wordCounter > 25) {
            throw new ErrorRateTooHighException('Text checking was stopped due to too many errors (more than ' + (outer.maxErrorsPerWordRate * 100).toFixed(0) +
              '% of words seem to have an error). Are you sure you have set the correct text language? Language set: ' + outer.language.getName() +
              ', text length: ' + this.annotatedText.getPlainText().length);
          }
        } catch (e) {
          if (e instanceof ErrorRateTooHighException) {
            throw e;
          }
          throw new Error('RuntimeException: Could not check sentence (language: ' + outer.language + '): <sentcontent>'
                  + abbreviate(sentence.analyzed.toTextString(), 500) + '</sentcontent>: ' + (e instanceof Error ? e.message : e), { cause: e });
        }
      }
      return new CheckResults(ruleMatches, ignoreRanges, extendedSentenceRanges);
    }

    private findLineColumn(offset: number): LineColumnPosition {
      if (this.sentences.length === 0) return new LineColumnPosition(0, 0);

      const sentence = this.findSentenceContaining(offset);
      const prefix = sentence.text.substring(0, offset - sentence.startOffset);
      return new LineColumnPosition(
        sentence.startLine + JLanguageTool.countLineBreaks(prefix),
        this.outer.processColumnChange(sentence.startColumn, prefix));
    }

    private findSentenceContaining(offset: number): SentenceData {
      let low = 0;
      let high = this.sentences.length - 1;
      while (low <= high) {
        const mid = Math.trunc((low + high) / 2);
        const sentence = this.sentences[mid]!;
        if (sentence.startOffset < offset) low = mid + 1;
        else if (sentence.startOffset > offset) high = mid - 1;
        else return sentence;
      }
      return this.sentences[low - 1]!;
    }
  };

  setConfigValues(v: Map<string, unknown[]>): void {
    this.userConfig.insertConfigValues(v);
  }

}

Rule.getMessageBundle = () => JLanguageTool.getMessageBundle();
