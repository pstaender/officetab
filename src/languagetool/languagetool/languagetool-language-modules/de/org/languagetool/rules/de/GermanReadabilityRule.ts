// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanReadabilityRule.java faithful
// The four constructors are one, as ReadabilityRule's: (messages, lang, userConfig, tooEasyTest,
// level?, defaultOn?), where a boolean in place of level is defaultOn. The two getId overloads are
// one with an optional parameter. The field tooEasyTest is _tooEasyTest: ReadabilityRule has a
// private field of that name (Java's subclass field hides it, TypeScript does not allow that).
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { Category, Location } from '../../../../../../languagetool-core/org/languagetool/rules/Category.ts';
import { CategoryId } from '../../../../../../languagetool-core/org/languagetool/rules/CategoryId.ts';
import { ReadabilityRule } from '../../../../../../languagetool-core/org/languagetool/rules/ReadabilityRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { GermanTools } from './GermanTools.ts';

/**
 * A rule that checks the readability of German text (using the Flesch-Reading-Ease Formula)
 * If tooEasyTest == true, the rule tests if paragraph level &gt; level (readability is too easy)
 * If tooEasyTest == false, the rule tests if paragraph level &lt; level (readability is too difficult)
 * @author Fred Kruse
 * @since 4.4
 */
export class GermanReadabilityRule extends ReadabilityRule {

  private readonly _tooEasyTest: boolean;

  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null,
      tooEasyTest: boolean, level: number | boolean = -1, defaultOn = false) {
    if (typeof level === 'boolean') {
      defaultOn = level;
      level = -1;
    }
    super(messages, lang, userConfig, tooEasyTest, level, defaultOn);
    super.setCategory(new Category(new CategoryId('CREATIVE_WRITING'), messages.getString('category_creative_writing'), Location.INTERNAL, false));
    this._tooEasyTest = tooEasyTest;
  }

  override getId(tooEasyTest: boolean = this._tooEasyTest): string {
    if (tooEasyTest) {
      return 'READABILITY_RULE_SIMPLE_DE';
    } else {
      return 'READABILITY_RULE_DIFFICULT_DE';
    }
  }

  override getDescription(): string {
    if (this._tooEasyTest) {
      return 'Lesbarkeit: Zu einfacher Text';
    } else {
      return 'Lesbarkeit: Zu schwieriger Text';
    }
  }

  override printMessageLevel(level: number): string {
    let sLevel: string | null = null;
    if (level === 0) {
      sLevel = 'Sehr schwer';
    } else if (level === 1) {
      sLevel = 'Schwer';
    } else if (level === 2) {
      sLevel = 'Mittelschwer';
    } else if (level === 3) {
      sLevel = 'Mittel';
    } else if (level === 4) {
      sLevel = 'Mittelleicht';
    } else if (level === 5) {
      sLevel = 'Leicht';
    } else if (level === 6) {
      sLevel = 'Sehr leicht';
    }
    if (sLevel != null) {
      return ' {Grad ' + level + ': ' + sLevel + '}';
    }
    return '';
  }

  protected override getMessage(level: number, _fre: number, _als: number, _asw: number): string {
    let simple: string;
    let few: string;
    if (this._tooEasyTest) {
      simple = 'einfach';
      few = 'wenige';
    } else {
      simple = 'schwierig';
      few = 'viele';
    }
    return 'Lesbarkeit: Der Text dieses Absatzes ist zu ' + simple + this.printMessageLevel(level) + '. Zu '
        + few + ' Wörter pro Satz und zu ' + few + ' Silben pro Wort.';
  }

  override getConfigureText(): string {
    return 'Grad der Lesbarkeit 0 (sehr schwierig) bis 6 (sehr einfach):';
  }

  override getFleschReadingEase(asl: number, asw: number): number {
    return 180 - asl - ( 58.5 * asw );  //  German
  }

  protected override simpleSyllablesCount(word: string): number {
    if (word.length === 0) {
      return 0;
    }
    let nSyllables = 0;
    if (GermanTools.isVowel(word.charAt(0))) {
      nSyllables++;
    }
    let lastDouble = false;
    for (let i = 1; i < word.length; i++) {
      const c = word.charAt(i);
      if (GermanTools.isVowel(c)) {
        const cl = word.charAt(i - 1);
        if (lastDouble) {
          nSyllables++;
          lastDouble = false;
        } else if (((c === 'i' || c === 'y') && (cl === 'a' || cl === 'e' || cl === 'A' || cl === 'E')) ||
            (c === 'u' && (cl === 'a' || cl === 'e' || cl === 'o' || cl === 'A' || cl === 'E' || cl === 'O')) ||
            (c === 'e' && (cl === 'e' || cl === 'i' || cl === 'E' || cl === 'I')) ||
            (c === 'a' && (cl === 'a' || cl === 'A'))) {
          lastDouble = true;
        } else {
          nSyllables++;
          lastDouble = false;
        }
      } else {
        lastDouble = false;
      }
    }
    return nSyllables === 0 ? 1 : nSyllables;
  }

}
