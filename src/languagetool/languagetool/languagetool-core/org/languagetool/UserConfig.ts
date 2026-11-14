// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/UserConfig.java reduced
// The constructor overloads are one constructor taking the longest parameter list; the short
// forms are recognised by their argument types: new UserConfig(), (words), (ruleValues: Map),
// (ruleValues: Map, linguServices), (words, ruleValues: Map, maxSpellingSuggestions, premiumUid,
// userDictName, userDictCacheSize, linguServices). LinguServices (the office extension's
// external speller) is not ported and typed as unknown. equals compares the same fields as Java
// (shallowly); hashCode is left out.
import type { Rule } from './rules/Rule.ts';
import { Arrays_equals } from '../../../../jdk/java/util/Objects.ts';

export const TokenType = {
  INVALID_TOKEN: 'INVALID_TOKEN',
  NO_TOKEN: 'NO_TOKEN',
  TEST_TOKEN: 'TEST_TOKEN',
  TRIAL_TOKEN: 'TRIAL_TOKEN',
} as const;
export type TokenType = typeof TokenType[keyof typeof TokenType];

type RuleValues = Map<string, unknown[]>;

/**
 * User-specific configuration. So far, this contains a list of words and a settings map.
 * @since 4.2
 */
export class UserConfig {

  static readonly TokenType = TokenType;

  // don't do A/B tests in command line / GUI mode / tests, etc.; true when running as a server
  private static abTestEnabled = false;
  static enableABTests(): void {
    UserConfig.abTestEnabled = true;
  }
  static hasABTestsEnabled(): boolean {
    return UserConfig.abTestEnabled;
  }

  private readonly userSpecificSpellerWords: string[];
  private readonly acceptedPhrases: Set<string>;
  private readonly userSpecificRules: Rule[];
  private readonly maxSpellingSuggestions: number;
  private readonly userDictCacheSize: number | null;
  private readonly userDictName: string;
  private readonly premiumUid: number | null;
  private readonly configurableRuleValues = new Map<string, unknown[]>();
  private readonly linguServices: unknown;
  // needs to be in UserConfig so it is considered both in ResultCache and in PipelinePool
  private readonly _filterDictionaryMatches: boolean;
  private readonly hidePremiumMatches: boolean;

  // partially indifferent for comparing UserConfigs (e.g. in PipelinePool)
  // provided to rules only for A/B tests
  private readonly textSessionId: number | null;
  private readonly abTest: string[] | null;
  private readonly preferredLanguages: string;
  private readonly trustedSource: boolean;
  private readonly optInThirdPartyAI: boolean;
  private readonly _isPremium: boolean;
  private readonly tokenType: TokenType;
  private readonly suggestionsEnabled: boolean;

  constructor(userSpecificSpellerWords?: string[] | RuleValues, userSpecificRules?: Rule[] | RuleValues | unknown,
              ruleValues?: RuleValues | number, maxSpellingSuggestions?: number | null, premiumUid?: number | string | null, userDictName?: string | number | null,
              userDictCacheSize?: number | unknown | null, linguServices?: unknown, filterDictionaryMatches = false,
              abTest: string[] | null = null, textSessionId: number | null = null,
              hidePremiumMatches = false, preferredLanguages: string[] | null = null,
              trustedSource = false, optInThirdPartyAI = false, isPremium = false,
              tokenType: TokenType = TokenType.NO_TOKEN, suggestionsEnabled = true) {
    if (userSpecificSpellerWords instanceof Map) {
      // UserConfig(Map ruleValues) and UserConfig(Map ruleValues, LinguServices linguServices)
      linguServices = userSpecificRules ?? null;
      ruleValues = userSpecificSpellerWords;
      userSpecificSpellerWords = [];
      userSpecificRules = [];
      maxSpellingSuggestions = 0;
      premiumUid = linguServices != null ? 0 : null;
      userDictName = null;
      userDictCacheSize = linguServices != null ? 0 : null;
    } else if (userSpecificRules instanceof Map) {
      // UserConfig(List words, Map ruleValues[, int max, Long premiumUid, String userDictName, Long userDictCacheSize, LinguServices])
      linguServices = userDictCacheSize ?? null;
      userDictCacheSize = userDictName as number | null ?? null;
      userDictName = premiumUid as string | null ?? null;
      premiumUid = maxSpellingSuggestions ?? null;
      maxSpellingSuggestions = (ruleValues as number | undefined) ?? 0;
      ruleValues = userSpecificRules;
      userSpecificRules = [];
    }
    this.userSpecificSpellerWords = userSpecificSpellerWords ?? [];
    this.userSpecificRules = (userSpecificRules as Rule[] | undefined) ?? [];
    for (const [key, value] of (ruleValues as RuleValues | undefined) ?? new Map()) {
      this.configurableRuleValues.set(key, value);
    }
    this.maxSpellingSuggestions = maxSpellingSuggestions ?? 0;
    this.premiumUid = premiumUid as number | null ?? null;
    this.userDictName = userDictName == null ? 'default' : userDictName as string;
    this.userDictCacheSize = userDictCacheSize as number | null ?? null;
    this.linguServices = linguServices ?? null;
    this._filterDictionaryMatches = filterDictionaryMatches;
    this.abTest = abTest;
    this.textSessionId = textSessionId;
    this.hidePremiumMatches = hidePremiumMatches;
    this.acceptedPhrases = this.buildAcceptedPhrases();
    this.preferredLanguages = this.removeAllButMainLanguagesAndSort(preferredLanguages);
    this.trustedSource = trustedSource;
    this.optInThirdPartyAI = optInThirdPartyAI;
    this._isPremium = isPremium;
    this.tokenType = tokenType;
    this.suggestionsEnabled = suggestionsEnabled;
  }

