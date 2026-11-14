// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/ConjunctionAtBeginOfSentenceRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStatisticSentenceStyleRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStatisticSentenceStyleRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PERCENT = 10;
/*
  private static final Set<String> fillerWords = new HashSet<>(Arrays.asList("aber", "als", "also", "andererseits", "anschließend", "anschliessend", "anstatt", 
      "außer", "ausserdem", "bevor", "beziehungsweise", "bis", "da", "dadurch", "dafür", "dagegen", "damit", "danach", "dann", "darauf", "darum", "dass", 
      "davor", "dazu", "denn", "deshalb", "dessen", "desto", "desungeachtet", "deswegen", "doch", "ehe", "eh", "entweder", "falls", "ferner", "folglich", 
      "genauso", "geschweige", "immerhin", "indem", "indes", "indessen", "insofern", "insoweit", "inzwischen", "je", "jedoch", "nachdem", "ob", 
      "obgleich", "obschon", "obwohl", "obzwar", "oder", "respektive", "seit", "seitdem", "so", "sodass", "sofern", "solang", "solange", "sondern", "sooft", 
      "soviel", "soweit", "sowie", "sowohl", "später", "statt", "trotzdem", "um", "umso", "und", "ungeachtet", "vorher", "während", "währenddem", 
      "währenddessen", "weder", "weil", "wenn", "wenngleich", "wennschon", "wie", "wiewohl", "wobei", "wohingegen", "zumal", "zuvor", "zwar")); 
*/

/**
 * A rule that gives Hints about the use of German filler words.
 * The Hints are only given when the percentage of filler words per chapter/text exceeds the given limit.
 * A limit of 0 shows all used filler words. Direct speech or citation is excluded otherwise. 
 * This rule detects no grammar error but gives stylistic hints (default off).
 * @author Fred Kruse
 * @since 4.2
 */
export class ConjunctionAtBeginOfSentenceRule extends AbstractStatisticSentenceStyleRule {

  sentenceMessage: string | null = null;

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PERCENT);
  }

  /**
   * Word is a Conjunction
   */
  private static isConjunction(token: AnalyzedTokenReadings): boolean {
    return (token.hasPosTagStartingWith('KON'));
  }

  /**
   * Token is comma
   */
  private static isComma(token: AnalyzedTokenReadings): boolean {
    return (',' === token.getToken());
  }

  /**
   * Is sentence with modal verb
   */
  protected override conditionFulfilled(sentence: AnalyzedTokenReadings[]): AnalyzedTokenReadings | null {
    if (sentence.length < 3) {
      return null;
    }
    let token: AnalyzedTokenReadings | null = null;
    let num = 0;
    if (this.isOpeningQuote(sentence[0]!)) {
      num++;
    }
    if (ConjunctionAtBeginOfSentenceRule.isConjunction(sentence[num]!)) {
      token = sentence[num]!;
    }
    if (token == null || token.getToken() === 'Wie' || token.getToken() === 'Seit' || token.getToken() === 'Allerdings'
        || (token.getToken() === 'Aber' && sentence[num + 1]!.getToken() === 'auch')) {
      return null;
    }
    if (token.getToken() === 'Um') {
      for (let i = 1; i < sentence.length; i++) {
        if (ConjunctionAtBeginOfSentenceRule.isComma(sentence[i]!) || sentence[i]!.getToken() === 'herum') {
          return null;
        }
      }
      return token;
    }
    if (!token.hasPosTagStartingWith('KON:UNT') || token.getToken() === 'Sondern'
        || (token.getToken() === 'Auch' && sentence[num + 1]!.getToken() === 'wenn')) {
      if (token.getToken() === 'Entweder') {
        for (let i = 1; i < sentence.length; i++) {
          if (sentence[i]!.getToken() === 'oder') {
            return null;
          }
        }
      } else if (token.getToken() === 'Sowohl') {
        for (let i = 1; i < sentence.length - 1; i++) {
          if (sentence[i]!.getToken() === 'als' && sentence[i + 1]!.getToken() === 'auch') {
            return null;
          }
        }
      } else if (token.getToken() === 'Weder') {
        for (let i = 1; i < sentence.length; i++) {
          if (sentence[i]!.getToken() === 'noch') {
            return null;
          }
        }
      } else {
        if (sentence[sentence.length - 1]!.getToken() === '?') {
          return null;
        }
        return token;
      }
    }
    for (let i = 2; i < sentence.length; i++) {
      if (ConjunctionAtBeginOfSentenceRule.isComma(sentence[i]!)) {
        return null;
      }
    }
    return token;
  }

  protected override excludeDirectSpeech(): boolean {
    return true;
  }

  protected override getLimitMessage(limit: number, percent: number): string {
    if (limit === 0) {
      return 'Eine Konjunktion sollte nur in Ausnahmefällen am Satzanfang verwendet werden. Formulieren Sie den Satz um, falls möglich.';
    }
    return 'Mehr als ' + limit + '% Sätze beginnen mit einer Konjunktion {' + Math.trunc(percent + 0.5) + '%} gefunden. Formulieren Sie den Satz um, falls möglich.';
  }

  override getId(): string {
    return 'SENTENCE_BEGINNING_WITH_CONJUNCTION_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Sätze beginnend mit Konjunktion';
  }

  override getConfigureText(): string {
    return 'Anzeigen wenn mehr als ...% Sätze eines Kapitels mit einer Konjunktion beginnen:';
  }

}
