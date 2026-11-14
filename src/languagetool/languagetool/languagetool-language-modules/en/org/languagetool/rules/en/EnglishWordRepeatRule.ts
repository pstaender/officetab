// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishWordRepeatRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WordRepeatRule } from '../../../../../../languagetool-core/org/languagetool/rules/WordRepeatRule.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringMatches } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

let singleChar: Pattern | null = null;
const SINGLE_CHAR = (): Pattern => (singleChar ??= Pattern.compile('(?i)^[a-z]$'));

/**
 * Word repeat rule for English, to avoid false alarms in the generic word repetition rule.
 */
export class EnglishWordRepeatRule extends WordRepeatRule {

  constructor(messages: ResourceBundle, language: Language | null) {
    super(messages, language);
    this.addExamplePair(Example.wrong('This <marker>is is</marker> just an example sentence.'),
                   Example.fixed('This <marker>is</marker> just an example sentence.'));
  }

  override getId(): string {
    return 'ENGLISH_WORD_REPEAT_RULE';
  }

  override ignore(tokens: AnalyzedTokenReadings[], position: number): boolean {
    if (position === 0) {
      return false;
    }

    // TODO:
    // What that is is a ...
    // but you you're my best friend ...
    // I'm so so happy
    // I'm very very happy
    const word = tokens[position]!.getToken();

    if ((this.repetitionOf("did", tokens, position) || this.repetitionOf("do", tokens, position)
        || this.repetitionOf("does", tokens, position)) && (position + 1 < tokens.length)
        && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), "n't")) {
      return true;
    } else if (this.repetitionOf("her", tokens, position) && this.posIsIn(tokens, position - 2, "VB", "VBP", "VBZ", "VBG", "VBD", "VBN") && this.posIsIn(tokens, position + 1, "NN", "NNS", "NN:U", "NN:UN", "NNP")) {
      return true;   // "Please pass her her phone."
    } else if (this.repetitionOf("had", tokens, position) && this.posIsIn(tokens, position - 2, "PRP", "NN")) {
      return true;   // "If I had had time, I would have gone to see him."
    } else if (this.repetitionOf("that", tokens, position) && this.posIsIn(tokens, position+1, "MD", "NN", "PRP$", "JJ", "VBZ", "VBD")) {
      return true;   // "I don't think that that is a problem."
    } else if (this.repetitionOf("can", tokens, position) && this.posIsIn(tokens, position-1, "NN")) {
      return true; // "The can can hold the water."
    } else if (this.repetitionOf("hip", tokens, position) && (position + 1 < tokens.length) && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), "hooray")) {
      return true;
    } else if (this.repetitionOf("bam", tokens, position) && (position + 1 < tokens.length) && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), "bigelow")) {
      return true;
    } else if (this.repetitionOf("wild", tokens, position) && (position + 1 < tokens.length) && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), "west")) {
      return true; // In the wild wild west (https://en.wikipedia.org/wiki/Wild_Wild_West)
    } else if (this.repetitionOf("far", tokens, position) && (position + 1 < tokens.length) && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), "away")) {
      return true;
    } else if (this.repetitionOf("so", tokens, position) && (position + 1 < tokens.length) && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), "much")) {
      return true;
    } else if (this.repetitionOf("so", tokens, position) && (position + 1 < tokens.length) && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), "many")) {
      return true;
    } else if (this.repetitionOf("s", tokens, position) && position > 1 && StringMatches(tokens[position - 2]!.getToken(), "['’`´‘]")) {
      return true; // It's S.T.E.A.M.
    } else if (this.repetitionOf("in", tokens, position) && position > 2 && StringMatches(tokens[position - 3]!.getToken(), "log(ged|s)?|sign(ed|s)?")) {
      return true; // log them in in the
    } else if (this.repetitionOf("in", tokens, position) && position > 1 && StringMatches(tokens[position - 2]!.getToken(), "log(ged|s)?|sign(ed|s)?")) {
      return true; // log in in the
    } else if (this.repetitionOf("a", tokens, position) && position > 1 && tokens[position - 2]!.getToken() === ".") {
      return true; // "a.k.a a"
    } else if (this.repetitionOf("on", tokens, position) && position > 1 && tokens[position - 2]!.getToken() === ".") {
      return true; // "You can contact E.ON on Instagram"
    } else if (StringEqualsIgnoreCase(tokens[position - 1]!.getToken(), word) && (((position + 1 < tokens.length) && StringEqualsIgnoreCase(tokens[position + 1]!.getToken(), word)) || (position > 1 && StringEqualsIgnoreCase(tokens[position - 2]!.getToken(), word)))) {
      // three time word repetition
      return true;
    } else if (SINGLE_CHAR().matcher(tokens[position]!.getToken()).matches() && position > 1 &&
        SINGLE_CHAR().matcher(tokens[position - 2]!.getToken()).matches() &&
        (position + 1 < tokens.length) && SINGLE_CHAR().matcher(tokens[position + 1]!.getToken()).matches()) {
      // spelling with spaces in between: "b a s i c a l l y"
      return true;
    } else if (this.repetitionOf("aye", tokens, position)) {
      return true;   // "aye aye"
    } else if (this.repetitionOf("blah", tokens, position)) {
      return true;   // "blah blah"
    } else if (this.repetitionOf("mau", tokens, position)) {
      return true;   // "mau mau"
    } else if (this.repetitionOf("uh", tokens, position)) {
      return true;   // "uh uh"
    } else if (this.repetitionOf("paw", tokens, position)) {
      return true;   // "paw paw"
    } else if (this.repetitionOf("cha", tokens, position)) {
      return true;   // "cha cha"
    } else if (this.repetitionOf("yum", tokens, position)) {
      return true;   // "yum yum"
    } else if (this.repetitionOf("wop", tokens, position)) {
      return true;   // "wop wop"
    } else if (this.repetitionOf("woop", tokens, position)) {
      return true;   // "woop woop"
    } else if (this.repetitionOf("fnarr", tokens, position)) {
      return true;   // "fnarr fnarr" https://www.lexico.com/definition/fnarr_fnarr
    } else if (this.repetitionOf("fnar", tokens, position)) {
      return true;   // "fnar fnar"
    } else if (this.repetitionOf("ha", tokens, position)) {
      return true;   // "ha ha"
    } else if (this.repetitionOf("omg", tokens, position)) {
      return true;   // "omg omg"
    } else if (this.repetitionOf("boo", tokens, position)) {
      return true;   // "boo boo"
    } else if (this.repetitionOf("tick", tokens, position)) {
      return true;   // "tick tick"
    } else if (this.repetitionOf("twinkle", tokens, position)) {
      return true;   // "twinkle twinkle little star"
    } else if (this.repetitionOf("ta", tokens, position)) {
      return true;
    } else if (this.repetitionOf("la", tokens, position)) {
      return true;
    } else if (this.repetitionOf("x", tokens, position)) {
      return true;
    } else if (this.repetitionOf("hi", tokens, position)) {
      return true;   // "hi hi"
    } else if (this.repetitionOf("ho", tokens, position)) {
      return true;   // "ho ho"
    } else if (this.repetitionOf("heh", tokens, position)) {
      return true;
    } else if (this.repetitionOf("jay", tokens, position)) {
      return true; // Jay Jay (name)
    } else if (this.repetitionOf("walla", tokens, position)) {
      return true; // Walla Walla is a city in Washington State
    } else if (this.repetitionOf("sri", tokens, position)) {
      return true; // Sri Sri (name)
    } else if (this.repetitionOf("hey", tokens, position)) {
      return true;
    } else if (this.repetitionOf("hah", tokens, position)) {
      return true;
    } else if (this.repetitionOf("heh", tokens, position)) {
      return true;
    } else if (this.repetitionOf("oh", tokens, position)) {
      return true;
    } else if (this.repetitionOf("ouh", tokens, position)) {
      return true;
    } else if (this.repetitionOf("chop", tokens, position)) {
      return true;
    } else if (this.repetitionOf("ring", tokens, position)) {
      return true;
    } else if (this.repetitionOf("beep", tokens, position)) {
      return true;
    } else if (this.repetitionOf("bleep", tokens, position)) {
      return true;
    } else if (this.repetitionOf("yeah", tokens, position)) {
      return true;
    } else if (this.repetitionOf("gout", tokens, position)) {
      return true;
    } else if (this.repetitionOf("wait", tokens, position) && position === 2) {
      return true;
    } else if (this.repetitionOf("quack", tokens, position)) {
      return true;
    } else if (this.repetitionOf("meow", tokens, position)) {
      return true;
    } else if (this.repetitionOf("squawk", tokens, position)) {
      return true;
    } else if (this.repetitionOf("whoa", tokens, position)) {
      return true;
    } else if (this.repetitionOf("si", tokens, position)) {
      return true;
    } else if (this.repetitionOf("honk", tokens, position)) {
      return true;
    } else if (this.repetitionOf("brum", tokens, position)) {
      return true;
    } else if (this.repetitionOf("chi", tokens, position)) {
      // name
      return true;
    } else if (this.repetitionOf("santorio", tokens, position)) {
      // name
      return true;
    } else if (this.repetitionOf("lapu", tokens, position)) {
      // city
      return true;
    } else if (this.repetitionOf("chow", tokens, position)) {
      // dog breed https://en.wikipedia.org/wiki/Chow_Chow
      return true;
    } else if (this.repetitionOf("beep", tokens, position)) {
      return true;
    } else if (this.repetitionOf("shh", tokens, position)) {
      return true;
    } else if (this.repetitionOf("yummy", tokens, position)) {
      return true;
    } else if (this.repetitionOf("boom", tokens, position)) {
      return true;
    } else if (this.repetitionOf("bye", tokens, position)) {
      return true;
    } else if (this.repetitionOf("ah", tokens, position)) {
      return true;
    } else if (this.repetitionOf("aah", tokens, position)) {
      return true;
    } else if (this.repetitionOf("bang", tokens, position)) {
      return true;
    } else if (this.repetitionOf("woof", tokens, position)) {
      return true;
    } else if (this.repetitionOf("wink", tokens, position)) {
      return true;
    } else if (this.repetitionOf("yes", tokens, position)) {
      return true;
    } else if (this.repetitionOf("tsk", tokens, position)) {
      return true;
    } else if (this.repetitionOf("hush", tokens, position)) {
      return true;
    } else if (this.repetitionOf("ding", tokens, position)) {
      return true;
    } else if (this.repetitionOf("choo", tokens, position)) {
      return true;
    } else if (this.repetitionOf("miu", tokens, position)) {
      return true;
    } else if (this.repetitionOf("tuk", tokens, position)) {
      return true;
    } else if (this.repetitionOf("yadda", tokens, position)) {
      return true;   // "yadda yadda"
    } else if (this.repetitionOf("walla", tokens, position)) {
      return true;   // "walla walla"
    } else if (this.repetitionOf("doo", tokens, position)) {
      return true;   // "doo doo"
    } else if (this.repetitionOf("sapiens", tokens, position)) {
      return true;   // "Homo sapiens sapiens"
    } else if (this.repetitionOf("tse", tokens, position)) {
      return true;   // "tse tse"
    } else if (this.repetitionOf("no", tokens, position)) {
      return true;   // "no no"
    } else if (this.repetitionOf("Bora", tokens, position)) {
      return true;   // "Bora Bora"
    } else if (tokens[position]!.getToken().endsWith("ay")) {
      if (tokens[position - 1]!.getToken() === "may" && tokens[position]!.getToken() === "May") {
        return true;   // "may May"
      }
      if (tokens[position - 1]!.getToken() === "May" && tokens[position]!.getToken() === "may") {
        return true;   // "May may"
      }
      if (tokens[1]!.getToken() === "May" && tokens[2]!.getToken() === "May") {
        return true;   // "May May" SENT_START
      }
    } else if (tokens[position]!.getToken().endsWith("ill")) {
      return (position > 0 && tokens[position - 1]!.getToken() === "will" && tokens[position]!.getToken() === "Will") // will Wills
        || (tokens[position - 1]!.getToken() === "Will" && tokens[position]!.getToken() === "will") // Will will ...
        || (tokens[1]!.getToken() === "Will" && tokens[2]!.getToken() === "Will"); // "Will Will" SENT_START
    }
    return super.ignore(tokens, position);
  }

  private posIsIn(tokens: AnalyzedTokenReadings[], position: number, ...posTags: string[]): boolean {
    if (position >= 0 && position < tokens.length) {
      for (const posTag of posTags) {
        if (tokens[position]!.hasPartialPosTag(posTag)) {
          return true;
        }
      }
    }
    return false;
  }

  private repetitionOf(word: string, tokens: AnalyzedTokenReadings[], position: number): boolean {
    return position > 0 && StringEqualsIgnoreCase(tokens[position - 1]!.getToken(), word) && StringEqualsIgnoreCase(tokens[position]!.getToken(), word);
  }

}
