// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/hunspell/HunspellRule.java reduced
// Left out:
// - the ForeignLanguageChecker (only used with two or more preferred languages in the user config,
//   which a server sets; it reports other languages detected in a sentence);
// - enSpellRules / getEnglishSpellingRules / isEnglish: isEnglish is never called, and building
//   the English rules would need English's data loaded for every Hunspell language;
// - Tools.isExternSpeller() (the 32-bit OpenOffice extension's external speller; always false);
// - dictionaries outside the class path ("dynamic languages": new File(shortDicPath + ".dic")) and
//   nonWordPatternFromPath; getDictionaryPath / fileCopy (private, unused: temporary files);
// - monitorRules / activeChecks (the system property is never set here).
// The constructors are one (altLanguages and languageModel optional). The ignore file is read
// by its resource path instead of its URL; the private addIgnoreWords() is addIgnoreWordsFromIgnoreFile()
// (an overload of SpellingCheckRule.addIgnoreWords(String) cannot be private).
// `volatile`/`synchronized` are dropped (one thread).
import type { AnalyzedSentence } from '../../../AnalyzedSentence.ts';
import { JLanguageTool } from '../../../JLanguageTool.ts';
import type { Language } from '../../../Language.ts';
import type { UserConfig } from '../../../UserConfig.ts';
import type { LanguageModel } from '../../../languagemodel/LanguageModel.ts';
import { Categories } from '../../Categories.ts';
import { RuleMatch, Type as RuleMatch_Type } from '../../RuleMatch.ts';
import { SuggestedReplacement } from '../../SuggestedReplacement.ts';
import { SpellingCheckRule } from '../SpellingCheckRule.ts';
import { StringTools } from '../../../tools/StringTools.ts';
import { Hunspell } from './Hunspell.ts';
import type { HunspellDictionary } from './HunspellDictionary.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

export const RULE_ID = 'HUNSPELL_RULE';

const NON_ALPHABETIC = '[^\\p{L}]';
let patterns: { NON_ALPHABETIC_PATTERN: Pattern; STARTS_WITH_TWO_UPPERCASE_CHARS: Pattern } | null = null;
const P = () => (patterns ??= {
  NON_ALPHABETIC_PATTERN: Pattern.compile(NON_ALPHABETIC),
  STARTS_WITH_TWO_UPPERCASE_CHARS: Pattern.compile('[A-Z][A-Z]\\p{javaLowerCase}+'),
});

