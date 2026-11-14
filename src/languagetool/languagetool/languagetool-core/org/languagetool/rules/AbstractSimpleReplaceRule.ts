// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractSimpleReplaceRule.java faithful
// The two loadFromPath overloads are one (varargs); the logger is left out (a warning only).
// Case conversion with getLocale() is the locale-independent one (as for all non-Turkic locales).
import { AnalyzedToken } from '../AnalyzedToken.ts';
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Language } from '../Language.ts';
import type { Synthesizer } from '../synthesis/Synthesizer.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Locale } from '../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Categories } from './Categories.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { SimpleReplaceDataLoader } from './SimpleReplaceDataLoader.ts';
import { SpecificIdRule } from './SpecificIdRule.ts';

/**
 * A rule that matches words which should not be used and suggests
 * correct ones instead. Loads the relevant words from
 * <code>rules/XX/replace.txt</code>, where XX is a code of the language.
 * 
 * @author Andriy Rysin
 */
export abstract class AbstractSimpleReplaceRule extends Rule {

  protected ignoreTaggedWords = false;
  protected subRuleSpecificIds = false;

  private checkLemmas = true;
  private readonly language: Language;

  abstract getWrongWords(): ReadonlyMap<string, readonly string[]>;

  /**
   * @since 5.0 (several paths)
   */
  protected static loadFromPath(...paths: string[]): ReadonlyMap<string, string[]> {
    const loader = new SimpleReplaceDataLoader();
    if (paths.length === 1) {
      return loader.loadWords(paths[0]!);
    }
    const map = new Map<string, string[]>();
    for (const path of paths) {
      for (const [k, v] of loader.loadWords(path)) {
        map.set(k, v);
      }
    }
    return map;
  }

  /**
   * Indicates if the rule is case-sensitive. Default value is <code>true</code>.
   * 
   * @return true if the rule is case-sensitive, false otherwise.
   */
  isCaseSensitive(): boolean {
    return true;
  }

  /**
   * @return the locale used for case conversion when {@link #isCaseSensitive()}
   *         is set to <code>false</code>.
   */
  getLocale(): Locale {
    return Locale.getDefault();
  }

  /**
   * Skip words that are known in the POS tagging dictionary, assuming they
   * cannot be incorrect.
   * @since 2.3
   */
  setIgnoreTaggedWords(): void {
    this.ignoreTaggedWords = true;
  }

  constructor(messages: ResourceBundle, language: Language) {
    super(messages);
    this.language = language;
    super.setCategory(Categories.MISC.getCategory(messages));
  }

  override getId(): string {
    return 'SIMPLE_REPLACE';
  }

  override getDescription(): string {
    return 'Checks for wrong words/phrases';
  }

  getMessage(tokenStr: string, replacements: readonly string[]): string {
    return tokenStr + ' is not valid. Use: '
        + replacements.join(', ') + '.';
  }

  getShort(): string {
    return 'Wrong word';
  }

