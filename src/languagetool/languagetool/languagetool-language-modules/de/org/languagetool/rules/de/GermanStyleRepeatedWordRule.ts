// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanStyleRepeatedWordRule.java faithful
// java.net.URL is a string. Strings.CS.equalsAny is an array lookup.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStyleRepeatedWordRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStyleRepeatedWordRule.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleOption } from '../../../../../../languagetool-core/org/languagetool/rules/RuleOption.ts';
import { MorfologikSpeller } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/morfologik/MorfologikSpeller.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Speller } from '../../../../../../../morfologik-stemming/morfologik-speller/morfologik/speller/Speller.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const SYNONYMS_URL = 'https://www.openthesaurus.de/synonyme/';
const LETTERS = Pattern.compile('^[A-Za-zÄÖÜäöüß]+$');
const MAX_DISTANCE_OF_SENTENCES = 1;
const EXCLUDE_DIRECT_SPEECH = true;
const TEST_COMPOUND_WORDS = false;

/**
 * A rule checks the appearance of same words in a sentence or in two consecutive sentences.
 * Only substantive, verbs and adjectives are checked.
 * This rule detects no grammar error but a stylistic problem (default off)
 * @author Fred Kruse
 */
export class GermanStyleRepeatedWordRule extends AbstractStyleRepeatedWordRule {