  private removeAllButMainLanguagesAndSort(preferredLanguages: string[] | null): string {
    const cleanLangList = preferredLanguages != null ? [...preferredLanguages] : [];
    const kept = cleanLangList.filter((language) =>
      language === 'de' || language === 'en' || language === 'es' || language === 'fr' || language === 'nl' || language === 'pt');
    kept.sort();
    return kept.length >= 2 ? kept.join(',') : '';
  }

  getAcceptedWords(): string[] {
    return this.userSpecificSpellerWords;
  }

  private buildAcceptedPhrases(): Set<string> {
    const phrases = new Set<string>();
    for (const wordOrPhrase of this.userSpecificSpellerWords) {
      if (wordOrPhrase.includes(' ')) {
        phrases.add(wordOrPhrase);
      }
    }
    return phrases;
  }

  getAcceptedPhrases(): Set<string> {
    return this.acceptedPhrases;
  }

  /**
   * @since 5.7
   */
  getRules(): Rule[] {
    return this.userSpecificRules;
  }

  getMaxSpellingSuggestions(): number {
    return this.maxSpellingSuggestions;
  }

  getConfigValues(): Map<string, unknown[]> {
    return this.configurableRuleValues;
  }

  insertConfigValues(ruleValues: Map<string, unknown[]>): void {
    for (const [key, value] of ruleValues) {
      this.configurableRuleValues.set(key, value);
    }
  }

  getConfigValueByID(ruleID: string): unknown[] | null {
    if (this.configurableRuleValues.has(ruleID)) {
      return this.configurableRuleValues.get(ruleID)!;
    }
    return null;
  }

  hasLinguServices(): boolean {
    return this.linguServices != null;
  }

  getLinguServices(): unknown {
    return this.linguServices;
  }

  /**
   * for speedup, certain users custom dictionaries are cached.
   * Null if disabled, else max. number of words in cache
   * @since 4.3
   */
  getUserDictCacheSize(): number | null {
    return this.userDictCacheSize;
  }

  /**
   * @since 4.3
   */
  getUserDictName(): string {
    return this.userDictName;
  }

  /**
   * @since 4.3
   */
  getPremiumUid(): number | null {
    return this.premiumUid;
  }

  /**
   * If the generation of suggestions should be enabled (default true)
   * @since 6.8
   */
  isSuggestionsEnabled(): boolean {
    return this.suggestionsEnabled;
  }

  isTrustedSource(): boolean { return this.trustedSource; }

  isOptInThirdPartyAI(): boolean { return this.optInThirdPartyAI; }

  isPremium(): boolean { return this._isPremium; }

  getTokenType(): TokenType { return this.tokenType; }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof UserConfig)) return false;
    const other = o;
    const sameValues = (a: Map<string, unknown[]>, b: Map<string, unknown[]>) =>
      a.size === b.size && [...a].every(([k, v]) => b.has(k) && Arrays_equals(v, b.get(k)!));
    return sameValues(this.configurableRuleValues, other.configurableRuleValues)
      && Arrays_equals(this.userSpecificRules.map((r) => r.getId()), other.userSpecificRules.map((r) => r.getId()))
      && this.premiumUid === other.premiumUid
      && this.userDictName === other.userDictName
      && Arrays_equals(this.userSpecificSpellerWords, other.userSpecificSpellerWords)
      && this._filterDictionaryMatches === other._filterDictionaryMatches
      && Arrays_equals(this.abTest, other.abTest)
      && this.hidePremiumMatches === other.hidePremiumMatches
      && this.preferredLanguages === other.preferredLanguages
      && this.trustedSource === other.trustedSource
      && this.optInThirdPartyAI === other.optInThirdPartyAI
      && this._isPremium === other._isPremium
      && this.tokenType === other.tokenType
      && this.suggestionsEnabled === other.suggestionsEnabled;
  }

  toString(): string {
    return 'UserConfig{' +
      'dictionarySize=' + this.userSpecificSpellerWords.length +
      ', maxSpellingSuggestions=' + this.maxSpellingSuggestions +
      ", userDictName='" + this.userDictName + "'" +
      ', configurableRuleValues=' + JSON.stringify([...this.configurableRuleValues]) +
      ', linguServices=' + this.linguServices +
      ', filterDictionaryMatches=' + this._filterDictionaryMatches +
      ', textSessionId=' + this.textSessionId +
      ', hidePremiumMatches=' + this.hidePremiumMatches +
      ", abTest='" + this.abTest + "'" +
      ', optInThirdPartyAI=' + this.optInThirdPartyAI +
      ', suggestionsEnabled=' + this.suggestionsEnabled +
      '}';
  }

  getTextSessionId(): number | null {
    return this.textSessionId;
  }

  getAbTest(): string[] | null {
    return this.abTest;
  }

  filterDictionaryMatches(): boolean {
    return this._filterDictionaryMatches;
  }

  /** @since 5.5 */
  getHidePremiumMatches(): boolean {
    return this.hidePremiumMatches;
  }

  /**
   * This may not contain the full preferredLanguages list as it's  intended to only be used with ForeignLanguageChecker
   * @return
   */
  getPreferredLanguages(): string[] {
    return this.preferredLanguages.split(',');
  }
}