  private cleanup(word: string): string {
    return this.isCaseSensitive() ? word : word.toLowerCase();
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    for (const tokenReadings of tokens) {
      // short for SENT_START
      if (JLanguageTool.SENTENCE_START_TAGNAME === tokenReadings.getAnalyzedToken(0).getPOSTag() ||
          tokenReadings.isImmunized() ||        //this rule is used mostly for spelling, so ignore both immunized
          tokenReadings.isIgnoredBySpeller() || //and speller-ignorable rules
          this.isTokenException(tokenReadings) ||
          (this.ignoreTaggedWords && this.isTagged(tokenReadings))
      ) {
        continue;
      }
      const matchesForToken = this.findMatches(tokenReadings, sentence);
      ruleMatches.push(...matchesForToken);
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  protected findMatches(tokenReadings: AnalyzedTokenReadings, sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];

    const originalTokenStr = tokenReadings.getToken();
    const tokenString = this.cleanup(originalTokenStr);
    const isAllUppercase = StringTools.isAllUppercase(originalTokenStr);

    // try first with the original word, then with the all lower-case version
    let possibleReplacements: readonly string[] | null = this.getWrongWords().get(originalTokenStr) ?? null;
    if (possibleReplacements == null) {
      possibleReplacements = this.getWrongWords().get(tokenString) ?? null;
    }

    if (possibleReplacements == null && this.checkLemmas) {
      const collected: string[] = [];

      const lemmas: string[] = [];
      for (const analyzedToken of tokenReadings.getReadings()) {
        const lemma = analyzedToken.getLemma();
        if (lemma != null && this.getWrongWords().has(lemma) && !lemmas.includes(lemma)) {
          lemmas.push(this.cleanup(lemma));
        }
      }

      for (const lemma of lemmas) {
        const replacements = this.getWrongWords().get(lemma);
        if (replacements != null) {
          const synth = this.getSynthesizer();
          if (synth != null) {
            for (const replacementLemma of replacements) {
              for (const at of tokenReadings.getReadings()) {
                const newAt = new AnalyzedToken(at.getLemma()!, at.getPOSTag(), replacementLemma);
                const s = synth.synthesize(newAt, at.getPOSTag()!);
                collected.push(...s);
              }
            }
          } else {
            collected.push(...replacements);
          }
        }
      }
      possibleReplacements = [...new Set(collected)];
    }

    if (possibleReplacements != null && possibleReplacements.length > 0) {
      let replacements: string[] = [];
      if (isAllUppercase) {
        for (const s of possibleReplacements) {
          replacements.push(s.toUpperCase());
        }
      } else {
        replacements = [...possibleReplacements];
      }
      const idx = replacements.indexOf(originalTokenStr);
      if (idx >= 0) {
        replacements.splice(idx, 1);
      }
      if (replacements.length > 0) {
        const potentialRuleMatch = this.createRuleMatch(tokenReadings, replacements, sentence, originalTokenStr);
        ruleMatches.push(potentialRuleMatch);
      }
    }

    return ruleMatches;
  }

  /**
   * This method allows to override which tags will mark token as tagged
   * @return returns true if token has valid tag
   */
  protected isTagged(tokenReadings: AnalyzedTokenReadings): boolean {
    return tokenReadings.isTagged();
  }

  protected createRuleMatch(tokenReadings: AnalyzedTokenReadings,
                            replacements: string[], sentence: AnalyzedSentence, originalTokenStr: string): RuleMatch {
    const tokenString = tokenReadings.getToken();
    const pos = tokenReadings.getStartPos();

    let potentialRuleMatch: RuleMatch;

    if (this.subRuleSpecificIds) {
      const id = StringTools.toId(this.getId() + '_' + originalTokenStr, this.language);
      const desc = this.getDescription().replaceAll('$match', originalTokenStr);
      const specificIdRule = new SpecificIdRule(id, desc, this.isPremium(), this.getCategory(), this.getLocQualityIssueType(), this.getTags());
      potentialRuleMatch = new RuleMatch(specificIdRule, sentence, pos, pos
        + tokenString.length, this.getMessage(tokenString, replacements), this.getShort());
    } else {
      potentialRuleMatch = new RuleMatch(this, sentence, pos, pos
        + tokenString.length, this.getMessage(tokenString, replacements), this.getShort());
    }
    if (!this.isCaseSensitive() && StringTools.startsWithUppercase(tokenString)) {
      for (let i = 0; i < replacements.length; i++) {
        replacements[i] = StringTools.uppercaseFirstChar(replacements[i]!)!;
      }
    }

    potentialRuleMatch.setSuggestedReplacements(replacements);

    return potentialRuleMatch;
  }

  /**
   * @since 2.5
   */
  isCheckLemmas(): boolean {
    return this.checkLemmas;
  }

  /**
   * Used to disable matching lemmas.
   * @since 2.5
   */
  setCheckLemmas(checkLemmas: boolean): void {
    this.checkLemmas = checkLemmas;
  }

  /**
   * Synthesizer to generate inflected suggestions
   * @since 5.1
   */
  getSynthesizer(): Synthesizer | null {
    return null;
  }

  /*
   * @since 5.2
   */
  protected isTokenException(_atr: AnalyzedTokenReadings): boolean {
    return false;
  }

  /**
   * If this is set, each replacement pair will have its own rule ID, making rule deactivations more specific.
   * @since 5.5
   */
  useSubRuleSpecificIds(): void {
    this.subRuleSpecificIds = true;
  }

  getLanguage(): Language {
    return this.language;
  }

}