//300 most common Portuguese words. They are used to avoid wrong split suggestions
const commonPortugueseWords: readonly string[] = ['eu', 'ja', 'so', 'de', 'e', 'a', 'o', 'da', 'do', 'em', 'que', 'uma', 'um', 'com', 'no', 'se', 'na', 'para', 'por', 'os', 'foi', 'como', 'dos', 'as', 'ao', 'mais', 'sua', 'das', 'não', 'ou', 'km', 'seu', 'pela', 'ser', 'pelo', 'são', 'também', 'anos', 'cidade', 'entre', 'era', 'tem', 'mas', 'habitantes', 'nos', 'seus', 'área', 'até', 'ele', 'onde', 'foram', 'população', 'região', 'sobre', 'nas', 'nome', 'parte', 'quando', 'ano', 'aos', 'grande', 'mesmo', 'pode', 'primeiro', 'segundo', 'sendo', 'suas', 'ainda', 'dois', 'estado', 'está', 'família', 'já', 'muito', 'outros', 'americano', 'depois', 'durante', 'maior', 'primeira', 'forma', 'apenas', 'banda', 'densidade', 'dia', 'então', 'município', 'norte', 'tempo', 'após', 'duas', 'num', 'pelos', 'qual', 'século', 'ter', 'todos', 'três', 'vez', 'água', 'acordo', 'cobertos', 'comuna', 'contra', 'ela', 'grupo', 'principal', 'quais', 'sem', 'tendo', 'às', 'álbum', 'alguns', 'assim', 'asteróide', 'bem', 'brasileiro', 'cerca', 'desde', 'este', 'localizada', 'mundo', 'outras', 'período', 'seguinte', 'sido', 'vida', 'através', 'cada', 'conhecido', 'final', 'história', 'partir', 'país', 'pessoas', 'sistema', 'terra', 'teve', 'tinha', 'época', 'administrativa', 'censo', 'departamento', 'dias', 'esta', 'filme', 'francesa', 'música', 'província', 'série', 'vezes', 'além', 'antes', 'eles', 'eram', 'espécie', 'governo', 'podem', 'vários', 'censos', 'distrito', 'estão', 'exemplo', 'hoje', 'início', 'jogo', 'lhe', 'lugar', 'muitos', 'média', 'novo', 'numa', 'número', 'pois', 'possui', 'sob', 'só', 'todo', 'tornou', 'trabalho', 'algumas', 'devido', 'estava', 'fez', 'filho', 'fim', 'grandes', 'há', 'isso', 'lado', 'local', 'morte', 'orbital', 'outro', 'passou', 'países', 'quatro', 'representa', 'seja', 'sempre', 'sul', 'várias', 'capital', 'chamado', 'começou', ' enquanto', 'fazer', 'lançado', 'meio', 'nova', 'nível', 'pelas', 'poder', 'presidente', 'redor', 'rio', 'tarde', 'todas', 'carreira', 'casa', 'década', 'estimada', 'guerra', 'havia', 'livro', 'localidades', 'maioria', 'muitas', 'obra', 'origem', 'pai', 'pouco', 'principais', 'produção', 'programa', 'qualquer', 'raio', 'seguintes', 'sucesso', 'título', 'aproximadamente', 'caso', 'centro', 'conhecida', 'construção', 'desta', 'diagrama', 'faz', 'ilha', 'importante', 'mar', 'melhor', 'menos', 'mesma', 'metros', 'mil', 'nacional', 'populacional', 'quase', 'rei', 'sede', 'segunda', 'tipo', 'toda', 'uso', 'velocidade', 'vizinhança', 'volta', 'base', 'brasileira', 'clube', 'desenvolvimento', 'deste', 'diferentes', 'diversos', 'empresa', 'entanto', 'futebol', 'geral', 'junto', 'longo', 'obras', 'outra', 'pertencente', 'política', 'português', 'principalmente', 'processo', 'quem', 'seria', 'têm', 'versão', 'TV', 'acima', 'atual', 'bairro', 'chamada', 'cinco', 'conta', 'corpo', 'dentro', 'deve'];
const commonGermanWords: readonly string[] = ['-', 'das', 'sein', 'mein', 'meine', 'meinen', 'meines', 'meiner', 'haben', 'kein', 'keine', 'keinen', 'keinem', 'keines', 'keiner', 'ein', 'eines', 'eins', 'einen', 'einem', 'eine', 'einer', 'rund', 'sehr', 'mach', 'noch', 'nein', 'ja', 'hallo', 'hi', 'das', 'die', 'der', 'den', 'dem', 'des', 'nacht', 'diesen', 'dieser', 'dies', 'dieses', 'diesem', 'zum', 'zur', 'beim', 'noch', 'nichts', 'aufs', 'aufm', 'aufn', 'ausn', 'ausm', 'aus', 'fürs', 'für', 'osten', 'rein', 'raus', 'namen', 'shippen', 'amt', 'wir'];

const ignoreFileContents = new Map<string, string[]>();
const nonWordPatterns = new Map<string, Pattern>();

const WHITESPACE_ARRAY: string[] = [];
for (let i = 0; i < 20; i++) {
  WHITESPACE_ARRAY[i] = ' '.repeat(i);
}

/** StringUtils.isAllUpperCase */
function isAllUpperCase(cs: string): boolean {
  if (cs.length === 0) return false;
  for (const c of cs) {
    if (!Character.isUpperCase(c)) return false;
  }
  return true;
}

