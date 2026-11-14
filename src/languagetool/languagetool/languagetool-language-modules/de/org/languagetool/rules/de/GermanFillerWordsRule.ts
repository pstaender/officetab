// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanFillerWordsRule.java faithful
// LinguServices (the office extension's services) is not ported: UserConfig gives it untyped.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStatisticStyleRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStatisticStyleRule.ts';
import type { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleOption } from '../../../../../../languagetool-core/org/languagetool/rules/RuleOption.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PERCENT = 8;
const DEFAULT_TWO_FOLLOWING = false;
const DEFAULT_MANY_IN_SENTENCE = false;

const DEFAULT_SENTENCE_MSG1 = 'Zwei potentielle Füllwörter hintereinander. Mindestens eins sollte gelöscht werden.';
const DEFAULT_SENTENCE_MSG2 = 'Mehr als zwei potentielle Füllwörter in einem Satz. Mindestens eins sollte gelöscht werden.';

const fillerWords = new Set<string>([ "aber","abermals","allein","allemal","allenfalls","allenthalben","allerdings","allesamt","allzu","also",
      "alt","andauernd","andererseits","andernfalls","anscheinend","auch","auffallend","augenscheinlich","ausdrücklich","ausgerechnet","ausnahmslos",
      "außerdem","äußerst","beinahe","bekanntlich","bereits","besonders","bestenfalls","bestimmt","bloß","dabei","dadurch","dafür","dagegen","daher","damals",
      "danach","demgegenüber","demgemäß","demnach","denkbar","denn","dennoch","deshalb","deswegen","doch","durchaus","durchweg","eben","eigentlich",
      "einerseits","einfach","einige","einigermaßen","einmal","ergo","erheblich","etliche","etwa","etwas","fast","folgendermaßen","folglich","förmlich",
      "fortwährend","fraglos","freilich","ganz","gänzlich","gar","gelegentlich","gemeinhin","genau","geradezu","gewiss","gewissermaßen","glatt","gleichsam",
      "gleichwohl","glücklicherweise","gottseidank","größtenteils","häufig","hingegen","hinlänglich","höchst","höchstens","immer","immerhin","immerzu",
      "indessen","infolgedessen","insbesondere","inzwischen","irgend","irgendein","irgendjemand","irgendwann","irgendwie","irgendwo","ja","je",
      "jedenfalls","jedoch","jemals","kaum","keinesfalls","keineswegs","längst","lediglich","leider","letztlich","manchmal","mehrfach","meinetwegen",
      "meist","meistens","meistenteils","mindestens","mithin","mitunter","möglicherweise","möglichst","nämlich","naturgemäß","natürlich","neuerdings",
      "neuerlich","neulich","nichtsdestoweniger","nie","niemals","nun","nur","offenbar","offenkundig","offensichtlich","oft","ohnedies","partout",
      "plötzlich","praktisch","quasi","recht","reichlich","reiflich","relativ","restlos","richtiggehend","rundheraus","rundum","sattsam","schlicht",
      "schlichtweg","schließlich","schlussendlich","schon","sehr","selbst","selbstredend","selbstverständlich","selten","seltsamerweise","sicher",
      "sicherlich","so","sogar","sonst","sowieso","sozusagen","stellenweise","stets","trotzdem","überaus","überdies","überhaupt","übrigens",
      "umständehalber","unbedingt","unerhört","ungefähr","ungemein","ungewöhnlich","ungleich","unglücklicherweise","unlängst","unmaßgeblich",
      "unsagbar","unsäglich","unstreitig","unzweifelhaft","vergleichsweise","vermutlich","vielfach","vielleicht","voll","vollends","völlig",
      "vollkommen","vollständig","wahrscheinlich","weidlich","weitgehend","wenigstens","wieder","wiederum","wirklich","wohl","wohlgemerkt",
      "womöglich","ziemlich","zudem","zugegeben","zumeist","zusehends","zuweilen","zweifellos","zweifelsfrei","zweifelsohne"
]);

/**
 * A rule that gives Hints about the use of German filler words.
 * The Hints are only given when the percentage of filler words per chapter/text exceeds the given limit.
 * A limit of 0 shows all used filler words. Direct speech or citation is excluded otherwise. 
 * This rule detects no grammar error but gives stylistic hints (default off).
 * @author Fred Kruse
 * @since 4.2
 */
export class GermanFillerWordsRule extends AbstractStatisticStyleRule {

  private readonly testTwoFollowing: boolean;
  private readonly TestManyInSentence: boolean;