  private speller: Speller | null = null;
  private testCompoundWords = TEST_COMPOUND_WORDS;

  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null) {
    super(messages, lang, userConfig);
    super.setCategory(Categories.STYLE.getCategory(messages));
    this.addExamplePair(Example.wrong('Ich gehe zum Supermarkt, danach <marker>gehe</marker> ich nach Hause.'),
                   Example.fixed('Ich gehe zum Supermarkt, danach nach Hause.'));
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null && cf.length > 2) {
        this.testCompoundWords = cf[2] as boolean;
      }
    }
  }

  override getId(): string {
    return 'STYLE_REPEATED_WORD_RULE_DE';
  }

  override getDescription(): string {
    return 'Wiederholte Worte in aufeinanderfolgenden Sätzen';
  }

  protected override messageSameSentence(): string {
    return 'Mögliches Stilproblem: Das Wort wird noch einmal im selben Satz verwendet.';
  }

  protected override messageSentenceBefore(): string {
    return 'Mögliches Stilproblem: Das Wort wird bereits in einem vorhergehenden Satz verwendet.';
  }

  protected override messageSentenceAfter(): string {
    return 'Mögliches Stilproblem: Das Wort wird auch in einem nachfolgenden Satz verwendet.';
  }

  /**
   *  give the user the possibility to configure the function
   */
  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [
        new RuleOption(MAX_DISTANCE_OF_SENTENCES, this.messages!.getString('guiStyleRepeatedWordText'), 0, 5),
        new RuleOption(EXCLUDE_DIRECT_SPEECH, 'Direkte Rede und Zitate ausschließen'),
        new RuleOption(TEST_COMPOUND_WORDS, 'Auch zusammengesetzte Wörter prüfen')
    ];
    return ruleOptions;
  }

  /**
   * is a correct spelled word
   */
  private isCorrectSpell(word: string): boolean {
    word = StringTools.uppercaseFirstChar(word)!;
    if (this.speller == null) {
      // speller can not initialized by constructor because of temporary initialization of LanguageTool in other rules,
      // which leads to problems in LO/OO extension
      this.speller = new Speller(MorfologikSpeller.getDictionaryWithCaching('/de/hunspell/de_DE.dict'));
    }
    if (this.speller != null) {
      return !this.speller.isMisspelled(word);
    } else if (this.linguServices != null) {
      return this.linguServices.isCorrectSpell(word, this.lang);
    }
    throw new Error('IllegalStateException: LinguServices or Speller must be not null to check spelling in CompoundInfinitivRule');
  }

  /**
   * Is a unknown word (has only letters and no PosTag) 
   */
  private static isUnknownWord(token: AnalyzedTokenReadings): boolean {
    return token.isPosTagUnknown() && token.getToken().length > 2 && LETTERS.matcher(token.getToken()).matches();
  }

  /**
   * Only substantive, names, verbs and adjectives are checked
   */
  protected override isTokenToCheck(tokens: AnalyzedTokenReadings[], n: number): boolean {
    if (n > 0 && n < tokens.length - 1 &&
        (tokens[n + 1]!.hasPosTagStartingWith('EIG') || GermanStyleRepeatedWordRule.isUnknownWord(tokens[n + 1]!))
        && (tokens[n]!.getToken() === 'Frau' || tokens[n]!.getToken() === 'Fräulein' || tokens[n]!.getToken() === 'Herr' ||
            tokens[n]!.getToken() === 'Herrn' || tokens[n]!.getToken() === 'Lady' || tokens[n]!.getToken() === 'Mister')
       ) {
      return false;
    }
    const token = tokens[n]!;
    return ((token.matchesPosTagRegex('(SUB|EIG|VER|ADJ):.*')
        && !token.matchesPosTagRegex('(PRO|A(RT|DV)|VER:(AUX|MOD)):.*')
        || GermanStyleRepeatedWordRule.isUnknownWord(token))
        && !['sicher', 'weit', 'Sie', 'Ich', 'Euch', 'Eure', 'Der', 'all'].includes(token.getToken()));
  }

  /**
   * Pairs of substantive are excluded like "Arm in Arm", "Seite an Seite", etc.
   */
  protected override isTokenPair(tokens: AnalyzedTokenReadings[], n: number, before: boolean): boolean {
    if (before) {
      if (n > 2 && n < tokens.length &&
          (tokens[n - 2]!.hasPosTagStartingWith('SUB') && tokens[n - 1]!.hasPosTagStartingWith('PRP')
              && tokens[n]!.hasPosTagStartingWith('SUB'))
          || (tokens[n - 2]!.getToken() === 'hart' && tokens[n - 1]!.getToken() === 'auf' && tokens[n]!.getToken() === 'hart')
          || (tokens[n - 2]!.getToken() === 'dicht' && tokens[n - 1]!.getToken() === 'an' && tokens[n]!.getToken() === 'dicht')
          || (tokens[n - 2]!.getToken() === 'fressen' && tokens[n - 1]!.getToken() === 'und' && tokens[n]!.getToken() === 'gefressen')
         ) {
        return true;
      }
    } else {
      if (n > 0 && n < tokens.length - 2 &&
          (tokens[n]!.hasPosTagStartingWith('SUB') && tokens[n + 1]!.hasPosTagStartingWith('PRP')
              && tokens[n + 2]!.hasPosTagStartingWith('SUB'))
          || (tokens[n]!.getToken() === 'hart' && tokens[n + 1]!.getToken() === 'auf' && tokens[n + 2]!.getToken() === 'hart')
          || (tokens[n]!.getToken() === 'dicht' && tokens[n + 1]!.getToken() === 'an' && tokens[n + 2]!.getToken() === 'dicht')
          || (tokens[n]!.getToken() === 'fressen' && tokens[n + 1]!.getToken() === 'und' && tokens[n + 2]!.getToken() === 'gefressen')
         ) {
        return true;
      }
    }
    return false;
  }

  private isSecondPartofWord(testTokenText: string, tokenText: string): boolean {
    if (testTokenText.length - tokenText.length < 3) {
      return false;
    }
    const lowerTokenText = StringTools.lowercaseFirstChar(tokenText);
    if (lowerTokenText === 'frei'
        || (lowerTokenText === 'alten' && testTokenText.endsWith('halten'))
        ) {
      return false;
    }
    if (StringTools.lowercaseFirstChar(testTokenText).startsWith(lowerTokenText)) {
      let word = testTokenText.substring(tokenText.length);
      if (this.isCorrectSpell(word)) {
        return true;
      } else if (word.startsWith('s')) {
        word = word.substring(1);
        if (this.isCorrectSpell(word)) {
          return true;
        }
      }
      return false;
    } else if (testTokenText.endsWith(lowerTokenText)) {
      let word = testTokenText.substring(0, testTokenText.length - tokenText.length);
      if (this.isCorrectSpell(word)) {
        return true;
      } else if (word.endsWith('s')) {
        word = word.substring(word.length - 1);
        if (this.isCorrectSpell(word)) {
          return true;
        }
      }
      return false;
    }
    return false;
  }

  protected override isPartOfWord(testTokenText: string, tokenText: string): boolean {
    if (!this.testCompoundWords || testTokenText.length < 3 || tokenText.length < 3) {
      return false;
    }
    if (testTokenText.length > tokenText.length) {
      return this.isSecondPartofWord(testTokenText, tokenText);
    } else {
      return this.isSecondPartofWord(tokenText, testTokenText);
    }
  }

  /* 
   *  true if is an exception of token pair
   *  note: method is called after two tokens are tested to share the same lemma
   */
  protected override isExceptionPair(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings): boolean {
    if ((token1.hasLemma('nah') && token1.hasLemma('nächst') && !token2.hasLemma('nächst')) ||
        (token2.hasLemma('nah') && token2.hasLemma('nächst') && !token1.hasLemma('nächst'))) {
      return true;
    } else {
      if (token1.hasLemma('gut') &&
          ((token1.getToken().startsWith('gut') && !token2.getToken().startsWith('gut')) ||
           (token2.getToken().startsWith('gut') && !token1.getToken().startsWith('gut')))) {
        return true;
      }
    }
    return false;
  }

  /* 
   *  set an URL to the German openThesaurus
   */
  protected override setURL(token: AnalyzedTokenReadings | null): string | null {
    if (token != null) {
      const readings = token.getReadings();
      const lemmas: string[] = [];
      for (const reading of readings) {
        const lemma = reading.getLemma();
        if (lemma != null) {
          lemmas.push(lemma);
        }
      }
      if (lemmas.length === 1) {
        return SYNONYMS_URL + lemmas[0];
      }
      return SYNONYMS_URL + token.getToken();
    }
    return null;
  }

}