function cutOffDot(s: string): string {
  return s.endsWith('.') ? s.substring(0, s.length - 1) : s;
}

function computeNonWordPattern(stream: Uint8Array): Pattern {
  const text = new TextDecoder('utf-8').decode(stream);
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (line.startsWith('WORDCHARS ')) {
      const wordCharsFromAff = line.substring('WORDCHARS '.length);
      //System.out.println("#" + wordCharsFromAff+ "#");
      return Pattern.compile('(?![' + wordCharsFromAff.replaceAll('-', '\\-') + '])' + NON_ALPHABETIC);
    }
  }
  return P().NON_ALPHABETIC_PATTERN;
}

/**
 * A hunspell-based spellchecking-rule.
 * The default dictionary is set to the first country variant on the list - so the order
 * in the Language class declaration is important!
 *
 * @author Marcin Miłkowski
 */
export class HunspellRule extends SpellingCheckRule {

  static readonly RULE_ID: string = RULE_ID;

  protected static readonly FILE_EXTENSION = '.dic';

  private needsInit = true;
  protected hunspell: HunspellDictionary | null = null;

  private readonly MINUS_PLUS = Pattern.compile('-+');

  protected nonWordPattern: Pattern | null = null;

  private readonly userConfig: UserConfig | null;

  /**
   * @since 4.3 (altLanguages)
   */
  constructor(messages: ResourceBundle, language: Language, userConfig: UserConfig | null, altLanguages: Language[] = [],
              languageModel: LanguageModel | null = null) {
    super(messages, language, userConfig, altLanguages, languageModel);
    super.setCategory(Categories.TYPOS.getCategory(messages));
    this.userConfig = userConfig;
  }

  override getId(): string {
    return RULE_ID;
  }

  override getDescription(): string {
    return this.messages!.getString('desc_spelling');
  }

