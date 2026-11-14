// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/NonSignificantVerbsRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStatisticStyleRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStatisticStyleRule.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { StringMatches } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const DEFAULT_MIN_PER_MILL = 8;

const nonSignificant = ['haben', 'sein', 'machen', 'tun'];

/**
 * A rule that gives Hints about the use of non-significant verbs.
 * The Hints are only given when the percentage of non-significant verbs per chapter/text exceeds the given limit.
 * A limit of 0 shows all used filler words. Direct speech or citation is excluded otherwise. 
 * This rule detects no grammar error but gives stylistic hints (default off).
 * @author Fred Kruse
 * @since 5.3
 */
export class NonSignificantVerbsRule extends AbstractStatisticStyleRule {

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PER_MILL);
    this.addExamplePair(Example.wrong('Er <marker>machte</marker> einen Kuchen.'),
                   Example.fixed('Das macht mir Angst.'));
  }

  /*
   * Is a unknown word (has only letters and no PosTag) 
   */
  private static isUnknownWord(token: AnalyzedTokenReadings): boolean {
    return token.isPosTagUnknown() && token.getToken().length > 2 && StringMatches(token.getToken(), '^[A-Za-zÄÖÜäöüß]+$');
  }

  private static isException(tokens: AnalyzedTokenReadings[], num: number): boolean {
    if (tokens[num]!.getToken().startsWith('sein') || tokens[num]!.getToken().startsWith('Sein')) {
      return true;
    } else if (tokens[num]!.hasLemma('machen')) {
      for (let i = 1; i < tokens.length; i++) {
        if ('Angst' === tokens[i]!.getToken() || 'Weg' === tokens[i]!.getToken() ||
            'frisch' === tokens[i]!.getToken() || 'bemerkbar' === tokens[i]!.getToken() ||
            'aufmerksam' === tokens[i]!.getToken()) {
          return true;
        }
      }
    } else {
      const isHaben = tokens[num]!.hasLemma('haben');
      if (isHaben) {
        for (let i = 1; i < tokens.length; i++) {
          const sToken = tokens[i]!.getToken();
          if (sToken === 'Glück' || sToken === 'Angst' || sToken === 'Mühe' ||
              sToken === 'Recht' || sToken === 'recht') {
            return true;
          }
        }
      }
      if (isHaben || tokens[num]!.hasLemma('sein')) {
        for (let i = 1; i < tokens.length; i++) {
          if (tokens[i]!.hasPosTagStartingWith('PA2') || tokens[i]!.hasPosTagStartingWith('VER:PA2') ||
              'Flucht' === tokens[i]!.getToken() || NonSignificantVerbsRule.isUnknownWord(tokens[i]!)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Minimal value is given in per mil
   */
  override denominator(): number {
    return 1000.0;
  }

  protected override conditionFulfilled(tokens: AnalyzedTokenReadings[], nAnalysedToken: number): number {
    if (tokens[nAnalysedToken]!.hasAnyLemma(...nonSignificant) && !NonSignificantVerbsRule.isException(tokens, nAnalysedToken)) {
      return nAnalysedToken;
    }
    return -1;
  }

  protected override sentenceConditionFulfilled(_tokens: AnalyzedTokenReadings[], _nToken: number): boolean {
    return false;
  }

  protected override excludeDirectSpeech(): boolean {
    return true;
  }

  protected override getLimitMessage(limit: number, percent: number): string {
    if (limit === 0) {
      return 'Dieses Verb hat wenig Aussagekraft. Verwenden Sie wenn möglich ein anderes oder formulieren Sie den Satz um.';
    }
    return 'Mehr als ' + limit + '‰ wenig aussagekräftige Verben {' + Math.trunc(percent + 0.5) +
        '‰} gefunden. Verwenden Sie wenn möglich ein anderes Verb oder formulieren Sie den Satz um.';
  }

  protected override getSentenceMessage(): string | null {
    return null;
  }

  override getId(): string {
    return 'NON_SIGNIFICANT_VERB_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Verben mit wenig Aussagekraft';
  }

  override getConfigurePercentText(): string {
    return 'Anzeigen wenn mehr als ...‰ eines Kapitels wenig aussagekräftige Verben sind:';
  }

  override getConfigureWithoutDirectSpeachText(): string {
    return 'Keine direkte Rede und Zitate berücksichtigen';
  }

}