  sentenceMessage: string | null = null;

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PERCENT);
    if (userConfig != null) {
      const linguServices = userConfig.getLinguServices() as { setThesaurusRelevantRule(rule: Rule): void } | null;
      if (linguServices != null) {
        linguServices.setThesaurusRelevantRule(this);
      }
    }
    this.testTwoFollowing = this.getTwoFollowing(userConfig);
    this.TestManyInSentence = this.getManyInSentence(userConfig);
  }

  private getTwoFollowing(userConfig: UserConfig | null): boolean {
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null && cf.length > 2 && cf[2] != null && typeof cf[2] === 'boolean') {
        return cf[2];
      }
    }
    return DEFAULT_TWO_FOLLOWING;
  }

  private getManyInSentence(userConfig: UserConfig | null): boolean {
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null && cf.length > 2 && cf[2] != null && typeof cf[2] === 'boolean') {
        return cf[2];
      }
    }
    return DEFAULT_MANY_IN_SENTENCE;
  }

  private static isException(tokens: AnalyzedTokenReadings[], num: number): boolean {
    if (num === 1 || ',' === tokens[num - 1]!.getToken()) {
      return true;
    }
    if ('allein' === tokens[num]!.getToken()) {
      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i]!.hasLemma('sein')) {
          return true;
        }
      }
      return false;
    }
    if ('recht' === tokens[num]!.getToken()) {
      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i]!.hasAnyLemma('haben', 'geben')) {
          return true;
        }
      }
    }
    if (num < tokens.length - 1 && ('so' === tokens[num]!.getToken() || 'besonders' === tokens[num]!.getToken())
        && tokens[num + 1]!.hasPosTagStartingWith('ADJ')) {
      return true;
    }
    if (tokens[num]!.hasPosTagStartingWith('ADJ') && 'so' === tokens[num - 1]!.getToken()) {
      return true;
    }
    if ('nur' === tokens[num]!.getToken() && 'nicht' === tokens[num - 1]!.getToken()) {
      for (let i = num + 1; i < tokens.length - 2; i++) {
        if (',' === tokens[i]!.getToken() && ('auch' === tokens[i + 1]!.getToken()
            || ('sondern' === tokens[i + 1]!.getToken() && 'auch' === tokens[i + 2]!.getToken()))) {
          return true;
        }
      }
    }
    if (num > 2 && 'auch' === tokens[num]!.getToken() && 'sondern' === tokens[num - 1]!.getToken() && ',' === tokens[num - 2]!.getToken()) {
      for (let i = 1; i < num - 2; i++) {
        if ('nicht' === tokens[i]!.getToken() && 'nur' === tokens[i + 1]!.getToken()) {
          return true;
        }
      }
    }
    return false;
  }

  protected override conditionFulfilled(tokens: AnalyzedTokenReadings[], nToken: number): number {
    if (fillerWords.has(tokens[nToken]!.getToken()) && !GermanFillerWordsRule.isException(tokens, nToken)
         && (nToken < 2 || !GermanFillerWordsRule.isTwoWordException(tokens[nToken - 1]!.getToken(), tokens[nToken]!.getToken()))
         && (nToken > tokens.length - 2 || !GermanFillerWordsRule.isTwoWordException(tokens[nToken]!.getToken(), tokens[nToken + 1]!.getToken()))
         ) {
      return nToken;
    }
    return -1;
  }

  private static isTwoWordException(first: string, second: string): boolean {
    return (('aber' === first && ('nur' === second || 'auch' === second))
        || ('auch' === first && 'nur' === second)
        || ('immer' === first && 'wieder' === second)
        || ('genau' === first && 'so' === second)
        || ('so' === first && ('etwas' === second || 'viel' === second || 'oft' === second))
        || ('schon' === first && 'fast' === second)
        );
  }

  protected override sentenceConditionFulfilled(tokens: AnalyzedTokenReadings[], nToken: number): boolean {
    if (this.testTwoFollowing) {
      if ((nToken > 1 && fillerWords.has(tokens[nToken - 1]!.getToken()) && !GermanFillerWordsRule.isException(tokens, nToken - 1)) ||
          (nToken < tokens.length - 1 && fillerWords.has(tokens[nToken + 1]!.getToken()) && !GermanFillerWordsRule.isException(tokens, nToken + 1))) {
        this.sentenceMessage = DEFAULT_SENTENCE_MSG1;
        return true;
      }
    }
    if (this.TestManyInSentence) {
      let n = 0;
      for (let i = nToken - 2; i > 0; i--) {
        if (this.conditionFulfilled(tokens, i) === i) {
          n++;
          if (n > 1) {
            this.sentenceMessage = DEFAULT_SENTENCE_MSG2;
            return true;
          }
        }
      }
      for (let i = nToken + 2; i < tokens.length; i++) {
        if (this.conditionFulfilled(tokens, i) === i) {
          n++;
          if (n > 1) {
            this.sentenceMessage = DEFAULT_SENTENCE_MSG2;
            return true;
          }
        }
      }
    }
    return false;
  }

  protected override excludeDirectSpeech(): boolean {
    return true;
  }

  protected override getLimitMessage(limit: number, percent: number): string {
    if (limit === 0) {
      return 'Dieses Wort könnte ein Füllwort sein. Möglicherweise ist es besser es zu löschen.';
    }
    return 'Mehr als ' + limit + '% Füllwörter {' + Math.trunc(percent + 0.5) + '%} gefunden. Möglicherweise ist es besser dieses potentielle Füllwort zu löschen.';
  }

  protected override getSentenceMessage(): string | null {
    return this.sentenceMessage;
  }

  override getId(): string {
    return 'FILLER_WORDS_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Füllwörter';
  }

  override getConfigurePercentText(): string {
    return 'Anzeigen wenn mehr als ...% eines Kapitels Füllwörter sind:';
  }

  override getConfigureWithoutDirectSpeachText(): string {
    return 'Keine wörtliche Rede und Zitate berücksichtigen';
  }

  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [
        new RuleOption(DEFAULT_MIN_PERCENT, this.getConfigurePercentText(), 0, 100),
        new RuleOption(this.excludeDirectSpeech(), this.getConfigureWithoutDirectSpeachText()),
        new RuleOption(DEFAULT_TWO_FOLLOWING, 'Zeige zwei aufeinander folgende Füllwörter'),
        new RuleOption(DEFAULT_MANY_IN_SENTENCE, 'Zeige mehr als zwei Füllwörter in einem Satz')
        ];
    return ruleOptions;
  }

}