  /**
   * Is the given token part of a hyphenated compound preceded by a quoted token (e.g., „Spiegel“-Magazin)
   * and should be treated as an ordinary hyphenated compound (e.g., „Spiegel-Magazin“)
   */
  protected isQuotedCompound(_analyzedSentence: AnalyzedSentence, _idx: number, _token: string): boolean {
    return false;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    this.ensureInitialized();
    if (this.hunspell == null) {
      // some languages might not have a dictionary, be silent about it
      return this.toRuleMatchArray(ruleMatches);
    }
    const messages = this.messages!;
    const tokens = this.tokenizeText(this.getSentenceTextWithoutUrlsAndImmunizedTokens(sentence));

    // starting with the first token to skip the zero-length START_SENT
    let len: number;
    if (sentence.getTokens().length > 1) { // if fixes exception in SuggestionsChangesTest
      len = sentence.getTokens()[1]!.getStartPos();
    } else {
      len = sentence.getTokens()[0]!.getStartPos();
    }
    let prevStartPos = -1;
    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i]!;
      let dashCorr = 0;
      if ((this.ignoreWord(tokens, i) || this.ignoreWord(word)) && !this.isProhibited(cutOffDot(word))) {
        prevStartPos = len;
        len += word.length + 1;
        continue;
      }
      if (this.isMisspelled(word)) {
        if (this.ignorePotentiallyMisspelledWord(word)) {
          prevStartPos = len;
          len += word.length + 1;
          continue;
        }
        const cleanWord = word.endsWith('.') ? word.substring(0, word.length - 1) : word;
        if (word.startsWith('-')) {
          if (!this.isMisspelled(cleanWord.substring(1)) || this.MINUS_PLUS.matcher(cleanWord).matches()) {
            len += word.length + 1;
            continue;
          } else {
            dashCorr++;
          }
        }
        if (i > 0 && prevStartPos !== -1) {
          const prevWord = tokens[i - 1]!;
          let ignoreSplitting = false;
          if (this.language.getShortCode() === 'pt' && (commonPortugueseWords.includes(prevWord.toLowerCase())
              || commonPortugueseWords.includes(word.toLowerCase()))) {
            ignoreSplitting = true;
          }
          if (this.language.getShortCode() === 'de' && (commonGermanWords.includes(prevWord.toLowerCase())
              || commonGermanWords.includes(word.toLowerCase()))) {
            ignoreSplitting = true;
          }
          if (!ignoreSplitting && prevWord.length > 0) {
            // "thanky ou" -> "thank you"
            const sugg1a = prevWord.substring(0, prevWord.length - 1);
            const sugg1b = cutOffDot(prevWord.substring(prevWord.length - 1) + word);
            if (!this.isMisspelled(sugg1a) && !this.isMisspelled(sugg1b) && this.acceptSuggestion(sugg1a + ' ' + sugg1b)) {
              const rm = this.createWrongSplitMatch(sentence, ruleMatches, len, cleanWord, sugg1a, sugg1b, prevStartPos);
              if (rm != null) {
                ruleMatches.push(rm);
              }
            }
            // "than kyou" -> "thank you"
            const sugg2a = prevWord + word.charAt(0);
            const sugg2b = cutOffDot(word.substring(1));
            if (!this.isMisspelled(sugg2a) && !this.isMisspelled(sugg2b) && this.acceptSuggestion(sugg2a + ' ' + sugg2b)) {
              const rm = this.createWrongSplitMatch(sentence, ruleMatches, len, cleanWord, sugg2a, sugg2b, prevStartPos);
              if (rm != null) {
                ruleMatches.push(rm);
              }
            }
          }
        }

        const ruleMatch = new RuleMatch(this, sentence,
          len + dashCorr, len + cleanWord.length,
          messages.getString('spelling'),
          messages.getString('desc_spelling_short'));
        ruleMatch.setType(RuleMatch_Type.UnknownWord);
        const cleanWord2 = cleanWord.substring(dashCorr);
        // log non-accepted de-DE words for debugging - only log hour to make aggregation easier:
        //if (language.getShortCodeWithCountryAndVariant().equals("de-DE") && cleanWord2.matches("[A-ZÖÄÜ][a-zöäüß]{6,30}+")) {
        //  SimpleDateFormat sdf = new SimpleDateFormat("HH");
        //  System.out.println(sdf.format(new Date()) + " - speller: " + cleanWord2);
        //}
        if (this.userConfig != null && !this.userConfig.isSuggestionsEnabled()) {
          ruleMatch.setSuggestedReplacements([]);
        } else if (this.userConfig == null || this.userConfig.getMaxSpellingSuggestions() === 0 || ruleMatches.length <= this.userConfig.getMaxSpellingSuggestions()) {
          const sugg = this.calcSuggestions(word, cleanWord2);
          if (this.isFirstItemHighConfidenceSuggestion(word, sugg)) {
            sugg[0]!.setConfidence(SpellingCheckRule.HIGH_CONFIDENCE);
          }
          if (sugg.length > 0) {
            ruleMatch.setMessage(this.getMessage(cleanWord2, sugg[0]!));
          }
          ruleMatch.setSuggestedReplacementObjects(sugg);
        } else {
          // limited to save CPU
          ruleMatch.setSuggestedReplacement(messages.getString('too_many_errors'));
        }
        ruleMatches.push(ruleMatch);
      }
      prevStartPos = len + dashCorr;
      len += word.length + 1;
    }
    /*if (sentence.getErrorLimitReached()) {
      return toRuleMatchArray(Collections.emptyList());
    }*/
    return this.toRuleMatchArray(ruleMatches);
  }

  protected getMessage(_origWord: string, _firstSuggestion: SuggestedReplacement): string {
    return this.messages!.getString('spelling');
  }

  protected getShortMessage(_origWord: string, _firstSuggestion: SuggestedReplacement): string {
    return this.messages!.getString('desc_spelling_short');
  }

  protected acceptSuggestion(_suggestion: string): boolean {
    return true;
  }

  isFirstItemHighConfidenceSuggestion(word: string, sugg: readonly SuggestedReplacement[]): boolean {
    // finds cases like "HAus", where "Haus" is surely the proper suggestion:
    if (sugg.length > 0 &&
        word !== 'IPs' &&
        StringEqualsIgnoreCase(word, sugg[0]!.getReplacement()) &&
      P().STARTS_WITH_TWO_UPPERCASE_CHARS.matcher(word).matches() &&
        this.language.getShortCode() === 'de') {
      //System.out.println("speller high conf case: " + word + "; " + sugg.get(0).getReplacement() + "; " + language.getShortCodeWithCountryAndVariant());
      if (word.endsWith('s') && isAllUpperCase(sugg[0]!.getReplacement())) {
        // e.g. "DMs" could mean plural of "DM"
        return false;
      }
      return true;
    }
    return false;
  }

  private calcSuggestions(word: string, cleanWord: string): SuggestedReplacement[] {
    const onlySuggestions = this.getOnlySuggestions(cleanWord);
    if (onlySuggestions.length !== 0) {
      return onlySuggestions;
    }
    let suggestions = SuggestedReplacement.convert(this.getSuggestions(cleanWord));
    if (word.endsWith('.')) {
      let pos = 1;
      for (const suggestion of this.getSuggestions(word)) {
        if (!suggestions.some((sr) => suggestion === sr.getReplacement())) {
          suggestions.splice(Math.min(pos, suggestions.length), 0, new SuggestedReplacement(suggestion.substring(0, suggestion.length - 1)));
          pos += 2;  // we mix the lists, as we don't know which one is the better one
        }
      }
    }
    let additionalTopSuggestions = this.getAdditionalTopSuggestions(suggestions, cleanWord);
    if (additionalTopSuggestions.length === 0 && word.endsWith('.')) {
      additionalTopSuggestions = this.getAdditionalTopSuggestions(suggestions, word)
        .map((sugg) => {
          if (sugg.getReplacement().endsWith('.')) {
            return sugg;
          } else {
            const newSugg = new SuggestedReplacement(sugg);
            newSugg.setReplacement(sugg.getReplacement() + '.');
            return newSugg;
          }
        });
    }
    additionalTopSuggestions.reverse();
    for (const additionalTopSuggestion of additionalTopSuggestions) {
      if (cleanWord !== additionalTopSuggestion.getReplacement()) {
        suggestions.unshift(additionalTopSuggestion);
      }
    }
    const additionalSuggestions = this.getAdditionalSuggestions(suggestions, cleanWord);
    for (const additionalSuggestion of additionalSuggestions) {
      if (cleanWord !== additionalSuggestion.getReplacement()) {
        suggestions.push(...additionalSuggestions);
      }
    }
    suggestions = suggestions.filter((k) => this.acceptSuggestion(k.getReplacement()));
    suggestions = SpellingCheckRule.filterDupes(this.filterSuggestions(suggestions));
    // Find potentially missing compounds with privacy-friendly logging: we only log a single unknown word with no
    // meta data and only if it's made up of two valid words, similar to the "UNKNOWN" logging in
    // GermanSpellerRule:
    /*if (language.getShortCode().equals("de")) {
      ...
    }*/
    // TODO user suggestions
    return suggestions;
  }

  /**
   * @since public since 4.1
   */
  override isMisspelled(word: string): boolean {
    this.ensureInitialized();
    let isAlphabetic = true;
    if (word.length === 1) { // hunspell dictionaries usually do not contain punctuation
      isAlphabetic = Character.isAlphabetic(word.charAt(0));
    }
    return (
            isAlphabetic && '--' !== word
            && (this.hunspell != null && !this.hunspell.spell(word))
            && !this.ignoreWord(word)
           )
           || this.isProhibited(cutOffDot(word));
  }

  getSuggestions(word: string): string[] {
    this.ensureInitialized();
    return this.hunspell!.suggest(word);
  }

  protected sortSuggestionByQuality(_misspelling: string, suggestions: string[]): string[] {
    return suggestions;
  }

  protected tokenizeText(sentence: string): string[] {
    return this.nonWordPattern!.split(sentence);
  }

  protected getSentenceTextWithoutUrlsAndImmunizedTokens(sentence: AnalyzedSentence): string {
    let sb = '';
    const sentenceTokens = this.getSentenceWithImmunization(sentence).getTokens();
    for (let i = 1; i < sentenceTokens.length; i++) {
      let token = sentenceTokens[i]!.getToken();
      if (sentenceTokens[i]!.isImmunized() || sentenceTokens[i]!.isIgnoredBySpeller() || SpellingCheckRule.isUrl(token) || SpellingCheckRule.isEMail(token)
        || this.isQuotedCompound(sentence, i, token) || sentenceTokens[i]!.hasPosTag('_english_ignore_')) {
        if (this.isQuotedCompound(sentence, i, token)) {
          sb += ' ' + token.substring(1);
        }
        // replace URLs and immunized tokens with whitespace to ignore them for spell checking:
        else if (token.length < 20) {
          sb += WHITESPACE_ARRAY[token.length]!;
        } else {
          for (let j = 0; j < token.length; j++) {
            sb += ' ';
          }
        }
      } else {
        token = StringTools.stringForSpeller(token);
        sb += token;
      }
    }
    return sb;
  }

  protected ensureInitialized(): void {
    if (this.needsInit) {
      try {
        this.init();
      } finally {
        this.needsInit = false;
      }
    }
  }

  protected override init(): void {
    super.init();
    let langCountry = this.language.getShortCode();
    if (this.language.getCountries().length > 0) {
      langCountry += '_' + this.language.getCountries()[0];
    }
    const shortDicPath = this.getDictFilenameInResources(langCountry);
    // set dictionary only if there are dictionary files:
    if (JLanguageTool.getDataBroker().resourceExists(shortDicPath)) {
      const aff = shortDicPath.substring(0, shortDicPath.length - 3) + 'aff';
      this.hunspell = Hunspell.forDictionaryInResources(langCountry, shortDicPath, aff);
      this.addIgnoreWordsFromIgnoreFile();
      const key = 'resource:' + shortDicPath;
      let nonWordPattern = nonWordPatterns.get(key);
      if (nonWordPattern === undefined) {
        nonWordPattern = computeNonWordPattern(JLanguageTool.getDataBroker().getFromResourceDirAsStream(aff));
        nonWordPatterns.set(key, nonWordPattern);
      }
      this.nonWordPattern = nonWordPattern;
    }

    if (this.nonWordPattern == null) {
      this.nonWordPattern = P().NON_ALPHABETIC_PATTERN;
    }
  }

  protected getDictFilenameInResources(langCountry: string): string {
    return '/' + this.language.getShortCode() + '/hunspell/' + langCountry + HunspellRule.FILE_EXTENSION;
  }

  /** Java's private addIgnoreWords() (renamed: it would clash with SpellingCheckRule.addIgnoreWords(String)). */
  private addIgnoreWordsFromIgnoreFile(): void {
    const ignorePath = this.getIgnoreFileName();
    let lines = ignoreFileContents.get(ignorePath);
    if (lines === undefined) {
      lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(ignorePath)
              .filter((line) => !line.startsWith('#'));
      ignoreFileContents.set(ignorePath, lines);
    }
    for (const w of lines) this.wordsToBeIgnored.add(w);
  }

  protected override isInIgnoredSet(word: string): boolean {
    return super.isInIgnoredSet(word) ||
           // We don't add these words to the main set to prevent startsWithIgnoredWord honoring them,
           // and thus to avoid the bogus "LanguageToolaccount" suggestion in AgreementRuleTest.
           // A better way might be nice.
           SpellingCheckRule.LANGUAGETOOL === word || SpellingCheckRule.LANGUAGETOOLER === word;
  }

}
